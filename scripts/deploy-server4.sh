#!/usr/bin/env bash
# Deploy or roll back a verified immutable release on server4.
# The script never builds on the server and never uses a mutable tag.
#
# Usage:
#   ./scripts/deploy-server4.sh --manifest .release.env --confirm
#   ./scripts/deploy-server4.sh --manifest .release.env --bootstrap --confirm
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
ROLE_TLS_SMOKE_COMPOSE_FILE="${ROLE_TLS_SMOKE_COMPOSE_FILE:-docker-compose.postgres-role-smoke.yml}"
POSTGRES_OPS_COMPOSE_FILE="${POSTGRES_OPS_COMPOSE_FILE:-docker-compose.postgres-ops.yml}"
RETENTION_SERVICE_GROUP="${RETENTION_SERVICE_GROUP:-zutomayo-retention}"
GAME_PORT="${GAME_PORT:-3000}"
API_PORT="${API_PORT:-3001}"
PLATFORM_PORT="${PLATFORM_PORT:-3002}"
SMOKE_LOCAL_GAME_PORT="${SMOKE_LOCAL_GAME_PORT:-13000}"
SMOKE_LOCAL_API_PORT="${SMOKE_LOCAL_API_PORT:-13001}"
SMOKE_LOCAL_PLATFORM_PORT="${SMOKE_LOCAL_PLATFORM_PORT:-13002}"
PLATFORM_SMOKE_TIMEOUT_MS="${PLATFORM_SMOKE_TIMEOUT_MS:-15000}"
VERIFY_RELEASE_ARTIFACTS="${VERIFY_RELEASE_ARTIFACTS:-true}"
COSIGN_IDENTITY_REGEXP="${COSIGN_IDENTITY_REGEXP:-https://github.com/${GITHUB_REPOSITORY:-}/.github/workflows/cd\\.yml@refs/(heads/master|tags/v[0-9]+\\.[0-9]+\\.[0-9]+([.-][0-9A-Za-z.-]+)?)$}"
COSIGN_OIDC_ISSUER="${COSIGN_OIDC_ISSUER:-https://token.actions.githubusercontent.com}"
MANIFEST_FILE="${RELEASE_MANIFEST:-$PROJECT_DIR/.release.env}"
CONFIRM=false
DRY_RUN=false
ROLLBACK=false
BOOTSTRAP=false
MANIFEST_FORMAT=''
ROLLBACK_MANIFEST_FORMAT=''
ROLE_ENV_VALIDATOR_ARGS='--require-pgsslmode=verify-full --require-rediss'

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
    --bootstrap) BOOTSTRAP=true; shift ;;
    -h|--help) usage ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
die() { printf '[%s] ERROR: %s\n' "$(date +%H:%M:%S)" "$*" >&2; exit 1; }
ssh_run() { ssh -p "$SERVER_PORT" "$SERVER_USER@$SERVER_HOST" "$@"; }

[[ "$RETENTION_SERVICE_GROUP" =~ ^[a-z_][a-z0-9_-]*$ ]] || die 'RETENTION_SERVICE_GROUP is invalid'

validate_manifest() {
  local file="$1" allow_legacy_six="${2:-false}" key value app ops_seen=false seen_keys='|'
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
  GATEWAY_IMAGE=''
  OPS_IMAGE=''
  while IFS='=' read -r key value || [[ -n "$key" ]]; do
    [[ -z "$key" ]] && continue
    case "$key" in
      RELEASE_SHA|APP_VERSION|GAME_RULES_VERSION|EXPECTED_SCHEMA_MIGRATION|EXPECTED_SCHEMA_CHECKSUM|GAME_IMAGE|API_IMAGE|PLATFORM_IMAGE|MIGRATE_IMAGE|RETENTION_IMAGE|GATEWAY_IMAGE|OPS_IMAGE)
        [[ "$seen_keys" != *"|$key|"* ]] || die "duplicate manifest key: $key"
        seen_keys="${seen_keys}${key}|"
        printf -v "$key" '%s' "$value"
        [[ "$key" != OPS_IMAGE ]] || ops_seen=true
        ;;
      *) die "invalid manifest key: $key" ;;
    esac
  done < "$file"
  [[ "$RELEASE_SHA" =~ ^[[:xdigit:]]{40}$ ]] || die 'manifest RELEASE_SHA must be a full commit SHA'
  [[ "$APP_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] || die 'manifest APP_VERSION is invalid'
  [[ "$GAME_RULES_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] || die 'manifest GAME_RULES_VERSION is invalid'
  [[ "$EXPECTED_SCHEMA_MIGRATION" =~ ^[0-9]{6,}_[a-z0-9_]+$ ]] || die 'manifest EXPECTED_SCHEMA_MIGRATION is invalid'
  [[ "$EXPECTED_SCHEMA_CHECKSUM" =~ ^[a-f0-9]{64}$ ]] || die 'manifest EXPECTED_SCHEMA_CHECKSUM is invalid'
  for key in GAME_IMAGE API_IMAGE PLATFORM_IMAGE MIGRATE_IMAGE RETENTION_IMAGE GATEWAY_IMAGE; do
    app="${key%_IMAGE}"
    app="$(printf '%s' "$app" | tr '[:upper:]' '[:lower:]')"
    value="${!key}"
    [[ "$value" =~ ^ghcr\.io/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+-${app}@sha256:[[:xdigit:]]{64}$ ]] || die "manifest $key must be an immutable GHCR digest"
  done
  if [[ "$ops_seen" == true ]]; then
    [[ "$OPS_IMAGE" =~ ^ghcr\.io/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+-ops@sha256:[[:xdigit:]]{64}$ ]] || {
      die 'manifest OPS_IMAGE must be an immutable GHCR digest'
    }
    MANIFEST_FORMAT='current-seven'
  else
    [[ "$allow_legacy_six" == true ]] || die 'manifest OPS_IMAGE is required for a new release'
    MANIFEST_FORMAT='legacy-six'
  fi
}

verify_manifest_artifacts() {
  [[ "$VERIFY_RELEASE_ARTIFACTS" == true ]] || return 0
  [[ -n "${GITHUB_REPOSITORY:-}" ]] || die 'GITHUB_REPOSITORY is required for release attestation verification'
  command -v cosign >/dev/null 2>&1 || die 'cosign is required for release artifact verification'
  command -v gh >/dev/null 2>&1 || die 'gh is required for release attestation verification'
  local key ref
  local image_keys=(GAME_IMAGE API_IMAGE PLATFORM_IMAGE MIGRATE_IMAGE RETENTION_IMAGE GATEWAY_IMAGE)
  [[ "$MANIFEST_FORMAT" != current-seven ]] || image_keys+=(OPS_IMAGE)
  for key in "${image_keys[@]}"; do
    ref="${!key}"
    cosign verify \
      --certificate-identity-regexp "$COSIGN_IDENTITY_REGEXP" \
      --certificate-oidc-issuer "$COSIGN_OIDC_ISSUER" \
      "$ref" >/dev/null
    gh attestation verify "oci://${ref}" --repo "$GITHUB_REPOSITORY" --source-digest "$RELEASE_SHA" >/dev/null
  done
}

validate_remote_manifest() {
  local remote_name="$1" file="$2" allow_legacy_six="${3:-false}"
  ssh_run "cat '$REMOTE_DIR/$remote_name'" > "$file" || die "remote release manifest is unreadable: $remote_name"
  validate_manifest "$file" "$allow_legacy_six"
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
  local role_tls_smoke_compose_source="$PROJECT_DIR/$ROLE_TLS_SMOKE_COMPOSE_FILE"
  local postgres_ops_compose_source="$PROJECT_DIR/$POSTGRES_OPS_COMPOSE_FILE"
  local role_projection_source="$PROJECT_DIR/scripts/project-compose-role-env.jq"
  [[ -f "$compose_source" ]] || die "local compose file not found: $compose_source"
  [[ -f "$retention_compose_source" ]] || die "local retention compose file not found: $retention_compose_source"
  [[ -f "$role_tls_smoke_compose_source" ]] || die "local role TLS smoke compose file not found: $role_tls_smoke_compose_source"
  [[ -f "$postgres_ops_compose_source" ]] || die "local PostgreSQL ops compose file not found: $postgres_ops_compose_source"
  [[ -f "$role_projection_source" ]] || die "local role environment projection is missing: $role_projection_source"
  scp -P "$SERVER_PORT" "$source" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/.release.env.incoming"
  scp -P "$SERVER_PORT" "$compose_source" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/.compose.incoming"
  scp -P "$SERVER_PORT" "$retention_compose_source" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/.retention-compose.incoming"
  scp -P "$SERVER_PORT" "$role_tls_smoke_compose_source" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/.role-tls-smoke-compose.incoming"
  scp -P "$SERVER_PORT" "$postgres_ops_compose_source" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/.postgres-ops-compose.incoming"
  scp -P "$SERVER_PORT" "$PROJECT_DIR/scripts/postgres-init-roles.sh" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/.postgres-init-roles.incoming"
  scp -P "$SERVER_PORT" "$role_projection_source" "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/.role-env-projection.incoming"
}

remote_deploy() {
  ssh_run "set -euo pipefail;
    cd '$REMOTE_DIR';
    test -f .env;
    command -v jq >/dev/null || { echo 'jq is required for secret-safe Compose role validation' >&2; exit 1; };
    getent group '$RETENTION_SERVICE_GROUP' >/dev/null || { echo 'retention service group is missing' >&2; exit 1; };
    if test -f .release.env; then case '$ROLLBACK_MANIFEST_FORMAT' in current-seven|legacy-six) ;; *) echo 'active release manifest format was not validated' >&2; exit 1;; esac; cp -p .release.env .release.previous.env; chgrp '$RETENTION_SERVICE_GROUP' .release.previous.env; chmod 0640 .release.previous.env; printf '%s\n' '$ROLLBACK_MANIFEST_FORMAT' > .release.previous.format; fi;
    if test -f '$COMPOSE_FILE'; then cp -p '$COMPOSE_FILE' '$COMPOSE_FILE.previous'; fi;
    if test -f '$RETENTION_COMPOSE_FILE'; then cp -p '$RETENTION_COMPOSE_FILE' '$RETENTION_COMPOSE_FILE.previous'; fi;
    if test -f scripts/postgres-init-roles.sh; then cp -p scripts/postgres-init-roles.sh scripts/postgres-init-roles.sh.previous; fi;
    if test -s .release.previous.env && test -s .release.previous.format && test -s '$COMPOSE_FILE.previous' && test -s '$RETENTION_COMPOSE_FILE.previous' && test -s scripts/postgres-init-roles.sh.previous; then touch .release.rollback-ready; fi;
    install -m 0640 .release.env.incoming .release.env;
    chgrp '$RETENTION_SERVICE_GROUP' .release.env;
    printf '%s\n' current-seven > .release.format;
    install -m 0644 .compose.incoming '$COMPOSE_FILE';
    install -m 0644 .retention-compose.incoming '$RETENTION_COMPOSE_FILE';
    install -m 0644 .role-tls-smoke-compose.incoming '$ROLE_TLS_SMOKE_COMPOSE_FILE';
    install -m 0644 .postgres-ops-compose.incoming '$POSTGRES_OPS_COMPOSE_FILE';
    install -d -m 0755 scripts;
    install -m 0755 .postgres-init-roles.incoming scripts/postgres-init-roles.sh;
    install -m 0644 .role-env-projection.incoming scripts/project-compose-role-env.jq;
    rm -f .release.env.incoming .compose.incoming .retention-compose.incoming .role-tls-smoke-compose.incoming .postgres-ops-compose.incoming .postgres-init-roles.incoming .role-env-projection.incoming;
    set -a; . ./.release.env; set +a;
    docker compose -f '$COMPOSE_FILE' -f '$RETENTION_COMPOSE_FILE' config --quiet;
    PG_DEPLOY_GATE_HOST=\$(docker compose -f '$COMPOSE_FILE' config --format json | jq -er '.services.migrate.environment.PG_HOST | select(type == \"string\" and length > 0)');
    PG_DEPLOY_GATE_PORT=\$(docker compose -f '$COMPOSE_FILE' config --format json | jq -er '.services.migrate.environment.PG_PORT | tostring | select(test(\"^[0-9]+$\"))');
    test \"\$PG_DEPLOY_GATE_PORT\" -ge 1 && test \"\$PG_DEPLOY_GATE_PORT\" -le 65535;
    export PG_DEPLOY_GATE_HOST PG_DEPLOY_GATE_PORT;
    docker compose --env-file .env --env-file .release.env -f '$ROLE_TLS_SMOKE_COMPOSE_FILE' --profile postgres-role-tls-smoke config --quiet;
    docker compose --env-file .env --env-file .release.env -f '$POSTGRES_OPS_COMPOSE_FILE' --profile postgres-ops config --quiet;
    docker compose -f '$COMPOSE_FILE' -f '$RETENTION_COMPOSE_FILE' pull --quiet retention;
    docker compose -f '$COMPOSE_FILE' config --quiet;
    docker compose -f '$COMPOSE_FILE' pull --quiet;
    docker pull "\$OPS_IMAGE" >/dev/null;
    docker compose -f '$COMPOSE_FILE' config --format json | jq -c -f scripts/project-compose-role-env.jq | docker compose -f '$COMPOSE_FILE' run --rm --no-deps -T migrate node scripts/verify-compose-role-env.mjs $ROLE_ENV_VALIDATOR_ARGS;
    docker compose -f '$COMPOSE_FILE' run --rm migrate;
    role_tls_evidence='.release.role-tls.next.'\$\$;
    : > \"\$role_tls_evidence\";
    for role in api game platform retention monitor backup; do
      report=\$(docker compose --env-file .env --env-file .release.env -f '$ROLE_TLS_SMOKE_COMPOSE_FILE' --profile postgres-role-tls-smoke run --rm --no-deps -T \"postgres-role-tls-\$role\");
      printf '%s\n' \"\$report\" | jq -e --arg role \"\$role\" '.schemaVersion == 1 and .artifactType == \"zutomayo-postgres-role-tls-smoke\" and .ok == true and .role == \$role' >/dev/null;
      printf '%s\n' \"\$report\" >> \"\$role_tls_evidence\";
      printf '%s\n' \"\$report\";
    done;
    mv -f \"\$role_tls_evidence\" .release.role-tls.jsonl;
    wal_report=\$(docker compose --env-file .env --env-file .release.env -f '$POSTGRES_OPS_COMPOSE_FILE' --profile postgres-ops run --rm --no-deps -T postgres-wal-operational-smoke);
    wal_evidence=\$(printf '%s\n' \"\$wal_report\" | jq -ce --arg releaseSha \"\$RELEASE_SHA\" --arg opsImage \"\$OPS_IMAGE\" 'select(.schemaVersion == 1 and .artifactType == \"zutomayo-pg-wal-operational-smoke\" and .ok == true) | . + {releaseSha:\$releaseSha,opsImage:\$opsImage}');
    printf '%s\n' \"\$wal_evidence\" > .release.wal-operational-smoke.json;
    printf '%s\n' \"\$wal_evidence\";
    docker compose -f '$COMPOSE_FILE' up -d --wait --wait-timeout 180;
    date -u +%Y-%m-%dT%H:%M:%SZ > .release.deployed-at;
    docker compose -f '$COMPOSE_FILE' ps;
    rm -f .release.rollback-ready"
}

remote_rollback() {
  ssh_run "set -euo pipefail;
    cd '$REMOTE_DIR';
    test -s .release.previous.env || { echo 'no verified previous release manifest' >&2; exit 1; };
    test -s '$COMPOSE_FILE.previous' || { echo 'no previous deployment compose file' >&2; exit 1; };
    test -s '$RETENTION_COMPOSE_FILE.previous' || { echo 'no verified previous retention compose file' >&2; exit 1; };
    test -s scripts/postgres-init-roles.sh.previous || { echo 'no previous PostgreSQL role bootstrap script' >&2; exit 1; };
    getent group '$RETENTION_SERVICE_GROUP' >/dev/null || { echo 'retention service group is missing' >&2; exit 1; };
    cp -p .release.env .release.failed.env 2>/dev/null || true;
    cp -p .release.previous.env .release.env;
    chgrp '$RETENTION_SERVICE_GROUP' .release.env;
    chmod 0640 .release.env;
    printf '%s\n' '$ROLLBACK_MANIFEST_FORMAT' > .release.format;
    cp -p '$COMPOSE_FILE' '$COMPOSE_FILE.failed' 2>/dev/null || true;
    cp -p '$COMPOSE_FILE.previous' '$COMPOSE_FILE';
    cp -p '$RETENTION_COMPOSE_FILE' '$RETENTION_COMPOSE_FILE.failed' 2>/dev/null || true;
    cp -p '$RETENTION_COMPOSE_FILE.previous' '$RETENTION_COMPOSE_FILE';
    cp -p scripts/postgres-init-roles.sh scripts/postgres-init-roles.sh.failed 2>/dev/null || true;
    cp -p scripts/postgres-init-roles.sh.previous scripts/postgres-init-roles.sh;
    set -a; . ./.release.env; set +a;
    docker compose -f '$COMPOSE_FILE' -f '$RETENTION_COMPOSE_FILE' config --quiet;
    docker compose -f '$COMPOSE_FILE' -f '$RETENTION_COMPOSE_FILE' pull --quiet retention;
    docker compose -f '$COMPOSE_FILE' config --quiet;
    docker compose -f '$COMPOSE_FILE' pull --quiet;
    docker compose -f '$COMPOSE_FILE' up -d --no-deps --wait --wait-timeout 180 game api platform;
    date -u +%Y-%m-%dT%H:%M:%SZ > .release.rolled-back-at;
    docker compose -f '$COMPOSE_FILE' ps;
    rm -f .release.rollback-ready"
}

run_smoke() {
  local tunnel_pid status platform_public_address
  platform_public_address="$(ssh_run "set -euo pipefail;
    cd '$REMOTE_DIR';
    set -a; . ./.release.env; set +a;
    docker compose -f '$COMPOSE_FILE' config --format json | jq -r '.services.platform.environment.PLATFORM_PUBLIC_ADDRESS'")"
  [[ "$platform_public_address" =~ ^wss?://[^[:space:]]+$ ]] || {
    log 'rendered platform public address is missing or invalid'
    return 1
  }
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
  if [[ "$status" -eq 0 ]]; then
    node --import tsx "$SCRIPT_DIR/platform-deployment-smoke.ts" \
      --http-url "http://127.0.0.1:${SMOKE_LOCAL_PLATFORM_PORT}" \
      --ws-url "$platform_public_address" \
      --expected-public-address "$platform_public_address" \
      --timeout-ms "$PLATFORM_SMOKE_TIMEOUT_MS"
    status=$?
  fi
  set -e
  kill "$tunnel_pid" >/dev/null 2>&1 || true
  wait "$tunnel_pid" >/dev/null 2>&1 || true
  return "$status"
}

rollback_and_smoke() {
  local failed_release_sha="$RELEASE_SHA" status
  [[ "${ROLLBACK_RELEASE_SHA:-}" =~ ^[[:xdigit:]]{40}$ ]] || return 1
  remote_rollback || return 1
  RELEASE_SHA="$ROLLBACK_RELEASE_SHA"
  if run_smoke; then
    status=0
  else
    status=$?
  fi
  RELEASE_SHA="$failed_release_sha"
  return "$status"
}

if [[ "$ROLLBACK" == true ]]; then
  confirm_action 'rollback to the previously verified manifest'
  if [[ "$DRY_RUN" == true ]]; then
    log '[dry-run] would restore .release.previous.env and restart the stack'
    exit 0
  fi
  previous_manifest="$(mktemp)"
  trap 'rm -f "$previous_manifest"' EXIT
  ssh_run "test -s '$REMOTE_DIR/.release.previous.env' && test -s '$REMOTE_DIR/$COMPOSE_FILE.previous' && test -s '$REMOTE_DIR/$RETENTION_COMPOSE_FILE.previous' && test -s '$REMOTE_DIR/scripts/postgres-init-roles.sh.previous'" || die 'remote previous release files are incomplete'
  validate_remote_manifest '.release.previous.env' "$previous_manifest" true
  ROLLBACK_MANIFEST_FORMAT="$MANIFEST_FORMAT"
  remote_rollback
  run_smoke
  log 'rollback completed'
  exit 0
fi

validate_manifest "$MANIFEST_FILE" false
verify_manifest_artifacts
confirm_action "deploy $(sed -n 's/^RELEASE_SHA=//p' "$MANIFEST_FILE" | cut -c1-12)"
if [[ "$DRY_RUN" == true ]]; then
  log "[dry-run] would upload $MANIFEST_FILE and deploy immutable images"
  exit 0
fi

ssh_run 'echo connected' >/dev/null || die 'SSH connection failed'
ssh_run "test -d '$REMOTE_DIR' && test -f '$REMOTE_DIR/.env'" || die 'remote deployment directory or .env is missing'
ssh_run "test ! -e '$REMOTE_DIR/.release.rollback-ready'" || die 'an incomplete prior rollout requires manual inspection or rollback'
if ssh_run "test -s '$REMOTE_DIR/.release.env' && test -s '$REMOTE_DIR/$COMPOSE_FILE' && test -s '$REMOTE_DIR/$RETENTION_COMPOSE_FILE' && test -s '$REMOTE_DIR/scripts/postgres-init-roles.sh'"; then
  HAS_PREVIOUS=true
  current_manifest="$(mktemp)"
  trap 'rm -f "$current_manifest"' EXIT
  validate_remote_manifest '.release.env' "$current_manifest" true
  ROLLBACK_MANIFEST_FORMAT="$MANIFEST_FORMAT"
  ROLLBACK_RELEASE_SHA="$RELEASE_SHA"
  # Restore the incoming release values after validating the active rollback target.
  validate_manifest "$MANIFEST_FILE" false
else
  HAS_PREVIOUS=false
  ROLLBACK_RELEASE_SHA=''
fi
if [[ "$HAS_PREVIOUS" != true && "$BOOTSTRAP" != true ]]; then
  die 'no verified previous release is present; use --bootstrap for the one-time cutover with a manual rollback plan'
fi
copy_release_files "$MANIFEST_FILE"
if ! remote_deploy; then
  if [[ "$HAS_PREVIOUS" == true ]]; then
    if ssh_run "test -e '$REMOTE_DIR/.release.rollback-ready'"; then
      log 'remote deployment failed; restoring previous verified release'
      if ! rollback_and_smoke; then
        log 'rollback verification failed; manual intervention is required'
      fi
    else
      log 'deployment failed before a complete rollback snapshot was confirmed; inspect the active release manually'
    fi
  else
    log 'bootstrap deployment failed; no automatic rollback is available, manual intervention is required'
  fi
  exit 1
fi
if ! run_smoke; then
  if [[ "$HAS_PREVIOUS" == true ]]; then
    log 'deployment smoke failed; restoring previous verified release'
    if ! rollback_and_smoke; then
      log 'rollback verification failed; manual intervention is required'
    fi
  else
    log 'bootstrap smoke failed; no automatic rollback is available, manual intervention is required'
  fi
  exit 1
fi
log 'deployment completed and smoke checks passed'
