#!/usr/bin/env bash
# Restore an encrypted logical backup into an isolated PostgreSQL container and
# verify migration/core-table invariants. This does not alter the source DB.
set -euo pipefail
umask 077

source_artifact="${1:-${PG_RESTORE_DRILL_ARTIFACT:-}}"
identity_file="${PG_BACKUP_AGE_IDENTITY_FILE:-}"
container_image="${PG_RESTORE_DRILL_IMAGE:-}"
container_name="${PG_RESTORE_DRILL_CONTAINER:-zutomayo-restore-drill-$$}"
metrics_dir="${PG_BACKUP_METRICS_DIR:-/var/lib/node_exporter/textfile_collector}"
report_dir="${PG_RESTORE_DRILL_REPORT_DIR:-/var/log/zutomayo/restore-drills}"
database="${PG_RESTORE_DRILL_DATABASE:-zutomayo_restore_drill}"
password="${PG_RESTORE_DRILL_PASSWORD:-restore-drill-only}"
allow_unencrypted="${PG_BACKUP_ALLOW_UNENCRYPTED:-false}"

write_metrics() {
  local success="$1"
  local timestamp="$2"
  mkdir -p "$metrics_dir"
  local temp_metrics="$metrics_dir/.pg_restore_drill.prom.$$"
  {
    echo '# HELP pg_restore_drill_success Whether the latest isolated logical restore drill succeeded.'
    echo '# TYPE pg_restore_drill_success gauge'
    echo "pg_restore_drill_success $success"
    echo '# HELP pg_restore_drill_last_success_unixtime_seconds Unix timestamp of the latest successful restore drill.'
    echo '# TYPE pg_restore_drill_last_success_unixtime_seconds gauge'
    echo "pg_restore_drill_last_success_unixtime_seconds $timestamp"
  } >"$temp_metrics"
  mv "$temp_metrics" "$metrics_dir/zutomayo_pg_restore_drill.prom"
  chmod 0644 "$metrics_dir/zutomayo_pg_restore_drill.prom"
}

fail() {
  echo "ERROR: $1" >&2
  exit 1
}

[[ -n "$source_artifact" ]] || fail 'backup artifact path or s3:// URI is required'
[[ "$container_image" =~ ^[A-Za-z0-9./_-]+@sha256:[0-9a-fA-F]{64}$ ]] ||
  fail 'PG_RESTORE_DRILL_IMAGE must be an explicitly pinned @sha256 image reference'
for command_name in docker awk; do
  command -v "$command_name" >/dev/null 2>&1 || fail "required command not found: $command_name"
done

mkdir -p "$metrics_dir" "$report_dir"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/pg-restore-drill.XXXXXX")"
container_started=false
success=false
cleanup() {
  local exit_code=$?
  if [[ "$container_started" == 'true' ]]; then
    docker rm -f "$container_name" >/dev/null 2>&1 || true
  fi
  rm -rf "$work_dir"
  if [[ "$success" != 'true' ]]; then
    write_metrics 0 0 || true
  fi
  return "$exit_code"
}
trap cleanup EXIT

artifact="$work_dir/backup"
checksum_file="$work_dir/backup.sha256"
if [[ "$source_artifact" == s3://* ]]; then
  command -v aws >/dev/null 2>&1 || fail 'aws command not found'
  aws s3 cp --only-show-errors "$source_artifact" "$artifact"
  aws s3 cp --only-show-errors "${source_artifact}.sha256" "$checksum_file"
else
  [[ -f "$source_artifact" && -f "${source_artifact}.sha256" ]] || fail 'artifact and .sha256 sidecar are required'
  cp "$source_artifact" "$artifact"
  cp "${source_artifact}.sha256" "$checksum_file"
fi

expected_checksum="$(awk 'NR == 1 {print $1}' "$checksum_file")"
if command -v sha256sum >/dev/null 2>&1; then
  actual_checksum="$(sha256sum "$artifact" | awk '{print $1}')"
else
  actual_checksum="$(shasum -a 256 "$artifact" | awk '{print $1}')"
fi
[[ -n "$expected_checksum" && "$expected_checksum" == "$actual_checksum" ]] || fail 'backup checksum mismatch'

plain_dump="$work_dir/restore.dump"
if [[ "$source_artifact" == *.age ]]; then
  [[ -r "$identity_file" ]] || fail 'PG_BACKUP_AGE_IDENTITY_FILE is required to decrypt the backup'
  command -v age >/dev/null 2>&1 || fail 'age command not found'
  age --decrypt --identity "$identity_file" --output "$plain_dump" "$artifact"
elif [[ "$allow_unencrypted" == 'true' ]]; then
  cp "$artifact" "$plain_dump"
else
  fail 'unencrypted restore artifacts require PG_BACKUP_ALLOW_UNENCRYPTED=true'
fi

started_at="$(date -u +%s)"
docker run --detach --rm \
  --name "$container_name" \
  --env "POSTGRES_PASSWORD=$password" \
  --env "POSTGRES_DB=$database" \
  "$container_image" >/dev/null
container_started=true

ready=false
for _ in $(seq 1 60); do
  if docker exec "$container_name" pg_isready --username postgres --dbname "$database" >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
[[ "$ready" == 'true' ]] || fail 'restore drill PostgreSQL did not become ready within 60 seconds'

docker cp "$plain_dump" "$container_name:/tmp/restore.dump"
docker exec "$container_name" pg_restore \
  --exit-on-error \
  --no-owner \
  --no-privileges \
  --username postgres \
  --dbname "$database" \
  /tmp/restore.dump

counts="$(docker exec "$container_name" psql \
  --username postgres \
  --dbname "$database" \
  --set ON_ERROR_STOP=1 \
  --tuples-only \
  --no-align \
  --command "SELECT 'schema_migrations=' || COUNT(*) FROM schema_migrations UNION ALL SELECT 'users=' || COUNT(*) FROM users UNION ALL SELECT 'cards=' || COUNT(*) FROM cards UNION ALL SELECT 'matches=' || COUNT(*) FROM matches ORDER BY 1")"
printf '%s\n' "$counts" | grep -q '^schema_migrations=[1-9][0-9]*$' || fail 'restored schema has no applied migrations'
printf '%s\n' "$counts" | grep -q '^cards=[1-9][0-9]*$' || fail 'restored card catalog is empty'

completed_at="$(date -u +%s)"
report="$report_dir/restore-drill-$(date -u +%Y%m%dT%H%M%SZ).txt"
{
  echo "artifact=$source_artifact"
  echo "sha256=$actual_checksum"
  echo "image=$container_image"
  echo "started_at=$started_at"
  echo "completed_at=$completed_at"
  echo "duration_seconds=$((completed_at - started_at))"
  printf '%s\n' "$counts"
} >"$report"
write_metrics 1 "$completed_at"
success=true
echo "restore drill passed: $report"
