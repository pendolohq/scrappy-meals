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
age-keygen -y age-identity.txt         # -> AGE_RECIPIENT in the VPS .env
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
backups stay unreadable (no read access, and the age identity isn't there) and
locked: every stored version survives.

What the attacker *can* do is upload new objects, including a fake run that
looks newer, or a new version of an existing key. Restore defends against the
obvious cases: `latest` ignores runs dated in the future, the confirmation
shows when each object was uploaded, and `pg_restore` runs as the app roles,
so a crafted dump can't run superuser SQL. After a break-in, restore a named
date from before it (`scripts/restore.sh daily 2026-10-01`) and check the
upload times it shows.

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

Set up the nightly cron job and the failure alert as in
[deploy.md](deploy.md) §6. Run one by hand first (`scripts/backup.sh`), then
check the bucket.

## 6. Restoring

Use read credentials (your admin profile, or a temporary key) and the age
identity from your password manager. See `scripts/restore.sh`:

```sh
RESTORE_AWS_ACCESS_KEY_ID=... RESTORE_AWS_SECRET_ACCESS_KEY=... \
AGE_IDENTITY_FILE=./age-identity.txt \
  scripts/restore.sh daily latest          # or: daily 2026-10-19, monthly 2026-09-01
```

It downloads the newest *complete* run (one whose `SHA256SUMS` was uploaded,
which happens last), checks and decrypts it, shows what it is about to restore
and asks for confirmation. Then it stops the app and Mealie, replaces both
databases (each in one transaction) and the Mealie data volume, and starts
again whatever was running before. Delete `age-identity.txt` afterwards.

`scripts/test-backup-restore.sh` runs the whole round trip against a
throwaway stack with a mock S3; CI runs it whenever the backup code changes.
Still practise a real restore on a fresh VM once in a while.
