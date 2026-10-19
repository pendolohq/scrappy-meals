#!/bin/sh
# Restore a backup from S3 into this stack. Destroys the current planner and
# mealie databases and the Mealie data volume.
#
#   RESTORE_AWS_ACCESS_KEY_ID=... RESTORE_AWS_SECRET_ACCESS_KEY=... \
#   AGE_IDENTITY_FILE=/path/to/age-identity.txt \
#     scripts/restore.sh [daily|monthly] [YYYY-MM-DD|latest]
#
# Use admin (read) credentials, not the write-only backup key. Bring the age
# identity in from your password manager for the duration of the restore only.
set -eu
cd "$(dirname "$0")/.."

kind=${1:-daily}
when=${2:-latest}

: "${RESTORE_AWS_ACCESS_KEY_ID:?set RESTORE_AWS_ACCESS_KEY_ID (read access to the bucket)}"
: "${RESTORE_AWS_SECRET_ACCESS_KEY:?set RESTORE_AWS_SECRET_ACCESS_KEY}"
: "${AGE_IDENTITY_FILE:?set AGE_IDENTITY_FILE to your age private key file}"
[ -r "$AGE_IDENTITY_FILE" ] || { echo "cannot read $AGE_IDENTITY_FILE" >&2; exit 1; }

RESTORE_WORKDIR=$(mktemp -d /var/tmp/scrappy-restore.XXXXXX)
chmod 700 "$RESTORE_WORKDIR"
export RESTORE_WORKDIR AGE_IDENTITY_FILE
trap 'rm -rf "$RESTORE_WORKDIR"' EXIT

docker compose up -d --wait postgres
docker compose run --rm -T restore fetch "$kind" "$when"
echo "About to replace live data with $(cat "$RESTORE_WORKDIR/SOURCE")."
if [ "${RESTORE_YES:-}" != 1 ]; then
  printf 'Type "restore" to continue: '
  read -r answer
  [ "$answer" = restore ] || { echo "aborted"; exit 1; }
fi

# Bring back whatever was running before (the app may not be deployed yet).
running=$(docker compose ps --services --status running | grep -E '^(app|mealie)$' || true)
docker compose stop app mealie
docker compose run --rm -T restore restore-db
docker compose run --rm -T restore restore-files
[ -n "$running" ] && docker compose start $running
echo "Restore complete."
