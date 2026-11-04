#!/bin/sh
set -eu
: "${STUDIO_API_PASSWORD:?Set a development password}"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    --set=studio_api_password="$STUDIO_API_PASSWORD" <<'SQL'
CREATE ROLE studio_api LOGIN PASSWORD :'studio_api_password';
CREATE ROLE studio_reporting NOLOGIN;
CREATE ROLE studio_worker NOLOGIN;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SQL
