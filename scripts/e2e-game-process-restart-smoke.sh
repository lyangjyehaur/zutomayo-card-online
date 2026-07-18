#!/usr/bin/env bash
set -euo pipefail

if [[ "${RESTART_SMOKE_CONFIRM:-}" != 'local-compose-only' ]]; then
  echo 'ERROR: set RESTART_SMOKE_CONFIRM=local-compose-only to run the disposable restart smoke' >&2
  exit 1
fi
if [[ "${DEPLOY_ENVIRONMENT:-local}" == 'production' ]]; then
  echo 'ERROR: restart smoke refuses to run against production' >&2
  exit 1
fi

export PG_PASSWORD="${PG_PASSWORD:-e2e-test-password}"
export PG_BOOTSTRAP_USER="${PG_BOOTSTRAP_USER:-zutomayo_e2e_bootstrap}"
export PG_BOOTSTRAP_PASSWORD="${PG_BOOTSTRAP_PASSWORD:-e2e-test-bootstrap-password}"
export PG_MIGRATION_USER="${PG_MIGRATION_USER:-zutomayo_migrator}"
export PG_MIGRATION_PASSWORD="${PG_MIGRATION_PASSWORD:-e2e-test-migration-password}"
export PG_APP_USER="${PG_APP_USER:-zutomayo_app}"
export PG_APP_PASSWORD="${PG_APP_PASSWORD:-e2e-test-app-password}"
export JWT_SECRET="${JWT_SECRET:-e2e-test-jwt-secret-at-least-32-bytes}"
export ACCOUNT_EXPORT_S3_BUCKET="${ACCOUNT_EXPORT_S3_BUCKET:-zutomayo-e2e-account-exports}"
export ACCOUNT_EXPORT_S3_REGION="${ACCOUNT_EXPORT_S3_REGION:-us-east-1}"
export ACCOUNT_EXPORT_S3_CREDENTIALS_MODE="${ACCOUNT_EXPORT_S3_CREDENTIALS_MODE:-default}"
export ACCOUNT_EXPORT_S3_VERSIONING_MODE="${ACCOUNT_EXPORT_S3_VERSIONING_MODE:-disabled}"
export ACCOUNT_EXPORT_S3_LIFECYCLE_CONFIRMED="${ACCOUNT_EXPORT_S3_LIFECYCLE_CONFIRMED:-true}"
export ACCOUNT_EXPORT_PSEUDONYM_KEY="${ACCOUNT_EXPORT_PSEUDONYM_KEY:-e2e-test-export-pseudonym-key-at-least-32-bytes}"
export REDIS_PASSWORD="${REDIS_PASSWORD:-}"
export METRICS_TOKEN="${METRICS_TOKEN:-e2e-test-metrics-token}"
export PGSSLMODE="${PGSSLMODE:-disable}"
export EXPECTED_SCHEMA_MIGRATION="${EXPECTED_SCHEMA_MIGRATION:-000033_card_text_authority}"
export EXPECTED_SCHEMA_CHECKSUM="${EXPECTED_SCHEMA_CHECKSUM:-55a2c2ab106410d8ca2588ed7fd9ad919ea0d13ddb8848623d0044931c0f74de}"

project="zutomayo-process-restart-${$}"
compose=(docker compose -p "$project" -f docker-compose.yml -f docker-compose.e2e.yml)
ready_marker='test-results/game-process-restart.ready'
restarted_marker='test-results/game-process-restart.restarted.json'
mkdir -p test-results playwright-report
chmod 0777 test-results playwright-report
rm -f "$ready_marker" "$restarted_marker"

runner_pid=''
cleanup() {
  if [[ -n "$runner_pid" ]]; then kill "$runner_pid" >/dev/null 2>&1 || true; fi
  "${compose[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  rm -f "$ready_marker" "$restarted_marker"
}
trap cleanup EXIT

wait_healthy() {
  local container_id="$1"
  local deadline=$((SECONDS + 120))
  local status=''
  while (( SECONDS < deadline )); do
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")"
    if [[ "$status" == 'healthy' ]]; then return 0; fi
    if [[ "$status" == 'exited' || "$status" == 'dead' ]]; then
      echo "ERROR: restarted container entered terminal state: $container_id ($status)" >&2
      return 1
    fi
    sleep 1
  done
  echo "ERROR: restarted container did not become healthy: $container_id ($status)" >&2
  return 1
}

if [[ "${RESTART_SMOKE_REUSE_RUNTIME_IMAGES:-false}" == 'true' ]]; then
  "${compose[@]}" build e2e seed
else
  "${compose[@]}" build
fi
"${compose[@]}" up --no-build --wait --wait-timeout 180 game api platform
"${compose[@]}" run --rm -e E2E_PROCESS_RESTART_CONTROLLER=1 e2e \
  npx playwright test e2e/game-process-restart.spec.ts --project=chromium --retries=0 &
runner_pid=$!

deadline=$((SECONDS + 120))
while [[ ! -f "$ready_marker" ]]; do
  if ! kill -0 "$runner_pid" >/dev/null 2>&1; then
    wait "$runner_pid"
    exit 1
  fi
  if (( SECONDS >= deadline )); then
    echo 'ERROR: timed out waiting for restart-ready marker' >&2
    exit 1
  fi
  sleep 1
done

game_id="$("${compose[@]}" ps -q game)"
platform_id="$("${compose[@]}" ps -q platform)"
game_before="$(docker inspect -f '{{.State.StartedAt}}' "$game_id")"
platform_before="$(docker inspect -f '{{.State.StartedAt}}' "$platform_id")"

"${compose[@]}" restart game platform
wait_healthy "$game_id"
wait_healthy "$platform_id"

game_after="$(docker inspect -f '{{.State.StartedAt}}' "$game_id")"
platform_after="$(docker inspect -f '{{.State.StartedAt}}' "$platform_id")"
if [[ "$game_before" == "$game_after" || "$platform_before" == "$platform_after" ]]; then
  echo 'ERROR: service StartedAt did not change across restart' >&2
  exit 1
fi

printf '{"game":{"startedAtChanged":true,"healthy":true},"platform":{"startedAtChanged":true,"healthy":true}}\n' \
  >"$restarted_marker"
wait "$runner_pid"
runner_pid=''
trap - EXIT
cleanup
echo 'game/platform process restart E2E smoke passed'
