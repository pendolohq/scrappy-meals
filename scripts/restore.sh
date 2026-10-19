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
stopped=
cleanup() {
  status=$?
  rm -rf "$RESTORE_WORKDIR"
  if [ "$status" -ne 0 ] && [ -n "$stopped" ]; then
    echo "Restore failed with the app and Mealie stopped. Each database is either fully" >&2
    echo "restored or empty, and the Mealie files may be partly replaced. Run the restore" >&2
    echo "again, or start them as they are: docker compose start app mealie" >&2
  fi
}
trap cleanup EXIT
# dash skips the EXIT trap when killed by a signal; exiting here runs it, so the
# decrypted dumps don't stay behind.
trap 'exit 130' INT TERM HUP

docker compose up -d --wait postgres
docker compose run --rm -T restore fetch "$kind" "$when"
echo "About to replace live data with:"
cat "$RESTORE_WORKDIR/SOURCE"
if [ "${RESTORE_YES:-}" != 1 ]; then
  printf 'Type "restore" to continue: '
  read -r answer
  [ "$answer" = restore ] || { echo "aborted"; exit 1; }
fi

# Bring back whatever was running before (the app may not be deployed yet).
running=$(docker compose ps --services --status running | grep -E '^(app|mealie)$' || true)
stopped=1
docker compose stop app mealie
docker compose run --rm -T restore restore-db
docker compose run --rm -T restore restore-files
stopped=
if [ -n "$running" ]; then
  docker compose start $running
else
  echo "Nothing was running before; start the stack with: docker compose up -d"
fi
echo "Restore complete."
