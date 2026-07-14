#!/usr/bin/env bash
# Force one WAL switch, observe successful continuous archiving, then fetch and
# validate that exact segment through the configured off-site restore command.
set -euo pipefail
umask 077

timeout_seconds="${PG_WAL_PROBE_TIMEOUT_SECONDS:-60}"
poll_seconds="${PG_WAL_PROBE_POLL_SECONDS:-2}"
restore_command="${PG_WAL_RESTORE_COMMAND:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/pg-wal-restore.sh}"
expected_archive_fragment="${PG_WAL_EXPECTED_ARCHIVE_COMMAND_FRAGMENT:-pg-wal-archive.sh}"
switch_function="${PG_WAL_SWITCH_FUNCTION:-zutomayo_ops.switch_wal}"
stage='configuration'
work_dir=''

fail() {
  printf 'ERROR: PostgreSQL WAL operational smoke failed during %s\n' "$stage" >&2
  exit 1
}

cleanup() {
  local exit_code=$?
  if [[ -n "$work_dir" ]]; then rm -rf "$work_dir"; fi
  return "$exit_code"
}
trap cleanup EXIT

[[ "$timeout_seconds" =~ ^[0-9]+$ && "$timeout_seconds" -ge 1 && "$timeout_seconds" -le 600 ]] || fail
[[ "$poll_seconds" =~ ^[0-9]+([.][0-9]+)?$ ]] || fail
[[ -n "$expected_archive_fragment" && "$expected_archive_fragment" != *$'\n'* ]] || fail
[[ "$switch_function" =~ ^[a-z_][a-z0-9_]*[.][a-z_][a-z0-9_]*$ ]] || fail
[[ -x "$restore_command" ]] || fail
for command_name in psql pg_waldump wc date mktemp sleep tr; do
  command -v "$command_name" >/dev/null 2>&1 || fail
done

export PGHOST="${PGHOST:-${PG_HOST:-localhost}}"
export PGPORT="${PGPORT:-${PG_PORT:-5432}}"
export PGDATABASE="${PGDATABASE:-${PG_WAL_PROBE_DATABASE:-${PG_DATABASE:-postgres}}}"
expected_user="${PG_WAL_PROBE_USER:-${PG_USER:-}}"
[[ -n "$expected_user" ]] || fail
if [[ -n "${PGUSER:-}" && "$PGUSER" != "$expected_user" ]]; then fail; fi
export PGUSER="$expected_user"
[[ "${PGSSLMODE:-}" == verify-full ]] || fail
export PGSSLROOTCERT="${PGSSLROOTCERT:-${PG_SSLROOTCERT:-}}"
[[ -n "$PGSSLROOTCERT" && -r "$PGSSLROOTCERT" ]] || fail
if [[ -z "${PGPASSWORD:-}" && -n "${PG_WAL_PROBE_PASSWORD:-${PG_PASSWORD:-}}" ]]; then
  export PGPASSWORD="${PG_WAL_PROBE_PASSWORD:-${PG_PASSWORD:-}}"
fi
[[ -n "$PGDATABASE" ]] || fail

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/pg-wal-operational-smoke.XXXXXX")"
psql_stderr="$work_dir/psql.stderr"

psql_query() {
  psql --no-psqlrc --tuples-only --no-align --set=ON_ERROR_STOP=1 --command "$1" 2>"$psql_stderr"
}

stage='connection-identity'
authenticated_user="$(psql_query 'SELECT current_user')" || fail
[[ "$authenticated_user" == "$expected_user" ]] || fail

stage='connection-tls'
tls_state="$(psql_query "SELECT ssl, COALESCE(version, ''), COALESCE(cipher, '') FROM pg_stat_ssl WHERE pid = pg_backend_pid()")" || fail
IFS='|' read -r tls_enabled tls_version tls_cipher <<<"$tls_state"
[[ "$tls_enabled" == t ]] || fail
[[ "$tls_version" =~ ^TLSv[0-9]+([.][0-9]+)?$ ]] || fail
[[ "$tls_cipher" =~ ^[A-Za-z0-9_-]+$ ]] || fail

stage='archive-configuration'
archive_mode="$(psql_query 'SHOW archive_mode')" || fail
wal_level="$(psql_query 'SHOW wal_level')" || fail
archive_command="$(psql_query 'SHOW archive_command')" || fail
segment_size="$(psql_query "SELECT pg_size_bytes(current_setting('wal_segment_size'))")" || fail
[[ "$archive_mode" == on || "$archive_mode" == always ]] || fail
[[ "$wal_level" == replica || "$wal_level" == logical ]] || fail
[[ "$archive_command" == *"$expected_archive_fragment"* ]] || fail
[[ "$segment_size" =~ ^[0-9]+$ && "$segment_size" -gt 0 ]] || fail

stage='primary-check'
[[ "$(psql_query 'SELECT pg_is_in_recovery()')" == f ]] || fail

stage='archive-baseline'
baseline="$(psql_query "SELECT archived_count, failed_count, COALESCE(last_archived_wal, '') FROM pg_stat_archiver")" || fail
IFS='|' read -r archived_before failed_before last_before <<<"$baseline"
[[ "$archived_before" =~ ^[0-9]+$ && "$failed_before" =~ ^[0-9]+$ ]] || fail

stage='wal-switch'
target_segment="$(psql_query 'SELECT pg_walfile_name(pg_current_wal_lsn())')" || fail
[[ "$target_segment" =~ ^[0-9A-F]{24}$ ]] || fail
psql_query "SELECT $switch_function()" >/dev/null || fail

stage='archive-observation'
deadline=$((SECONDS + timeout_seconds))
archived_after="$archived_before"
failed_after="$failed_before"
last_after="$last_before"
target_archived=false
while (( SECONDS <= deadline )); do
  observation="$(psql_query "SELECT archived_count, failed_count, COALESCE(last_archived_wal, '') FROM pg_stat_archiver")" || fail
  IFS='|' read -r archived_after failed_after last_after <<<"$observation"
  [[ "$archived_after" =~ ^[0-9]+$ && "$failed_after" =~ ^[0-9]+$ ]] || fail
  (( failed_after == failed_before )) || fail
  if (( archived_after > archived_before )) &&
    [[ "$last_after" =~ ^[0-9A-F]{24}$ ]] &&
    [[ "${last_after:0:8}" == "${target_segment:0:8}" ]] &&
    { [[ "$last_after" == "$target_segment" ]] || [[ "$last_after" > "$target_segment" ]]; }; then
    target_archived=true
    break
  fi
  sleep "$poll_seconds"
done
[[ "$target_archived" == true ]] || fail

stage='offsite-restore'
restored_segment="$work_dir/$target_segment"
if ! "$restore_command" "$target_segment" "$restored_segment" >"$work_dir/restore.stdout" 2>"$work_dir/restore.stderr"; then
  fail
fi
[[ -f "$restored_segment" ]] || fail
restored_bytes="$(wc -c <"$restored_segment" | tr -d ' ')"
[[ "$restored_bytes" == "$segment_size" ]] || fail

stage='wal-format'
pg_waldump -n 1 "$restored_segment" >"$work_dir/pg-waldump.stdout" 2>"$work_dir/pg-waldump.stderr" || fail

checked_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '{"schemaVersion":1,"artifactType":"zutomayo-pg-wal-operational-smoke","ok":true,"checkedAt":"%s","identity":{"matchesExpectedRole":true},"tls":{"enabled":true,"version":"%s","cipher":"%s"},"archive":{"mode":"%s","walLevel":"%s","counterAdvanced":true,"failureCounterUnchanged":true,"segment":"%s"},"restore":{"offsiteRoundTrip":true,"segmentBytes":%s,"walDumpValidated":true}}\n' \
  "$checked_at" "$tls_version" "$tls_cipher" "$archive_mode" "$wal_level" "$target_segment" "$restored_bytes"
