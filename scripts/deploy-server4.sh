#!/usr/bin/env bash
# Deploy the current origin/master beta release to server4, or restore the
# runtime images and configuration captured immediately before that release.
#
# Usage:
#   ./scripts/deploy-server4.sh
#   ./scripts/deploy-server4.sh --confirm
#   ./scripts/deploy-server4.sh --dry-run
#   ./scripts/deploy-server4.sh --rollback --confirm

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER_HOST="${SERVER_HOST:-149.104.6.238}"
SERVER_PORT="${SERVER_PORT:-4649}"
SERVER_USER="${SERVER_USER:-root}"
REMOTE_DIR="${REMOTE_DIR:-/opt/zutomayo-card-online}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.server4.yml}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-postgresql}"
REDIS_CONTAINER="${REDIS_CONTAINER:-redis}"
REMOTE_BACKUP_DIR="${REMOTE_BACKUP_DIR:-$REMOTE_DIR/backups/pre-deploy}"
BATTLE_ASSET_DIR="${BATTLE_ASSET_DIR:-$PROJECT_DIR/public/battle}"
BATTLE_ASSET_CHECKSUMS="${BATTLE_ASSET_CHECKSUMS:-$PROJECT_DIR/scripts/battle-assets.sha256}"
REMOTE_BATTLE_ASSET_DIR="${REMOTE_BATTLE_ASSET_DIR:-$REMOTE_DIR/public/battle}"
DEPLOY_WAIT_SECONDS="${DEPLOY_WAIT_SECONDS:-180}"
GAME_PORT="${GAME_PORT:-3000}"
API_PORT="${API_PORT:-3001}"
PLATFORM_PORT="${PLATFORM_PORT:-3002}"
SMOKE_LOCAL_GAME_PORT="${SMOKE_LOCAL_GAME_PORT:-13000}"
SMOKE_LOCAL_API_PORT="${SMOKE_LOCAL_API_PORT:-13001}"
SMOKE_LOCAL_PLATFORM_PORT="${SMOKE_LOCAL_PLATFORM_PORT:-13002}"
GHCR_OWNER="${GHCR_OWNER:-lyangjyehaur}"
GAME_IMAGE="ghcr.io/${GHCR_OWNER}/zutomayo-card-online-game"
API_IMAGE="ghcr.io/${GHCR_OWNER}/zutomayo-card-online-api"
PLATFORM_IMAGE="ghcr.io/${GHCR_OWNER}/zutomayo-card-online-platform"
EXPECTED_SCHEMA_MIGRATION="000032_announcements"

CONFIRM=false
DRY_RUN=false
ROLLBACK=false

usage() {
  sed -n '2,10p' "$0"
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --confirm) CONFIRM=true; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    --rollback) ROLLBACK=true; shift ;;
    -h|--help) usage ;;
    *) printf 'unknown argument: %s\n' "$1" >&2; exit 2 ;;
  esac
done

log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
die() { printf '[%s] ERROR: %s\n' "$(date +%H:%M:%S)" "$*" >&2; exit 1; }
ssh_run() { ssh -p "$SERVER_PORT" "$SERVER_USER@$SERVER_HOST" "$@"; }

[[ "$REMOTE_DIR" =~ ^/[A-Za-z0-9._/-]+$ ]] || die 'REMOTE_DIR contains unsupported characters'
[[ "$REMOTE_BACKUP_DIR" =~ ^/[A-Za-z0-9._/-]+$ ]] || die 'REMOTE_BACKUP_DIR contains unsupported characters'
[[ "$REMOTE_BATTLE_ASSET_DIR" =~ ^/[A-Za-z0-9._/-]+$ ]] || die 'REMOTE_BATTLE_ASSET_DIR contains unsupported characters'
[[ "$REMOTE_BATTLE_ASSET_DIR" == "$REMOTE_DIR/"* ]] || die 'REMOTE_BATTLE_ASSET_DIR must be inside REMOTE_DIR'
[[ "$COMPOSE_FILE" =~ ^[A-Za-z0-9._-]+$ ]] || die 'COMPOSE_FILE must be a file name'
[[ "$POSTGRES_CONTAINER" =~ ^[A-Za-z0-9._-]+$ ]] || die 'POSTGRES_CONTAINER is invalid'
[[ "$REDIS_CONTAINER" =~ ^[A-Za-z0-9._-]+$ ]] || die 'REDIS_CONTAINER is invalid'
[[ "$DEPLOY_WAIT_SECONDS" =~ ^[0-9]+$ ]] || die 'DEPLOY_WAIT_SECONDS must be an integer'

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

verify_local_battle_assets() {
  local expected relative extra actual expected_count=0 actual_count
  [[ -d "$BATTLE_ASSET_DIR" ]] || die "private battle asset directory is missing: $BATTLE_ASSET_DIR"
  [[ -f "$BATTLE_ASSET_CHECKSUMS" ]] || die "battle asset checksum file is missing: $BATTLE_ASSET_CHECKSUMS"

  while read -r expected relative extra; do
    [[ -n "${expected:-}" ]] || continue
    [[ "$expected" =~ ^[a-f0-9]{64}$ ]] || die "invalid battle asset checksum: $expected"
    [[ -z "${extra:-}" ]] || die "battle asset checksum entry contains unsupported whitespace: $relative"
    [[ "$relative" =~ ^[A-Za-z0-9._/-]+\.(png|svg)$ ]] || die "invalid battle asset path: $relative"
    [[ "$relative" != /* && "$relative" != ../* && "$relative" != */../* && "$relative" != */.. ]] || \
      die "battle asset path escapes its directory: $relative"
    [[ -f "$BATTLE_ASSET_DIR/$relative" ]] || die "required battle asset is missing: $relative"
    actual="$(sha256_file "$BATTLE_ASSET_DIR/$relative")"
    [[ "$actual" == "$expected" ]] || die "battle asset checksum mismatch: $relative"
    expected_count=$((expected_count + 1))
  done < "$BATTLE_ASSET_CHECKSUMS"

  actual_count="$(find "$BATTLE_ASSET_DIR" -type f \( -iname '*.png' -o -iname '*.svg' \) | wc -l | tr -d '[:space:]')"
  [[ "$expected_count" -gt 0 ]] || die 'battle asset checksum file is empty'
  [[ "$actual_count" == "$expected_count" ]] || \
    die "battle asset inventory mismatch: checksums=$expected_count files=$actual_count"
  BATTLE_ASSET_COUNT="$expected_count"
}

confirm_action() {
  [[ "$CONFIRM" == true ]] || return 0
  local answer
  read -r -p "Continue with $1 on $SERVER_HOST? [y/N] " answer
  [[ "$answer" =~ ^[Yy]$ ]] || die 'cancelled'
}

load_local_release() {
  cd "$PROJECT_DIR"
  [[ -z "$(git status --porcelain)" ]] || die 'local worktree is not clean'
  [[ "$(git branch --show-current)" == master ]] || die 'server4 deployments must run from the master branch'
  git fetch origin >/dev/null
  TARGET_SHA="$(git rev-parse HEAD)"
  local origin_sha
  origin_sha="$(git rev-parse origin/master)"
  [[ "$TARGET_SHA" == "$origin_sha" ]] || die 'local master must exactly match origin/master before deployment'
  TARGET_SHORT="$(git rev-parse --short=12 "$TARGET_SHA")"
  PACKAGE_VERSION="$(node -p "require('./package.json').version")"
  [[ "$PACKAGE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] || die 'package version is invalid'
  local migration_file="migrations/${EXPECTED_SCHEMA_MIGRATION}.js"
  [[ -f "$migration_file" ]] || die "expected migration is missing: $migration_file"
  EXPECTED_SCHEMA_CHECKSUM="$(sha256_file "$migration_file")"
  [[ "$EXPECTED_SCHEMA_CHECKSUM" =~ ^[a-f0-9]{64}$ ]] || die 'migration checksum is invalid'
  verify_local_battle_assets
}

remote_predeploy_backup() {
  ssh_run "set -euo pipefail
    cd '$REMOTE_DIR'
    test -f .env
    test -f '$COMPOSE_FILE'
    umask 077
    timestamp=\$(date -u +%Y%m%dT%H%M%SZ)
    mkdir -p '$REMOTE_BACKUP_DIR'
    chmod 0700 '$REMOTE_BACKUP_DIR'
    cp -p .env '$REMOTE_BACKUP_DIR/.env.'\"\$timestamp\"
    cp -p '$COMPOSE_FILE' '$REMOTE_BACKUP_DIR/$COMPOSE_FILE.'\"\$timestamp\"
    cp -p .env .env.previous
    cp -p '$COMPOSE_FILE' '$COMPOSE_FILE.previous'
    set -a
    . ./.env
    set +a
    : \"\${PG_MIGRATION_USER:?PG_MIGRATION_USER is required for the pre-deploy backup}\"
    : \"\${PG_MIGRATION_PASSWORD:?PG_MIGRATION_PASSWORD is required for the pre-deploy backup}\"
    : \"\${PG_DATABASE:?PG_DATABASE is required for the pre-deploy backup}\"
    dump='$REMOTE_BACKUP_DIR/zutomayo-'\"\$timestamp\"'.dump'
    docker exec -e PGPASSWORD=\"\$PG_MIGRATION_PASSWORD\" '$POSTGRES_CONTAINER' \
      pg_dump --username \"\$PG_MIGRATION_USER\" --dbname \"\$PG_DATABASE\" \
      --format=custom --compress=6 --no-owner --no-privileges > \"\$dump\"
    test -s \"\$dump\"
    docker exec -i '$POSTGRES_CONTAINER' pg_restore --list < \"\$dump\" >/dev/null
    sha256sum \"\$dump\" > \"\$dump.sha256\"
    sha256sum --check \"\$dump.sha256\"
    printf 'pre-deploy backup: %s\n' \"\$dump\""
}

remote_sync_master_and_env() {
  ssh_run "set -euo pipefail
    cd '$REMOTE_DIR'
    git config --global --add safe.directory '$REMOTE_DIR' 2>/dev/null || true
    git fetch origin
    git reset --hard origin/master
    test \"\$(git rev-parse HEAD)\" = '$TARGET_SHA'
    printf '%s  %s\n' '$EXPECTED_SCHEMA_CHECKSUM' 'migrations/$EXPECTED_SCHEMA_MIGRATION.js' | sha256sum --check
    upsert_env() {
      key=\"\$1\"
      value=\"\$2\"
      if grep -q \"^\${key}=\" .env; then
        sed -i \"s|^\${key}=.*|\${key}=\${value}|\" .env
      else
        printf '%s=%s\n' \"\$key\" \"\$value\" >> .env
      fi
    }
    upsert_env APP_BUILD_ID '$TARGET_SHA'
    upsert_env APP_VERSION '$PACKAGE_VERSION'
    upsert_env GAME_RULES_VERSION '$PACKAGE_VERSION'
    upsert_env EXPECTED_SCHEMA_MIGRATION '$EXPECTED_SCHEMA_MIGRATION'
    upsert_env EXPECTED_SCHEMA_CHECKSUM '$EXPECTED_SCHEMA_CHECKSUM'
    grep -E '^(APP_BUILD_ID|APP_VERSION|GAME_RULES_VERSION|EXPECTED_SCHEMA_MIGRATION|EXPECTED_SCHEMA_CHECKSUM)=' .env"
}

sync_battle_assets() {
  local remote_stage="${REMOTE_BATTLE_ASSET_DIR}.next"
  local remote_previous="$REMOTE_DIR/backups/battle-assets/previous"
  awk 'NF { print $2 }' "$BATTLE_ASSET_CHECKSUMS" \
    | COPYFILE_DISABLE=1 tar -C "$BATTLE_ASSET_DIR" -cf - -T - \
    | ssh -p "$SERVER_PORT" "$SERVER_USER@$SERVER_HOST" "set -euo pipefail
        rm -rf '$remote_stage'
        mkdir -p '$remote_stage' '$REMOTE_DIR/backups/battle-assets'
        tar -xf - -C '$remote_stage'
        find '$remote_stage' -type f -name '._*' -delete
        find '$remote_stage' -type d -exec chmod 0755 {} +
        find '$remote_stage' -type f -exec chmod 0644 {} +
        cd '$remote_stage'
        sha256sum --check '$REMOTE_DIR/scripts/battle-assets.sha256'
        actual_count=\$(find . -type f \( -iname '*.png' -o -iname '*.svg' \) | wc -l | tr -d '[:space:]')
        test \"\$actual_count\" = '$BATTLE_ASSET_COUNT'
        rm -rf '$remote_previous'
        if test -d '$REMOTE_BATTLE_ASSET_DIR'; then mv '$REMOTE_BATTLE_ASSET_DIR' '$remote_previous'; fi
        mv '$remote_stage' '$REMOTE_BATTLE_ASSET_DIR'"
  log "synchronized and verified $BATTLE_ASSET_COUNT private battle assets"
}

verify_remote_runtime_config() {
  ssh_run "set -euo pipefail
    cd '$REMOTE_DIR'
    set -a
    . ./.env
    set +a
    : \"\${PG_MIGRATION_USER:?PG_MIGRATION_USER is required}\"
    : \"\${PG_MIGRATION_PASSWORD:?PG_MIGRATION_PASSWORD is required}\"
    : \"\${PG_APP_USER:?PG_APP_USER is required}\"
    : \"\${PG_APP_PASSWORD:?PG_APP_PASSWORD is required}\"
    : \"\${REDIS_URL:?REDIS_URL is required}\"
    test \"\${PGSSLMODE:-}\" = verify-full || { echo 'PGSSLMODE must be verify-full' >&2; exit 1; }
    test -r \"\${PG_CA_FILE:?PG_CA_FILE is required}\" || { echo 'PG_CA_FILE is not readable' >&2; exit 1; }
    docker compose -f '$COMPOSE_FILE' config --quiet
    config=\$(docker compose -f '$COMPOSE_FILE' config)
    extract_redis_db() {
      printf '%s\n' \"\$config\" | awk -v service=\"\$1\" '
        \$0 == \"  \" service \":\" { in_service=1; next }
        in_service && \$0 ~ /^  [A-Za-z0-9_.-]+:$/ { in_service=0 }
        in_service && \$0 ~ /^      REDIS_DB:/ {
          sub(/^      REDIS_DB:[[:space:]]*/, \"\")
          gsub(/[\"\x27]/, \"\")
          print
          exit
        }
      '
    }
    game_redis_db=\$(extract_redis_db game)
    api_redis_db=\$(extract_redis_db api)
    platform_redis_db=\$(extract_redis_db platform)
    if test -z \"\$game_redis_db\" || test \"\$game_redis_db\" != \"\$api_redis_db\" || test \"\$game_redis_db\" != \"\$platform_redis_db\"; then
      printf 'Redis DB mismatch: game=%s api=%s platform=%s\n' \"\$game_redis_db\" \"\$api_redis_db\" \"\$platform_redis_db\" >&2
      exit 1
    fi
    printf 'Redis DB consistent: %s\n' \"\$game_redis_db\"
    policy=\$(docker exec -e REDISCLI_AUTH=\"\${REDIS_PASSWORD:-}\" '$REDIS_CONTAINER' \
      redis-cli --no-auth-warning CONFIG GET maxmemory-policy | tail -n 1)
    test \"\$policy\" = noeviction || { printf 'Redis maxmemory-policy must be noeviction (got: %s)\n' \"\$policy\" >&2; exit 1; }
    echo 'Redis eviction policy: noeviction'"
}

capture_rollback_images() {
  ssh_run "set -euo pipefail
    cd '$REMOTE_DIR'
    rm -f .server4-rollback-ready
    if docker image inspect '$GAME_IMAGE:latest' '$API_IMAGE:latest' '$PLATFORM_IMAGE:latest' >/dev/null 2>&1; then
      docker tag '$GAME_IMAGE:latest' '$GAME_IMAGE:rollback'
      docker tag '$API_IMAGE:latest' '$API_IMAGE:rollback'
      docker tag '$PLATFORM_IMAGE:latest' '$PLATFORM_IMAGE:rollback'
      touch .server4-rollback-ready
    elif grep -Eq '^GAME_IMAGE=.+@sha256:' .env.previous \
      && grep -Eq '^API_IMAGE=.+@sha256:' .env.previous \
      && grep -Eq '^PLATFORM_IMAGE=.+@sha256:' .env.previous; then
      touch .server4-rollback-ready
    else
      echo 'warning: complete previous runtime image set was not found; automatic rollback is unavailable' >&2
    fi"
}

remote_build_and_start() {
  ssh_run "set -euo pipefail
    cd '$REMOTE_DIR'
    docker compose -f '$COMPOSE_FILE' build --pull migrate game api platform
    docker compose -f '$COMPOSE_FILE' up -d --wait --wait-timeout '$DEPLOY_WAIT_SECONDS'
    docker compose -f '$COMPOSE_FILE' ps"
}

remote_rollback() {
  ssh_run "set -euo pipefail
    cd '$REMOTE_DIR'
    test -s .env.previous
    test -s '$COMPOSE_FILE.previous'
    cp -p .env .env.failed 2>/dev/null || true
    cp -p '$COMPOSE_FILE' '$COMPOSE_FILE.failed' 2>/dev/null || true
    cp -p .env.previous .env
    cp -p '$COMPOSE_FILE.previous' '$COMPOSE_FILE'
    if test -d '$REMOTE_DIR/backups/battle-assets/previous'; then
      rm -rf '$REMOTE_DIR/backups/battle-assets/failed'
      if test -d '$REMOTE_BATTLE_ASSET_DIR'; then
        mv '$REMOTE_BATTLE_ASSET_DIR' '$REMOTE_DIR/backups/battle-assets/failed'
      fi
      mv '$REMOTE_DIR/backups/battle-assets/previous' '$REMOTE_BATTLE_ASSET_DIR'
    fi
    TAG=rollback docker compose -f '$COMPOSE_FILE' config --quiet
    TAG=rollback docker compose -f '$COMPOSE_FILE' up -d --no-build --no-deps --wait \
      --wait-timeout '$DEPLOY_WAIT_SECONDS' game api platform
    date -u +%Y-%m-%dT%H:%M:%SZ > .release.rolled-back-at
    docker compose -f '$COMPOSE_FILE' ps"
}

remote_build_id() {
  ssh_run "set -euo pipefail; cd '$REMOTE_DIR'; sed -n 's/^APP_BUILD_ID=//p' .env | tail -n 1"
}

run_smoke() {
  local expected_build_id="$1" check_battle_assets="${2:-true}" tunnel_pid status
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
    --expected-build-id "$expected_build_id" \
    --check-battle-assets "$check_battle_assets"
  status=$?
  set -e
  kill "$tunnel_pid" >/dev/null 2>&1 || true
  wait "$tunnel_pid" >/dev/null 2>&1 || true
  return "$status"
}

rollback_and_smoke() {
  remote_rollback || return 1
  local previous_build_id
  previous_build_id="$(remote_build_id)"
  [[ -n "$previous_build_id" ]] || return 1
  run_smoke "$previous_build_id" false
}

if [[ "$ROLLBACK" == true ]]; then
  confirm_action 'rollback to the previous server4 runtime images and configuration'
  if [[ "$DRY_RUN" == true ]]; then
    log '[dry-run] would restore .env.previous, the previous Compose file, and previous runtime images'
    exit 0
  fi
  ssh_run "test -s '$REMOTE_DIR/.env.previous' && test -s '$REMOTE_DIR/$COMPOSE_FILE.previous'" || \
    die 'previous server4 configuration is unavailable'
  rollback_and_smoke || die 'rollback or rollback health verification failed'
  log 'rollback completed and health checks passed'
  exit 0
fi

load_local_release
confirm_action "deploy origin/master $TARGET_SHORT"
if [[ "$DRY_RUN" == true ]]; then
  log "[dry-run] would back up PostgreSQL and deploy origin/master $TARGET_SHORT"
  log "[dry-run] schema=$EXPECTED_SCHEMA_MIGRATION checksum=$EXPECTED_SCHEMA_CHECKSUM"
  log "[dry-run] would synchronize and verify $BATTLE_ASSET_COUNT private battle assets"
  exit 0
fi

ssh_run 'echo connected' >/dev/null || die 'SSH connection failed'
ssh_run "test -d '$REMOTE_DIR' && test -f '$REMOTE_DIR/.env' && test -f '$REMOTE_DIR/$COMPOSE_FILE'" || \
  die 'remote deployment directory, .env, or Compose file is missing'

log 'creating a fresh PostgreSQL custom-format backup and configuration snapshots'
remote_predeploy_backup
log "aligning server4 source and release metadata to origin/master $TARGET_SHORT"
remote_sync_master_and_env
log 'checking PostgreSQL TLS and shared Redis safety configuration'
verify_remote_runtime_config
log 'synchronizing private battle assets outside GitHub'
sync_battle_assets
capture_rollback_images

if ! remote_build_and_start; then
  if ssh_run "test -f '$REMOTE_DIR/.server4-rollback-ready'"; then
    log 'deployment failed; restoring the previous runtime images and configuration'
    rollback_and_smoke || log 'rollback verification failed; manual intervention is required'
  else
    log 'deployment failed and no complete rollback image set is available'
  fi
  exit 1
fi

if ! run_smoke "$TARGET_SHA" true; then
  if ssh_run "test -f '$REMOTE_DIR/.server4-rollback-ready'"; then
    log 'health verification failed; restoring the previous runtime images and configuration'
    rollback_and_smoke || log 'rollback verification failed; manual intervention is required'
  else
    log 'health verification failed and no complete rollback image set is available'
  fi
  exit 1
fi

ssh_run "date -u +%Y-%m-%dT%H:%M:%SZ > '$REMOTE_DIR/.release.deployed-at'"
log "deployment completed: origin/master $TARGET_SHORT"
