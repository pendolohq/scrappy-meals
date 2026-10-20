#!/bin/sh
# Local development: starts docker-compose.dev.yml, creates the test databases,
# writes app/.env.local on first run (or a fresh Mealie token when the stored
# one stops working) and applies migrations. Safe to re-run.
# Reset everything with: docker compose -f docker-compose.dev.yml down -v
set -eu
cd "$(dirname "$0")/.."

compose() { docker compose -f docker-compose.dev.yml "$@"; }
mealie=http://localhost:9000
env_file=app/.env.local
# Mealie's first-boot admin; override if you changed it in the local Mealie.
mealie_user=${MEALIE_DEV_USER:-changeme@example.com}
mealie_password=${MEALIE_DEV_PASSWORD:-MyPassword}

compose up -d --wait postgres </dev/null
compose up -d mealie </dev/null

for db in planner_test planner_e2e; do
  if ! compose exec -T postgres psql -U postgres -tAc \
    "SELECT 1 FROM pg_database WHERE datname = '$db'" </dev/null | grep -q 1; then
    compose exec -T postgres createdb -U postgres "$db" </dev/null
  fi
done

echo "Waiting for Mealie..."
i=0
until curl -fsS "$mealie/api/app/about" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -gt 60 ]; then
    echo "Mealie did not start; see: docker compose -f docker-compose.dev.yml logs mealie" >&2
    exit 1
  fi
  sleep 3
done

json_field() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s)[process.argv[1]]??""))' "$1"; }

new_token() {
  jwt=$(curl -fsS -X POST "$mealie/api/auth/token" \
    --data-urlencode "username=$mealie_user" --data-urlencode "password=$mealie_password" |
    json_field access_token)
  curl -fsS -X POST "$mealie/api/users/api-tokens" \
    -H "Authorization: Bearer $jwt" -H 'Content-Type: application/json' \
    -d "{\"name\":\"dev-$(date +%s)\"}" | json_field token
}

if [ ! -f "$env_file" ]; then
  umask 077
  cat >"$env_file" <<ENV
DATABASE_URL=postgres://postgres@localhost:5432/planner
AUTH_SECRET=$(openssl rand -hex 32)
AUTH_URL=http://localhost:3000
MEALIE_URL=$mealie
MEALIE_PUBLIC_URL=$mealie
MEALIE_API_TOKEN=$(new_token)
ENV
  echo "Wrote $env_file"
else
  token=$(sed -n 's/^MEALIE_API_TOKEN=//p' "$env_file")
  # A wiped Mealie volume invalidates the stored token.
  if ! curl -fsS -H "Authorization: Bearer $token" "$mealie/api/users/self" >/dev/null 2>&1; then
    tmp=$(mktemp)
    grep -v '^MEALIE_API_TOKEN=' "$env_file" >"$tmp" || true
    echo "MEALIE_API_TOKEN=$(new_token)" >>"$tmp"
    cat "$tmp" >"$env_file" && rm -f "$tmp"
    echo "Refreshed MEALIE_API_TOKEN in $env_file"
  fi
fi

cd app
bun install </dev/null
set -a
. ./.env.local
set +a
bunx tsx --conditions=react-server src/cli/migrate.ts </dev/null

if bun run --silent cli user list </dev/null | grep -q '^No users yet'; then
  echo "Create your login for the planner:"
  bun run --silent cli user add
fi

cat <<'DONE'

Ready. Start the app from app/ with: bun run dev   (http://localhost:3000)
Mealie: http://localhost:9000 (changeme@example.com / MyPassword); add a few
recipes with servings, nutrition and parsed ingredients.
More users: set -a; . ./.env.local; set +a; bun run cli user add
DONE
