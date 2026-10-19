# AWS S3 backup setup

One-time setup, run from your own machine with admin AWS credentials.
Nothing here runs on the VPS. Requires AWS CLI v2 and `age`.

```sh
export BUCKET=scrappy-meals-backups-<something-unique>
export AWS_REGION=eu-central-1
```

These become `S3_BUCKET` and `S3_REGION` in the VPS `.env`. `S3_REGION` must
equal `AWS_REGION` here.

## 1. Encryption key (age)

```sh
age-keygen -o age-identity.txt
grep 'public key' age-identity.txt     # -> AGE_RECIPIENT in the VPS .env
```

Store `age-identity.txt` in your password manager, then delete the local file.
**Without it the backups cannot be decrypted.** It never goes on the VPS.

## 2. Bucket

Object Lock can only be enabled at creation time.

```sh
aws s3api create-bucket --bucket "$BUCKET" --region "$AWS_REGION" \
  --create-bucket-configuration LocationConstraint="$AWS_REGION" \
  --object-lock-enabled-for-bucket          # also turns on versioning

aws s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

aws s3api put-bucket-encryption --bucket "$BUCKET" \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

# Every new object is undeletable for 30 days (governance mode: an admin
# with s3:BypassGovernanceRetention can still remove one deliberately).
aws s3api put-object-lock-configuration --bucket "$BUCKET" \
  --object-lock-configuration \
  '{"ObjectLockEnabled":"Enabled","Rule":{"DefaultRetention":{"Mode":"GOVERNANCE","Days":30}}}'
```

## 3. Retention (lifecycle)

- `daily/`: expires after 31 days (just past the 30-day lock).
- `monthly/` (first backup of each month): Glacier Instant Retrieval, expires after 365 days.
- Expired versions are cleaned up a day later; incomplete uploads after 1 day.

```sh
cat > lifecycle.json <<'JSON'
{
  "Rules": [
    {
      "ID": "daily",
      "Status": "Enabled",
      "Filter": { "Prefix": "daily/" },
      "Expiration": { "Days": 31 },
      "NoncurrentVersionExpiration": { "NoncurrentDays": 1 },
      "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 1 }
    },
    {
      "ID": "monthly",
      "Status": "Enabled",
      "Filter": { "Prefix": "monthly/" },
      "Transitions": [{ "Days": 0, "StorageClass": "GLACIER_IR" }],
      "Expiration": { "Days": 365 },
      "NoncurrentVersionExpiration": { "NoncurrentDays": 1 },
      "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 1 }
    },
    {
      "ID": "expired-delete-markers",
      "Status": "Enabled",
      "Filter": {},
      "Expiration": { "ExpiredObjectDeleteMarker": true }
    }
  ]
}
JSON
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" \
  --lifecycle-configuration file://lifecycle.json
```

## 4. Write-only IAM user for the VPS

The VPS key can upload and list, nothing else: no reads, no deletes, no
changes to lock or lifecycle settings. If the VPS is compromised, existing
backups stay intact and unreadable.

```sh
cat > backup-writer.json <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::$BUCKET/*" },
    { "Effect": "Allow", "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::$BUCKET" }
  ]
}
JSON
aws iam create-user --user-name scrappy-meals-backup
aws iam put-user-policy --user-name scrappy-meals-backup \
  --policy-name backup-writer --policy-document file://backup-writer.json
aws iam create-access-key --user-name scrappy-meals-backup
# -> BACKUP_AWS_ACCESS_KEY_ID / BACKUP_AWS_SECRET_ACCESS_KEY in the VPS .env
```

## 5. Schedule on the VPS

```sh
echo '15 3 * * * root /opt/scrappy-meals/scripts/backup.sh >> /var/log/scrappy-meals-backup.log 2>&1' \
  | sudo tee /etc/cron.d/scrappy-meals
```

Run one by hand first: `scripts/backup.sh`, then check the bucket.

Optional: create a check on healthchecks.io (daily, 1 h grace) and put its
ping URL in `BACKUP_PING_URL`. You get an email if a night is missed or fails.

## 6. Restoring

Use read credentials (your admin profile, or a temporary key) and the age
identity from your password manager. See `scripts/restore.sh`:

```sh
RESTORE_AWS_ACCESS_KEY_ID=... RESTORE_AWS_SECRET_ACCESS_KEY=... \
AGE_IDENTITY_FILE=./age-identity.txt \
  scripts/restore.sh daily latest          # or: daily 2026-10-19, monthly 2026-09-01
```

It downloads, decrypts and checksums the run, asks for confirmation, stops
the app and Mealie, replaces both databases and the Mealie data volume, then
starts them again. Delete `age-identity.txt` afterwards.

Practise this on a fresh VM once a quarter so you know it works.
