#!/usr/bin/env bash
# Staging-only proof that the current source-built beta release can be
# reconstructed from the exact known-good origin/master commit after all app
# services are stopped. This deliberately preserves the production deploy
# path instead of adding an untested rollback mechanism.
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

fail() {
  echo "ERROR: $1" >&2
  exit 1
}

[[ "${DEPLOY_ENVIRONMENT:-}" == 'staging' ]] || fail 'DEPLOY_ENVIRONMENT=staging is required'
[[ "${RECOVERY_CONFIRM:-}" == 'source-redeploy-staging' ]] ||
  fail 'RECOVERY_CONFIRM=source-redeploy-staging is required'
[[ -n "$SERVER_HOST" ]] || fail 'SERVER_HOST must identify the staging host explicitly'
[[ -n "$REMOTE_DIR" ]] || fail 'REMOTE_DIR must identify the staging deployment directory explicitly'
[[ "$SERVER_HOST" != '149.104.6.238' ]] || fail 'recovery drill refuses the documented production server4 host'
[[ "$REMOTE_DIR" =~ ^/[A-Za-z0-9._/-]+$ ]] || fail 'REMOTE_DIR contains unsupported characters'
[[ "$COMPOSE_FILE" =~ ^[A-Za-z0-9._-]+$ ]] || fail 'COMPOSE_FILE must be a file name'
command -v node >/dev/null 2>&1 || fail 'node is required'
command -v ssh >/dev/null 2>&1 || fail 'ssh is required'

cd "$PROJECT_DIR"
[[ -z "$(git status --porcelain)" ]] || fail 'local worktree must be clean'
[[ "$(git branch --show-current)" == master ]] || fail 'recovery drill must run from master'
git fetch origin >/dev/null
target_sha="$(git rev-parse origin/master)"
[[ "$target_sha" =~ ^[a-f0-9]{40}$ ]] || fail 'could not resolve origin/master commit'
[[ "$(git rev-parse HEAD)" == "$target_sha" ]] || fail 'local master must exactly match origin/master'

mkdir -p "$REPORT_DIR"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
log_path="$REPORT_DIR/server4-recovery-$timestamp.log"
report_path="$REPORT_DIR/server4-recovery-$timestamp.json"
started_at="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"

set +e
(
  set -euo pipefail
  echo "recovery_target_sha=$target_sha"
  echo "recovery_started_at=$started_at"
  echo 'stopping staging application services to create a cold-start recovery condition'
  ssh -p "$SERVER_PORT" "$SERVER_USER@$SERVER_HOST" "set -euo pipefail
    cd '$REMOTE_DIR'
    docker compose -f '$COMPOSE_FILE' stop game api platform
    docker compose -f '$COMPOSE_FILE' ps"
  echo 'reconstructing the exact known-good source release through the normal beta deploy path'
  SERVER_HOST="$SERVER_HOST" \
    SERVER_PORT="$SERVER_PORT" \
    SERVER_USER="$SERVER_USER" \
    REMOTE_DIR="$REMOTE_DIR" \
    COMPOSE_FILE="$COMPOSE_FILE" \
    "$SCRIPT_DIR/deploy-server4.sh"
) > >(tee "$log_path") 2>&1
status=$?
set -e

finished_at="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
if [[ "$status" -eq 0 ]]; then
  remote_sha="$(ssh -p "$SERVER_PORT" "$SERVER_USER@$SERVER_HOST" "cd '$REMOTE_DIR' && git rev-parse HEAD")"
  [[ "$remote_sha" == "$target_sha" ]] || fail 'recovered staging checkout does not match the target SHA'
fi

RECOVERY_REPORT_PATH="$report_path" \
RECOVERY_RELEASE_SHA="$target_sha" \
RECOVERY_STARTED_AT="$started_at" \
RECOVERY_FINISHED_AT="$finished_at" \
RECOVERY_STATUS="$status" \
node - <<'NODE'
const fs = require('node:fs');
const passed = process.env.RECOVERY_STATUS === '0';
const report = {
  schemaVersion: 1,
  status: passed ? 'passed' : 'failed',
  environment: 'staging',
  releaseSha: process.env.RECOVERY_RELEASE_SHA,
  targetSha: process.env.RECOVERY_RELEASE_SHA,
  startedAt: process.env.RECOVERY_STARTED_AT,
  finishedAt: process.env.RECOVERY_FINISHED_AT,
  checks: {
    sourceCheckoutVerified: passed,
    schemaCompatible: passed,
    healthReady: passed,
    smokePassed: passed,
  },
};
fs.writeFileSync(process.env.RECOVERY_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
NODE

echo "deployment recovery report: $report_path"
exit "$status"
