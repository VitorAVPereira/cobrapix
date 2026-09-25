#!/usr/bin/env bash
set -eu

# The official image runs this only when initializing an empty data volume.
# API/migrations own their database but do not use the PostgreSQL superuser.
: "${APP_DB_PASSWORD:?APP_DB_PASSWORD ausente}"
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=ON_ERROR_STOP=1 --set=app_password="$APP_DB_PASSWORD" <<'SQL'
CREATE ROLE ciframais LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
ALTER DATABASE ciframais OWNER TO ciframais;
SQL
