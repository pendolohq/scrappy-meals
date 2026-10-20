#!/bin/sh
# Nightly backup entry point for host cron, e.g. /etc/cron.d/scrappy-meals:
#   15 3 * * * deploy /opt/scrappy-meals/scripts/backup.sh >> /var/log/scrappy-meals-backup.log 2>&1
set -eu
cd "$(dirname "$0")/.."
exec docker compose run --rm -T backup
