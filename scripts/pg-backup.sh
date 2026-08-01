#!/usr/bin/env bash
# Create a verified PostgreSQL logical backup, encrypt it with age, and copy it
# to S3-compatible off-site storage. Local-only and unencrypted modes require
# explicit development opt-ins.
set -euo pipefail
umask 077

PG_HOST="${PG_HOST:-localhost}"
PG_PORT="${PG_PORT:-5432}"
PG_USER="${PG_BACKUP_USER:-${PG_USER:-zutomayo_backup}}"
PG_PASSWORD="${PG_BACKUP_PASSWORD:-${PG_PASSWORD:-}}"
PG_DATABASE="${PG_DATABASE:-zutomayo}"
BACKUP_DIR="${PG_BACKUP_DIR:-/var/backups/zutomayo}"
RETENTION_DAYS="${PG_BACKUP_RETENTION_DAYS:-7}"
OFFSITE_URI="${PG_BACKUP_OFFSITE_URI:-}"
METRICS_DIR="${PG_BACKUP_METRICS_DIR:-/var/lib/node_exporter/textfile_collector}"
RECEIPT_DIR="${PG_BACKUP_RECEIPT_DIR:-$BACKUP_DIR/receipts}"
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
  local previous_success=0
  local previous_size=0
  if [[ -f "$METRICS_DIR/zutomayo_pg_backup.prom" ]]; then
    previous_success="$(awk '$1 == "pg_backup_last_success_unixtime_seconds" {print $2; exit}' "$METRICS_DIR/zutomayo_pg_backup.prom" || true)"
    previous_size="$(awk '$1 == "pg_backup_last_size_bytes" {print $2; exit}' "$METRICS_DIR/zutomayo_pg_backup.prom" || true)"
  fi
  [[ "$previous_success" =~ ^[0-9]+([.][0-9]+)?$ ]] || previous_success=0
  [[ "$previous_size" =~ ^[0-9]+([.][0-9]+)?$ ]] || previous_size=0
  if [[ "$completed_at" != 0 ]]; then
    previous_success="$completed_at"
    previous_size="$size_bytes"
  fi
  mkdir -p "$METRICS_DIR"
  local temp_metrics="$METRICS_DIR/.pg_backup.prom.$$"
  {
    echo '# HELP pg_backup_last_run_success Whether the latest logical backup run succeeded.'
    echo '# TYPE pg_backup_last_run_success gauge'
    echo "pg_backup_last_run_success $success"
    echo '# HELP pg_backup_last_success_unixtime_seconds Unix timestamp of the latest successful encrypted off-site backup.'
    echo '# TYPE pg_backup_last_success_unixtime_seconds gauge'
    echo "pg_backup_last_success_unixtime_seconds $previous_success"
    echo '# HELP pg_backup_last_size_bytes Size in bytes of the latest successful encrypted backup.'
    echo '# TYPE pg_backup_last_size_bytes gauge'
    echo "pg_backup_last_size_bytes $previous_size"
  } >"$temp_metrics"
  mv "$temp_metrics" "$METRICS_DIR/zutomayo_pg_backup.prom"
  chmod 0644 "$METRICS_DIR/zutomayo_pg_backup.prom"
}

completed=false
work_dir=''
receipt_temp=''
latest_receipt_temp=''
cleanup() {
  local exit_code=$?
  if [[ -n "$receipt_temp" ]]; then rm -f "$receipt_temp"; fi
  if [[ -n "$latest_receipt_temp" ]]; then rm -f "$latest_receipt_temp"; fi
  if [[ -n "$work_dir" ]]; then rm -rf "$work_dir"; fi
  if [[ "$completed" != 'true' ]]; then
    write_metrics 0 0 0 || true
  fi
  return "$exit_code"
}
trap cleanup EXIT

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
  require_command jq
fi

mkdir -p "$BACKUP_DIR" "$METRICS_DIR"
if [[ -n "$OFFSITE_URI" ]]; then
  mkdir -p "$RECEIPT_DIR"
  chmod 0750 "$BACKUP_DIR" "$RECEIPT_DIR"
fi
work_dir="$(mktemp -d "$BACKUP_DIR/.pg-backup.XXXXXX")"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
recovery_point_at="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
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
  remote_path="${remote_prefix#s3://}"
  remote_bucket="${remote_path%%/*}"
  if [[ "$remote_bucket" == "$remote_path" ]]; then
    remote_key_prefix=''
  else
    remote_key_prefix="${remote_path#*/}"
  fi
  [[ "$remote_bucket" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{1,62}$ ]] || {
    echo 'ERROR: PG_BACKUP_OFFSITE_URI must contain a valid S3 bucket' >&2
    exit 1
  }
  [[ "$remote_prefix" != *'?'* && "$remote_prefix" != *'#'* && "$remote_prefix" != *[$'\r\n\t ']* ]] || {
    echo 'ERROR: PG_BACKUP_OFFSITE_URI must be a credential-free S3 prefix' >&2
    exit 1
  }
  artifact_key="${remote_key_prefix:+${remote_key_prefix}/}${artifact_name}"
  checksum_key="${artifact_key}.sha256"
  artifact_response="$(aws s3api put-object \
    --bucket "$remote_bucket" \
    --key "$artifact_key" \
    --metadata "recovery-point-at=$recovery_point_at" \
    --body "$artifact")"
  checksum_response="$(aws s3api put-object \
    --bucket "$remote_bucket" \
    --key "$checksum_key" \
    --body "${artifact}.sha256")"
  if ! artifact_version_id="$(printf '%s' "$artifact_response" | jq -er \
    '.VersionId | select(type == "string" and length > 0 and . != "null")')"; then
    echo 'ERROR: backup object upload did not return an immutable VersionId' >&2
    exit 1
  fi
  if ! checksum_version_id="$(printf '%s' "$checksum_response" | jq -er \
    '.VersionId | select(type == "string" and length > 0 and . != "null")')"; then
    echo 'ERROR: checksum object upload did not return an immutable VersionId' >&2
    exit 1
  fi

  receipt_name="${artifact_name}.receipt.json"
  receipt_path="$RECEIPT_DIR/$receipt_name"
  [[ ! -e "$receipt_path" && ! -L "$receipt_path" ]] || {
    echo "ERROR: backup receipt already exists: $receipt_path" >&2
    exit 1
  }
  uploaded_at="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  receipt_temp="$(mktemp "$RECEIPT_DIR/.${receipt_name}.XXXXXX")"
  jq -n \
    --arg uploadedAt "$uploaded_at" \
    --arg recoveryPointAt "$recovery_point_at" \
    --arg remoteObjectUrl "s3://$remote_bucket/$artifact_key" \
    --arg checksumRemoteObjectUrl "s3://$remote_bucket/$checksum_key" \
    --arg objectVersionId "$artifact_version_id" \
    --arg checksumObjectVersionId "$checksum_version_id" \
    --arg artifactSha256 "$checksum" \
    --argjson sizeBytes "$size_bytes" \
    '{
      schemaVersion: 1,
      artifactType: "zutomayo-encrypted-logical-backup-receipt",
      uploadedAt: $uploadedAt,
      recoveryPointAt: $recoveryPointAt,
      remoteObjectUrl: $remoteObjectUrl,
      checksumRemoteObjectUrl: $checksumRemoteObjectUrl,
      objectVersionId: $objectVersionId,
      checksumObjectVersionId: $checksumObjectVersionId,
      artifactSha256: $artifactSha256,
      sizeBytes: $sizeBytes
    }' >"$receipt_temp"
  chmod 0440 "$receipt_temp"
  mv "$receipt_temp" "$receipt_path"
  receipt_temp=''
  latest_receipt_temp="$(mktemp "$RECEIPT_DIR/.latest-offsite-backup-receipt.XXXXXX")"
  cp "$receipt_path" "$latest_receipt_temp"
  chmod 0440 "$latest_receipt_temp"
  mv "$latest_receipt_temp" "$RECEIPT_DIR/latest-offsite-backup-receipt.json"
  latest_receipt_temp=''
fi

completed_at="$(date -u +%s)"
write_metrics 1 "$completed_at" "$size_bytes"

find "$BACKUP_DIR" -type f \( -name 'zutomayo_*.dump' -o -name 'zutomayo_*.dump.age' -o -name 'zutomayo_*.sha256' \) \
  -mtime "+$RETENTION_DAYS" -delete
if [[ -d "$RECEIPT_DIR" ]]; then
  find "$RECEIPT_DIR" -type f -name 'zutomayo_*.receipt.json' -mtime "+$RETENTION_DAYS" -delete
fi
completed=true

echo "[$(date -u +%FT%TZ)] backup complete: $artifact ($size_bytes bytes, sha256=$checksum)"
