#!/usr/bin/env bash
set -euo pipefail
umask 077

readonly SOURCE_PGPASS_FILE='/run/secrets/postgres-operator.pgpass'
readonly RUNTIME_PGPASS_FILE='/tmp/postgres-operator.pgpass'
readonly EXPECTED_AGE_IDENTITY_FILE='/run/secrets/wal-age-identity'
readonly EXPECTED_AWS_CREDENTIALS_FILE='/run/secrets/wal-s3-credentials'

fail() {
  echo 'ERROR: PostgreSQL operations runner secret contract failed' >&2
  exit 1
}

[[ "$#" -eq 0 ]] || fail
[[ "$(id -u)" != 0 ]] || fail
[[ "${PGPASSFILE:-}" == "$SOURCE_PGPASS_FILE" ]] || fail
[[ "${PG_BACKUP_AGE_IDENTITY_FILE:-}" == "$EXPECTED_AGE_IDENTITY_FILE" ]] || fail
[[ "${AWS_SHARED_CREDENTIALS_FILE:-}" == "$EXPECTED_AWS_CREDENTIALS_FILE" ]] || fail
[[ "${AWS_EC2_METADATA_DISABLED:-}" == true ]] || fail
[[ "${POSTGRES_OPS_SECRETS_GID:-}" =~ ^[1-9][0-9]*$ ]] || fail
id -G | tr ' ' '\n' | grep -Fx "$POSTGRES_OPS_SECRETS_GID" >/dev/null || fail

for variable in PGPASSWORD PG_PASSWORD PG_WAL_PROBE_PASSWORD AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN; do
  [[ -z "${!variable:-}" ]] || fail
done

assert_private_source_file() {
  local path="$1" mode owner group
  [[ -f "$path" && ! -L "$path" && -r "$path" ]] || fail
  mode="$(stat -c '%a' "$path" 2>/dev/null)" || fail
  owner="$(stat -c '%u' "$path" 2>/dev/null)" || fail
  group="$(stat -c '%g' "$path" 2>/dev/null)" || fail
  [[ "$owner" == 0 && "$group" == "$POSTGRES_OPS_SECRETS_GID" ]] || fail
  [[ "$mode" == 440 ]] || fail
}

assert_private_source_file "$SOURCE_PGPASS_FILE"
assert_private_source_file "$PG_BACKUP_AGE_IDENTITY_FILE"
assert_private_source_file "$AWS_SHARED_CREDENTIALS_FILE"
[[ -f "${PGSSLROOTCERT:-}" && -r "${PGSSLROOTCERT:-}" ]] || fail
grep -Eq '^(AGE-SECRET-KEY-|AGE-PLUGIN-)' "$PG_BACKUP_AGE_IDENTITY_FILE" || fail
grep -Eq '^[[:space:]]*aws_access_key_id[[:space:]]*=' "$AWS_SHARED_CREDENTIALS_FILE" || fail
grep -Eq '^[[:space:]]*aws_secret_access_key[[:space:]]*=' "$AWS_SHARED_CREDENTIALS_FILE" || fail

rm -f "$RUNTIME_PGPASS_FILE"
cp "$SOURCE_PGPASS_FILE" "$RUNTIME_PGPASS_FILE" || fail
chmod 0600 "$RUNTIME_PGPASS_FILE" || fail
[[ "$(stat -c '%u' "$RUNTIME_PGPASS_FILE" 2>/dev/null)" == "$(id -u)" ]] || fail
[[ "$(stat -c '%a' "$RUNTIME_PGPASS_FILE" 2>/dev/null)" == 600 ]] || fail
export PGPASSFILE="$RUNTIME_PGPASS_FILE"
export HOME=/tmp
exec /opt/zutomayo/scripts/pg-wal-operational-smoke.sh
