#!/usr/bin/env bash
# Deploy or roll back a verified immutable release on server4.
# The script never builds on the server and never uses a mutable tag.
#
# Usage:
#   ./scripts/deploy-server4.sh --manifest .release.env --confirm
#   ./scripts/deploy-server4.sh --rollback --confirm
#   ./scripts/deploy-server4.sh --manifest .release.env --dry-run

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER_HOST="${SERVER_HOST:-149.104.6.238}"
SERVER_PORT="${SERVER_PORT:-4649}"
SERVER_USER="${SERVER_USER:-root}"
REMOTE_DIR="${REMOTE_DIR:-/opt/zutomayo-card-online}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.server4.yml}"
RETENTION_COMPOSE_FILE="${RETENTION_COMPOSE_FILE:-docker-compose.retention.yml}"
RETENTION_SERVICE_GROUP="${RETENTION_SERVICE_GROUP:-zutomayo-retention}"
GAME_PORT="${GAME_PORT:-3000}"
API_PORT="${API_PORT:-3001}"
PLATFORM_PORT="${PLATFORM_PORT:-3002}"
SMOKE_LOCAL_GAME_PORT="${SMOKE_LOCAL_GAME_PORT:-13000}"
SMOKE_LOCAL_API_PORT="${SMOKE_LOCAL_API_PORT:-13001}"
SMOKE_LOCAL_PLATFORM_PORT="${SMOKE_LOCAL_PLATFORM_PORT:-13002}"
VERIFY_RELEASE_ARTIFACTS="${VERIFY_RELEASE_ARTIFACTS:-true}"
COSIGN_IDENTITY_REGEXP="${COSIGN_IDENTITY_REGEXP:-https://github.com/${GITHUB_REPOSITORY:-}/.github/workflows/cd\\.yml@refs/(heads/master|tags/v[0-9]+\\.[0-9]+\\.[0-9]+([.-][0-9A-Za-z.-]+)?)$}"
COSIGN_OIDC_ISSUER="${COSIGN_OIDC_ISSUER:-https://token.actions.githubusercontent.com}"
MANIFEST_FILE="${RELEASE_MANIFEST:-$PROJECT_DIR/.release.env}"
CONFIRM=false
DRY_RUN=false
ROLLBACK=false
ROLE_ENV_VALIDATOR_ARGS='--require-pgsslmode=verify-full'
if [[ "$COMPOSE_FILE" == 'docker-compose.staging.yml' ]]; then
  ROLE_ENV_VALIDATOR_ARGS+=' --require-rediss'
fi

usage() {
  sed -n '2,10p' "$0"
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --manifest)
      [[ $# -ge 2 ]] || { echo '--manifest requires a file' >&2; exit 2; }
      MANIFEST_FILE="$2"
      shift 2
      ;;
    --confirm) CONFIRM=true; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    --rollback) ROLLBACK=true; shift ;;
    -h|--help) usage ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
die() { printf '[%s] ERROR: %s\n' "$(date +%H:%M:%S)" "$*" >&2; exit 1; }
ssh_run() { ssh -p "$SERVER_PORT" "$SERVER_USER@$SERVER_HOST" "$@"; }

[[ "$RETENTION_SERVICE_GROUP" =~ ^[a-z_][a-z0-9_-]*$ ]] || die 'RETENTION_SERVICE_GROUP is invalid'

validate_manifest() {
  local file="$1" key value app
  [[ -f "$file" ]] || die "release manifest not found: $file"
  RELEASE_SHA=''
  APP_VERSION=''
  GAME_RULES_VERSION=''
  EXPECTED_SCHEMA_MIGRATION=''
  EXPECTED_SCHEMA_CHECKSUM=''
  GAME_IMAGE=''
  API_IMAGE=''
  PLATFORM_IMAGE=''
  MIGRATE_IMAGE=''
  RETENTION_IMAGE=''
  while IFS='=' read -r key value || [[ -n "$key" ]]; do
    [[ -z "$key" ]] && continue
    case "$key" in
      RELEASE_SHA|APP_VERSION|GAME_RULES_VERSION|EXPECTED_SCHEMA_MIGRATION|EXPECTED_SCHEMA_CHECKSUM|GAME_IMAGE|API_IMAGE|PLATFORM_IMAGE|MIGRATE_IMAGE|RETENTION_IMAGE)
        printf -v "$key" '%s' "$value"
        ;;
      *) die "invalid manifest key: $key" ;;
    esac
  done < "$file"
  [[ "$RELEASE_SHA" =~ ^[[:xdigit:]]{40}$ ]] || die 'manifest RELEASE_SHA must be a full commit SHA'
  [[ "$APP_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] || die 'manifest APP_VERSION is invalid'
  [[ "$GAME_RULES_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] || die 'manifest GAME_RULES_VERSION is invalid'
  [[ "$EXPECTED_SCHEMA_MIGRATION" =~ ^[0-9]{6,}_[a-z0-9_]+$ ]] || die 'manifest EXPECTED_SCHEMA_MIGRATION is invalid'
  [[ "$EXPECTED_SCHEMA_CHECKSUM" =~ ^[a-f0-9]{64}$ ]] || die 'manifest EXPECTED_SCHEMA_CHECKSUM is invalid'
  for key in GAME_IMAGE API_IMAGE PLATFORM_IMAGE MIGRATE_IMAGE RETENTION_IMAGE; do
    app="${key%_IMAGE}"
    app="$(printf '%s' "$app" | tr '[:upper:]' '[:lower:]')"
    value="${!key}"
    [[ "$value" =~ ^ghcr\.io/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+-${app}@sha256:[[:xdigit:]]{64}$ ]] || die "manifest $key must be an immutable GHCR digest"
  done
}

verify_manifest_artifacts() {
  [[ "$VERIFY_RELEASE_ARTIFACTS" == true ]] || return 0
  [[ -n "${GITHUB_REPOSITORY:-}" ]] || die 'GITHUB_REPOSITORY is required for release attestation verification'
  command -v cosign >/dev/null 2>&1 || die 'cosign is required for release artifact verification'
  command -v gh >/dev/null 2>&1 || die 'gh is required for release attestation verification'
  local key ref
  for key in GAME_IMAGE API_IMAGE PLATFORM_IMAGE MIGRATE_IMAGE RETENTION_IMAGE; do
    ref="${!key}"
    cosign verify \
      --certificate-identity-regexp "$COSIGN_IDENTITY_REGEXP" \
      --certificate-oidc-issuer "$COSIGN_OIDC_ISSUER" \
      "$ref" >/dev/null
    gh attestation verify "oci://${ref}" --repo "$GITHUB_REPOSITORY" >/dev/null
  done
}

validate_remote_previous_manifest() {
  local file="$1"
  ssh_run "cat '$REMOTE_DIR/.release.previous.env'" > "$file" || die 'remote previous release manifest is unreadable'
  validate_manifest "$file"
  local migration_file="${PROJECT_DIR}/migrations/${EXPECTED_SCHEMA_MIGRATION}.js"
  [[ -f "$migration_file" ]] || die "rollback migration file is missing: $migration_file"
  local actual_checksum
  if command -v sha256sum >/dev/null 2>&1; then
    actual_checksum="$(sha256sum "$migration_file" | awk '{print $1}')"
  else
    actual_checksum="$(shasum -a 256 "$migration_file" | awk '{print $1}')"
  fi
  [[ "$actual_checksum" == "$EXPECTED_SCHEMA_CHECKSUM" ]] || die 'rollback schema checksum is not present in this checkout'
  verify_manifest_artifacts
}

confirm_action() {
  [[ "$CONFIRM" == true ]] || return 0
  read -r -p "Continue with $1 on $SERVER_HOST? [y/N] " answer
  [[ "$answer" =~ ^[Yy]$ ]] || die 'cancelled'
}

copy_release_files() {
  local source="$1" compose_source="$PROJECT_DIR/$COMPOSE_FILE" retention_compose_source="$PROJECT_DIR/$RETENTION_COMPOSE_FILE"
  [[ -f "$compose_source" ]] || die "local compose file not found: $compose_source"
  [[ -f "$retention_compose_source" ]] || die "local retention compose file not found: $retention_compose_source"
  scp -P "$SERVER_PORT" "$source" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/.release.env.incoming"
  scp -P "$SERVER_PORT" "$compose_source" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/.compose.incoming"
  scp -P "$SERVER_PORT" "$retention_compose_source" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/.retention-compose.incoming"
  scp -P "$SERVER_PORT" "$PROJECT_DIR/scripts/postgres-init-roles.sh" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/.postgres-init-roles.incoming"
}

remote_deploy() {
  ssh_run "set -euo pipefail;
    cd '$REMOTE_DIR';
    test -f .env;
    getent group '$RETENTION_SERVICE_GROUP' >/dev/null || { echo 'retention service group is missing' >&2; exit 1; };
    if test -f .release.env; then cp -p .release.env .release.previous.env; chgrp '$RETENTION_SERVICE_GROUP' .release.previous.env; chmod 0640 .release.previous.env; fi;
    if test -f '$COMPOSE_FILE'; then cp -p '$COMPOSE_FILE' '$COMPOSE_FILE.previous'; fi;
    if test -f '$RETENTION_COMPOSE_FILE'; then cp -p '$RETENTION_COMPOSE_FILE' '$RETENTION_COMPOSE_FILE.previous'; fi;
    install -m 0640 .release.env.incoming .release.env;
    chgrp '$RETENTION_SERVICE_GROUP' .release.env;
    install -m 0644 .compose.incoming '$COMPOSE_FILE';
    install -m 0644 .retention-compose.incoming '$RETENTION_COMPOSE_FILE';
    install -d -m 0755 scripts;
    install -m 0755 .postgres-init-roles.incoming scripts/postgres-init-roles.sh;
    rm -f .release.env.incoming .compose.incoming .retention-compose.incoming .postgres-init-roles.incoming;
    set -a; . ./.release.env; set +a;
    docker compose -f '$COMPOSE_FILE' -f '$RETENTION_COMPOSE_FILE' config --quiet;
    docker compose -f '$COMPOSE_FILE' -f '$RETENTION_COMPOSE_FILE' pull --quiet retention;
    docker compose -f '$COMPOSE_FILE' config --quiet;
    docker compose -f '$COMPOSE_FILE' pull --quiet;
    docker compose -f '$COMPOSE_FILE' config --format json | docker compose -f '$COMPOSE_FILE' run --rm --no-deps -T migrate node scripts/verify-compose-role-env.mjs $ROLE_ENV_VALIDATOR_ARGS;
    docker compose -f '$COMPOSE_FILE' run --rm migrate;
    docker compose -f '$COMPOSE_FILE' up -d --wait --wait-timeout 180;
    date -u +%Y-%m-%dT%H:%M:%SZ > .release.deployed-at;
    docker compose -f '$COMPOSE_FILE' ps"
}

remote_rollback() {
  ssh_run "set -euo pipefail;
    cd '$REMOTE_DIR';
    test -s .release.previous.env || { echo 'no verified previous release manifest' >&2; exit 1; };
    test -s '$RETENTION_COMPOSE_FILE.previous' || { echo 'no verified previous retention compose file' >&2; exit 1; };
    getent group '$RETENTION_SERVICE_GROUP' >/dev/null || { echo 'retention service group is missing' >&2; exit 1; };
    cp -p .release.env .release.failed.env 2>/dev/null || true;
    cp -p .release.previous.env .release.env;
    chgrp '$RETENTION_SERVICE_GROUP' .release.env;
    chmod 0640 .release.env;
    if test -f '$COMPOSE_FILE.previous'; then cp -p '$COMPOSE_FILE' '$COMPOSE_FILE.failed'; cp -p '$COMPOSE_FILE.previous' '$COMPOSE_FILE'; fi;
    cp -p '$RETENTION_COMPOSE_FILE' '$RETENTION_COMPOSE_FILE.failed' 2>/dev/null || true;
    cp -p '$RETENTION_COMPOSE_FILE.previous' '$RETENTION_COMPOSE_FILE';
    set -a; . ./.release.env; set +a;
    docker compose -f '$COMPOSE_FILE' -f '$RETENTION_COMPOSE_FILE' config --quiet;
    docker compose -f '$COMPOSE_FILE' -f '$RETENTION_COMPOSE_FILE' pull --quiet retention;
    docker compose -f '$COMPOSE_FILE' config --quiet;
    docker compose -f '$COMPOSE_FILE' pull --quiet;
    docker compose -f '$COMPOSE_FILE' up -d --wait --wait-timeout 180;
    date -u +%Y-%m-%dT%H:%M:%SZ > .release.rolled-back-at;
    docker compose -f '$COMPOSE_FILE' ps"
}

run_smoke() {
  local tunnel_pid status
  ssh -p "$SERVER_PORT" -o ExitOnForwardFailure=yes -N -T \
    -L "${SMOKE_LOCAL_GAME_PORT}:127.0.0.1:${GAME_PORT}" \
    -L "${SMOKE_LOCAL_API_PORT}:127.0.0.1:${API_PORT}" \
    -L "${SMOKE_LOCAL_PLATFORM_PORT}:127.0.0.1:${PLATFORM_PORT}" \
    "$SERVER_USER@$SERVER_HOST" &
  tunnel_pid=$!
  sleep 2
  if ! kill -0 "$tunnel_pid" 2>/dev/null; then
    wait "$tunnel_pid" || true
    return 1
  fi
  set +e
  node "$SCRIPT_DIR/deploy-smoke.mjs" \
    --host 127.0.0.1 \
    --game-port "$SMOKE_LOCAL_GAME_PORT" \
    --api-port "$SMOKE_LOCAL_API_PORT" \
    --platform-port "$SMOKE_LOCAL_PLATFORM_PORT" \
    --expected-build-id "$RELEASE_SHA"
  status=$?
  set -e
  kill "$tunnel_pid" >/dev/null 2>&1 || true
  wait "$tunnel_pid" >/dev/null 2>&1 || true
  return "$status"
}

rollback_and_smoke() {
  remote_rollback || return 1
  run_smoke
}

if [[ "$ROLLBACK" == true ]]; then
  confirm_action 'rollback to the previously verified manifest'
  if [[ "$DRY_RUN" == true ]]; then
    log '[dry-run] would restore .release.previous.env and restart the stack'
    exit 0
  fi
  previous_manifest="$(mktemp)"
  trap 'rm -f "$previous_manifest"' EXIT
  ssh_run "test -s '$REMOTE_DIR/.release.previous.env'" || die 'remote previous release manifest is missing'
  validate_remote_previous_manifest "$previous_manifest"
  remote_rollback
  run_smoke
  log 'rollback completed'
  exit 0
fi

validate_manifest "$MANIFEST_FILE"
verify_manifest_artifacts
confirm_action "deploy $(sed -n 's/^RELEASE_SHA=//p' "$MANIFEST_FILE" | cut -c1-12)"
if [[ "$DRY_RUN" == true ]]; then
  log "[dry-run] would upload $MANIFEST_FILE and deploy immutable images"
  exit 0
fi

ssh_run 'echo connected' >/dev/null || die 'SSH connection failed'
ssh_run "test -d '$REMOTE_DIR' && test -f '$REMOTE_DIR/.env'" || die 'remote deployment directory or .env is missing'
copy_release_files "$MANIFEST_FILE"
if ! remote_deploy; then
  log 'remote deployment failed; restoring previous verified release'
  if ! rollback_and_smoke; then
    log 'rollback verification failed; manual intervention is required'
  fi
  exit 1
fi
if ! run_smoke; then
  log 'deployment smoke failed; restoring previous verified release'
  if ! rollback_and_smoke; then
    log 'rollback verification failed; manual intervention is required'
  fi
  exit 1
fi
log 'deployment completed and smoke checks passed'
