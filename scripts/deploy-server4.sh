#!/usr/bin/env bash
# Deploy the current origin/master beta release to server4.
#
# Usage:
#   ./scripts/deploy-server4.sh
#   ./scripts/deploy-server4.sh --confirm
#   ./scripts/deploy-server4.sh --dry-run

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
MEILI_CONTAINER="${MEILI_CONTAINER:-meilisearch}"
MEILI_EXPECTED_IMAGE="${MEILI_EXPECTED_IMAGE:-getmeili/meilisearch:v1.51.0}"
MEILI_APP_DIR="${MEILI_APP_DIR:-/opt/1panel/apps/meilisearch/meilisearch}"
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
PUBLIC_SMOKE_BASE_URL="${PUBLIC_SMOKE_BASE_URL:-https://battle.zutomayocard.online}"
SERVER4_ALLOWED_ORIGIN="${SERVER4_ALLOWED_ORIGIN:-https://battle.zutomayocard.online}"
DIRECT_SMOKE_ADDRESS="${DIRECT_SMOKE_ADDRESS:-$SERVER_HOST}"
DEPLOY_SMOKE_REPORT_PATH="${DEPLOY_SMOKE_REPORT_PATH:-}"
CARD_DATASET_SHA256="${VITE_CARD_DATASET_SHA256:-}"
CLOUDFLARE_CACHE_RULES_REQUIRED="${CLOUDFLARE_CACHE_RULES_REQUIRED:-false}"
OFFICIAL_TRANSLATIONS_SOURCE="${OFFICIAL_TRANSLATIONS_SOURCE:-$PROJECT_DIR/data/official-rulings-translations.json}"
OFFICIAL_RULE_DOCUMENTS_SOURCE="${OFFICIAL_RULE_DOCUMENTS_SOURCE:-$PROJECT_DIR/data/official-rule-documents-20260721.json}"
CARD_DERIVED_EFFECTS_DIR="${CARD_DERIVED_EFFECTS_DIR:-$PROJECT_DIR/data}"
CARD_DERIVED_EFFECT_FILES=(
  card-effects-i18n.json
  card-derived-effects-review.json
  card-english-extraction.json
  card-official-errata.json
)
CARD_DERIVED_NAME_FILES=(
  card-names-i18n.json
  card-song-titles-i18n.json
  card-english-extraction.json
  e2e-card-seed.json
  card-official-errata.json
  card-derived-names-review.json
)
CARD_UNLISTED_RELEASE_FILES=(
  card-unlisted-sources.json
  card-unlisted-human-reviews.json
  card-unlisted-release.json
)

CONFIRM=false
DRY_RUN=false

usage() {
  sed -n '2,10p' "$0"
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --confirm) CONFIRM=true; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
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
[[ "$MEILI_CONTAINER" =~ ^[A-Za-z0-9._-]+$ ]] || die 'MEILI_CONTAINER is invalid'
[[ "$MEILI_EXPECTED_IMAGE" =~ ^[A-Za-z0-9._/:@-]+$ ]] || die 'MEILI_EXPECTED_IMAGE is invalid'
[[ "$MEILI_APP_DIR" =~ ^/[A-Za-z0-9._/-]+$ ]] || die 'MEILI_APP_DIR contains unsupported characters'
[[ "$DEPLOY_WAIT_SECONDS" =~ ^[0-9]+$ ]] || die 'DEPLOY_WAIT_SECONDS must be an integer'
[[ -z "$CARD_DATASET_SHA256" || "$CARD_DATASET_SHA256" =~ ^[a-f0-9]{64}$ ]] || \
  die 'VITE_CARD_DATASET_SHA256 must be a lowercase SHA-256 digest'
[[ "$SERVER4_ALLOWED_ORIGIN" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] || \
  die 'SERVER4_ALLOWED_ORIGIN must be one HTTPS origin without a path'
[[ -z "$PUBLIC_SMOKE_BASE_URL" || "$PUBLIC_SMOKE_BASE_URL" =~ ^https?://[A-Za-z0-9._:-]+/?$ ]] || \
  die 'PUBLIC_SMOKE_BASE_URL must be an HTTP(S) origin URL'

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
  EXPECTED_SCHEMA_MIGRATION="$(find migrations -maxdepth 1 -type f -name '*.js' -print | sort | tail -n 1 | sed 's#^.*/##; s/\.js$//')"
  [[ "$EXPECTED_SCHEMA_MIGRATION" =~ ^[0-9]{6,}_[a-z0-9_]+$ ]] || die 'could not resolve the latest migration'
  local migration_file="migrations/${EXPECTED_SCHEMA_MIGRATION}.js"
  [[ -f "$migration_file" ]] || die "expected migration is missing: $migration_file"
  EXPECTED_SCHEMA_CHECKSUM="$(sha256_file "$migration_file")"
  [[ "$EXPECTED_SCHEMA_CHECKSUM" =~ ^[a-f0-9]{64}$ ]] || die 'migration checksum is invalid'
  verify_local_battle_assets
  [[ -f "$OFFICIAL_TRANSLATIONS_SOURCE" ]] || \
    die "reviewed official-rulings translations are missing: $OFFICIAL_TRANSLATIONS_SOURCE"
  [[ -f "$OFFICIAL_RULE_DOCUMENTS_SOURCE" ]] || \
    die "reviewed official rule documents are missing: $OFFICIAL_RULE_DOCUMENTS_SOURCE"
  [[ -d "$CARD_DERIVED_EFFECTS_DIR" ]] || \
    die "reviewed card-derived-effects directory is missing: $CARD_DERIVED_EFFECTS_DIR"
  local derived_file
  for derived_file in "${CARD_DERIVED_EFFECT_FILES[@]}"; do
    [[ -f "$CARD_DERIVED_EFFECTS_DIR/$derived_file" ]] || \
      die "reviewed card-derived-effects source is missing: $CARD_DERIVED_EFFECTS_DIR/$derived_file"
  done
  local name_file
  for name_file in "${CARD_DERIVED_NAME_FILES[@]}"; do
    [[ -f "$CARD_DERIVED_EFFECTS_DIR/$name_file" ]] || \
      die "reviewed card-derived-names source is missing: $CARD_DERIVED_EFFECTS_DIR/$name_file"
  done
  CARD_NAME_I18N_SOURCE="$CARD_DERIVED_EFFECTS_DIR/card-names-i18n.json" \
  CARD_SONG_I18N_SOURCE="$CARD_DERIVED_EFFECTS_DIR/card-song-titles-i18n.json" \
  CARD_ENGLISH_EXTRACTION_SOURCE="$CARD_DERIVED_EFFECTS_DIR/card-english-extraction.json" \
  CARD_SEED_SOURCE="$CARD_DERIVED_EFFECTS_DIR/e2e-card-seed.json" \
  CARD_OFFICIAL_ERRATA_SOURCE="$CARD_DERIVED_EFFECTS_DIR/card-official-errata.json" \
  CARD_DERIVED_NAMES_REVIEW_SOURCE="$CARD_DERIVED_EFFECTS_DIR/card-derived-names-review.json" \
    node --import tsx scripts/audit-card-derived-names.ts >/dev/null || \
    die 'reviewed card-derived-names audit failed'
  local unlisted_file
  for unlisted_file in "${CARD_UNLISTED_RELEASE_FILES[@]}"; do
    [[ -f "$CARD_DERIVED_EFFECTS_DIR/$unlisted_file" ]] || \
      die "reviewed unlisted-card release source is missing: $CARD_DERIVED_EFFECTS_DIR/$unlisted_file"
  done
  CARD_UNLISTED_SOURCES_SOURCE="$CARD_DERIVED_EFFECTS_DIR/card-unlisted-sources.json" \
  CARD_UNLISTED_HUMAN_REVIEWS_SOURCE="$CARD_DERIVED_EFFECTS_DIR/card-unlisted-human-reviews.json" \
  CARD_UNLISTED_RELEASE_SOURCE="$CARD_DERIVED_EFFECTS_DIR/card-unlisted-release.json" \
    node --import tsx scripts/audit-reviewed-unlisted-cards.ts >/dev/null || \
    die 'reviewed unlisted-card release audit failed'
}

remote_predeploy_backup() {
  ssh_run "set -euo pipefail
    cd '$REMOTE_DIR'
    test -f .env
    test -f '$COMPOSE_FILE'
    test -f '$MEILI_APP_DIR/.env'
    test -f '$MEILI_APP_DIR/docker-compose.yml'
    test -f '$MEILI_APP_DIR/config/config.toml'
    umask 077
    timestamp=\$(date -u +%Y%m%dT%H%M%SZ)
    mkdir -p '$REMOTE_BACKUP_DIR'
    chmod 0700 '$REMOTE_BACKUP_DIR'
    cp -p .env '$REMOTE_BACKUP_DIR/.env.'\"\$timestamp\"
    cp -p '$COMPOSE_FILE' '$REMOTE_BACKUP_DIR/$COMPOSE_FILE.'\"\$timestamp\"
    cp -p '$MEILI_APP_DIR/.env' '$REMOTE_BACKUP_DIR/meilisearch.env.'"\$timestamp"
    cp -p '$MEILI_APP_DIR/docker-compose.yml' '$REMOTE_BACKUP_DIR/meilisearch.compose.'"\$timestamp"'.yml'
    cp -p '$MEILI_APP_DIR/config/config.toml' '$REMOTE_BACKUP_DIR/meilisearch.config.'"\$timestamp"'.toml'
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

prepare_external_meilisearch() {
  ssh_run "set -euo pipefail
    cd '$REMOTE_DIR'
    docker inspect '$MEILI_CONTAINER' >/dev/null
    test \"\$(docker inspect '$MEILI_CONTAINER' --format '{{.State.Running}}')\" = true || {
      echo 'external Meilisearch container is not running' >&2
      exit 1
    }
    actual_image=\$(docker inspect '$MEILI_CONTAINER' --format '{{.Config.Image}}')
    test \"\$actual_image\" = '$MEILI_EXPECTED_IMAGE' || {
      printf 'external Meilisearch image mismatch: expected %s, got %s\n' '$MEILI_EXPECTED_IMAGE' \"\$actual_image\" >&2
      exit 1
    }
    docker inspect '$MEILI_CONTAINER' --format '{{json .NetworkSettings.Networks}}' | grep -q '\"1panel-network\"' || {
      echo 'external Meilisearch is not attached to 1panel-network' >&2
      exit 1
    }
    container_key=\$(docker inspect '$MEILI_CONTAINER' --format '{{range .Config.Env}}{{println .}}{{end}}' |
      sed -n 's/^MEILI_MASTER_KEY=//p')
    test \"\${#container_key}\" -ge 16 || {
      echo 'external Meilisearch master key must contain at least 16 characters' >&2
      exit 1
    }
    app_key=\$(set -a; . '$MEILI_APP_DIR/.env'; printf '%s' \"\${MEILI_MASTER_KEY:-}\")
    test \"\$app_key\" = \"\$container_key\" || {
      echo '1Panel Meilisearch key does not match the running container' >&2
      exit 1
    }
    sed -i '/^MEILI_MASTER_KEY=/d' .env
    printf 'MEILI_MASTER_KEY=%s\n' \"\$container_key\" >> .env
    chmod 0600 .env

    config='$MEILI_APP_DIR/config/config.toml'
    sed -i 's/^env = .*/env = \"production\"/' \"\$config\"
    sed -i 's/^http_addr = .*/http_addr = \"0.0.0.0:7700\"/' \"\$config\"
    if grep -Eq '^#? *no_analytics = ' \"\$config\"; then
      sed -i 's/^#\? *no_analytics = .*/no_analytics = true/' \"\$config\"
    else
      printf '\nno_analytics = true\n' >> \"\$config\"
    fi
    grep -qx 'env = \"production\"' \"\$config\"
    grep -qx 'http_addr = \"0.0.0.0:7700\"' \"\$config\"
    grep -qx 'no_analytics = true' \"\$config\"

    cd '$MEILI_APP_DIR'
    docker compose up -d --force-recreate meilisearch >/dev/null
    for attempt in \$(seq 1 30); do
      if docker exec '$MEILI_CONTAINER' curl --fail --silent http://localhost:7700/health |
        grep -q '\"status\":\"available\"'; then
        break
      fi
      test \"\$attempt\" -lt 30 || { echo 'external Meilisearch health check timed out' >&2; exit 1; }
      sleep 2
    done
    runtime_key=\$(docker inspect '$MEILI_CONTAINER' --format '{{range .Config.Env}}{{println .}}{{end}}' |
      sed -n 's/^MEILI_MASTER_KEY=//p')
    test \"\$runtime_key\" = \"\$container_key\" || {
      echo 'external Meilisearch master key changed during recreation' >&2
      exit 1
    }
    docker exec '$MEILI_CONTAINER' curl --fail --silent \
      --header \"Authorization: Bearer \$runtime_key\" http://localhost:7700/keys >/dev/null
    host_binding=\$(docker inspect '$MEILI_CONTAINER' \
      --format '{{(index (index .HostConfig.PortBindings \"7700/tcp\") 0).HostIp}}')
    test \"\$host_binding\" = '127.0.0.1' || {
      printf 'external Meilisearch must bind host port 7700 to 127.0.0.1 (got: %s)\n' \"\$host_binding\" >&2
      exit 1
    }
    docker run --rm --network 1panel-network --entrypoint curl '$MEILI_EXPECTED_IMAGE' \
      --fail --silent http://meilisearch:7700/health | grep -q '\"status\":\"available\"'
    echo 'external Meilisearch verified: production, private, healthy, and reachable on 1panel-network'"
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
    upsert_env ALLOWED_ORIGINS '$SERVER4_ALLOWED_ORIGIN'
    grep -E '^(APP_BUILD_ID|APP_VERSION|GAME_RULES_VERSION|EXPECTED_SCHEMA_MIGRATION|EXPECTED_SCHEMA_CHECKSUM|ALLOWED_ORIGINS|VITE_CARD_DATASET_SHA256)=' .env"
}

sync_battle_assets() {
  local remote_stage="${REMOTE_BATTLE_ASSET_DIR}.next"
  awk 'NF { print $2 }' "$BATTLE_ASSET_CHECKSUMS" \
    | COPYFILE_DISABLE=1 tar -C "$BATTLE_ASSET_DIR" -cf - -T - \
    | ssh -p "$SERVER_PORT" "$SERVER_USER@$SERVER_HOST" "set -euo pipefail
        rm -rf '$remote_stage'
        mkdir -p '$remote_stage'
        tar -xf - -C '$remote_stage'
        find '$remote_stage' -type f -name '._*' -delete
        find '$remote_stage' -type d -exec chmod 0755 {} +
        find '$remote_stage' -type f -exec chmod 0644 {} +
        cd '$remote_stage'
        sha256sum --check '$REMOTE_DIR/scripts/battle-assets.sha256'
        actual_count=\$(find . -type f \( -iname '*.png' -o -iname '*.svg' \) | wc -l | tr -d '[:space:]')
        test \"\$actual_count\" = '$BATTLE_ASSET_COUNT'
        rm -rf '$REMOTE_BATTLE_ASSET_DIR'
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
    : \"\${MEILI_MASTER_KEY:?MEILI_MASTER_KEY is required}\"
    : \"\${TRUSTED_PROXY:?TRUSTED_PROXY is required}\"
    test \"\${ALLOWED_ORIGINS:-}\" = '$SERVER4_ALLOWED_ORIGIN' || {
      echo 'ALLOWED_ORIGINS must contain only the production HTTPS origin' >&2
      exit 1
    }
    case \",\$TRUSTED_PROXY,\" in
      *,172.16.0.0/12,*) ;;
      *) echo 'TRUSTED_PROXY must include the Docker ingress range 172.16.0.0/12' >&2; exit 1 ;;
    esac
    test \"\${#MEILI_MASTER_KEY}\" -ge 16 || { echo 'MEILI_MASTER_KEY must contain at least 16 characters' >&2; exit 1; }
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

remote_build_migration() {
  ssh_run "set -euo pipefail
    cd '$REMOTE_DIR'
    docker compose -f '$COMPOSE_FILE' build --pull migrate
    docker compose -f '$COMPOSE_FILE' run --rm migrate"
}

preflight_card_dataset() {
  local report_file derived_hash remote_report
  report_file="$(mktemp)"
  if ! ssh_run "set -euo pipefail
    cd '$REMOTE_DIR'
    docker compose -f '$COMPOSE_FILE' run --rm -T migrate \
      node --import tsx scripts/public-card-dataset-preflight.ts \
      --base-url http://api:3001/api/" >"$report_file"; then
    rm -f "$report_file"
    return 1
  fi
  derived_hash="$(node -e '
    const fs = require("node:fs");
    const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (report.status !== "passed") throw new Error("card dataset preflight did not pass");
    if (!/^[a-f0-9]{64}$/.test(report.datasetSha256 || "")) throw new Error("card dataset preflight returned an invalid SHA-256 digest");
    process.stdout.write(report.datasetSha256);
  ' "$report_file")" || {
    rm -f "$report_file"
    return 1
  }
  if [[ -n "$CARD_DATASET_SHA256" && "$CARD_DATASET_SHA256" != "$derived_hash" ]]; then
    rm -f "$report_file"
    die "operator-provided card dataset SHA-256 does not match preflight: expected=$CARD_DATASET_SHA256 actual=$derived_hash"
  fi
  CARD_DATASET_SHA256="$derived_hash"
  remote_report="$REMOTE_DIR/.release-evidence/production/card-dataset-preflight-$TARGET_SHA.json"
  if ! ssh -p "$SERVER_PORT" "$SERVER_USER@$SERVER_HOST" "set -euo pipefail
      umask 077
      mkdir -p '$REMOTE_DIR/.release-evidence/production'
      cat > '$remote_report'" <"$report_file"; then
    rm -f "$report_file"
    return 1
  fi
  rm -f "$report_file"
  log "verified public card dataset SHA-256: $CARD_DATASET_SHA256"
}

record_card_dataset_sha256() {
  ssh_run "set -euo pipefail
    cd '$REMOTE_DIR'
    if grep -q '^VITE_CARD_DATASET_SHA256=' .env; then
      sed -i 's|^VITE_CARD_DATASET_SHA256=.*|VITE_CARD_DATASET_SHA256=$CARD_DATASET_SHA256|' .env
    else
      printf '%s\n' 'VITE_CARD_DATASET_SHA256=$CARD_DATASET_SHA256' >> .env
    fi
    grep -qx 'VITE_CARD_DATASET_SHA256=$CARD_DATASET_SHA256' .env"
}

remote_build_runtime() {
  ssh_run "set -euo pipefail
    cd '$REMOTE_DIR'
    docker compose -f '$COMPOSE_FILE' config --quiet
    docker compose -f '$COMPOSE_FILE' build --pull game api platform"
}

reindex_knowledge_search() {
  ssh_run "set -euo pipefail
    cd '$REMOTE_DIR'
    docker compose -f '$COMPOSE_FILE' run --rm migrate npm run search:reindex
    docker compose -f '$COMPOSE_FILE' run --rm migrate npm run search:check"
}

release_official_rulings() {
  ssh -p "$SERVER_PORT" "$SERVER_USER@$SERVER_HOST" "set -euo pipefail
    cd '$REMOTE_DIR'
    docker compose -f '$COMPOSE_FILE' run --rm -T migrate \
      node --import tsx scripts/release-official-rulings.ts \
      --translations=- --app-version='$PACKAGE_VERSION' --build-id='$TARGET_SHA'" \
    < "$OFFICIAL_TRANSLATIONS_SOURCE"
}

release_official_rule_documents() {
  ssh -p "$SERVER_PORT" "$SERVER_USER@$SERVER_HOST" "set -euo pipefail
    cd '$REMOTE_DIR'
    docker compose -f '$COMPOSE_FILE' run --rm -T migrate sh -ceu '
      tmp=\$(mktemp)
      trap \"rm -f \\\"\$tmp\\\"\" EXIT
      cat > \"\$tmp\"
      OFFICIAL_RULE_DOCUMENTS_FILE=\"\$tmp\" \\
        node --import tsx scripts/release-official-rule-documents.ts
    '" < "$OFFICIAL_RULE_DOCUMENTS_SOURCE"
}

release_card_derived_effects() {
  COPYFILE_DISABLE=1 tar -C "$CARD_DERIVED_EFFECTS_DIR" -cf - "${CARD_DERIVED_EFFECT_FILES[@]}" \
    | ssh -p "$SERVER_PORT" "$SERVER_USER@$SERVER_HOST" "set -euo pipefail
      cd '$REMOTE_DIR'
      docker compose -f '$COMPOSE_FILE' run --rm -T migrate sh -ceu '
        tmp=\$(mktemp -d)
        trap \"rm -rf \\\"\$tmp\\\"\" EXIT
        tar -xf - -C \"\$tmp\"
        CARD_EFFECT_I18N_SOURCE=\"\$tmp/card-effects-i18n.json\" \\
        CARD_DERIVED_EFFECTS_REVIEW_SOURCE=\"\$tmp/card-derived-effects-review.json\" \\
        CARD_ENGLISH_EXTRACTION_SOURCE=\"\$tmp/card-english-extraction.json\" \\
        CARD_OFFICIAL_ERRATA_SOURCE=\"\$tmp/card-official-errata.json\" \\
          node --import tsx scripts/import-card-derived-effects-pg.ts
      '"
}

release_card_derived_names() {
  COPYFILE_DISABLE=1 tar -C "$CARD_DERIVED_EFFECTS_DIR" -cf - "${CARD_DERIVED_NAME_FILES[@]}" \
    | ssh -p "$SERVER_PORT" "$SERVER_USER@$SERVER_HOST" "set -euo pipefail
      cd '$REMOTE_DIR'
      docker compose -f '$COMPOSE_FILE' run --rm -T migrate sh -ceu '
        tmp=\$(mktemp -d)
        trap \"rm -rf \\\"\$tmp\\\"\" EXIT
        tar -xf - -C \"\$tmp\"
        CARD_NAME_I18N_SOURCE=\"\$tmp/card-names-i18n.json\" \\
        CARD_SONG_I18N_SOURCE=\"\$tmp/card-song-titles-i18n.json\" \\
        CARD_ENGLISH_EXTRACTION_SOURCE=\"\$tmp/card-english-extraction.json\" \\
        CARD_SEED_SOURCE=\"\$tmp/e2e-card-seed.json\" \\
        CARD_OFFICIAL_ERRATA_SOURCE=\"\$tmp/card-official-errata.json\" \\
        CARD_DERIVED_NAMES_REVIEW_SOURCE=\"\$tmp/card-derived-names-review.json\" \\
          node --import tsx scripts/import-card-derived-names-pg.ts
      '"
}

release_reviewed_unlisted_cards() {
  COPYFILE_DISABLE=1 tar -C "$CARD_DERIVED_EFFECTS_DIR" -cf - "${CARD_UNLISTED_RELEASE_FILES[@]}" \
    | ssh -p "$SERVER_PORT" "$SERVER_USER@$SERVER_HOST" "set -euo pipefail
      cd '$REMOTE_DIR'
      docker compose -f '$COMPOSE_FILE' run --rm -T migrate sh -ceu '
        tmp=\$(mktemp -d)
        trap \"rm -rf \\\"\$tmp\\\"\" EXIT
        tar -xf - -C \"\$tmp\"
        CARD_UNLISTED_SOURCES_SOURCE=\"\$tmp/card-unlisted-sources.json\" \\
        CARD_UNLISTED_HUMAN_REVIEWS_SOURCE=\"\$tmp/card-unlisted-human-reviews.json\" \\
        CARD_UNLISTED_RELEASE_SOURCE=\"\$tmp/card-unlisted-release.json\" \\
          node --import tsx scripts/release-reviewed-unlisted-cards.ts
      '"
}

remote_start() {
  ssh_run "set -euo pipefail
    cd '$REMOTE_DIR'
    docker compose -f '$COMPOSE_FILE' up -d --wait --wait-timeout '$DEPLOY_WAIT_SECONDS'
    docker compose -f '$COMPOSE_FILE' ps"
}

remote_handoff_knowledge_search_lock() {
  ssh_run "set -euo pipefail
    cd '$REMOTE_DIR'
    set -a
    . ./.env
    set +a
    redis_db=\"\${REDIS_DB:-0}\"
    case \"\$redis_db\" in
      ''|*[!0-9]*) echo 'REDIS_DB must be a non-negative integer' >&2; exit 1 ;;
    esac
    docker compose -f '$COMPOSE_FILE' stop api
    if ! removed=\$(docker exec -e REDISCLI_AUTH=\"\${REDIS_PASSWORD:-}\" '$REDIS_CONTAINER' \
      redis-cli --no-auth-warning -n \"\$redis_db\" DEL search:index:rebuild); then
      docker compose -f '$COMPOSE_FILE' start api >/dev/null || true
      echo 'failed to clear the knowledge-search rebuild lease; restored the previous API container' >&2
      exit 1
    fi
    case \"\$removed\" in
      0|1) ;;
      *) docker compose -f '$COMPOSE_FILE' start api >/dev/null || true
         echo 'unexpected Redis response while clearing the knowledge-search rebuild lease' >&2
         exit 1 ;;
    esac
    printf 'knowledge-search rebuild lease handed off (removed=%s, redisDb=%s)\n' \"\$removed\" \"\$redis_db\""
}

run_smoke() {
  local expected_build_id="$1" tunnel_pid status
  local smoke_args=(
    --host 127.0.0.1
    --game-port "$SMOKE_LOCAL_GAME_PORT"
    --api-port "$SMOKE_LOCAL_API_PORT"
    --platform-port "$SMOKE_LOCAL_PLATFORM_PORT"
    --expected-build-id "$expected_build_id"
    --expected-dataset-sha256 "$CARD_DATASET_SHA256"
    --check-battle-assets true
  )
  if [[ -n "$PUBLIC_SMOKE_BASE_URL" ]]; then
    smoke_args+=(--public-base-url "$PUBLIC_SMOKE_BASE_URL")
  fi
  if [[ -n "$DEPLOY_SMOKE_REPORT_PATH" ]]; then
    smoke_args+=(--report-path "$DEPLOY_SMOKE_REPORT_PATH")
  fi
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
  node "$SCRIPT_DIR/deploy-smoke.mjs" "${smoke_args[@]}"
  status=$?
  set -e
  kill "$tunnel_pid" >/dev/null 2>&1 || true
  wait "$tunnel_pid" >/dev/null 2>&1 || true
  return "$status"
}

sync_cloudflare_cache_rules() {
  local token_set=false zone_set=false
  [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]] && token_set=true
  [[ -n "${CLOUDFLARE_ZONE_ID:-}" ]] && zone_set=true
  if [[ "$token_set" != true && "$zone_set" != true ]]; then
    [[ "$CLOUDFLARE_CACHE_RULES_REQUIRED" == true ]] && \
      die 'Cloudflare cache rules are required but CLOUDFLARE_API_TOKEN/CLOUDFLARE_ZONE_ID are missing'
    log 'Cloudflare cache rule sync skipped (operator credentials not configured)'
    return
  fi
  [[ "$token_set" == true && "$zone_set" == true ]] || \
    die 'CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID must be configured together'
  log 'synchronizing repository-managed Cloudflare cache rules'
  (cd "$PROJECT_DIR" && npm run cloudflare:cache:apply)
}

run_cache_policy_smoke() {
  local args=(
    --base-url "$PUBLIC_SMOKE_BASE_URL"
    --expected-build-id "$TARGET_SHA"
  )
  if [[ -n "$DIRECT_SMOKE_ADDRESS" ]]; then
    args+=(--direct-address "$DIRECT_SMOKE_ADDRESS")
  fi
  if [[ -n "${CLOUDFLARE_API_TOKEN:-}" && -n "${CLOUDFLARE_ZONE_ID:-}" ]]; then
    args+=(--expect-cloudflare true)
  fi
  log 'verifying cache policy through public DNS and the direct Hong Kong route'
  node --import tsx "$SCRIPT_DIR/cache-policy-smoke.ts" "${args[@]}"
}

load_local_release
confirm_action "deploy origin/master $TARGET_SHORT"
if [[ "$DRY_RUN" == true ]]; then
  log "[dry-run] would back up PostgreSQL and deploy origin/master $TARGET_SHORT"
  log "[dry-run] schema=$EXPECTED_SCHEMA_MIGRATION checksum=$EXPECTED_SCHEMA_CHECKSUM"
  log "[dry-run] would stream the reviewed official-rulings translations and require an atomic active release"
  log "[dry-run] would stream and atomically activate the translated official rule documents"
  log "[dry-run] would stream and transactionally import reviewed card-derived effects"
  log "[dry-run] would stream and transactionally import reviewed card-derived names"
  log "[dry-run] would stream and transactionally publish reviewed unlisted cards"
  log "[dry-run] would back up, configure, and verify the external 1Panel Meilisearch service"
  log "[dry-run] would set ALLOWED_ORIGINS=$SERVER4_ALLOWED_ORIGIN"
  log '[dry-run] would derive and record the card dataset SHA-256 after publishing data and before building runtime images'
  log "[dry-run] would atomically rebuild and verify the Meilisearch knowledge index"
  log "[dry-run] would synchronize and verify $BATTLE_ASSET_COUNT private battle assets"
  log "[dry-run] would verify every battle asset through origin and $PUBLIC_SMOKE_BASE_URL"
  log '[dry-run] would sync Cloudflare cache rules when credentials are configured'
  log "[dry-run] would verify cache headers through $PUBLIC_SMOKE_BASE_URL and $DIRECT_SMOKE_ADDRESS"
  exit 0
fi

ssh_run 'echo connected' >/dev/null || die 'SSH connection failed'
ssh_run "test -d '$REMOTE_DIR' && test -f '$REMOTE_DIR/.env' && test -f '$REMOTE_DIR/$COMPOSE_FILE'" || \
  die 'remote deployment directory, .env, or Compose file is missing'

log 'creating a fresh PostgreSQL custom-format backup and configuration snapshots'
remote_predeploy_backup
log "aligning server4 source and release metadata to origin/master $TARGET_SHORT"
remote_sync_master_and_env
log 'configuring and verifying the external 1Panel Meilisearch service'
prepare_external_meilisearch || die 'external Meilisearch verification failed; the application release was not replaced'
log 'checking PostgreSQL TLS, shared Redis, and search safety configuration'
verify_remote_runtime_config
log 'synchronizing private battle assets outside GitHub'
sync_battle_assets

remote_build_migration || die 'migration image build or schema migration failed; the running release was not replaced'
log 'streaming and transactionally publishing reviewed unlisted cards'
release_reviewed_unlisted_cards || die 'reviewed unlisted-card release gate failed; the running release was not replaced'
log 'streaming and transactionally importing reviewed card-derived names'
release_card_derived_names || die 'card-derived-names release gate failed; the running release was not replaced'
log 'streaming and transactionally importing reviewed card-derived effects'
release_card_derived_effects || die 'card-derived-effects release gate failed; the running release was not replaced'
log 'synchronizing and atomically activating current official Q&A, errata, and five reviewed locales'
release_official_rulings || die 'official-rulings release gate failed; the running release was not replaced'
log 'synchronizing and atomically activating Grand Rules and Floor Rules in five reviewed locales'
release_official_rule_documents || die 'official rule documents release gate failed; the running release was not replaced'
log 'deriving the public card dataset identity from the imported data'
preflight_card_dataset || die 'public card dataset preflight failed; runtime images were not built'
record_card_dataset_sha256 || die 'card dataset SHA-256 could not be recorded; runtime images were not built'
log 'atomically rebuilding and verifying the public knowledge search index'
reindex_knowledge_search || die 'knowledge search reindex failed; the running application release was not replaced'
log 'building runtime images with the verified dataset identity'
remote_build_runtime || die 'runtime image build failed; the running release was not replaced'
log 'stopping the previous API and handing off the knowledge search rebuild lease'
remote_handoff_knowledge_search_lock || die 'knowledge search lock handoff failed; inspect the server4 API container'
remote_start || die 'deployment failed; inspect the server4 Compose logs before retrying'

run_smoke "$TARGET_SHA" || die 'health verification failed; inspect the deployed release before retrying'
sync_cloudflare_cache_rules || die 'Cloudflare cache rule synchronization failed'
run_cache_policy_smoke || die 'public/direct cache policy verification failed'

ssh_run "date -u +%Y-%m-%dT%H:%M:%SZ > '$REMOTE_DIR/.release.deployed-at'"
log "deployment completed: origin/master $TARGET_SHORT"
