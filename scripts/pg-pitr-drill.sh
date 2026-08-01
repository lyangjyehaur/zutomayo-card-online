#!/usr/bin/env bash
# Run a disposable physical PostgreSQL point-in-time recovery drill. The host
# mode owns Docker Compose; __worker runs inside the pinned PostgreSQL image.
set -Eeuo pipefail
umask 077

readonly DEFAULT_PG_PITR_DRILL_IMAGE='postgres:16-alpine@sha256:e013e867e712fec275706a6c51c966f0bb0c93cfa8f51000f85a15f9865a28cb'
readonly RESULT_SCHEMA_VERSION=1
readonly RESULT_ARTIFACT_TYPE='zutomayo-restore-drill-raw'

fail() {
  echo "ERROR: $1" >&2
  exit 1
}

validate_inputs() {
  local image="$1"
  local run_id="$2"
  local migration="$3"
  local checksum="$4"
  local release_sha="$5"
  local migrate_image="$6"

  [[ "$image" =~ ^[A-Za-z0-9./:_-]+@sha256:[0-9a-f]{64}$ ]] ||
    fail 'PG_PITR_DRILL_IMAGE must be an immutable @sha256 image reference'
  [[ "$run_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] ||
    fail 'PG_PITR_RUN_ID must contain only letters, digits, dot, underscore, or hyphen (max 64 characters)'
  [[ "$migration" =~ ^[0-9]{6,}_[a-z0-9_]+$ ]] ||
    fail 'EXPECTED_SCHEMA_MIGRATION must be a migration basename'
  [[ "$checksum" =~ ^[0-9a-f]{64}$ ]] ||
    fail 'EXPECTED_SCHEMA_CHECKSUM must be a lowercase SHA-256 digest'
  [[ "$release_sha" =~ ^[0-9a-fA-F]{40}$ ]] ||
    fail 'RELEASE_SHA must be a full 40-character commit SHA'
  [[ "$migrate_image" =~ ^[^[:space:]]+@sha256:[0-9a-f]{64}$ ]] ||
    fail 'PG_PITR_DRILL_MIGRATE_IMAGE must be the immutable release manifest digest'
}

worker_main() {
  image="${PG_PITR_DRILL_IMAGE:-}"
  run_id="${PG_PITR_RUN_ID:-}"
  migration="${EXPECTED_SCHEMA_MIGRATION:-}"
  checksum="${EXPECTED_SCHEMA_CHECKSUM:-}"
  release_sha="${RELEASE_SHA:-}"
  migrate_image="${PG_PITR_DRILL_MIGRATE_IMAGE:-}"
  validate_inputs "$image" "$run_id" "$migration" "$checksum" "$release_sha" "$migrate_image"

  artifact_dir='/artifacts'
  [[ -d "$artifact_dir" && -w "$artifact_dir" ]] || fail 'PITR artifact directory is not writable'

  raw_log="$artifact_dir/pitr-drill-$run_id.log"
  postgres_log="$artifact_dir/pitr-drill-$run_id-postgres.log"
  manifest_artifact="$artifact_dir/pitr-drill-$run_id-backup_manifest"
  result_file="$artifact_dir/pitr-drill-$run_id.json"
  : >"$raw_log"
  chmod 0644 "$raw_log"
  exec > >(tee -a "$raw_log") 2>&1

  started_at="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  started_epoch="$(date -u +%s)"
  completed_at=''
  completed_epoch=0
  duration_seconds=0

  current_step='worker_preflight'
  success='false'
  recovery_started='false'
  work_dir=''
  recovery_dir=''
  recovery_socket=''
  server_version_num=0
  manifest_sha256=''
  restore_target_name='zutomayo_pitr_target'
  restore_target_lsn=''
  restore_target_at=''
  recovered_through_at=''
  first_archived_wal=''
  second_archived_wal=''
  archived_wal_count=0
  wal_segments_applied=0
  marker_before_count=0
  wal_replay_probe_count=0
  marker_after_count=0
  source_marker_after_count=0
  expected_migration_count=0
  required_table_count=0
  unvalidated_constraints=0
  invalid_outbox_status=0
  deletion_hold_violations=0
  deleted_social_violations=0
  target_reached='false'
  recovery_promoted='false'
  exit_code=0

  write_result() {
    local result_success="$1"
    local result_exit_code="$2"
    local temp_result="$artifact_dir/.pitr-drill-$run_id.json.$$"
    local backup_verified='false'
    local schema_gate='false'
    local fixture_round_trip='false'
    local legal_hold_invariant='false'

    completed_at="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
    completed_epoch="$(date -u +%s)"
    duration_seconds=$((completed_epoch - started_epoch))
    if [[ "$result_success" == true && -n "$manifest_sha256" ]]; then backup_verified='true'; fi
    if [[ "$result_success" == true &&
      "$expected_migration_count" == 1 &&
      "$required_table_count" == 8 &&
      "$unvalidated_constraints" == 0 &&
      "$invalid_outbox_status" == 0 ]]; then
      schema_gate='true'
    fi
    if [[ "$result_success" == true &&
      "$marker_before_count" == 1 &&
      "$wal_replay_probe_count" == 1 &&
      "$marker_after_count" == 0 &&
      "$source_marker_after_count" == 1 &&
      "$target_reached" == true ]]; then
      fixture_round_trip='true'
    fi
    if [[ "$result_success" == true &&
      "$deletion_hold_violations" == 0 &&
      "$deleted_social_violations" == 0 ]]; then
      legal_hold_invariant='true'
    fi
    cat >"$temp_result" <<JSON
{
  "schemaVersion": $RESULT_SCHEMA_VERSION,
  "artifactType": "$RESULT_ARTIFACT_TYPE",
  "releaseSha": "$release_sha",
  "runId": "$run_id",
  "success": $result_success,
  "exitCode": $result_exit_code,
  "failureStep": "$current_step",
  "startedAt": "$started_at",
  "finishedAt": "$completed_at",
  "durationSeconds": $duration_seconds,
  "postgres": {
    "image": "$image",
    "serverVersionNum": $server_version_num
  },
  "backup": {
    "method": "pg_basebackup",
    "verified": $backup_verified,
    "manifestSha256": "$manifest_sha256"
  },
  "restore": {
    "mode": "pitr",
    "targetAt": "$restore_target_at",
    "recoveredThroughAt": "$recovered_through_at",
    "baseBackupSha256": "$manifest_sha256",
    "walSegmentsApplied": $wal_segments_applied,
    "targetType": "name",
    "targetName": "$restore_target_name",
    "targetLsn": "$restore_target_lsn",
    "targetReached": $target_reached,
    "promoted": $recovery_promoted,
    "firstArchivedWal": "$first_archived_wal",
    "secondArchivedWal": "$second_archived_wal",
    "archivedWalCount": $archived_wal_count
  },
  "checks": {
    "schemaGatePassed": $schema_gate,
    "fixtureRoundTripPassed": $fixture_round_trip,
    "legalHoldInvariantPassed": $legal_hold_invariant,
    "backupVerified": $backup_verified,
    "markerBeforeCount": $marker_before_count,
    "walReplayProbeCount": $wal_replay_probe_count,
    "markerAfterCount": $marker_after_count,
    "sourceMarkerAfterCount": $source_marker_after_count,
    "expectedMigration": "$migration",
    "expectedMigrationCount": $expected_migration_count,
    "expectedSchemaChecksum": "$checksum",
    "migrateImage": "$migrate_image",
    "requiredTableCount": $required_table_count,
    "unvalidatedConstraints": $unvalidated_constraints,
    "invalidOutboxStatus": $invalid_outbox_status,
    "deletionHoldViolations": $deletion_hold_violations,
    "deletedSocialViolations": $deleted_social_violations
  },
  "artifacts": {
    "rawLog": "$(basename "$raw_log")",
    "postgresLog": "$(basename "$postgres_log")",
    "backupManifest": "$(basename "$manifest_artifact")"
  }
}
JSON
    chmod 0644 "$temp_result"
    mv "$temp_result" "$result_file"
  }

  worker_cleanup() {
    exit_code=$?
    trap - EXIT
    if [[ "$recovery_started" == 'true' && -n "$recovery_dir" ]]; then
      pg_ctl --pgdata "$recovery_dir" --mode fast --wait stop >/dev/null 2>&1 || true
    fi
    if [[ -n "$work_dir" ]]; then
      rm -rf "$work_dir"
    fi
    if [[ "$success" != 'true' ]]; then
      write_result false "$exit_code" || true
    fi
    exit "$exit_code"
  }
  trap worker_cleanup EXIT

  for command_name in \
    awk basename bash cat chmod cp date find grep mkdir mktemp mv \
    pg_basebackup pg_ctl pg_isready pg_verifybackup psql rm seq sha256sum sleep tee wc; do
    command -v "$command_name" >/dev/null 2>&1 || fail "required worker command not found: $command_name"
  done

  work_dir="$(mktemp -d "${TMPDIR:-/tmp}/zutomayo-pitr.XXXXXX")"
  local base_dir="$work_dir/base"
  recovery_dir="$work_dir/recovery"
  recovery_socket="$work_dir/socket"
  mkdir -p "$base_dir" "$recovery_dir" "$recovery_socket"
  chmod 0700 "$base_dir" "$recovery_dir" "$recovery_socket"

  psql_source() {
    psql \
      --host source \
      --port 5432 \
      --username postgres \
      --dbname zutomayo_pitr \
      --no-password \
      --set ON_ERROR_STOP=1 \
      "$@"
  }

  psql_recovery() {
    psql \
      --host "$recovery_socket" \
      --port 55432 \
      --username postgres \
      --dbname zutomayo_pitr \
      --no-password \
      --set ON_ERROR_STOP=1 \
      "$@"
  }

  insert_marker() {
    local marker="$1"
    [[ "$marker" =~ ^[a-z0-9-]+$ ]] || fail 'invalid PITR marker name'
    psql_source \
      --command="INSERT INTO public.zutomayo_pitr_drill_markers (run_id, marker) VALUES ('$run_id', '$marker')"
  }

  force_archive() {
    local wal_name
    wal_name="$(psql_source --tuples-only --no-align --command='SELECT pg_walfile_name(pg_current_wal_insert_lsn())')"
    [[ "$wal_name" =~ ^[0-9A-F]{24}$ ]] || fail 'source returned an invalid WAL segment name'
    psql_source --tuples-only --no-align --command='SELECT pg_switch_wal()' >/dev/null
    for _ in $(seq 1 60); do
      if [[ -s "/pitr-wal/$wal_name" ]]; then
        printf '%s\n' "$wal_name"
        return 0
      fi
      sleep 1
    done
    fail "WAL segment was not archived within 60 seconds: $wal_name"
  }

  current_step='source_schema_gate'
  server_version_num="$(psql_source --tuples-only --no-align --command='SHOW server_version_num')"
  [[ "$server_version_num" =~ ^[0-9]+$ ]] || fail 'source returned an invalid PostgreSQL server version'
  ((server_version_num >= 160000 && server_version_num < 170000)) || fail 'PITR drill requires PostgreSQL 16'

  expected_migration_count="$(psql_source \
    --tuples-only \
    --no-align \
    --command="
      SELECT COUNT(*)
        FROM public.schema_migrations migrations
        JOIN public.schema_migration_checksums checksums USING (name)
       WHERE migrations.name = '$migration'
         AND checksums.sha256 = '$checksum'
    ")"
  [[ "$expected_migration_count" == 1 ]] || fail 'source schema migration/checksum gate failed'

  psql_source --command="
    CREATE TABLE public.zutomayo_pitr_drill_markers (
      run_id text NOT NULL,
      marker text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY (run_id, marker)
    )
  "

  current_step='marker_before'
  insert_marker 'marker-before'

  current_step='basebackup'
  pg_basebackup \
    --host source \
    --port 5432 \
    --username postgres \
    --pgdata "$base_dir" \
    --format plain \
    --wal-method stream \
    --checkpoint fast \
    --manifest-checksums SHA256 \
    --no-password \
    --progress \
    --verbose

  current_step='verifybackup'
  pg_verifybackup "$base_dir"
  manifest_sha256="$(sha256sum "$base_dir/backup_manifest" | awk '{print $1}')"
  cp "$base_dir/backup_manifest" "$manifest_artifact"
  chmod 0644 "$manifest_artifact"

  current_step='wal_replay_probe'
  insert_marker 'wal-replay-probe'
  restore_target_lsn="$(psql_source \
    --tuples-only \
    --no-align \
    --command="SELECT pg_create_restore_point('$restore_target_name')")"
  [[ "$restore_target_lsn" =~ ^[0-9A-F]+/[0-9A-F]+$ ]] || fail 'source returned an invalid restore point LSN'
  restore_target_at="$(psql_source \
    --tuples-only \
    --no-align \
    --command="SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')")"
  [[ "$restore_target_at" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$ ]] ||
    fail 'source returned an invalid restore target timestamp'

  current_step='archive_before_target'
  first_archived_wal="$(force_archive)"

  current_step='marker_after'
  insert_marker 'marker-after'
  source_marker_after_count="$(psql_source \
    --tuples-only \
    --no-align \
    --command="SELECT COUNT(*) FROM public.zutomayo_pitr_drill_markers WHERE run_id = '$run_id' AND marker = 'marker-after'")"
  [[ "$source_marker_after_count" == 1 ]] || fail 'source marker-after write was not committed'

  current_step='archive_after_target'
  second_archived_wal="$(force_archive)"
  archived_wal_count="$(find /pitr-wal -maxdepth 1 -type f -name '[0-9A-F]*' | wc -l | awk '{print $1}')"
  ((archived_wal_count >= 2)) || fail 'fewer than two WAL files were archived'

  current_step='prepare_recovery'
  cp -a "$base_dir/." "$recovery_dir/"
  rm -f "$recovery_dir/postmaster.pid" "$recovery_dir/postmaster.opts" "$recovery_dir/standby.signal"
  cat >>"$recovery_dir/postgresql.auto.conf" <<CONF
restore_command = 'cp /pitr-wal/%f %p'
recovery_target_name = '$restore_target_name'
recovery_target_action = 'promote'
recovery_target_timeline = 'current'
CONF
  touch "$recovery_dir/recovery.signal"
  chmod 0600 "$recovery_dir/postgresql.auto.conf" "$recovery_dir/recovery.signal"

  current_step='start_recovery'
  pg_ctl \
    --pgdata "$recovery_dir" \
    --log "$postgres_log" \
    --options="-p 55432 -c listen_addresses='' -c unix_socket_directories='$recovery_socket'" \
    --wait \
    start
  recovery_started='true'
  chmod 0644 "$postgres_log"

  for _ in $(seq 1 60); do
    if pg_isready --host "$recovery_socket" --port 55432 --username postgres --dbname zutomayo_pitr >/dev/null 2>&1 &&
      [[ "$(psql_recovery --tuples-only --no-align --command='SELECT NOT pg_is_in_recovery()')" == t ]]; then
      recovery_promoted='true'
      break
    fi
    sleep 1
  done
  [[ "$recovery_promoted" == 'true' ]] || fail 'recovered PostgreSQL did not promote within 60 seconds'
  if grep -Fq "recovery stopping at restore point \"$restore_target_name\"" "$postgres_log"; then
    target_reached='true'
  fi
  [[ "$target_reached" == 'true' ]] || fail 'PostgreSQL log does not prove the named recovery target was reached'

  recovered_through_at="$(psql_recovery \
    --tuples-only \
    --no-align \
    --command="SELECT to_char(pg_last_xact_replay_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')")"
  [[ "$recovered_through_at" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$ ]] ||
    fail 'recovered PostgreSQL did not report a replayed transaction timestamp'
  [[ "$recovered_through_at" < "$restore_target_at" || "$recovered_through_at" == "$restore_target_at" ]] ||
    fail 'recovered-through timestamp is later than the restore target'

  wal_segments_applied="$(awk -F'\"' \
    '/restored log file "[0-9A-F][0-9A-F]*" from archive/ { seen[$2] = 1 } \
     END { for (segment in seen) count += 1; print count + 0 }' \
    "$postgres_log")"
  [[ "$wal_segments_applied" =~ ^[0-9]+$ ]] || fail 'could not count restored WAL segments'
  ((wal_segments_applied >= 1)) || fail 'physical recovery did not restore any WAL segment from archive'

  current_step='recovery_marker_gate'
  marker_before_count="$(psql_recovery \
    --tuples-only \
    --no-align \
    --command="SELECT COUNT(*) FROM public.zutomayo_pitr_drill_markers WHERE run_id = '$run_id' AND marker = 'marker-before'")"
  wal_replay_probe_count="$(psql_recovery \
    --tuples-only \
    --no-align \
    --command="SELECT COUNT(*) FROM public.zutomayo_pitr_drill_markers WHERE run_id = '$run_id' AND marker = 'wal-replay-probe'")"
  marker_after_count="$(psql_recovery \
    --tuples-only \
    --no-align \
    --command="SELECT COUNT(*) FROM public.zutomayo_pitr_drill_markers WHERE run_id = '$run_id' AND marker = 'marker-after'")"
  [[ "$marker_before_count" == 1 ]] || fail 'recovered marker-before is missing'
  [[ "$wal_replay_probe_count" == 1 ]] || fail 'post-backup WAL replay probe is missing'
  [[ "$marker_after_count" == 0 ]] || fail 'marker-after exists past the requested recovery target'

  current_step='recovery_schema_gate'
  expected_migration_count="$(psql_recovery \
    --tuples-only \
    --no-align \
    --command="
      SELECT COUNT(*)
        FROM public.schema_migrations migrations
        JOIN public.schema_migration_checksums checksums USING (name)
       WHERE migrations.name = '$migration'
         AND checksums.sha256 = '$checksum'
    ")"
  required_table_count="$(psql_recovery --tuples-only --no-align --command="
    SELECT COUNT(*)
      FROM unnest(ARRAY[
        'users', 'cards', 'matches', 'relationship_change_outbox',
        'legal_holds', 'account_deletion_requests', 'account_export_jobs',
        'schema_migration_checksums'
      ]) AS required(table_name)
     WHERE to_regclass('public.' || required.table_name) IS NOT NULL
  ")"
  [[ "$expected_migration_count" == 1 ]] || fail 'recovered schema migration/checksum gate failed'
  [[ "$required_table_count" == 8 ]] || fail 'recovered schema is missing required runtime tables'

  current_step='recovery_invariants'
  unvalidated_constraints="$(psql_recovery --tuples-only --no-align --command="
    SELECT COUNT(*) FROM pg_constraint
     WHERE connamespace = 'public'::regnamespace AND convalidated = FALSE
  ")"
  invalid_outbox_status="$(psql_recovery --tuples-only --no-align --command="
    SELECT COUNT(*) FROM public.relationship_change_outbox
     WHERE status NOT IN ('pending', 'processing', 'delivered', 'dead_letter')
  ")"
  deletion_hold_violations="$(psql_recovery --tuples-only --no-align --command="
    SELECT COUNT(*)
      FROM public.account_deletion_requests requests
      JOIN public.legal_holds holds
        ON holds.subject_type = 'account' AND holds.subject_id = requests.user_id
     WHERE requests.status = 'completed'
       AND holds.released_at IS NULL
       AND (holds.expires_at IS NULL OR holds.expires_at > NOW())
  ")"
  deleted_social_violations="$(psql_recovery --tuples-only --no-align --command="
    SELECT COUNT(*)
      FROM public.users users
     WHERE users.deleted_at IS NOT NULL
       AND (
         EXISTS (
           SELECT 1 FROM public.user_friends friends
            WHERE friends.user_id = users.id OR friends.friend_user_id = users.id
         )
         OR EXISTS (
           SELECT 1 FROM public.friend_requests requests
            WHERE requests.requester_user_id = users.id OR requests.recipient_user_id = users.id
         )
         OR EXISTS (
           SELECT 1 FROM public.user_blocks blocks
            WHERE blocks.blocker_user_id = users.id OR blocks.blocked_user_id = users.id
         )
       )
  ")"
  for invariant_value in \
    "$unvalidated_constraints" \
    "$invalid_outbox_status" \
    "$deletion_hold_violations" \
    "$deleted_social_violations"; do
    [[ "$invariant_value" == 0 ]] || fail 'a recovered database invariant failed'
  done

  current_step='complete'
  success='true'
  write_result true 0
  echo "PITR drill passed: $result_file"
}

host_main() {
  [[ $# == 0 ]] || fail 'usage: scripts/pg-pitr-drill.sh'

  local script_dir repo_root compose_file
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
  repo_root="$(cd "$script_dir/.." && pwd -P)"
  compose_file="$repo_root/docker-compose.pitr-drill.yml"

  local image="${PG_PITR_DRILL_IMAGE:-$DEFAULT_PG_PITR_DRILL_IMAGE}"
  local run_id="${PG_PITR_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
  local migration="${EXPECTED_SCHEMA_MIGRATION:-}"
  local checksum="${EXPECTED_SCHEMA_CHECKSUM:-}"
  local release_sha="${RELEASE_SHA:-}"
  local migrate_image="${PG_PITR_DRILL_MIGRATE_IMAGE:-${MIGRATE_IMAGE:-}}"
  if [[ -z "$release_sha" ]]; then
    command -v git >/dev/null 2>&1 || fail 'RELEASE_SHA is required when git is unavailable'
    release_sha="$(git -C "$repo_root" rev-parse HEAD)" || fail 'could not resolve RELEASE_SHA from git HEAD'
  fi
  validate_inputs "$image" "$run_id" "$migration" "$checksum" "$release_sha" "$migrate_image"

  command -v docker >/dev/null 2>&1 || fail 'required command not found: docker'
  command -v node >/dev/null 2>&1 || fail 'required command not found: node'
  command -v id >/dev/null 2>&1 || fail 'required command not found: id'
  [[ -f "$compose_file" ]] || fail 'docker-compose.pitr-drill.yml is missing'

  local artifact_dir="${PG_PITR_DRILL_ARTIFACT_DIR:-$repo_root/artifacts/pg-pitr-drill/$run_id}"
  local artifact_parent artifact_gid
  artifact_parent="$(dirname "$artifact_dir")"
  mkdir -p "$artifact_parent"
  [[ ! -e "$artifact_dir" && ! -L "$artifact_dir" ]] ||
    fail 'PITR artifact directory already exists; choose a unique run ID and directory'
  mkdir -m 0700 "$artifact_dir" || fail 'could not atomically create the PITR artifact directory'
  artifact_dir="$(cd "$artifact_dir" && pwd -P)"
  artifact_gid="${PG_PITR_ARTIFACT_GID:-$(id -g)}"
  [[ "$artifact_gid" =~ ^[0-9]+$ ]] || fail 'PG_PITR_ARTIFACT_GID must be numeric'

  local project_name="${PG_PITR_DRILL_PROJECT:-zutomayo-pitr-$$}"
  [[ "$project_name" =~ ^[a-z0-9][a-z0-9_-]{0,62}$ ]] ||
    fail 'PG_PITR_DRILL_PROJECT must be a valid lowercase Compose project name'

  export PG_PITR_DRILL_IMAGE="$image"
  export PG_PITR_RUN_ID="$run_id"
  export PG_PITR_DRILL_ARTIFACT_DIR="$artifact_dir"
  export PG_PITR_ARTIFACT_GID="$artifact_gid"
  export PG_PITR_DRILL_MIGRATE_IMAGE="$migrate_image"
  export EXPECTED_SCHEMA_MIGRATION="$migration"
  export EXPECTED_SCHEMA_CHECKSUM="$checksum"
  export RELEASE_SHA="$release_sha"

  local -a compose=(
    docker compose
    --project-directory "$repo_root"
    --file "$compose_file"
    --project-name "$project_name"
  )
  local stack_started='false'
  cleanup_host() {
    local status=$?
    trap - EXIT
    if [[ "$stack_started" == 'true' ]]; then
      "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
    fi
    if ((status != 0)); then
      echo "PITR drill failed; artifacts retained in $artifact_dir" >&2
    fi
    exit "$status"
  }
  trap cleanup_host EXIT

  "${compose[@]}" version >/dev/null
  "${compose[@]}" config --quiet
  "${compose[@]}" pull --quiet migrate
  stack_started='true'
  "${compose[@]}" up --detach --wait source
  "${compose[@]}" run --rm --no-deps migrate
  "${compose[@]}" run --rm --no-deps drill

  local result_file="$artifact_dir/pitr-drill-$run_id.json"
  [[ -s "$result_file" ]] || fail 'PITR worker did not produce a result JSON artifact'
  node -e '
    const fs = require("node:fs");
    const result = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const valid =
      result.schemaVersion === 1 &&
      result.artifactType === "zutomayo-restore-drill-raw" &&
      result.releaseSha?.toLowerCase() === process.env.RELEASE_SHA?.toLowerCase() &&
      result.success === true &&
      result.exitCode === 0 &&
      typeof result.durationSeconds === "number" &&
      result.backup?.verified === true &&
      result.restore?.mode === "pitr" &&
      /^[a-f0-9]{64}$/i.test(result.restore?.baseBackupSha256 ?? "") &&
      Number.isInteger(result.restore?.walSegmentsApplied) &&
      result.restore.walSegmentsApplied >= 1 &&
      Date.parse(result.restore?.targetAt) >= Date.parse(result.restore?.recoveredThroughAt) &&
      result.restore?.targetReached === true &&
      result.restore?.promoted === true &&
      result.checks?.schemaGatePassed === true &&
      result.checks?.expectedMigration === process.env.EXPECTED_SCHEMA_MIGRATION &&
      result.checks?.expectedSchemaChecksum === process.env.EXPECTED_SCHEMA_CHECKSUM &&
      result.checks?.migrateImage === process.env.PG_PITR_DRILL_MIGRATE_IMAGE &&
      result.checks?.fixtureRoundTripPassed === true &&
      result.checks?.legalHoldInvariantPassed === true &&
      result.checks?.markerBeforeCount === 1 &&
      result.checks?.walReplayProbeCount === 1 &&
      result.checks?.markerAfterCount === 0 &&
      result.checks?.sourceMarkerAfterCount === 1 &&
      result.checks?.unvalidatedConstraints === 0 &&
      result.checks?.invalidOutboxStatus === 0 &&
      result.checks?.deletionHoldViolations === 0 &&
      result.checks?.deletedSocialViolations === 0;
    if (!valid) throw new Error("PITR result JSON failed its typed success contract");
  ' "$result_file"

  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1
  stack_started='false'
  trap - EXIT

  echo "PITR_DRILL_RESULT=$result_file"
  echo "PITR_DRILL_LOG=$artifact_dir/pitr-drill-$run_id.log"
}

if [[ "${1:-}" == '__worker' ]]; then
  shift
  worker_main "$@"
else
  host_main "$@"
fi
