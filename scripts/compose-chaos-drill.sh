#!/usr/bin/env bash
# Local/staging cold-restart smoke. This is intentionally not a substitute for
# a managed PostgreSQL/Redis failover drill.
set -euo pipefail

mode="${1:-}"
if [[ "${CHAOS_CONFIRM:-}" != 'local-compose-only' ]]; then
  echo 'ERROR: set CHAOS_CONFIRM=local-compose-only to acknowledge this restarts a Compose service' >&2
  exit 1
fi
if [[ "${DEPLOY_ENVIRONMENT:-local}" == 'production' ]]; then
  echo 'ERROR: compose chaos helper refuses to run against production' >&2
  exit 1
fi

case "$mode" in
  redis-restart)
    service=redis
    ;;
  postgres-restart)
    service=postgres
    ;;
  game-restart)
    service=game
    export CHAOS_PROBE_URLS="${CHAOS_PROBE_URLS:-http://localhost:3000/ready}"
    ;;
  *)
    echo 'Usage: compose-chaos-drill.sh <redis-restart|postgres-restart|game-restart>' >&2
    exit 1
    ;;
esac

artifact_dir="${CHAOS_ARTIFACT_DIR:-artifacts/chaos}"
mkdir -p "$artifact_dir"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
probe_log="$artifact_dir/${mode}-${timestamp}.jsonl"
export CHAOS_PROBE_REQUIRE_OUTAGE=true

npm run chaos:probe >"$probe_log" 2>&1 &
probe_pid=$!
cleanup() {
  kill "$probe_pid" >/dev/null 2>&1 || true
}
trap cleanup EXIT

sleep 2
docker compose restart "$service"
wait "$probe_pid"
trap - EXIT
echo "chaos recovery probe passed: $probe_log"
