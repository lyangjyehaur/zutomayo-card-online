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
artifact_dir="${PG_RESTORE_DRILL_ARTIFACT_DIR:-$report_dir}"
run_id="${PG_RESTORE_DRILL_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
release_sha="${RELEASE_SHA:-}"
object_version_id="${PG_RESTORE_DRILL_OBJECT_VERSION_ID:-}"
checksum_version_id="${PG_RESTORE_DRILL_CHECKSUM_VERSION_ID:-}"
expected_schema_migration="${EXPECTED_SCHEMA_MIGRATION:-}"
expected_schema_checksum="${EXPECTED_SCHEMA_CHECKSUM:-}"
migrate_image="${MIGRATE_IMAGE:-}"
database="${PG_RESTORE_DRILL_DATABASE:-zutomayo_restore_drill}"
allow_unencrypted="${PG_BACKUP_ALLOW_UNENCRYPTED:-false}"

write_metrics() {
  local success="$1"
  local timestamp="$2"
  local previous_success=0
  if [[ -f "$metrics_dir/zutomayo_pg_restore_drill.prom" ]]; then
    previous_success="$(awk '$1 == "pg_restore_drill_last_success_unixtime_seconds" {print $2; exit}' "$metrics_dir/zutomayo_pg_restore_drill.prom" || true)"
  fi
  [[ "$previous_success" =~ ^[0-9]+([.][0-9]+)?$ ]] || previous_success=0
  if [[ "$timestamp" != 0 ]]; then previous_success="$timestamp"; fi
  mkdir -p "$metrics_dir"
  local temp_metrics="$metrics_dir/.pg_restore_drill.prom.$$"
  {
    echo '# HELP pg_restore_drill_success Whether the latest isolated logical restore drill succeeded.'
    echo '# TYPE pg_restore_drill_success gauge'
    echo "pg_restore_drill_success $success"
    echo '# HELP pg_restore_drill_last_success_unixtime_seconds Unix timestamp of the latest successful restore drill.'
    echo '# TYPE pg_restore_drill_last_success_unixtime_seconds gauge'
    echo "pg_restore_drill_last_success_unixtime_seconds $previous_success"
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
[[ "$release_sha" =~ ^[0-9a-fA-F]{40}$ ]] || fail 'RELEASE_SHA must be a full 40-character commit SHA'
[[ "$run_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || fail 'PG_RESTORE_DRILL_RUN_ID is invalid'
[[ "$expected_schema_migration" =~ ^[0-9]{6,}_[a-z0-9_]+$ ]] ||
  fail 'EXPECTED_SCHEMA_MIGRATION must be a migration basename'
[[ "$expected_schema_checksum" =~ ^[a-f0-9]{64}$ ]] ||
  fail 'EXPECTED_SCHEMA_CHECKSUM must be a lowercase SHA-256 digest'
[[ "$migrate_image" =~ ^[^[:space:]]+@sha256:[a-f0-9]{64}$ ]] ||
  fail 'MIGRATE_IMAGE must be the immutable release manifest digest'
for command_name in docker awk jq; do
  command -v "$command_name" >/dev/null 2>&1 || fail "required command not found: $command_name"
done

offsite_restore=false
remote_bucket=''
remote_key=''
if [[ "$source_artifact" == s3://* ]]; then
  offsite_restore=true
  remote_path="${source_artifact#s3://}"
  remote_bucket="${remote_path%%/*}"
  remote_key="${remote_path#*/}"
  [[ "$remote_bucket" != "$remote_path" && "$remote_bucket" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{1,62}$ ]] ||
    fail 'backup S3 URI must contain a valid bucket and object key'
  [[ -n "$remote_key" && "$source_artifact" != *'?'* && "$source_artifact" != *'#'* && "$source_artifact" != *[$'\r\n\t ']* ]] ||
    fail 'backup S3 URI must be an unversioned, credential-free object URL'
  [[ "$source_artifact" == *.age ]] || fail 'off-site restore artifact must use age encryption'
  [[ "$object_version_id" =~ ^[A-Za-z0-9._~+/=-]+$ && "$object_version_id" != 'null' ]] ||
    fail 'PG_RESTORE_DRILL_OBJECT_VERSION_ID is required for the exact backup object version'
  [[ "$checksum_version_id" =~ ^[A-Za-z0-9._~+/=-]+$ && "$checksum_version_id" != 'null' ]] ||
    fail 'PG_RESTORE_DRILL_CHECKSUM_VERSION_ID is required for the exact checksum object version'
  command -v aws >/dev/null 2>&1 || fail 'aws command not found'
fi

mkdir -p "$metrics_dir" "$report_dir" "$artifact_dir"
evidence_report=''
if [[ "$offsite_restore" == 'true' ]]; then
  evidence_report="$artifact_dir/encrypted-offsite-restore-$run_id.json"
  [[ ! -e "$evidence_report" ]] || fail "off-site restore evidence already exists: $evidence_report"
fi
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/pg-restore-drill.XXXXXX")"
container_started=false
success=false
evidence_temp=''
cleanup() {
  local exit_code=$?
  if [[ "$container_started" == 'true' ]]; then
    docker rm -f "$container_name" >/dev/null 2>&1 || true
  fi
  if [[ -n "$evidence_temp" ]]; then rm -f "$evidence_temp"; fi
  rm -rf "$work_dir"
  if [[ "$success" != 'true' ]]; then
    write_metrics 0 0 || true
  fi
  return "$exit_code"
}
trap cleanup EXIT

artifact="$work_dir/backup"
checksum_file="$work_dir/backup.sha256"
artifact_response="$work_dir/backup.response.json"
checksum_response="$work_dir/checksum.response.json"
recovery_point_at=''
object_last_modified_at=''
started_at="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
started_epoch="$(date -u +%s)"
if [[ "$offsite_restore" == 'true' ]]; then
  aws s3api get-object \
    --bucket "$remote_bucket" \
    --key "$remote_key" \
    --version-id "$object_version_id" \
    "$artifact" >"$artifact_response"
  aws s3api get-object \
    --bucket "$remote_bucket" \
    --key "${remote_key}.sha256" \
    --version-id "$checksum_version_id" \
    "$checksum_file" >"$checksum_response"
  jq -e --arg versionId "$object_version_id" '.VersionId == $versionId' "$artifact_response" >/dev/null ||
    fail 'downloaded backup response did not confirm the requested object version'
  jq -e --arg versionId "$checksum_version_id" '.VersionId == $versionId' "$checksum_response" >/dev/null ||
    fail 'downloaded checksum response did not confirm the requested object version'
  recovery_point_at="$(jq -er '.Metadata["recovery-point-at"]' "$artifact_response")" ||
    fail 'backup object metadata is missing recovery-point-at'
  object_last_modified_at="$(jq -er \
    '.LastModified | sub("\\+00:00$"; "Z") | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601 | strftime("%Y-%m-%dT%H:%M:%S.000Z")' \
    "$artifact_response")" || fail 'backup object LastModified is invalid'
  [[ "$recovery_point_at" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$ ]] ||
    fail 'backup object recovery-point-at must be a canonical ISO timestamp'
else
  [[ -f "$source_artifact" && -f "${source_artifact}.sha256" ]] || fail 'artifact and .sha256 sidecar are required'
  cp "$source_artifact" "$artifact"
  cp "${source_artifact}.sha256" "$checksum_file"
fi

expected_checksum="$(awk 'NR == 1 {print $1}' "$checksum_file")"
[[ "$expected_checksum" =~ ^[a-f0-9]{64}$ ]] || fail 'backup checksum sidecar must start with a lowercase SHA-256 digest'
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

docker run --detach --rm \
  --network none \
  --name "$container_name" \
  --env POSTGRES_HOST_AUTH_METHOD=trust \
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
  --command "
    SELECT 'schema_migrations=' || COUNT(*) FROM schema_migrations
    UNION ALL SELECT 'expected_schema_binding=' || COUNT(*)
      FROM schema_migrations m
      JOIN schema_migration_checksums c ON c.name = m.name
     WHERE m.name = '$expected_schema_migration'
       AND c.sha256 = '$expected_schema_checksum'
    UNION ALL SELECT 'users=' || COUNT(*) FROM users
    UNION ALL SELECT 'cards=' || COUNT(*) FROM cards
    UNION ALL SELECT 'matches=' || COUNT(*) FROM matches
    UNION ALL SELECT 'relationship_change_outbox=' || COUNT(*) FROM relationship_change_outbox
    UNION ALL SELECT 'legal_holds=' || COUNT(*) FROM legal_holds
    UNION ALL SELECT 'unvalidated_constraints=' || COUNT(*)
      FROM pg_constraint
     WHERE connamespace = 'public'::regnamespace AND convalidated = FALSE
    UNION ALL SELECT 'invalid_outbox_status=' || COUNT(*)
      FROM relationship_change_outbox
     WHERE status NOT IN ('pending', 'processing', 'delivered', 'dead_letter')
    UNION ALL SELECT 'deletion_hold_violations=' || COUNT(*)
      FROM account_deletion_requests d
      JOIN legal_holds h ON h.subject_type = 'account' AND h.subject_id = d.user_id
     WHERE d.status = 'completed'
       AND h.released_at IS NULL
       AND (h.expires_at IS NULL OR h.expires_at > NOW())
    UNION ALL SELECT 'deleted_social_violations=' || COUNT(*)
      FROM users u
     WHERE u.deleted_at IS NOT NULL
       AND (
         EXISTS (SELECT 1 FROM user_friends f WHERE f.user_id = u.id OR f.friend_user_id = u.id)
         OR EXISTS (SELECT 1 FROM friend_requests r WHERE r.requester_user_id = u.id OR r.recipient_user_id = u.id)
         OR EXISTS (SELECT 1 FROM user_blocks b WHERE b.blocker_user_id = u.id OR b.blocked_user_id = u.id)
       )
    ORDER BY 1
  ")"
count_value() {
  local key="$1" value
  value="$(printf '%s\n' "$counts" | awk -F= -v key="$key" '$1 == key { print $2; exit }')"
  [[ "$value" =~ ^[0-9]+$ ]] || fail "restored count is missing or invalid: $key"
  printf '%s' "$value"
}
schema_migrations_count="$(count_value schema_migrations)"
expected_schema_binding_count="$(count_value expected_schema_binding)"
users_count="$(count_value users)"
cards_count="$(count_value cards)"
matches_count="$(count_value matches)"
relationship_change_outbox_count="$(count_value relationship_change_outbox)"
legal_holds_count="$(count_value legal_holds)"
unvalidated_constraints_count="$(count_value unvalidated_constraints)"
invalid_outbox_status_count="$(count_value invalid_outbox_status)"
deletion_hold_violations_count="$(count_value deletion_hold_violations)"
deleted_social_violations_count="$(count_value deleted_social_violations)"
schema_gate_passed=false
core_data_invariant_passed=false
legal_hold_invariant_passed=false
((schema_migrations_count >= 1)) || fail 'restored schema has no applied migrations'
[[ "$expected_schema_binding_count" == 1 ]] || fail 'restored schema migration/checksum binding mismatch'
[[ "$unvalidated_constraints_count" == 0 ]] || fail 'restored invariant failed: unvalidated_constraints'
schema_gate_passed=true
((cards_count >= 1)) || fail 'restored card catalog is empty'
[[ "$invalid_outbox_status_count" == 0 ]] || fail 'restored invariant failed: invalid_outbox_status'
core_data_invariant_passed=true
[[ "$deletion_hold_violations_count" == 0 ]] || fail 'restored invariant failed: deletion_hold_violations'
[[ "$deleted_social_violations_count" == 0 ]] || fail 'restored invariant failed: deleted_social_violations'
legal_hold_invariant_passed=true

docker rm -f "$container_name" >/dev/null
container_started=false
finished_epoch="$(date -u +%s)"
while [[ "$finished_epoch" -le "$started_epoch" ]]; do
  sleep 1
  finished_epoch="$(date -u +%s)"
done
finished_at="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
report="$report_dir/restore-drill-$(date -u +%Y%m%dT%H%M%SZ).txt"
{
  echo "artifact=$source_artifact"
  echo "release_sha=$release_sha"
  if [[ "$offsite_restore" == 'true' ]]; then
    echo "object_version_id=$object_version_id"
    echo "checksum_object_version_id=$checksum_version_id"
  fi
  echo "sha256=$actual_checksum"
  echo "image=$container_image"
  echo "started_at=$started_epoch"
  echo "completed_at=$finished_epoch"
  echo "duration_seconds=$((finished_epoch - started_epoch))"
  printf '%s\n' "$counts"
} >"$report"

if [[ -n "$evidence_report" ]]; then
  evidence_temp="$(mktemp "$artifact_dir/.encrypted-offsite-restore-$run_id.XXXXXX")"
  jq -n \
    --arg releaseSha "$release_sha" \
    --arg startedAt "$started_at" \
    --arg finishedAt "$finished_at" \
    --arg remoteObjectUrl "$source_artifact" \
    --arg objectVersionId "$object_version_id" \
    --arg checksumObjectVersionId "$checksum_version_id" \
    --arg artifactSha256 "$actual_checksum" \
    --arg recoveryPointAt "$recovery_point_at" \
    --arg objectLastModifiedAt "$object_last_modified_at" \
    --arg expectedSchemaMigration "$expected_schema_migration" \
    --arg expectedSchemaChecksum "$expected_schema_checksum" \
    --arg migrateImage "$migrate_image" \
    --argjson schemaMigrations "$schema_migrations_count" \
    --argjson expectedSchemaBinding "$expected_schema_binding_count" \
    --argjson users "$users_count" \
    --argjson cards "$cards_count" \
    --argjson matches "$matches_count" \
    --argjson relationshipChangeOutbox "$relationship_change_outbox_count" \
    --argjson legalHolds "$legal_holds_count" \
    --argjson unvalidatedConstraints "$unvalidated_constraints_count" \
    --argjson invalidOutboxStatus "$invalid_outbox_status_count" \
    --argjson deletionHoldViolations "$deletion_hold_violations_count" \
    --argjson deletedSocialViolations "$deleted_social_violations_count" \
    --argjson schemaGatePassed "$schema_gate_passed" \
    --argjson coreDataInvariantPassed "$core_data_invariant_passed" \
    --argjson legalHoldInvariantPassed "$legal_hold_invariant_passed" \
    '{
      schemaVersion: 1,
      artifactType: "zutomayo-encrypted-offsite-restore-raw",
      releaseSha: $releaseSha,
      startedAt: $startedAt,
      finishedAt: $finishedAt,
      backup: {
        remoteObjectUrl: $remoteObjectUrl,
        objectVersionId: $objectVersionId,
        checksumObjectVersionId: $checksumObjectVersionId,
        encrypted: true,
        encryptionScheme: "age",
        artifactSha256: $artifactSha256,
        recoveryPointAt: $recoveryPointAt,
        objectLastModifiedAt: $objectLastModifiedAt,
        checksumVerified: true,
        decryptSucceeded: true
      },
      restore: {
        isolated: true,
        completed: true,
        schema: {
          expectedMigration: $expectedSchemaMigration,
          expectedChecksum: $expectedSchemaChecksum,
          migrateImage: $migrateImage
        },
        observations: {
          schemaMigrations: $schemaMigrations,
          expectedSchemaBinding: $expectedSchemaBinding,
          users: $users,
          cards: $cards,
          matches: $matches,
          relationshipChangeOutbox: $relationshipChangeOutbox,
          legalHolds: $legalHolds,
          unvalidatedConstraints: $unvalidatedConstraints,
          invalidOutboxStatus: $invalidOutboxStatus,
          deletionHoldViolations: $deletionHoldViolations,
          deletedSocialViolations: $deletedSocialViolations
        },
        schemaGatePassed: $schemaGatePassed,
        coreDataInvariantPassed: $coreDataInvariantPassed,
        legalHoldInvariantPassed: $legalHoldInvariantPassed
      }
    }' >"$evidence_temp"
  chmod 0644 "$evidence_temp"
  mv "$evidence_temp" "$evidence_report"
  evidence_temp=''
fi

write_metrics 1 "$finished_epoch"
success=true
if [[ -n "$evidence_report" ]]; then
  echo "restore drill passed: $report (evidence=$evidence_report)"
else
  echo "restore drill passed: $report (local source; no off-site release evidence produced)"
fi
