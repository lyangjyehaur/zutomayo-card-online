#!/usr/bin/env bash
# Bootstrap PostgreSQL login roles before release migrations create tables.
# Table and sequence ACLs are applied and verified by postgres-role-gate.cjs
# after migrations complete.

set -euo pipefail

: "${POSTGRES_USER:?POSTGRES_USER must be set to the bootstrap administrator}"
: "${POSTGRES_DB:?POSTGRES_DB must be set}"
PG_MIGRATION_USER="${PG_MIGRATION_USER:-$POSTGRES_USER}"
PG_MIGRATION_PASSWORD="${PG_MIGRATION_PASSWORD:-${POSTGRES_PASSWORD:-}}"
if [[ "$PG_MIGRATION_USER" != "$POSTGRES_USER" ]]; then
  : "${PG_MIGRATION_PASSWORD:?PG_MIGRATION_PASSWORD must be set for a dedicated migration role}"
fi
if [[ "${REQUIRE_DISTINCT_DB_ROLES:-false}" == 'true' && "$PG_MIGRATION_USER" == "$POSTGRES_USER" ]]; then
  echo 'production PG_MIGRATION_USER must differ from the bootstrap administrator' >&2
  exit 2
fi

legacy_app_user="${PG_APP_USER:-}"
legacy_app_password="${PG_APP_PASSWORD:-}"

PG_API_USER="${PG_API_USER:-$legacy_app_user}"
PG_API_PASSWORD="${PG_API_PASSWORD:-$legacy_app_password}"
PG_GAME_USER="${PG_GAME_USER:-$legacy_app_user}"
PG_GAME_PASSWORD="${PG_GAME_PASSWORD:-$legacy_app_password}"
PG_PLATFORM_USER="${PG_PLATFORM_USER:-$legacy_app_user}"
PG_PLATFORM_PASSWORD="${PG_PLATFORM_PASSWORD:-$legacy_app_password}"

: "${PG_API_USER:?PG_API_USER or PG_APP_USER must be set}"
: "${PG_API_PASSWORD:?PG_API_PASSWORD or PG_APP_PASSWORD must be set}"
: "${PG_GAME_USER:?PG_GAME_USER or PG_APP_USER must be set}"
: "${PG_GAME_PASSWORD:?PG_GAME_PASSWORD or PG_APP_PASSWORD must be set}"
: "${PG_PLATFORM_USER:?PG_PLATFORM_USER or PG_APP_USER must be set}"
: "${PG_PLATFORM_PASSWORD:?PG_PLATFORM_PASSWORD or PG_APP_PASSWORD must be set}"
: "${PG_RETENTION_USER:?PG_RETENTION_USER must be set}"
: "${PG_RETENTION_PASSWORD:?PG_RETENTION_PASSWORD must be set}"
: "${PG_MONITOR_USER:?PG_MONITOR_USER must be set}"
: "${PG_MONITOR_PASSWORD:?PG_MONITOR_PASSWORD must be set}"
: "${PG_BACKUP_USER:?PG_BACKUP_USER must be set}"
: "${PG_BACKUP_PASSWORD:?PG_BACKUP_PASSWORD must be set}"
: "${PG_WAL_USER:?PG_WAL_USER must be set}"
: "${PG_WAL_PASSWORD:?PG_WAL_PASSWORD must be set}"
: "${PG_WAL_OPERATOR_USER:?PG_WAL_OPERATOR_USER must be set}"
: "${PG_WAL_OPERATOR_PASSWORD:?PG_WAL_OPERATOR_PASSWORD must be set}"

role_names=(
  "$PG_API_USER"
  "$PG_GAME_USER"
  "$PG_PLATFORM_USER"
  "$PG_RETENTION_USER"
  "$PG_MONITOR_USER"
  "$PG_BACKUP_USER"
  "$PG_WAL_USER"
  "$PG_WAL_OPERATOR_USER"
)
role_passwords=(
  "$PG_API_PASSWORD"
  "$PG_GAME_PASSWORD"
  "$PG_PLATFORM_PASSWORD"
  "$PG_RETENTION_PASSWORD"
  "$PG_MONITOR_PASSWORD"
  "$PG_BACKUP_PASSWORD"
  "$PG_WAL_PASSWORD"
  "$PG_WAL_OPERATOR_PASSWORD"
)
role_kinds=(api game platform retention monitor backup wal wal_operator)
export PG_API_PASSWORD PG_GAME_PASSWORD PG_PLATFORM_PASSWORD PG_RETENTION_PASSWORD
export PG_MONITOR_PASSWORD PG_BACKUP_PASSWORD PG_WAL_PASSWORD PG_WAL_OPERATOR_PASSWORD PG_MIGRATION_PASSWORD

seen_role_names=()
seen_role_passwords=()
seen_role_kinds=()
distinct_role_passwords=()
if [[ "${REQUIRE_DISTINCT_DB_ROLES:-false}" == 'true' && -n "$PG_MIGRATION_PASSWORD" ]]; then
  distinct_role_passwords+=("$PG_MIGRATION_PASSWORD")
fi
for index in "${!role_names[@]}"; do
  role_name="${role_names[$index]}"
  role_password="${role_passwords[$index]}"
  role_kind="${role_kinds[$index]}"
  if [[ "${REQUIRE_DISTINCT_DB_ROLES:-false}" == 'true' ]]; then
    if (( ${#distinct_role_passwords[@]} > 0 )); then
      for distinct_password in "${distinct_role_passwords[@]}"; do
        if [[ "$distinct_password" == "$role_password" ]]; then
          echo 'production PostgreSQL roles must not reuse passwords' >&2
          exit 2
        fi
      done
    fi
    distinct_role_passwords+=("$role_password")
  fi
  if [[ "$role_name" == "$POSTGRES_USER" || "$role_name" == "$PG_MIGRATION_USER" ]]; then
    role_label="$(printf '%s' "$role_kind" | tr '[:lower:]' '[:upper:]')"
    echo "PG_${role_label}_USER must differ from the bootstrap administrator and migration owner" >&2
    exit 2
  fi
  role_name_index=-1
  if (( ${#seen_role_names[@]} > 0 )); then
    for candidate_index in "${!seen_role_names[@]}"; do
      if [[ "${seen_role_names[$candidate_index]}" == "$role_name" ]]; then
        role_name_index="$candidate_index"
        break
      fi
    done
  fi
  if (( role_name_index >= 0 )); then
    if [[ "${seen_role_passwords[$role_name_index]}" != "$role_password" ]]; then
      echo "aliased PostgreSQL role '$role_name' must use one password" >&2
      exit 2
    fi
    if [[ "${seen_role_kinds[$role_name_index]}" != 'app-runtime' || ! "$role_kind" =~ ^(api|game|platform)$ ]]; then
      echo "only PG_API_USER, PG_GAME_USER, and PG_PLATFORM_USER may share a local role" >&2
      exit 2
    fi
  else
    seen_role_names+=("$role_name")
    seen_role_passwords+=("$role_password")
    if [[ "$role_kind" =~ ^(api|game|platform)$ ]]; then
      seen_role_kinds+=('app-runtime')
    else
      seen_role_kinds+=("$role_kind")
    fi
  fi
done

if [[ "${REQUIRE_DISTINCT_DB_ROLES:-false}" == 'true' && "${#seen_role_names[@]}" -ne "${#role_names[@]}" ]]; then
  echo 'production PostgreSQL roles must all use distinct login names' >&2
  exit 2
fi

# Identifiers and passwords stay in psql variables and are quoted server-side
# with format(). DISTINCT removes the supported local api/game/platform alias.
psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=api_user="$PG_API_USER" \
  --set=game_user="$PG_GAME_USER" \
  --set=platform_user="$PG_PLATFORM_USER" \
  --set=retention_user="$PG_RETENTION_USER" \
  --set=monitor_user="$PG_MONITOR_USER" \
  --set=backup_user="$PG_BACKUP_USER" \
  --set=wal_user="$PG_WAL_USER" \
  --set=wal_operator_user="$PG_WAL_OPERATOR_USER" \
  --set=migration_user="$PG_MIGRATION_USER" <<'SQL'
\getenv migration_password PG_MIGRATION_PASSWORD
\getenv api_password PG_API_PASSWORD
\getenv game_password PG_GAME_PASSWORD
\getenv platform_password PG_PLATFORM_PASSWORD
\getenv retention_password PG_RETENTION_PASSWORD
\getenv monitor_password PG_MONITOR_PASSWORD
\getenv backup_password PG_BACKUP_PASSWORD
\getenv wal_password PG_WAL_PASSWORD
\getenv wal_operator_password PG_WAL_OPERATOR_PASSWORD
BEGIN;

SELECT format('CREATE ROLE %I', :'migration_user')
 WHERE :'migration_user' <> current_user
   AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'migration_user')
\gexec
SELECT format(
  'ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT NOBYPASSRLS',
  :'migration_user',
  :'migration_password'
)
 WHERE :'migration_user' <> current_user
\gexec

SELECT format('ALTER DATABASE %I OWNER TO %I', current_database(), :'migration_user')
 WHERE :'migration_user' <> current_user
\gexec
SELECT format('ALTER SCHEMA public OWNER TO %I', :'migration_user')
 WHERE :'migration_user' <> current_user
\gexec
SELECT format('ALTER TABLE %I.%I OWNER TO %I', namespace.nspname, relation.relname, :'migration_user')
 FROM pg_class relation
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
 WHERE namespace.nspname = 'public'
   AND relation.relkind IN ('r', 'p', 'f')
   AND relation.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
   AND :'migration_user' <> current_user
\gexec
SELECT format('ALTER VIEW %I.%I OWNER TO %I', namespace.nspname, relation.relname, :'migration_user')
  FROM pg_class relation
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
 WHERE namespace.nspname = 'public'
   AND relation.relkind = 'v'
   AND relation.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
   AND :'migration_user' <> current_user
\gexec
SELECT format('ALTER MATERIALIZED VIEW %I.%I OWNER TO %I', namespace.nspname, relation.relname, :'migration_user')
  FROM pg_class relation
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
 WHERE namespace.nspname = 'public'
   AND relation.relkind = 'm'
   AND relation.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
   AND :'migration_user' <> current_user
\gexec
SELECT format('ALTER SEQUENCE %I.%I OWNER TO %I', namespace.nspname, relation.relname, :'migration_user')
  FROM pg_class relation
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
 WHERE namespace.nspname = 'public'
   AND relation.relkind = 'S'
   AND relation.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
   AND :'migration_user' <> current_user
\gexec

CREATE TEMP TABLE bootstrap_roles (
  role_name text PRIMARY KEY,
  role_password text NOT NULL,
  replication boolean NOT NULL DEFAULT false,
  inherit_role boolean NOT NULL DEFAULT true
) ON COMMIT DROP;

INSERT INTO bootstrap_roles (role_name, role_password, replication, inherit_role)
VALUES
  (:'api_user', :'api_password', false, true),
  (:'game_user', :'game_password', false, true),
  (:'platform_user', :'platform_password', false, true),
  (:'retention_user', :'retention_password', false, true),
  (:'monitor_user', :'monitor_password', false, true),
  (:'backup_user', :'backup_password', false, true),
  (:'wal_user', :'wal_password', true, false),
  (:'wal_operator_user', :'wal_operator_password', false, false)
ON CONFLICT (role_name) DO NOTHING;

SELECT format('CREATE ROLE %I', role_name)
  FROM bootstrap_roles candidate
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles existing WHERE existing.rolname = candidate.role_name)
\gexec

SELECT format(
  'ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE %s NOBYPASSRLS %s',
  role_name,
  role_password,
  CASE WHEN replication THEN 'REPLICATION' ELSE 'NOREPLICATION' END,
  CASE WHEN inherit_role THEN 'INHERIT' ELSE 'NOINHERIT' END
)
  FROM bootstrap_roles
\gexec

SELECT format('REVOKE pg_monitor FROM %I', role_name)
  FROM bootstrap_roles
 WHERE role_name <> :'monitor_user'
\gexec
SELECT format('GRANT pg_monitor TO %I', :'monitor_user')\gexec

CREATE SCHEMA IF NOT EXISTS zutomayo_ops;
ALTER SCHEMA zutomayo_ops OWNER TO CURRENT_USER;
REVOKE ALL ON SCHEMA zutomayo_ops FROM PUBLIC;
SELECT format('REVOKE ALL ON SCHEMA zutomayo_ops FROM %I', role_name)
  FROM bootstrap_roles
\gexec
SELECT format('GRANT USAGE ON SCHEMA zutomayo_ops TO %I', :'wal_operator_user')\gexec

CREATE OR REPLACE FUNCTION zutomayo_ops.switch_wal()
RETURNS pg_lsn
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS 'SELECT pg_catalog.pg_switch_wal()';
REVOKE ALL ON FUNCTION zutomayo_ops.switch_wal() FROM PUBLIC;
SELECT format('REVOKE ALL ON FUNCTION zutomayo_ops.switch_wal() FROM %I', role_name)
  FROM bootstrap_roles
\gexec
SELECT format('GRANT EXECUTE ON FUNCTION zutomayo_ops.switch_wal() TO %I', :'wal_operator_user')\gexec

SELECT format('REVOKE CONNECT ON DATABASE %I FROM PUBLIC', current_database())\gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'migration_user')\gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), role_name)
  FROM bootstrap_roles
 WHERE replication = false
\gexec
SELECT format('REVOKE CONNECT ON DATABASE %I FROM %I', current_database(), :'wal_user')\gexec

REVOKE ALL ON SCHEMA public FROM PUBLIC;
SELECT format('REVOKE ALL ON SCHEMA public FROM %I', role_name)
  FROM bootstrap_roles
\gexec

COMMIT;
SQL

echo "PostgreSQL role bootstrap complete for database '$POSTGRES_DB'"
