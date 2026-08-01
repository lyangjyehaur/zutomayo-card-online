#!/usr/bin/env bash
# Staging-only proof that the current source-built beta release can be
# reconstructed from the exact known-good origin/master commit after all app
# services are gracefully stopped. This deliberately preserves the production
# deploy path instead of adding an untested rollback mechanism.
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER_HOST="${SERVER_HOST:-}"
SERVER_PORT="${SERVER_PORT:-22}"
SERVER_USER="${SERVER_USER:-root}"
REMOTE_DIR="${REMOTE_DIR:-}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.server4.yml}"
REPORT_DIR="${RECOVERY_REPORT_DIR:-$PROJECT_DIR/artifacts/recovery}"
REMOTE_BACKUP_DIR="${REMOTE_BACKUP_DIR:-$REMOTE_DIR/backups/pre-deploy}"
DATASET_SHA256="${RECOVERY_DATASET_SHA256:-}"
MATCH_IMPACT_REPORT="${RECOVERY_MATCH_IMPACT_REPORT:-}"

fail() {
  echo "ERROR: $1" >&2
  exit 1
}

file_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

[[ "${DEPLOY_ENVIRONMENT:-}" == 'staging' ]] || fail 'DEPLOY_ENVIRONMENT=staging is required'
[[ "${RECOVERY_CONFIRM:-}" == 'source-redeploy-staging' ]] ||
  fail 'RECOVERY_CONFIRM=source-redeploy-staging is required'
[[ -n "$SERVER_HOST" ]] || fail 'SERVER_HOST must identify the staging host explicitly'
[[ -n "$REMOTE_DIR" ]] || fail 'REMOTE_DIR must identify the staging deployment directory explicitly'
[[ "$SERVER_HOST" != '149.104.6.238' ]] || fail 'recovery drill refuses the documented production server4 host'
[[ "$REMOTE_DIR" =~ ^/[A-Za-z0-9._/-]+$ ]] || fail 'REMOTE_DIR contains unsupported characters'
[[ "$REMOTE_BACKUP_DIR" =~ ^/[A-Za-z0-9._/-]+$ ]] || fail 'REMOTE_BACKUP_DIR contains unsupported characters'
[[ "$REMOTE_BACKUP_DIR" == "$REMOTE_DIR/"* ]] || fail 'REMOTE_BACKUP_DIR must be inside REMOTE_DIR'
[[ "$COMPOSE_FILE" =~ ^[A-Za-z0-9._-]+$ ]] || fail 'COMPOSE_FILE must be a file name'
[[ "$DATASET_SHA256" =~ ^[a-f0-9]{64}$ ]] ||
  fail 'RECOVERY_DATASET_SHA256 must be a lowercase SHA-256 digest'
[[ -n "$MATCH_IMPACT_REPORT" ]] || fail 'RECOVERY_MATCH_IMPACT_REPORT must identify the observer output path'
command -v node >/dev/null 2>&1 || fail 'node is required'
command -v ssh >/dev/null 2>&1 || fail 'ssh is required'

cd "$PROJECT_DIR"
[[ -z "$(git status --porcelain)" ]] || fail 'local worktree must be clean'
[[ "$(git branch --show-current)" == master ]] || fail 'recovery drill must run from master'
git fetch origin >/dev/null
target_sha="$(git rev-parse origin/master)"
[[ "$target_sha" =~ ^[a-f0-9]{40}$ ]] || fail 'could not resolve origin/master commit'
[[ "$(git rev-parse HEAD)" == "$target_sha" ]] || fail 'local master must exactly match origin/master'
expected_schema_migration="$(find migrations -maxdepth 1 -type f -name '*.js' -print | sort | tail -n 1 | sed 's#^.*/##; s/\.js$//')"
[[ "$expected_schema_migration" =~ ^[0-9]{6,}_[a-z0-9_]+$ ]] || fail 'could not resolve the latest migration'
expected_schema_checksum="$(file_sha256 "migrations/$expected_schema_migration.js")"

mkdir -p "$REPORT_DIR"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
log_path="$REPORT_DIR/server4-recovery-$timestamp.log"
report_path="$REPORT_DIR/server4-recovery-$timestamp.json"
smoke_report_path="$REPORT_DIR/server4-recovery-smoke-$timestamp.json"
started_at="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"

services_stopped=false
deploy_command_passed=false
backup_verified=false
source_checkout_verified=false
dataset_identity_verified=false
schema_compatible=false
smoke_receipt_verified=false
match_impact_verified=false
backup_path=''
backup_sha256=''

set +e
(
  echo "recovery_target_sha=$target_sha"
  echo "recovery_started_at=$started_at"
  echo 'gracefully stopping staging application services to create a cold-start recovery condition'
  ssh -p "$SERVER_PORT" "$SERVER_USER@$SERVER_HOST" "set -euo pipefail
    cd '$REMOTE_DIR'
    docker compose -f '$COMPOSE_FILE' stop game api platform
    for service in game api platform; do
      test -z \"\$(docker compose -f '$COMPOSE_FILE' ps --status running --services \"\$service\")\"
    done
    docker compose -f '$COMPOSE_FILE' ps"
) 2>&1 | tee "$log_path"
stop_status=${PIPESTATUS[0]}
if [[ "$stop_status" -eq 0 ]]; then
  services_stopped=true
fi

if [[ "$services_stopped" == true ]]; then
  echo 'reconstructing the exact known-good source release through the normal beta deploy path' | tee -a "$log_path"
  SERVER_HOST="$SERVER_HOST" \
    SERVER_PORT="$SERVER_PORT" \
    SERVER_USER="$SERVER_USER" \
    REMOTE_DIR="$REMOTE_DIR" \
    REMOTE_BACKUP_DIR="$REMOTE_BACKUP_DIR" \
    COMPOSE_FILE="$COMPOSE_FILE" \
    VITE_CARD_DATASET_SHA256="$DATASET_SHA256" \
    DEPLOY_SMOKE_REPORT_PATH="$smoke_report_path" \
    "$SCRIPT_DIR/deploy-server4.sh" 2>&1 | tee -a "$log_path"
  deploy_status=${PIPESTATUS[0]}
  if [[ "$deploy_status" -eq 0 ]]; then
    deploy_command_passed=true
  fi
fi

if [[ "$deploy_command_passed" == true ]]; then
  backup_path="$(sed -n 's/^pre-deploy backup: //p' "$log_path" | tail -n 1)"
  if [[ "$backup_path" =~ ^[A-Za-z0-9._/-]+$ && "$backup_path" == "$REMOTE_BACKUP_DIR/"* ]]; then
    backup_sha256="$(ssh -p "$SERVER_PORT" "$SERVER_USER@$SERVER_HOST" "set -euo pipefail
      test -s '$backup_path'
      sha256sum --check '$backup_path.sha256' >/dev/null
      awk '{print \$1}' '$backup_path.sha256'")"
    if [[ "$backup_sha256" =~ ^[a-f0-9]{64}$ ]]; then
      backup_verified=true
    fi
  fi

  remote_sha="$(ssh -p "$SERVER_PORT" "$SERVER_USER@$SERVER_HOST" "cd '$REMOTE_DIR' && git rev-parse HEAD")"
  if [[ "$remote_sha" == "$target_sha" ]]; then
    source_checkout_verified=true
  fi
  if ssh -p "$SERVER_PORT" "$SERVER_USER@$SERVER_HOST" \
    "grep -qx 'VITE_CARD_DATASET_SHA256=$DATASET_SHA256' '$REMOTE_DIR/.env'"; then
    dataset_identity_verified=true
  fi

  ssh -p "$SERVER_PORT" "$SERVER_USER@$SERVER_HOST" "set -euo pipefail
    cd '$REMOTE_DIR'
    docker compose -f '$COMPOSE_FILE' run --rm -T migrate node scripts/db-schema-gate.cjs" \
    2>&1 | tee -a "$log_path"
  schema_status=${PIPESTATUS[0]}
  if [[ "$schema_status" -eq 0 ]]; then
    schema_compatible=true
  fi

  if [[ -f "$smoke_report_path" ]]; then
    node - "$smoke_report_path" "$target_sha" <<'NODE'
const fs = require('node:fs');
const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const expectedSha = process.argv[3];
const checks = report.checks || {};
if (
  report.schemaVersion !== 1 ||
  report.status !== 'passed' ||
  report.expectedBuildId !== expectedSha ||
  report.observedBuildId !== expectedSha ||
  checks.healthReady !== true ||
  checks.buildIdentityVerified !== true ||
  checks.applicationSmokePassed !== true ||
  checks.battleAssetsVerified !== true ||
  checks.smokePassed !== true
) {
  process.exit(1);
}
NODE
    if [[ "$?" -eq 0 ]]; then
      smoke_receipt_verified=true
    fi
  fi

  if [[ -f "$MATCH_IMPACT_REPORT" ]]; then
    node - "$MATCH_IMPACT_REPORT" "$target_sha" <<'NODE'
const fs = require('node:fs');
const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const expectedSha = process.argv[3];
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const impact = report.impact || {};
let receipt;
try {
  receipt = new URL(String(impact.receiptUrl || ''));
} catch {
  process.exit(1);
}
if (
  report.schemaVersion !== 1 ||
  report.releaseSha !== expectedSha ||
  !integer(impact.activeMatchesAtStop) ||
  impact.activeMatchesAtStop < 1 ||
  !integer(impact.completedMatches) ||
  !integer(impact.reconnectedMatches) ||
  !integer(impact.failedMatches) ||
  !integer(impact.manualInterventions) ||
  impact.completedMatches + impact.reconnectedMatches + impact.failedMatches !== impact.activeMatchesAtStop ||
  receipt.protocol !== 'https:'
) {
  process.exit(1);
}
NODE
    if [[ "$?" -eq 0 ]]; then
      match_impact_verified=true
    fi
  fi
fi
set -e

finished_at="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
status=1
if [[ "$services_stopped" == true && "$deploy_command_passed" == true && "$backup_verified" == true && \
  "$source_checkout_verified" == true && "$dataset_identity_verified" == true && "$schema_compatible" == true && \
  "$smoke_receipt_verified" == true && "$match_impact_verified" == true ]]; then
  status=0
fi

log_sha256="$(file_sha256 "$log_path")"
smoke_sha256=''
if [[ -f "$smoke_report_path" ]]; then
  smoke_sha256="$(file_sha256 "$smoke_report_path")"
fi
impact_sha256=''
if [[ -f "$MATCH_IMPACT_REPORT" ]]; then
  impact_sha256="$(file_sha256 "$MATCH_IMPACT_REPORT")"
fi

RECOVERY_REPORT_PATH="$report_path" \
RECOVERY_RELEASE_SHA="$target_sha" \
RECOVERY_DATASET_SHA256="$DATASET_SHA256" \
RECOVERY_STARTED_AT="$started_at" \
RECOVERY_FINISHED_AT="$finished_at" \
RECOVERY_STATUS="$status" \
RECOVERY_SERVICES_STOPPED="$services_stopped" \
RECOVERY_DEPLOY_COMMAND_PASSED="$deploy_command_passed" \
RECOVERY_BACKUP_VERIFIED="$backup_verified" \
RECOVERY_BACKUP_PATH="$backup_path" \
RECOVERY_BACKUP_SHA256="$backup_sha256" \
RECOVERY_SOURCE_CHECKOUT_VERIFIED="$source_checkout_verified" \
RECOVERY_DATASET_IDENTITY_VERIFIED="$dataset_identity_verified" \
RECOVERY_SCHEMA_COMPATIBLE="$schema_compatible" \
RECOVERY_SCHEMA_MIGRATION="$expected_schema_migration" \
RECOVERY_SCHEMA_CHECKSUM="$expected_schema_checksum" \
RECOVERY_SMOKE_RECEIPT_VERIFIED="$smoke_receipt_verified" \
RECOVERY_SMOKE_REPORT_PATH="$smoke_report_path" \
RECOVERY_SMOKE_SHA256="$smoke_sha256" \
RECOVERY_MATCH_IMPACT_VERIFIED="$match_impact_verified" \
RECOVERY_MATCH_IMPACT_REPORT="$MATCH_IMPACT_REPORT" \
RECOVERY_MATCH_IMPACT_SHA256="$impact_sha256" \
RECOVERY_LOG_PATH="$log_path" \
RECOVERY_LOG_SHA256="$log_sha256" \
node - <<'NODE'
const fs = require('node:fs');
const passed = process.env.RECOVERY_STATUS === '0';
const smoke = fs.existsSync(process.env.RECOVERY_SMOKE_REPORT_PATH)
  ? JSON.parse(fs.readFileSync(process.env.RECOVERY_SMOKE_REPORT_PATH, 'utf8'))
  : { checks: {} };
const matchImpact = fs.existsSync(process.env.RECOVERY_MATCH_IMPACT_REPORT)
  ? JSON.parse(fs.readFileSync(process.env.RECOVERY_MATCH_IMPACT_REPORT, 'utf8')).impact
  : {};
const bool = (name) => process.env[name] === 'true';
const report = {
  schemaVersion: 1,
  status: passed ? 'passed' : 'failed',
  environment: 'staging',
  recoveryMode: 'exact-release-reconstruction',
  releaseSha: process.env.RECOVERY_RELEASE_SHA,
  targetSha: process.env.RECOVERY_RELEASE_SHA,
  datasetSha256: process.env.RECOVERY_DATASET_SHA256,
  startedAt: process.env.RECOVERY_STARTED_AT,
  finishedAt: process.env.RECOVERY_FINISHED_AT,
  backup: {
    artifact: process.env.RECOVERY_BACKUP_PATH,
    sha256: process.env.RECOVERY_BACKUP_SHA256,
  },
  schema: {
    migration: process.env.RECOVERY_SCHEMA_MIGRATION,
    sha256: process.env.RECOVERY_SCHEMA_CHECKSUM,
  },
  impact: matchImpact,
  checks: {
    servicesStopped: bool('RECOVERY_SERVICES_STOPPED'),
    deployCommandPassed: bool('RECOVERY_DEPLOY_COMMAND_PASSED'),
    preDeployBackupVerified: bool('RECOVERY_BACKUP_VERIFIED'),
    sourceCheckoutVerified: bool('RECOVERY_SOURCE_CHECKOUT_VERIFIED'),
    datasetIdentityVerified: bool('RECOVERY_DATASET_IDENTITY_VERIFIED'),
    schemaCompatible: bool('RECOVERY_SCHEMA_COMPATIBLE'),
    healthReady: smoke.checks?.healthReady === true,
    buildIdentityVerified: smoke.checks?.buildIdentityVerified === true,
    battleAssetsVerified: smoke.checks?.battleAssetsVerified === true,
    websocketOutcomeVerified: bool('RECOVERY_MATCH_IMPACT_VERIFIED'),
    smokePassed: bool('RECOVERY_SMOKE_RECEIPT_VERIFIED'),
  },
  artifacts: [
    { path: process.env.RECOVERY_LOG_PATH, sha256: process.env.RECOVERY_LOG_SHA256 },
    { path: process.env.RECOVERY_SMOKE_REPORT_PATH, sha256: process.env.RECOVERY_SMOKE_SHA256 },
    { path: process.env.RECOVERY_MATCH_IMPACT_REPORT, sha256: process.env.RECOVERY_MATCH_IMPACT_SHA256 },
  ],
};
fs.writeFileSync(process.env.RECOVERY_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
NODE

echo "deployment recovery report: $report_path"
exit "$status"
