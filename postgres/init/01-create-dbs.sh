#!/bin/sh
# Runs once, on first boot of an empty data volume.
# Creates one role + database per app so Mealie and the planner never share credentials.
set -eu

: "${PLANNER_DB_PASSWORD:?PLANNER_DB_PASSWORD is required}"
: "${MEALIE_DB_PASSWORD:?MEALIE_DB_PASSWORD is required}"

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" --dbname postgres \
  -v planner_pw="$PLANNER_DB_PASSWORD" \
  -v mealie_pw="$MEALIE_DB_PASSWORD" <<'SQL'
CREATE ROLE planner LOGIN PASSWORD :'planner_pw';
CREATE DATABASE planner OWNER planner;
REVOKE ALL ON DATABASE planner FROM PUBLIC;

CREATE ROLE mealie LOGIN PASSWORD :'mealie_pw';
CREATE DATABASE mealie OWNER mealie;
REVOKE ALL ON DATABASE mealie FROM PUBLIC;
SQL
