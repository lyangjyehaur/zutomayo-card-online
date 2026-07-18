#!/usr/bin/env bash
# Create an encrypted physical base backup suitable for WAL point-in-time
# recovery. The replication role must have pg_hba access for pg_basebackup.
set -euo pipefail
umask 077

PG_HOST="${PG_HOST:-localhost}"
PG_PORT="${PG_PORT:-5432}"
PG_USER="${PG_WAL_USER:-${PG_BASE_BACKUP_USER:-${PG_USER:-zutomayo_wal}}}"
PG_PASSWORD="${PG_WAL_PASSWORD:-${PG_PASSWORD:-}}"
BACKUP_DIR="${PG_BASE_BACKUP_DIR:-/var/backups/zutomayo/base}"
OFFSITE_URI="${PG_BASE_BACKUP_OFFSITE_URI:-${PG_BACKUP_OFFSITE_URI:-}}"
METRICS_DIR="${PG_BACKUP_METRICS_DIR:-/var/lib/node_exporter/textfile_collector}"
AGE_RECIPIENT="${PG_BACKUP_AGE_RECIPIENT:-}"
AGE_RECIPIENT_FILE="${PG_BACKUP_AGE_RECIPIENT_FILE:-}"
RETENTION_DAYS="${PG_BASE_BACKUP_RETENTION_DAYS:-7}"

write_failure_metrics() {
  local previous_success=0
  local previous_size=0
  if [[ -f "$METRICS_DIR/zutomayo_pg_base_backup.prom" ]]; then
    previous_success="$(awk '$1 == "pg_base_backup_last_success_unixtime_seconds" {print $2; exit}' "$METRICS_DIR/zutomayo_pg_base_backup.prom" || true)"
    previous_size="$(awk '$1 == "pg_base_backup_last_size_bytes" {print $2; exit}' "$METRICS_DIR/zutomayo_pg_base_backup.prom" || true)"
  fi
  [[ "$previous_success" =~ ^[0-9]+([.][0-9]+)?$ ]] || previous_success=0
  [[ "$previous_size" =~ ^[0-9]+([.][0-9]+)?$ ]] || previous_size=0
  mkdir -p "$METRICS_DIR" || return 0
  local temp_metrics="$METRICS_DIR/.pg_base_backup.prom.$$"
  printf '%s\n' \
    '# HELP pg_base_backup_last_run_success Whether the latest physical base backup succeeded.' \
    '# TYPE pg_base_backup_last_run_success gauge' \
    'pg_base_backup_last_run_success 0' \
    '# HELP pg_base_backup_last_success_unixtime_seconds Unix timestamp of the latest encrypted off-site base backup.' \
    '# TYPE pg_base_backup_last_success_unixtime_seconds gauge' \
    "pg_base_backup_last_success_unixtime_seconds $previous_success" \
    '# HELP pg_base_backup_last_size_bytes Size in bytes of the latest encrypted base backup.' \
    '# TYPE pg_base_backup_last_size_bytes gauge' \
    "pg_base_backup_last_size_bytes $previous_size" >"$temp_metrics" || return 0
  mv "$temp_metrics" "$METRICS_DIR/zutomayo_pg_base_backup.prom" || return 0
  chmod 0644 "$METRICS_DIR/zutomayo_pg_base_backup.prom" || true
}

success=false
work_dir=''
cleanup() {
  local exit_code=$?
  if [[ -n "$work_dir" ]]; then rm -rf "$work_dir"; fi
  if [[ "$success" != 'true' ]]; then
    write_failure_metrics || true
  fi
  return "$exit_code"
}
trap cleanup EXIT

fail() {
  echo "ERROR: $1" >&2
  exit 1
}

[[ -n "${PG_PASSWORD:-}" || -n "${PGPASSFILE:-}" ]] || fail 'PG_PASSWORD or PGPASSFILE is required'
[[ "$OFFSITE_URI" == s3://* ]] || fail 'PG_BASE_BACKUP_OFFSITE_URI must use s3:// syntax'
[[ -n "$AGE_RECIPIENT" || -n "$AGE_RECIPIENT_FILE" ]] || fail 'age recipient is required'
for command_name in pg_basebackup age aws tar awk; do
  command -v "$command_name" >/dev/null 2>&1 || fail "required command not found: $command_name"
done

mkdir -p "$BACKUP_DIR" "$METRICS_DIR"
work_dir="$(mktemp -d "$BACKUP_DIR/.pg-base-backup.XXXXXX")"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
raw_dir="$work_dir/raw"
mkdir -p "$raw_dir"
if [[ -n "${PG_PASSWORD:-}" ]]; then
  export PGPASSWORD="$PG_PASSWORD"
fi
pg_basebackup \
  --host "$PG_HOST" \
  --port "$PG_PORT" \
  --username "$PG_USER" \
  --pgdata "$raw_dir" \
  --format tar \
  --gzip \
  --wal-method stream \
  --checkpoint fast \
  --progress

bundle_name="zutomayo_base_${timestamp}.tar"
bundle="$work_dir/$bundle_name"
tar -cf "$bundle" -C "$raw_dir" .
artifact="$BACKUP_DIR/${bundle_name}.age"
if [[ -n "$AGE_RECIPIENT_FILE" ]]; then
  age --recipients-file "$AGE_RECIPIENT_FILE" --output "$artifact" "$bundle"
else
  age --recipient "$AGE_RECIPIENT" --output "$artifact" "$bundle"
fi

if command -v sha256sum >/dev/null 2>&1; then
  checksum="$(sha256sum "$artifact" | awk '{print $1}')"
else
  checksum="$(shasum -a 256 "$artifact" | awk '{print $1}')"
fi
artifact_name="$(basename "$artifact")"
printf '%s  %s\n' "$checksum" "$artifact_name" >"${artifact}.sha256"
remote_prefix="${OFFSITE_URI%/}"
aws s3 cp --only-show-errors "$artifact" "$remote_prefix/$artifact_name"
aws s3 cp --only-show-errors "${artifact}.sha256" "$remote_prefix/${artifact_name}.sha256"

size_bytes="$(wc -c <"$artifact" | tr -d ' ')"
temp_metrics="$METRICS_DIR/.pg_base_backup.prom.$$"
{
  echo '# HELP pg_base_backup_last_run_success Whether the latest physical base backup succeeded.'
  echo '# TYPE pg_base_backup_last_run_success gauge'
  echo 'pg_base_backup_last_run_success 1'
  echo '# HELP pg_base_backup_last_success_unixtime_seconds Unix timestamp of the latest encrypted off-site base backup.'
  echo '# TYPE pg_base_backup_last_success_unixtime_seconds gauge'
  echo "pg_base_backup_last_success_unixtime_seconds $(date -u +%s)"
  echo '# HELP pg_base_backup_last_size_bytes Size in bytes of the latest encrypted base backup.'
  echo '# TYPE pg_base_backup_last_size_bytes gauge'
  echo "pg_base_backup_last_size_bytes $size_bytes"
} >"$temp_metrics"

find "$BACKUP_DIR" -type f \( -name 'zutomayo_base_*.tar.age' -o -name 'zutomayo_base_*.tar.age.sha256' \) \
  -mtime "+$RETENTION_DAYS" -delete
mv "$temp_metrics" "$METRICS_DIR/zutomayo_pg_base_backup.prom"
chmod 0644 "$METRICS_DIR/zutomayo_pg_base_backup.prom"
success=true
echo "[$(date -u +%FT%TZ)] physical base backup complete: $artifact (sha256=$checksum)"
