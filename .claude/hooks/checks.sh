#!/bin/sh
# Stop hook: runs the checks once the agent is done, so the agent doesn't run
# them itself. Exit 2 hands the failures back to the agent to fix.
set -u
cd "$CLAUDE_PROJECT_DIR" || exit 0
cat >/dev/null # the hook's JSON input; nothing in it is needed

# Skip when app/ is unchanged since the last run that passed.
passed=$(git rev-parse --path-format=absolute --git-path claude-checks-passed)
blocked=$(git rev-parse --path-format=absolute --git-path claude-checks-blocked)
fingerprint=$(
  {
    git rev-parse HEAD:app
    git diff HEAD -- app
    git ls-files -o --exclude-standard -- app | while read -r f; do git hash-object "$f"; done
  } | git hash-object --stdin
)
[ "$(cat "$passed" 2>/dev/null)" = "$fingerprint" ] && { rm -f "$blocked"; exit 0; }

cd app
log=$(mktemp)
trap 'rm -f "$log"' EXIT
steps="format:check lint typecheck test"
[ -n "${DATABASE_TEST_URL:-}" ] && steps="$steps test:db"
for step in $steps; do
  if ! bun run "$step" >"$log" 2>&1; then
    tries=$(($(cat "$blocked" 2>/dev/null || echo 0) + 1))
    # Don't keep the agent going forever on something it can't fix.
    if [ "$tries" -gt 3 ]; then
      rm -f "$blocked"
      printf '{"systemMessage": "Checks: bun run %s still fails after 3 attempts."}\n' "$step"
      exit 0
    fi
    echo "$tries" >"$blocked"
    {
      echo "bun run $step failed (from app/). Fix it; the checks run again when you stop."
      tail -n 80 "$log"
    } >&2
    exit 2
  fi
done
rm -f "$blocked"
echo "$fingerprint" >"$passed"
