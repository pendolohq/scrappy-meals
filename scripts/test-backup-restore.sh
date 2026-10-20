#!/bin/sh
# Backup -> restore round trip on a throwaway stack: the real compose file,
# Postgres with postgres/init, a real Mealie, and a mock S3 instead of AWS.
# Run by CI; works locally too (needs only Docker). Leaves nothing behind.
set -eu
cd "$(dirname "$0")/.."

export COMPOSE_PROJECT_NAME=scrappy-backup-test
export COMPOSE_FILE=docker-compose.yml:scripts/backup-test.compose.yml
export POSTGRES_SUPERUSER_PASSWORD=test-super PLANNER_DB_PASSWORD=test-planner \
  MEALIE_DB_PASSWORD=test-mealie DOMAIN=example.test ACME_EMAIL=ci@example.test \
  AUTH_SECRET=unused APP_IMAGE=unused \
  S3_BUCKET=backups S3_REGION=us-east-1 S3_ENDPOINT=http://s3:9090 \
  BACKUP_AWS_ACCESS_KEY_ID=test BACKUP_AWS_SECRET_ACCESS_KEY=test \
  RESTORE_AWS_ACCESS_KEY_ID=test RESTORE_AWS_SECRET_ACCESS_KEY=test

work=$(mktemp -d)
cleanup() {
  docker compose --profile ops down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT
trap 'exit 130' INT TERM HUP

sql() { docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -tAq "$@"; }
mealie_up() {
  docker compose exec -T mealie python -c \
    "import urllib.request; urllib.request.urlopen('http://localhost:9000/api/app/about')" \
    >/dev/null 2>&1
}
wait_for() {
  i=0
  until "$@"; do
    i=$((i + 1))
    [ "$i" -lt 60 ] || { echo "timed out waiting for: $*" >&2; exit 1; }
    sleep 3
  done
}
check() {
  [ "$2" = "$3" ] || { echo "FAIL: $1: expected '$3', got '$2'" >&2; exit 1; }
  echo "ok: $1"
}

docker compose build backup
docker compose up -d --wait postgres
docker compose up -d s3 mealie
wait_for mealie_up

docker compose run --rm -T --entrypoint age-keygen backup > "$work/age-identity.txt" 2>/dev/null
AGE_RECIPIENT=$(grep -o 'age1[a-z0-9]*' "$work/age-identity.txt" | head -n 1)
export AGE_RECIPIENT

# Data to get back: a planner table owned by the app role, Mealie's own
# tables, and a file in Mealie's data volume.
sql -U planner -d planner -c "CREATE TABLE backup_check (note text); INSERT INTO backup_check VALUES ('before')"
mealie_tables=$(sql -U mealie -d mealie -c "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")
docker compose exec -T mealie sh -c 'echo before > /app/data/backup-check.txt'

docker compose run --rm -T backup

# A planted run dated in the future must be ignored by "latest".
echo planted > "$work/SHA256SUMS"
docker compose run --rm -T -v "$work/SHA256SUMS:/planted:ro" --entrypoint aws backup \
  --region us-east-1 --endpoint-url http://s3:9090 \
  s3 cp /planted s3://backups/daily/2099/01/01/000000Z/SHA256SUMS >/dev/null

# Change everything, then restore.
sql -U planner -d planner -c "UPDATE backup_check SET note = 'after'"
docker compose exec -T mealie sh -c 'echo after > /app/data/backup-check.txt'

RESTORE_YES=1 AGE_IDENTITY_FILE="$work/age-identity.txt" scripts/restore.sh daily latest

check "planner row restored" "$(sql -U planner -d planner -c 'SELECT note FROM backup_check')" before
check "planner table owned by the app role" \
  "$(sql -U postgres -d planner -c "SELECT tableowner FROM pg_tables WHERE tablename = 'backup_check'")" planner
check "mealie tables restored" \
  "$(sql -U mealie -d mealie -c "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")" "$mealie_tables"
check "mealie file restored" "$(docker compose exec -T mealie cat /app/data/backup-check.txt)" before
wait_for mealie_up
echo "ok: mealie starts on the restored data"
echo "Backup and restore round trip passed."
