#!/usr/bin/env bash
# Disposable fresh-cluster smoke for the PostgreSQL role matrix.
# This is intentionally separate from npm run verify because it needs Docker.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

command -v docker >/dev/null 2>&1 || {
  echo 'ERROR: Docker is required for the PostgreSQL role smoke' >&2
  exit 2
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}
docker compose version >/dev/null 2>&1 || {
  echo 'ERROR: Docker Compose v2 is required for the PostgreSQL role smoke' >&2
  exit 2
}

project="${ROLE_SMOKE_COMPOSE_PROJECT:-zutomayo-role-smoke-$$}"
compose=(docker compose --project-name "$project" --file docker-compose.yml)
source_smoke_compose=(
  docker compose --project-name "$project"
  --file docker-compose.yml
  --file docker-compose.postgres-concurrency-smoke.yml
)

PG_BOOTSTRAP_USER="${PG_BOOTSTRAP_USER:-z_role_bootstrap_executor}"
PG_BOOTSTRAP_PASSWORD="${PG_BOOTSTRAP_PASSWORD:-role-smoke-bootstrap-password}"
PG_MIGRATION_USER="${PG_MIGRATION_USER:-z_role_migrator}"
PG_MIGRATION_PASSWORD="${PG_MIGRATION_PASSWORD:-role-smoke-migration-password}"
PG_DATABASE="${PG_DATABASE:-zutomayo_role_smoke}"
PG_APP_USER="${PG_APP_USER:-z_role_app}"
PG_APP_PASSWORD="${PG_APP_PASSWORD:-role-smoke-app-password}"
PG_PASSWORD="${PG_PASSWORD:-$PG_APP_PASSWORD}"
PG_API_USER="${PG_API_USER:-z_role_api}"
PG_API_PASSWORD="${PG_API_PASSWORD:-role-smoke-api-password}"
PG_GAME_USER="${PG_GAME_USER:-z_role_game}"
PG_GAME_PASSWORD="${PG_GAME_PASSWORD:-role-smoke-game-password}"
PG_PLATFORM_USER="${PG_PLATFORM_USER:-z_role_platform}"
PG_PLATFORM_PASSWORD="${PG_PLATFORM_PASSWORD:-role-smoke-platform-password}"
PG_RETENTION_USER="${PG_RETENTION_USER:-z_role_retention}"
PG_RETENTION_PASSWORD="${PG_RETENTION_PASSWORD:-role-smoke-retention-password}"
PG_MONITOR_USER="${PG_MONITOR_USER:-z_role_monitor}"
PG_MONITOR_PASSWORD="${PG_MONITOR_PASSWORD:-role-smoke-monitor-password}"
PG_BACKUP_USER="${PG_BACKUP_USER:-z_role_backup}"
PG_BACKUP_PASSWORD="${PG_BACKUP_PASSWORD:-role-smoke-backup-password}"
PG_WAL_USER="${PG_WAL_USER:-z_role_wal}"
PG_WAL_PASSWORD="${PG_WAL_PASSWORD:-role-smoke-wal-password}"
PG_WAL_OPERATOR_USER="${PG_WAL_OPERATOR_USER:-z_role_wal_operator}"
PG_WAL_OPERATOR_PASSWORD="${PG_WAL_OPERATOR_PASSWORD:-role-smoke-wal-operator-password}"
PGSSLMODE="${PGSSLMODE:-disable}"
REQUIRE_DISTINCT_DB_ROLES=true
REQUIRE_ROLE_MATRIX_GATE=true
JWT_SECRET="${JWT_SECRET:-role-smoke-jwt-secret-32-characters-min}"
METRICS_TOKEN="${METRICS_TOKEN:-role-smoke-metrics-token}"
REDIS_PASSWORD="${REDIS_PASSWORD:-role-smoke-redis-password}"
REDIS_DB="${REDIS_DB:-7}"
ACCOUNT_EXPORT_S3_BUCKET="${ACCOUNT_EXPORT_S3_BUCKET:-zutomayo-role-smoke-account-exports}"
ACCOUNT_EXPORT_S3_REGION="${ACCOUNT_EXPORT_S3_REGION:-us-east-1}"
ACCOUNT_EXPORT_S3_CREDENTIALS_MODE="${ACCOUNT_EXPORT_S3_CREDENTIALS_MODE:-default}"
ACCOUNT_EXPORT_S3_VERSIONING_MODE="${ACCOUNT_EXPORT_S3_VERSIONING_MODE:-disabled}"
ACCOUNT_EXPORT_S3_LIFECYCLE_CONFIRMED="${ACCOUNT_EXPORT_S3_LIFECYCLE_CONFIRMED:-true}"
ACCOUNT_EXPORT_PSEUDONYM_KEY="${ACCOUNT_EXPORT_PSEUDONYM_KEY:-role-smoke-export-pseudonym-key-32-characters-min}"

export PG_BOOTSTRAP_USER PG_BOOTSTRAP_PASSWORD PG_MIGRATION_USER PG_MIGRATION_PASSWORD
export PG_DATABASE PG_APP_USER PG_APP_PASSWORD PG_PASSWORD
export PG_API_USER PG_API_PASSWORD PG_GAME_USER PG_GAME_PASSWORD
export PG_PLATFORM_USER PG_PLATFORM_PASSWORD
export PG_RETENTION_USER PG_RETENTION_PASSWORD PG_MONITOR_USER PG_MONITOR_PASSWORD
export PG_BACKUP_USER PG_BACKUP_PASSWORD PG_WAL_USER PG_WAL_PASSWORD
export PG_WAL_OPERATOR_USER PG_WAL_OPERATOR_PASSWORD
export PGSSLMODE REQUIRE_DISTINCT_DB_ROLES REQUIRE_ROLE_MATRIX_GATE JWT_SECRET METRICS_TOKEN REDIS_PASSWORD REDIS_DB
export ACCOUNT_EXPORT_S3_BUCKET ACCOUNT_EXPORT_S3_REGION ACCOUNT_EXPORT_S3_CREDENTIALS_MODE
export ACCOUNT_EXPORT_S3_VERSIONING_MODE ACCOUNT_EXPORT_S3_LIFECYCLE_CONFIRMED
export ACCOUNT_EXPORT_PSEUDONYM_KEY

EXPECTED_SCHEMA_MIGRATION="${EXPECTED_SCHEMA_MIGRATION:-$(find migrations -maxdepth 1 -type f -name '*.js' -print | sort | tail -n 1 | sed 's#^.*/##; s/\.js$//')}"
EXPECTED_SCHEMA_CHECKSUM="${EXPECTED_SCHEMA_CHECKSUM:-$(sha256_file "migrations/${EXPECTED_SCHEMA_MIGRATION}.js")}"
export EXPECTED_SCHEMA_MIGRATION EXPECTED_SCHEMA_CHECKSUM

cleanup() {
  local exit_code=$?
  if [[ "${ROLE_SMOKE_KEEP:-false}" == 'true' ]]; then
    echo "role smoke kept Compose project '$project' for inspection" >&2
  else
    "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  fi
  return "$exit_code"
}
trap cleanup EXIT

echo "Starting fresh PostgreSQL role smoke in Compose project '$project'"
"${compose[@]}" up --detach postgres redis
ready=false
for _attempt in $(seq 1 90); do
  if "${compose[@]}" exec --no-TTY postgres pg_isready --username "$PG_MIGRATION_USER" --dbname "$PG_DATABASE" >/dev/null 2>&1; then
    ready=true
    break
  fi
  if [[ -n "$("${compose[@]}" ps --quiet --status exited postgres)" ]]; then break; fi
  sleep 1
done
if [[ "$ready" != 'true' ]]; then
  "${compose[@]}" logs postgres >&2 || true
  echo 'ERROR: fresh PostgreSQL role smoke did not become ready' >&2
  exit 1
fi

# pg_isready can report the temporary server used by the PostgreSQL image
# while init scripts are still running. Wait for the role bootstrap script to
# finish and for the API role to be visible on the stable server before using
# psql or launching migration containers.
roles_ready=false
for _attempt in $(seq 1 90); do
  if "${compose[@]}" exec --no-TTY --env PGPASSWORD="$PG_MIGRATION_PASSWORD" postgres \
    psql --host 127.0.0.1 --username "$PG_MIGRATION_USER" --dbname "$PG_DATABASE" \
    --tuples-only --no-align --command "SELECT 1 FROM pg_roles WHERE rolname = '$PG_API_USER'" 2>/dev/null | grep -qx '1'; then
    roles_ready=true
    break
  fi
  sleep 1
done
if [[ "$roles_ready" != 'true' ]]; then
  "${compose[@]}" logs postgres >&2 || true
  echo 'ERROR: PostgreSQL role bootstrap did not become queryable' >&2
  exit 1
fi
redis_ready=false
for _attempt in $(seq 1 90); do
  if "${compose[@]}" exec --no-TTY redis redis-cli -a "$REDIS_PASSWORD" --no-auth-warning ping 2>/dev/null | grep -q PONG; then
    redis_ready=true
    break
  fi
  sleep 1
done
if [[ "$redis_ready" != 'true' ]]; then
  "${compose[@]}" logs redis >&2 || true
  echo 'ERROR: relationship outbox Redis smoke did not become ready' >&2
  exit 1
fi

"${compose[@]}" exec --no-TTY \
  --env POSTGRES_USER="$PG_BOOTSTRAP_USER" \
  --env PG_MIGRATION_USER="$PG_MIGRATION_USER" \
  --env PG_MIGRATION_PASSWORD="$PG_MIGRATION_PASSWORD" \
  --env POSTGRES_DB="$PG_DATABASE" \
  --env PGHOST=127.0.0.1 \
  --env PGPASSWORD="$PG_BOOTSTRAP_PASSWORD" \
  postgres /docker-entrypoint-initdb.d/10-roles.sh >/dev/null

"${compose[@]}" run --build --rm --no-deps migrate

"${compose[@]}" run --rm --no-deps \
  --env PG_USER="$PG_API_USER" \
  --env PG_PASSWORD="$PG_API_PASSWORD" \
  --env PG_API_USER="$PG_API_USER" \
  --env PG_API_PASSWORD="$PG_API_PASSWORD" \
  --env REDIS_URL="redis://:$REDIS_PASSWORD@redis:6379" \
  --env REDIS_DB="$REDIS_DB" \
  migrate npm run relationship:outbox:pg-smoke

"${compose[@]}" run --build --rm --no-deps api node social-concurrency-pg-smoke.cjs

"${compose[@]}" run --rm --no-deps --env NODE_ENV=test api node account-deletion-pg-smoke.cjs

"${source_smoke_compose[@]}" run --build --rm --no-deps boardgame-metadata-pg-smoke

"${compose[@]}" run --rm --no-deps \
  --env NODE_ENV=test \
  --env ADMIN_CREDENTIAL_PG_SMOKE_ALLOW_REMOTE=true \
  --env ADMIN_CREDENTIAL_PG_SMOKE_URL="postgresql://$PG_MIGRATION_USER:$PG_MIGRATION_PASSWORD@postgres:5432/$PG_DATABASE" \
  migrate node scripts/admin-credential-pg-smoke.cjs

"${compose[@]}" exec --no-TTY \
  --env PGPASSWORD="$PG_MIGRATION_PASSWORD" \
  postgres psql --username "$PG_MIGRATION_USER" --dbname "$PG_DATABASE" \
  --set=ON_ERROR_STOP=1 \
  --set=api_user="$PG_API_USER" \
  --set=game_user="$PG_GAME_USER" \
  --set=platform_user="$PG_PLATFORM_USER" \
  --set=retention_user="$PG_RETENTION_USER" \
  --set=monitor_user="$PG_MONITOR_USER" \
  --set=backup_user="$PG_BACKUP_USER" \
  --set=wal_user="$PG_WAL_USER" \
  --set=wal_operator_user="$PG_WAL_OPERATOR_USER" \
  --set=bootstrap_user="$PG_BOOTSTRAP_USER" \
  --set=migration_user="$PG_MIGRATION_USER" <<'SQL'
CREATE TEMP TABLE role_expectations (
  role_name text PRIMARY KEY,
  replication boolean NOT NULL,
  inherit_role boolean NOT NULL
);
INSERT INTO role_expectations (role_name, replication, inherit_role)
VALUES
  (:'api_user', false, true),
  (:'game_user', false, true),
  (:'platform_user', false, true),
  (:'retention_user', false, true),
  (:'monitor_user', false, true),
  (:'backup_user', false, true),
  (:'wal_user', true, false),
  (:'wal_operator_user', false, false);

SELECT
  (SELECT COUNT(*) = 8
     FROM role_expectations e
     JOIN pg_roles r ON r.rolname = e.role_name
    WHERE r.rolcanlogin IS TRUE
      AND r.rolsuper IS FALSE
      AND r.rolcreatedb IS FALSE
      AND r.rolcreaterole IS FALSE
      AND r.rolbypassrls IS FALSE
      AND r.rolreplication = e.replication
      AND r.rolinherit = e.inherit_role) AS role_attributes_ok,
  (SELECT rolsuper FROM pg_roles WHERE rolname = :'bootstrap_user') AS bootstrap_super,
  NOT (SELECT rolsuper FROM pg_roles WHERE rolname = :'migration_user') AS migration_not_super,
  has_table_privilege(:'api_user', 'public.users', 'INSERT') AS api_insert_ok,
  has_column_privilege(:'game_user', 'public.users', 'auth_version', 'SELECT') AS game_auth_read,
  NOT has_column_privilege(:'game_user', 'public.users', 'email', 'SELECT') AS game_no_email_read,
  has_column_privilege(:'game_user', 'public.users', 'elo', 'UPDATE') AS game_elo_update,
  NOT has_column_privilege(:'game_user', 'public.users', 'auth_version', 'UPDATE') AS game_no_auth_update,
  has_column_privilege(:'platform_user', 'public.users', 'auth_version', 'SELECT') AS platform_auth_read,
  NOT has_column_privilege(:'platform_user', 'public.users', 'email', 'SELECT') AS platform_no_email_read,
  has_column_privilege(:'retention_user', 'public.users', 'deleted_at', 'SELECT') AS retention_deleted_read,
  NOT has_column_privilege(:'retention_user', 'public.users', 'email', 'SELECT') AS retention_no_email_read,
  NOT has_table_privilege(:'backup_user', 'public.users', 'UPDATE') AS backup_no_update,
  has_table_privilege(:'backup_user', 'public.users', 'SELECT') AS backup_select_ok,
  NOT has_table_privilege(:'retention_user', 'public.matches', 'DELETE') AS retention_no_delete,
  has_table_privilege(:'retention_user', 'public.matches', 'UPDATE') AS retention_update_ok,
  has_table_privilege(:'retention_user', 'public.retention_runs', 'INSERT') AS retention_insert_ok,
  NOT has_table_privilege(:'monitor_user', 'public.users', 'SELECT') AS monitor_no_table_read,
  pg_has_role(:'monitor_user', 'pg_monitor', 'member') AS monitor_member,
  NOT has_database_privilege(:'wal_user', current_database(), 'CONNECT') AS wal_no_connect,
  has_database_privilege(:'wal_operator_user', current_database(), 'CONNECT') AS wal_operator_connect,
  NOT has_schema_privilege(:'wal_operator_user', 'public', 'USAGE') AS wal_operator_no_public_schema,
  has_schema_privilege(:'wal_operator_user', 'zutomayo_ops', 'USAGE') AS wal_operator_ops_schema,
  NOT has_schema_privilege(:'wal_operator_user', 'zutomayo_ops', 'CREATE') AS wal_operator_no_ops_create,
  has_function_privilege(
    :'wal_operator_user',
    (SELECT procedure.oid
       FROM pg_proc procedure
       JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
      WHERE namespace.nspname = 'zutomayo_ops'
        AND procedure.proname = 'switch_wal'
        AND procedure.pronargs = 0),
    'EXECUTE'
  ) AS wal_operator_wrapper,
  NOT pg_has_role(:'wal_operator_user', 'pg_monitor', 'member') AS wal_operator_no_monitor,
  has_table_privilege(:'api_user', 'public.schema_migrations', 'SELECT') AS api_schema_read,
  NOT has_table_privilege(:'api_user', 'public.schema_migrations', 'UPDATE') AS api_schema_no_write
\gset

\if :role_attributes_ok
\else
  \echo 'role attribute smoke failed' >&2
  \quit 3
\endif
\if :bootstrap_super
\else
  \echo 'bootstrap administrator is not a superuser' >&2
  \quit 3
\endif
\if :migration_not_super
\else
  \echo 'migration owner is still a superuser' >&2
  \quit 3
\endif
\if :api_insert_ok
\else
  \echo 'API role cannot insert users' >&2
  \quit 3
\endif
\if :game_auth_read
\else
  \echo 'GAME role cannot read auth_version' >&2
  \quit 3
\endif
\if :game_no_email_read
\else
  \echo 'GAME role can read user email' >&2
  \quit 3
\endif
\if :game_elo_update
\else
  \echo 'GAME role cannot update elo' >&2
  \quit 3
\endif
\if :game_no_auth_update
\else
  \echo 'GAME role can update auth_version' >&2
  \quit 3
\endif
\if :platform_auth_read
\else
  \echo 'PLATFORM role cannot read auth_version' >&2
  \quit 3
\endif
\if :platform_no_email_read
\else
  \echo 'PLATFORM role can read user email' >&2
  \quit 3
\endif
\if :retention_deleted_read
\else
  \echo 'RETENTION role cannot read deleted_at' >&2
  \quit 3
\endif
\if :retention_no_email_read
\else
  \echo 'RETENTION role can read user email' >&2
  \quit 3
\endif
\if :backup_no_update
\else
  \echo 'backup role can update users' >&2
  \quit 3
\endif
\if :backup_select_ok
\else
  \echo 'backup role cannot select users' >&2
  \quit 3
\endif
\if :retention_no_delete
\else
  \echo 'retention role can delete matches' >&2
  \quit 3
\endif
\if :retention_update_ok
\else
  \echo 'retention role cannot update matches' >&2
  \quit 3
\endif
\if :retention_insert_ok
\else
  \echo 'retention role cannot insert retention runs' >&2
  \quit 3
\endif
\if :monitor_no_table_read
\else
  \echo 'monitor role can read application tables' >&2
  \quit 3
\endif
\if :monitor_member
\else
  \echo 'monitor role is not a pg_monitor member' >&2
  \quit 3
\endif
\if :wal_no_connect
\else
  \echo 'WAL role can connect to the application database' >&2
  \quit 3
\endif
\if :wal_operator_connect
\else
  \echo 'WAL operator cannot connect to the application database' >&2
  \quit 3
\endif
\if :wal_operator_no_public_schema
\else
  \echo 'WAL operator can use the public application schema' >&2
  \quit 3
\endif
\if :wal_operator_ops_schema
\else
  \echo 'WAL operator cannot use the operations schema' >&2
  \quit 3
\endif
\if :wal_operator_no_ops_create
\else
  \echo 'WAL operator can create objects in the operations schema' >&2
  \quit 3
\endif
\if :wal_operator_wrapper
\else
  \echo 'WAL operator cannot execute the WAL switch wrapper' >&2
  \quit 3
\endif
\if :wal_operator_no_monitor
\else
  \echo 'WAL operator unexpectedly inherits pg_monitor' >&2
  \quit 3
\endif
\if :api_schema_read
\else
  \echo 'API role cannot read schema history' >&2
  \quit 3
\endif
\if :api_schema_no_write
\else
  \echo 'API role can modify schema history' >&2
  \quit 3
\endif
SQL

for role_and_password in \
  "$PG_API_USER:$PG_API_PASSWORD" \
  "$PG_GAME_USER:$PG_GAME_PASSWORD" \
  "$PG_PLATFORM_USER:$PG_PLATFORM_PASSWORD" \
  "$PG_RETENTION_USER:$PG_RETENTION_PASSWORD" \
  "$PG_MONITOR_USER:$PG_MONITOR_PASSWORD" \
  "$PG_BACKUP_USER:$PG_BACKUP_PASSWORD" \
  "$PG_WAL_OPERATOR_USER:$PG_WAL_OPERATOR_PASSWORD"; do
  role="${role_and_password%%:*}"
  password="${role_and_password#*:}"
  "${compose[@]}" exec --no-TTY --env PGPASSWORD="$password" postgres \
    psql --host 127.0.0.1 --username "$role" --dbname "$PG_DATABASE" --command 'SELECT 1' >/dev/null
done

if "${compose[@]}" exec --no-TTY --env PGPASSWORD="$PG_WAL_OPERATOR_PASSWORD" postgres \
  psql --host 127.0.0.1 --username "$PG_WAL_OPERATOR_USER" --dbname "$PG_DATABASE" \
  --set=ON_ERROR_STOP=1 --command 'SELECT pg_catalog.pg_switch_wal()' >/dev/null 2>&1; then
  echo 'ERROR: WAL operator can call pg_catalog.pg_switch_wal() directly' >&2
  exit 1
fi
"${compose[@]}" exec --no-TTY --env PGPASSWORD="$PG_WAL_OPERATOR_PASSWORD" postgres \
  psql --host 127.0.0.1 --username "$PG_WAL_OPERATOR_USER" --dbname "$PG_DATABASE" \
  --set=ON_ERROR_STOP=1 --command 'SELECT zutomayo_ops.switch_wal()' >/dev/null

"${compose[@]}" exec --no-TTY --env PGPASSWORD="$PG_GAME_PASSWORD" postgres \
  psql --host 127.0.0.1 --username "$PG_GAME_USER" --dbname "$PG_DATABASE" --set=ON_ERROR_STOP=1 \
  --command "BEGIN; SELECT auth_version, deleted_at FROM users WHERE id = 'role-smoke-missing'; UPDATE users SET elo = elo, match_count = match_count, wins = wins WHERE id = 'role-smoke-missing'; ROLLBACK" \
  >/dev/null
"${compose[@]}" exec --no-TTY --env PGPASSWORD="$PG_PLATFORM_PASSWORD" postgres \
  psql --host 127.0.0.1 --username "$PG_PLATFORM_USER" --dbname "$PG_DATABASE" --set=ON_ERROR_STOP=1 \
  --command "SELECT auth_version, deleted_at FROM users WHERE id = 'role-smoke-missing'" >/dev/null
if "${compose[@]}" exec --no-TTY --env PGPASSWORD="$PG_GAME_PASSWORD" postgres \
  psql --host 127.0.0.1 --username "$PG_GAME_USER" --dbname "$PG_DATABASE" --set=ON_ERROR_STOP=1 \
  --command 'SELECT email, password_hash, salt FROM users LIMIT 1' >/dev/null 2>&1; then
  echo 'ERROR: GAME role can read account credentials' >&2
  exit 1
fi
if "${compose[@]}" exec --no-TTY --env PGPASSWORD="$PG_GAME_PASSWORD" postgres \
  psql --host 127.0.0.1 --username "$PG_GAME_USER" --dbname "$PG_DATABASE" --set=ON_ERROR_STOP=1 \
  --command "UPDATE users SET auth_version = auth_version WHERE id = 'role-smoke-missing'" >/dev/null 2>&1; then
  echo 'ERROR: GAME role can update auth_version' >&2
  exit 1
fi

"${compose[@]}" exec --no-TTY --env PGPASSWORD="$PG_MIGRATION_PASSWORD" postgres \
  psql --username "$PG_MIGRATION_USER" --dbname "$PG_DATABASE" --set=ON_ERROR_STOP=1 \
  --command 'CREATE TABLE public.role_matrix_unknown_smoke (id integer)' >/dev/null
if "${compose[@]}" run --rm --no-deps migrate npm run db:migrate >/dev/null 2>&1; then
  echo 'ERROR: role gate accepted an undeclared public table' >&2
  exit 1
fi
"${compose[@]}" exec --no-TTY --env PGPASSWORD="$PG_MIGRATION_PASSWORD" postgres \
  psql --username "$PG_MIGRATION_USER" --dbname "$PG_DATABASE" --set=ON_ERROR_STOP=1 \
  --command 'DROP TABLE public.role_matrix_unknown_smoke' >/dev/null

echo 'PostgreSQL role matrix smoke passed'
