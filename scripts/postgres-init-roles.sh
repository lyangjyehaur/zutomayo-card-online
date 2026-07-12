#!/usr/bin/env bash
# Create the least-privilege application role in a fresh PostgreSQL cluster.
# The migration runner reapplies and verifies grants after schema creation,
# when protected migration tables exist and can be made read-only.

set -euo pipefail

: "${POSTGRES_USER:?POSTGRES_USER must be set to the migration owner}"
: "${POSTGRES_DB:?POSTGRES_DB must be set}"
: "${PG_APP_USER:?PG_APP_USER must be set}"
: "${PG_APP_PASSWORD:?PG_APP_PASSWORD must be set}"

if [[ "$POSTGRES_USER" == "$PG_APP_USER" ]]; then
  echo 'PG_APP_USER must differ from POSTGRES_USER (migration owner)' >&2
  exit 2
fi

# Use server-side format() for identifiers and literals. This keeps role names
# and passwords safe without interpolating untrusted values into SQL text.
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=app_user="$PG_APP_USER" \
  --set=app_password="$PG_APP_PASSWORD" \
  --set=migration_user="$POSTGRES_USER" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'app_user', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user')\gexec

SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', :'app_user', :'app_password')\gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'app_user')\gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'app_user')\gexec
SELECT format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', :'app_user')\gexec
SELECT format('GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO %I', :'app_user')\gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', :'migration_user', :'app_user')\gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO %I', :'migration_user', :'app_user')\gexec
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
-- This protects an initialized cluster when the script is deliberately rerun.
-- Fresh clusters are finalized by postgres-role-gate.cjs after migrations.
SELECT format('GRANT SELECT ON %I TO %I', table_name, :'app_user')
FROM (VALUES ('schema_migrations'), ('schema_migration_checksums')) AS protected(table_name)
WHERE to_regclass('public.' || table_name) IS NOT NULL\gexec
SELECT format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON %I FROM %I', table_name, :'app_user')
FROM (VALUES ('schema_migrations'), ('schema_migration_checksums')) AS protected(table_name)
WHERE to_regclass('public.' || table_name) IS NOT NULL\gexec
SQL

echo "PostgreSQL application role '$PG_APP_USER' is ready"
