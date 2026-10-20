#!/bin/sh
# Backup/restore helper. Runs inside the `backup` / `restore` compose services.
#
#   ops backup                     dump, encrypt, upload to S3
#   ops fetch <daily|monthly> <YYYY-MM-DD|latest>
#                                  download, decrypt and verify one run into RESTORE_DIR
#   ops restore-db                 replace the planner + mealie DBs from RESTORE_DIR
#   ops restore-files              replace the Mealie data volume from RESTORE_DIR
set -eu
# A failing aws or pg_dump inside a pipe must fail the run, not look like "no backup".
set -o pipefail

DBS="planner mealie"
DATA_DIR=${MEALIE_DATA_DIR:-/mealie-data}
RESTORE_DIR=${RESTORE_DIR:-/restore}
AGE_IDENTITY=${AGE_IDENTITY:-/run/age-identity}

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

aws_s3() {
  if [ -n "${S3_ENDPOINT:-}" ]; then
    aws --region "$S3_REGION" --endpoint-url "$S3_ENDPOINT" "$@"
  else
    aws --region "$S3_REGION" "$@"
  fi
}

ping() {
  [ -n "${BACKUP_PING_URL:-}" ] || return 0
  curl -fsS -m 10 --retry 3 "${BACKUP_PING_URL}$1" >/dev/null || log "ping failed (ignored)"
}

backup() {
  : "${S3_BUCKET:?S3_BUCKET is required}"
  : "${AGE_RECIPIENT:?AGE_RECIPIENT is required}"

  # TMPDIR is a disk-backed volume: dumps can outgrow RAM.
  work=$(mktemp -d)
  trap 'rm -rf "$work"; ping /fail' EXIT

  stamp=$(date -u +%H%M%SZ)
  prefixes="daily/$(date -u +%Y/%m/%d)/$stamp"
  # First run of each month is also kept as the monthly copy (longer lifecycle).
  [ "$(date -u +%d)" = "01" ] && prefixes="$prefixes monthly/$(date -u +%Y/%m)/$stamp"

  # Everything is encrypted as it is written, so no plaintext copy touches disk.
  ping /start
  for db in $DBS; do
    log "dumping $db"
    pg_dump -Fc -d "$db" | age -r "$AGE_RECIPIENT" -o "$work/$db.dump.age"
  done
  pg_dumpall --globals-only --no-role-passwords | age -r "$AGE_RECIPIENT" -o "$work/globals.sql.age"

  log "archiving mealie data volume"
  # Mealie keeps running, so files may change or vanish while tar reads them.
  # GNU tar exits 1 for that; the archive is still usable.
  {
    tar -C "$DATA_DIR" --warning=no-file-changed --warning=no-file-removed -czf - . \
      || [ $? -eq 1 ]
  } | age -r "$AGE_RECIPIENT" -o "$work/mealie-data.tar.gz.age"

  (cd "$work" && sha256sum -- *.age > SHA256SUMS)
  want=$(find "$work" -type f | wc -l)

  for p in $prefixes; do
    # SHA256SUMS goes up last: fetch only picks runs that have it, so a run that
    # died halfway is never taken for the latest one.
    for f in "$work"/*.age "$work/SHA256SUMS"; do
      key="$p/$(basename "$f")"
      log "uploading s3://$S3_BUCKET/$key"
      aws_s3 s3api put-object --bucket "$S3_BUCKET" --key "$key" \
        --body "$f" --checksum-algorithm SHA256 >/dev/null
    done
    # Verify every object landed (ListBucket only; the key has no GetObject).
    got=$(aws_s3 s3api list-objects-v2 --bucket "$S3_BUCKET" --prefix "$p/" \
      --query 'length(Contents)' --output text)
    [ "$got" -eq "$want" ] || die "expected $want objects under $p/, found $got"
  done

  rm -rf "$work"
  trap - EXIT
  ping ""
  log "backup complete: $prefixes"
}

fetch() {
  usage="usage: fetch <daily|monthly> <YYYY-MM-DD|latest>"
  kind=${1:?$usage}
  when=${2:?$usage}
  : "${S3_BUCKET:?S3_BUCKET is required}"
  [ -s "$AGE_IDENTITY" ] || die "no age identity at $AGE_IDENTITY"

  case "$kind" in
    daily | monthly) ;;
    *) die "$usage" ;;
  esac
  search="$kind/"
  if [ "$when" != latest ]; then
    echo "$when" | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' || die "$usage"
    ymd=$(echo "$when" | tr - /)
    if [ "$kind" = daily ]; then search="daily/$ymd/"; else search="monthly/${ymd%/*}/"; fi
  fi

  # Keys sort by date then time, so the last complete run is the newest. Runs
  # dated in the future can only have been planted (the VPS key can write).
  now=$(date -u +%Y%m%d%H%M%S)
  run=$(aws_s3 s3api list-objects-v2 --bucket "$S3_BUCKET" --prefix "$search" \
    --query 'Contents[].Key' --output text | tr '\t' '\n' \
    | { grep '/SHA256SUMS$' || true; } | sed 's#/[^/]*$##' | sort -u \
    | while read -r r; do
      d=$(echo "$r" | sed 's#^[a-z]*/##; s#[/Z]##g')
      # monthly/YYYY/MM/HHMMSSZ has no day: compare it as the 1st.
      if [ ${#d} -eq 12 ]; then d="${d%??????}01${d#??????}"; fi
      if [ "$d" -le "$now" ]; then echo "$r"; fi
    done | tail -n 1)
  [ -n "$run" ] || die "no complete backup found under $search"
  log "fetching $run"

  find "$RESTORE_DIR" -mindepth 1 -delete
  aws_s3 s3 cp --recursive --only-show-errors "s3://$S3_BUCKET/$run/" "$RESTORE_DIR/"
  (cd "$RESTORE_DIR" && sha256sum -c SHA256SUMS >/dev/null) || die "checksum mismatch"
  for f in "$RESTORE_DIR"/*.age; do
    age -d -i "$AGE_IDENTITY" -o "${f%.age}" "$f"
    rm "$f"
  done
  {
    echo "$run"
    echo "Uploaded:"
    aws_s3 s3api list-objects-v2 --bucket "$S3_BUCKET" --prefix "$run/" \
      --query 'Contents[].[LastModified,Key]' --output text | sed 's/^/  /'
  } > "$RESTORE_DIR/SOURCE"
  log "fetched and verified $run"
}

restore_db() {
  for db in $DBS; do
    [ -s "$RESTORE_DIR/$db.dump" ] || die "$RESTORE_DIR/$db.dump missing; run fetch first"
  done
  for db in $DBS; do
    log "restoring $db"
    dropdb --if-exists --force "$db"
    createdb -O "$db" "$db"
    psql -q -d postgres -c "REVOKE ALL ON DATABASE $db FROM PUBLIC"
    # Restore as the app role, not the superuser: everything restored is owned
    # by it (so migrations keep working), and a tampered dump can't run
    # superuser SQL.
    pw=$(printenv "$(echo "$db" | tr a-z A-Z)_DB_PASSWORD") || die "${db}_DB_PASSWORD not set"
    PGUSER=$db PGPASSWORD=$pw pg_restore --exit-on-error --single-transaction \
      --no-owner --no-privileges -d "$db" "$RESTORE_DIR/$db.dump"
  done
  log "databases restored"
}

restore_files() {
  archive="$RESTORE_DIR/mealie-data.tar.gz"
  [ -s "$archive" ] || die "$archive missing; run fetch first"
  log "replacing mealie data volume"
  find "$DATA_DIR" -mindepth 1 -delete
  tar -C "$DATA_DIR" -xzf "$archive"
  log "mealie data restored"
}

cmd=${1:-backup}
[ $# -gt 0 ] && shift
case "$cmd" in
  backup) backup ;;
  fetch) fetch "$@" ;;
  restore-db) restore_db ;;
  restore-files) restore_files ;;
  *) die "unknown command: $cmd" ;;
esac
