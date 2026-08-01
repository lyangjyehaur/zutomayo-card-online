#!/usr/bin/env bash
# Run the isolated restore drill from a recent backup receipt. The receipt pins
# both S3 object versions so the scheduler never resolves a mutable latest key.
set -euo pipefail
umask 077

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
receipt_file="${PG_RESTORE_DRILL_RECEIPT_FILE:-/var/backups/zutomayo/receipts/latest-offsite-backup-receipt.json}"
restore_script="${PG_RESTORE_DRILL_SCRIPT:-$script_dir/pg-restore-drill.sh}"
max_receipt_age_seconds="${PG_RESTORE_DRILL_MAX_RECEIPT_AGE_SECONDS:-93600}"
metrics_dir="${PG_BACKUP_METRICS_DIR:-/var/lib/node_exporter/textfile_collector}"

write_failure_metrics() {
  local previous_success=0
  if [[ -f "$metrics_dir/zutomayo_pg_restore_drill.prom" ]]; then
    previous_success="$(awk '$1 == "pg_restore_drill_last_success_unixtime_seconds" {print $2; exit}' \
      "$metrics_dir/zutomayo_pg_restore_drill.prom" || true)"
  fi
  [[ "$previous_success" =~ ^[0-9]+([.][0-9]+)?$ ]] || previous_success=0
  mkdir -p "$metrics_dir" || return 0
  local temp_metrics="$metrics_dir/.pg_restore_drill.prom.$$"
  {
    echo '# HELP pg_restore_drill_success Whether the latest isolated logical restore drill succeeded.'
    echo '# TYPE pg_restore_drill_success gauge'
    echo 'pg_restore_drill_success 0'
    echo '# HELP pg_restore_drill_last_success_unixtime_seconds Unix timestamp of the latest successful restore drill.'
    echo '# TYPE pg_restore_drill_last_success_unixtime_seconds gauge'
    echo "pg_restore_drill_last_success_unixtime_seconds $previous_success"
  } >"$temp_metrics" || return 0
  mv "$temp_metrics" "$metrics_dir/zutomayo_pg_restore_drill.prom" || return 0
  chmod 0644 "$metrics_dir/zutomayo_pg_restore_drill.prom" || true
}

fail() {
  echo "ERROR: $1" >&2
  write_failure_metrics || true
  exit 1
}

parse_iso_epoch() {
  local value="$1"
  local whole_seconds="${value%.*}Z"
  if date -u -d "$whole_seconds" +%s >/dev/null 2>&1; then
    date -u -d "$whole_seconds" +%s
  else
    date -j -u -f '%Y-%m-%dT%H:%M:%SZ' "$whole_seconds" +%s
  fi
}

[[ "$max_receipt_age_seconds" =~ ^[1-9][0-9]*$ ]] ||
  fail 'PG_RESTORE_DRILL_MAX_RECEIPT_AGE_SECONDS must be a positive integer'
[[ -f "$receipt_file" && ! -L "$receipt_file" ]] ||
  fail 'PG_RESTORE_DRILL_RECEIPT_FILE must be a regular non-symlink file'
[[ -x "$restore_script" && ! -L "$restore_script" ]] ||
  fail 'PG_RESTORE_DRILL_SCRIPT must be an executable non-symlink file'
command -v jq >/dev/null 2>&1 || fail 'jq command not found'

if receipt_mode="$(stat -c '%a' "$receipt_file" 2>/dev/null)"; then
  :
elif receipt_mode="$(stat -f '%Lp' "$receipt_file" 2>/dev/null)"; then
  :
else
  fail 'unable to inspect backup receipt permissions'
fi
receipt_mode="${receipt_mode: -3}"
[[ "$receipt_mode" =~ ^[0-7]{3}$ ]] || fail 'backup receipt permissions are invalid'
group_mode="${receipt_mode:1:1}"
other_mode="${receipt_mode:2:1}"
(( (group_mode & 2) == 0 && (other_mode & 2) == 0 )) ||
  fail 'backup receipt must not be group- or world-writable'

receipt_json="$(jq -ce '
  if .schemaVersion == 1 and
  .artifactType == "zutomayo-encrypted-logical-backup-receipt" and
  (.uploadedAt | type == "string") and
  (.recoveryPointAt | type == "string") and
  (.remoteObjectUrl | type == "string") and
  (.checksumRemoteObjectUrl | type == "string") and
  (.objectVersionId | type == "string") and
  (.checksumObjectVersionId | type == "string") and
  (.artifactSha256 | type == "string") and
  (.sizeBytes | type == "number") and
  .sizeBytes > 0 and
  .sizeBytes == (.sizeBytes | floor)
  then . else error("invalid backup receipt") end
' "$receipt_file" 2>/dev/null)" || fail 'backup receipt schema is invalid'

uploaded_at="$(jq -r '.uploadedAt' <<<"$receipt_json")"
recovery_point_at="$(jq -r '.recoveryPointAt' <<<"$receipt_json")"
remote_object_url="$(jq -r '.remoteObjectUrl' <<<"$receipt_json")"
checksum_remote_object_url="$(jq -r '.checksumRemoteObjectUrl' <<<"$receipt_json")"
object_version_id="$(jq -r '.objectVersionId' <<<"$receipt_json")"
checksum_version_id="$(jq -r '.checksumObjectVersionId' <<<"$receipt_json")"
artifact_sha256="$(jq -r '.artifactSha256' <<<"$receipt_json")"

canonical_timestamp_pattern='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
[[ "$uploaded_at" =~ $canonical_timestamp_pattern && "$recovery_point_at" =~ $canonical_timestamp_pattern ]] ||
  fail 'backup receipt timestamps must use canonical UTC ISO format'
[[ "$remote_object_url" == s3://*.age && "$remote_object_url" != *[$'\r\n\t ?#']* ]] ||
  fail 'backup receipt remoteObjectUrl must be a credential-free encrypted S3 URL'
[[ "$checksum_remote_object_url" == "${remote_object_url}.sha256" ]] ||
  fail 'backup receipt checksum URL must match the artifact sidecar'
[[ "$object_version_id" =~ ^[A-Za-z0-9._~+/=-]+$ && "$object_version_id" != 'null' ]] ||
  fail 'backup receipt objectVersionId is invalid'
[[ "$checksum_version_id" =~ ^[A-Za-z0-9._~+/=-]+$ && "$checksum_version_id" != 'null' ]] ||
  fail 'backup receipt checksumObjectVersionId is invalid'
[[ "$artifact_sha256" =~ ^[a-f0-9]{64}$ ]] || fail 'backup receipt artifactSha256 is invalid'

uploaded_epoch="$(parse_iso_epoch "$uploaded_at")" || fail 'backup receipt uploadedAt is invalid'
recovery_point_epoch="$(parse_iso_epoch "$recovery_point_at")" || fail 'backup receipt recoveryPointAt is invalid'
now_epoch="$(date -u +%s)"
(( uploaded_epoch >= recovery_point_epoch )) || fail 'backup receipt upload precedes its recovery point'
(( uploaded_epoch <= now_epoch + 300 )) || fail 'backup receipt uploadedAt is in the future'
receipt_age_seconds=$((now_epoch - recovery_point_epoch))
(( receipt_age_seconds <= max_receipt_age_seconds )) ||
  fail "backup receipt recovery point is older than ${max_receipt_age_seconds} seconds"

export PG_RESTORE_DRILL_OBJECT_VERSION_ID="$object_version_id"
export PG_RESTORE_DRILL_CHECKSUM_VERSION_ID="$checksum_version_id"
export PG_RESTORE_DRILL_EXPECTED_SHA256="$artifact_sha256"
export PG_RESTORE_DRILL_RUN_ID="${PG_RESTORE_DRILL_RUN_ID:-scheduled-$(date -u +%Y%m%dT%H%M%SZ)-$$}"

set +e
"$restore_script" "$remote_object_url"
status=$?
set -e
if [[ "$status" -ne 0 ]]; then
  write_failure_metrics || true
  exit "$status"
fi
