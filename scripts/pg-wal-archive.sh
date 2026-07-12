#!/usr/bin/env bash
# PostgreSQL archive_command target:
#   archive_command = '/opt/zutomayo/scripts/pg-wal-archive.sh %p %f'
set -euo pipefail
umask 077

wal_path="${1:-}"
wal_name="${2:-}"
offsite_uri="${PG_WAL_OFFSITE_URI:-}"
recipient="${PG_BACKUP_AGE_RECIPIENT:-}"
recipient_file="${PG_BACKUP_AGE_RECIPIENT_FILE:-}"
metrics_dir="${PG_BACKUP_METRICS_DIR:-/var/lib/node_exporter/textfile_collector}"

write_metrics() {
  local success="$1"
  local timestamp="$2"
  local previous_success=0
  if [[ -f "$metrics_dir/zutomayo_pg_wal_archive.prom" ]]; then
    previous_success="$(awk '$1 == "pg_wal_archive_last_success_unixtime_seconds" {print $2; exit}' "$metrics_dir/zutomayo_pg_wal_archive.prom" || true)"
  fi
  [[ "$previous_success" =~ ^[0-9]+([.][0-9]+)?$ ]] || previous_success=0
  if [[ "$timestamp" != 0 ]]; then previous_success="$timestamp"; fi
  mkdir -p "$metrics_dir"
  local temp_metrics="$metrics_dir/.pg_wal_archive.prom.$$"
  {
    echo '# HELP pg_wal_archive_last_run_success Whether the latest WAL archive command succeeded.'
    echo '# TYPE pg_wal_archive_last_run_success gauge'
    echo "pg_wal_archive_last_run_success $success"
    echo '# HELP pg_wal_archive_last_success_unixtime_seconds Unix timestamp of the latest encrypted WAL upload.'
    echo '# TYPE pg_wal_archive_last_success_unixtime_seconds gauge'
    echo "pg_wal_archive_last_success_unixtime_seconds $previous_success"
  } >"$temp_metrics"
  mv "$temp_metrics" "$metrics_dir/zutomayo_pg_wal_archive.prom"
  chmod 0644 "$metrics_dir/zutomayo_pg_wal_archive.prom"
}

fail() {
  echo "ERROR: $1" >&2
  write_metrics 0 0 || true
  exit 1
}

[[ -f "$wal_path" ]] || fail 'WAL source path does not exist'
[[ "$wal_name" =~ ^[0-9A-Fa-f]{24}(\.[A-Za-z0-9._-]+)?$ ]] || fail 'invalid WAL file name'
[[ "$offsite_uri" == s3://* ]] || fail 'PG_WAL_OFFSITE_URI must use s3:// syntax'
[[ -n "$recipient" || -n "$recipient_file" ]] || fail 'age recipient is required for WAL archiving'
command -v age >/dev/null 2>&1 || fail 'age command not found'
command -v aws >/dev/null 2>&1 || fail 'aws command not found'

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/pg-wal.XXXXXX")"
trap 'rm -rf "$work_dir"' EXIT
encrypted="$work_dir/${wal_name}.age"
if [[ -n "$recipient_file" ]]; then
  age --recipients-file "$recipient_file" --output "$encrypted" "$wal_path"
else
  age --recipient "$recipient" --output "$encrypted" "$wal_path"
fi

if command -v sha256sum >/dev/null 2>&1; then
  checksum="$(sha256sum "$encrypted" | awk '{print $1}')"
else
  checksum="$(shasum -a 256 "$encrypted" | awk '{print $1}')"
fi
printf '%s  %s\n' "$checksum" "${wal_name}.age" >"${encrypted}.sha256"
remote_prefix="${offsite_uri%/}"
aws s3 cp --only-show-errors "$encrypted" "$remote_prefix/${wal_name}.age"
aws s3 cp --only-show-errors "${encrypted}.sha256" "$remote_prefix/${wal_name}.age.sha256"
write_metrics 1 "$(date -u +%s)"
