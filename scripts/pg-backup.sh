#!/usr/bin/env bash
# Create a verified PostgreSQL logical backup, encrypt it with age, and copy it
# to S3-compatible off-site storage. Local-only and unencrypted modes require
# explicit development opt-ins.
set -euo pipefail
umask 077

PG_HOST="${PG_HOST:-localhost}"
PG_PORT="${PG_PORT:-5432}"
PG_USER="${PG_USER:-zutomayo}"
PG_DATABASE="${PG_DATABASE:-zutomayo}"
BACKUP_DIR="${PG_BACKUP_DIR:-/var/backups/zutomayo}"
RETENTION_DAYS="${PG_BACKUP_RETENTION_DAYS:-7}"
OFFSITE_URI="${PG_BACKUP_OFFSITE_URI:-}"
METRICS_DIR="${PG_BACKUP_METRICS_DIR:-/var/lib/node_exporter/textfile_collector}"
ALLOW_LOCAL_ONLY="${PG_BACKUP_ALLOW_LOCAL_ONLY:-false}"
ALLOW_UNENCRYPTED="${PG_BACKUP_ALLOW_UNENCRYPTED:-false}"
AGE_RECIPIENT="${PG_BACKUP_AGE_RECIPIENT:-}"
AGE_RECIPIENT_FILE="${PG_BACKUP_AGE_RECIPIENT_FILE:-}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ERROR: required command not found: $1" >&2
    exit 1
  fi
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

write_metrics() {
  local success="$1"
  local completed_at="${2:-0}"
  local size_bytes="${3:-0}"
  mkdir -p "$METRICS_DIR"
  local temp_metrics="$METRICS_DIR/.pg_backup.prom.$$"
  {
    echo '# HELP pg_backup_last_run_success Whether the latest logical backup run succeeded.'
    echo '# TYPE pg_backup_last_run_success gauge'
    echo "pg_backup_last_run_success $success"
    echo '# HELP pg_backup_last_success_unixtime_seconds Unix timestamp of the latest successful encrypted off-site backup.'
    echo '# TYPE pg_backup_last_success_unixtime_seconds gauge'
    echo "pg_backup_last_success_unixtime_seconds $completed_at"
    echo '# HELP pg_backup_last_size_bytes Size in bytes of the latest successful encrypted backup.'
    echo '# TYPE pg_backup_last_size_bytes gauge'
    echo "pg_backup_last_size_bytes $size_bytes"
  } >"$temp_metrics"
  mv "$temp_metrics" "$METRICS_DIR/zutomayo_pg_backup.prom"
  chmod 0644 "$METRICS_DIR/zutomayo_pg_backup.prom"
}

require_command pg_dump
require_command pg_restore
require_command awk

if [[ -z "${PG_PASSWORD:-}" && -z "${PGPASSFILE:-}" ]]; then
  echo 'ERROR: PG_PASSWORD or PGPASSFILE is required' >&2
  exit 1
fi
if [[ -z "$OFFSITE_URI" && "$ALLOW_LOCAL_ONLY" != 'true' ]]; then
  echo 'ERROR: PG_BACKUP_OFFSITE_URI is required unless PG_BACKUP_ALLOW_LOCAL_ONLY=true' >&2
  exit 1
fi
if [[ -n "$OFFSITE_URI" && "$OFFSITE_URI" != s3://* ]]; then
  echo 'ERROR: PG_BACKUP_OFFSITE_URI must use s3:// syntax' >&2
  exit 1
fi
if [[ -z "$AGE_RECIPIENT" && -z "$AGE_RECIPIENT_FILE" && "$ALLOW_UNENCRYPTED" != 'true' ]]; then
  echo 'ERROR: configure PG_BACKUP_AGE_RECIPIENT(_FILE), or explicitly allow unencrypted development backups' >&2
  exit 1
fi
if [[ -n "$AGE_RECIPIENT" || -n "$AGE_RECIPIENT_FILE" ]]; then
  require_command age
fi
if [[ -n "$OFFSITE_URI" ]]; then
  require_command aws
fi

mkdir -p "$BACKUP_DIR" "$METRICS_DIR"
work_dir="$(mktemp -d "$BACKUP_DIR/.pg-backup.XXXXXX")"
completed=false
cleanup() {
  local exit_code=$?
  rm -rf "$work_dir"
  if [[ "$completed" != 'true' ]]; then
    write_metrics 0 0 0 || true
  fi
  return "$exit_code"
}
trap cleanup EXIT

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
base_name="zutomayo_${timestamp}.dump"
plain_dump="$work_dir/$base_name"

echo "[$(date -u +%FT%TZ)] creating PostgreSQL custom-format backup"
if [[ -n "${PG_PASSWORD:-}" ]]; then
  export PGPASSWORD="$PG_PASSWORD"
fi
pg_dump \
  --host "$PG_HOST" \
  --port "$PG_PORT" \
  --username "$PG_USER" \
  --dbname "$PG_DATABASE" \
  --format custom \
  --compress 6 \
  --no-owner \
  --no-privileges \
  --file "$plain_dump"
pg_restore --list "$plain_dump" >/dev/null

artifact_name="$base_name"
artifact="$BACKUP_DIR/$artifact_name"
if [[ -n "$AGE_RECIPIENT_FILE" ]]; then
  artifact_name="${base_name}.age"
  artifact="$BACKUP_DIR/$artifact_name"
  age --recipients-file "$AGE_RECIPIENT_FILE" --output "$artifact" "$plain_dump"
elif [[ -n "$AGE_RECIPIENT" ]]; then
  artifact_name="${base_name}.age"
  artifact="$BACKUP_DIR/$artifact_name"
  age --recipient "$AGE_RECIPIENT" --output "$artifact" "$plain_dump"
else
  cp "$plain_dump" "$artifact"
fi

checksum="$(sha256_file "$artifact")"
printf '%s  %s\n' "$checksum" "$artifact_name" >"${artifact}.sha256"
size_bytes="$(wc -c <"$artifact" | tr -d ' ')"

if [[ -n "$OFFSITE_URI" ]]; then
  remote_prefix="${OFFSITE_URI%/}"
  aws s3 cp --only-show-errors "$artifact" "$remote_prefix/$artifact_name"
  aws s3 cp --only-show-errors "${artifact}.sha256" "$remote_prefix/${artifact_name}.sha256"
fi

completed_at="$(date -u +%s)"
write_metrics 1 "$completed_at" "$size_bytes"

find "$BACKUP_DIR" -type f \( -name 'zutomayo_*.dump' -o -name 'zutomayo_*.dump.age' -o -name 'zutomayo_*.sha256' \) \
  -mtime "+$RETENTION_DAYS" -delete
completed=true

echo "[$(date -u +%FT%TZ)] backup complete: $artifact ($size_bytes bytes, sha256=$checksum)"
