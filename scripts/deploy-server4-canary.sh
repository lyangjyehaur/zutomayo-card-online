#!/usr/bin/env bash
# Parallel blue/green deployment controller for server4.
#
# This intentionally does not replace scripts/deploy-server4.sh or mutate the
# legacy /opt/zutomayo-card-online tree. The one-time OpenResty cutover remains
# a separately reviewed operation after the bootstrap gateway is healthy.
#
# Examples:
#   ./scripts/deploy-server4-canary.sh preflight
#   ./scripts/deploy-server4-canary.sh install --copy-legacy-env --confirm
#   ./scripts/deploy-server4-canary.sh stage-slot --slot blue --manifest stable.env --confirm
#   ./scripts/deploy-server4-canary.sh bootstrap-gateway --stable-slot blue --manifest stable.env --confirm
#   ./scripts/deploy-server4-canary.sh activate-retention --slot blue --confirm
#   ./scripts/deploy-server4-canary.sh start-workers --slot blue --confirm
#   ./scripts/deploy-server4-canary.sh stage-slot --slot green --manifest candidate.env --confirm
#   ./scripts/deploy-server4-canary.sh switch --stable-slot blue --candidate-slot green \
#     --stable-manifest stable.env --candidate-manifest candidate.env --weight 10 --confirm
#   ./scripts/deploy-server4-canary.sh transfer-workers --from-slot blue --to-slot green --confirm

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER_HOST="${SERVER_HOST:-server4}"
SERVER_PORT="${SERVER_PORT:-}"
SERVER_USER="${SERVER_USER:-}"
REMOTE_DIR="${REMOTE_DIR:-/opt/zutomayo-card-runtime}"
LEGACY_DIR="${LEGACY_DIR:-/opt/zutomayo-card-online}"
EDGE_NETWORK="${GATEWAY_EDGE_NETWORK:-zutomayo-release-edge}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-postgresql}"
FEEDBACK_UPLOADS_VOLUME_DEFAULT="${FEEDBACK_UPLOADS_VOLUME_DEFAULT:-zutomayo-feedback-uploads}"
SLOT_COMPOSE_FILE="docker-compose.server4-slot.yml"
GATEWAY_COMPOSE_FILE="docker-compose.server4-gateway.yml"
RETENTION_COMPOSE_FILE="docker-compose.retention.yml"
ROLE_TLS_SMOKE_COMPOSE_FILE="docker-compose.postgres-role-smoke.yml"
POSTGRES_OPS_COMPOSE_FILE="docker-compose.postgres-ops.yml"
RETENTION_SERVICE_GROUP="${RETENTION_SERVICE_GROUP:-zutomayo-retention}"
MANAGED_MARKER=".zutomayo-parallel-runtime-v1"
REMOTE_LOCK_FILE="${REMOTE_DIR}.deploy.lock"
GATEWAY_ACTIVE_STATE="gateway-active.json"
GATEWAY_OBSERVATION_STATE="gateway-observation.json"
VERIFY_RELEASE_ARTIFACTS="${VERIFY_RELEASE_ARTIFACTS:-true}"
PG_SLOT_WEB_CONNECTION_BUDGET="${PG_SLOT_WEB_CONNECTION_BUDGET:-20}"
PG_SLOT_CONNECTION_BUDGET="${PG_SLOT_CONNECTION_BUDGET:-25}"
PG_STAGE_TRANSIENT_BUDGET="${PG_STAGE_TRANSIENT_BUDGET:-2}"
PG_MINIMUM_HEADROOM="${PG_MINIMUM_HEADROOM:-20}"
LEGACY_GAME_PG_POOL_BUDGET="${LEGACY_GAME_PG_POOL_BUDGET:-25}"
LEGACY_API_PG_POOL_BUDGET="${LEGACY_API_PG_POOL_BUDGET:-20}"
COSIGN_IDENTITY_REGEXP="${COSIGN_IDENTITY_REGEXP:-https://github.com/${GITHUB_REPOSITORY:-}/.github/workflows/cd\\.yml@refs/(heads/master|tags/v[0-9]+\\.[0-9]+\\.[0-9]+([.-][0-9A-Za-z.-]+)?)$}"
COSIGN_OIDC_ISSUER="${COSIGN_OIDC_ISSUER:-https://token.actions.githubusercontent.com}"

COMMAND="${1:-preflight}"
if [[ $# -gt 0 ]]; then shift; fi
CONFIRM=false
COPY_LEGACY_ENV=false
WITH_WORKERS=false
SLOT=''
FROM_SLOT=''
TO_SLOT=''
STABLE_SLOT=''
CANDIDATE_SLOT=''
WEIGHT=''
MANIFEST_FILE=''
STABLE_MANIFEST_FILE=''
CANDIDATE_MANIFEST_FILE=''
MANIFEST_FORMAT=''

usage() {
  sed -n '2,18p' "$0"
}

log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
die() { printf '[%s] ERROR: %s\n' "$(date +%H:%M:%S)" "$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --confirm) CONFIRM=true; shift ;;
    --copy-legacy-env) COPY_LEGACY_ENV=true; shift ;;
    --with-workers) WITH_WORKERS=true; shift ;;
    --slot|--from-slot|--to-slot|--stable-slot|--candidate-slot|--weight|--manifest|--stable-manifest|--candidate-manifest)
      [[ $# -ge 2 ]] || die "$1 requires a value"
      case "$1" in
        --slot) SLOT="$2" ;;
        --from-slot) FROM_SLOT="$2" ;;
        --to-slot) TO_SLOT="$2" ;;
        --stable-slot) STABLE_SLOT="$2" ;;
        --candidate-slot) CANDIDATE_SLOT="$2" ;;
        --weight) WEIGHT="$2" ;;
        --manifest) MANIFEST_FILE="$2" ;;
        --stable-manifest) STABLE_MANIFEST_FILE="$2" ;;
        --candidate-manifest) CANDIDATE_MANIFEST_FILE="$2" ;;
      esac
      shift 2
      ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[[ "$REMOTE_DIR" =~ ^/opt/[A-Za-z0-9._/-]+$ && "$REMOTE_DIR" != *'/../'* && "$REMOTE_DIR" != */.. && "$REMOTE_DIR" != *'/./'* ]] || die 'REMOTE_DIR must be a normalized path below /opt'
[[ "$LEGACY_DIR" =~ ^/opt/[A-Za-z0-9._/-]+$ && "$LEGACY_DIR" != *'/../'* && "$LEGACY_DIR" != */.. && "$LEGACY_DIR" != *'/./'* ]] || die 'LEGACY_DIR must be a normalized path below /opt'
[[ "$EDGE_NETWORK" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$ ]] || die 'GATEWAY_EDGE_NETWORK is invalid'
[[ "$POSTGRES_CONTAINER" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$ ]] || die 'POSTGRES_CONTAINER is invalid'
[[ "$FEEDBACK_UPLOADS_VOLUME_DEFAULT" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$ ]] || die 'FEEDBACK_UPLOADS_VOLUME_DEFAULT is invalid'
for value in PG_SLOT_WEB_CONNECTION_BUDGET PG_SLOT_CONNECTION_BUDGET PG_STAGE_TRANSIENT_BUDGET PG_MINIMUM_HEADROOM LEGACY_GAME_PG_POOL_BUDGET LEGACY_API_PG_POOL_BUDGET; do
  [[ "${!value}" =~ ^[0-9]+$ ]] || die "$value must be a non-negative integer"
done

ssh_target() {
  if [[ -n "$SERVER_USER" ]]; then printf '%s@%s' "$SERVER_USER" "$SERVER_HOST"; else printf '%s' "$SERVER_HOST"; fi
}

ssh_run() {
  if [[ -n "$SERVER_PORT" ]]; then
    ssh -p "$SERVER_PORT" "$(ssh_target)" "$@"
  else
    ssh "$(ssh_target)" "$@"
  fi
}

scp_to() {
  local source="$1" destination="$2"
  if [[ -n "$SERVER_PORT" ]]; then
    scp -P "$SERVER_PORT" "$source" "$(ssh_target):$destination"
  else
    scp "$source" "$(ssh_target):$destination"
  fi
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

require_confirm() {
  [[ "$CONFIRM" == true ]] || die "$COMMAND changes remote state; rerun with --confirm"
}

validate_slot() {
  [[ "$1" == blue || "$1" == green ]] || die 'slot must be blue or green'
}

other_slot() {
  if [[ "$1" == blue ]]; then printf 'green'; else printf 'blue'; fi
}

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
  [[ "$EXPECTED_SCHEMA_MIGRATION" =~ ^[0-9]{6,}_[a-z0-9_]+$ ]] || die 'manifest migration basename is invalid'
  [[ "$EXPECTED_SCHEMA_CHECKSUM" =~ ^[a-f0-9]{64}$ ]] || die 'manifest schema checksum is invalid'
  for key in GAME_IMAGE API_IMAGE PLATFORM_IMAGE MIGRATE_IMAGE RETENTION_IMAGE GATEWAY_IMAGE; do
    app="${key%_IMAGE}"
    app="$(printf '%s' "$app" | tr '[:upper:]' '[:lower:]')"
    value="${!key}"
    [[ "$value" =~ ^ghcr\.io/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+-${app}@sha256:[[:xdigit:]]{64}$ ]] || {
      die "manifest $key must be an immutable GHCR digest"
    }
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
  [[ -n "${GITHUB_REPOSITORY:-}" ]] || die 'GITHUB_REPOSITORY is required for artifact verification'
  command -v cosign >/dev/null 2>&1 || die 'cosign is required for artifact verification'
  command -v gh >/dev/null 2>&1 || die 'gh is required for artifact verification'
  local key ref
  local image_keys=(GAME_IMAGE API_IMAGE PLATFORM_IMAGE MIGRATE_IMAGE RETENTION_IMAGE GATEWAY_IMAGE)
  [[ "$MANIFEST_FORMAT" != current-seven ]] || image_keys+=(OPS_IMAGE)
  for key in "${image_keys[@]}"; do
    ref="${!key}"
    cosign verify --certificate-identity-regexp "$COSIGN_IDENTITY_REGEXP" \
      --certificate-oidc-issuer "$COSIGN_OIDC_ISSUER" "$ref" >/dev/null
    gh attestation verify "oci://${ref}" --repo "$GITHUB_REPOSITORY" --source-digest "$RELEASE_SHA" >/dev/null
  done
}

collect_pg_budget_snapshot() {
  local target_slot="$1"
  validate_slot "$target_slot"
  ssh_run "set -euo pipefail
    capacity=\$(docker exec '$POSTGRES_CONTAINER' sh -ec 'max=\$(psql -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d \"\${POSTGRES_DB:-\$POSTGRES_USER}\" -X -Atc \"SHOW max_connections\"); superuser=\$(psql -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d \"\${POSTGRES_DB:-\$POSTGRES_USER}\" -X -Atc \"SHOW superuser_reserved_connections\"); reserved=\$(psql -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d \"\${POSTGRES_DB:-\$POSTGRES_USER}\" -X -Atc \"SHOW reserved_connections\" 2>/dev/null || printf 0); current=\$(psql -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d \"\${POSTGRES_DB:-\$POSTGRES_USER}\" -X -Atc \"SELECT count(*) FROM pg_stat_activity WHERE datid IS NOT NULL\"); printf \"%s|%s|%s|%s\\n\" \"\$max\" \"\$superuser\" \"\$reserved\" \"\$current\"')
    old_ifs=\$IFS
    IFS='|'
    set -- \$capacity
    IFS=\$old_ifs
    test \"\$#\" = 4
    max_connections=\$1
    superuser_reserved=\$2
    reserved_connections=\$3
    current_connections=\$4
    for value in \"\$max_connections\" \"\$superuser_reserved\" \"\$reserved_connections\" \"\$current_connections\"; do
      test \"\$value\" -ge 0 2>/dev/null
    done

    managed_connections=0
    managed_containers='[]'
    for container in \$(docker ps -q --filter label=com.zutomayo.pg-pool-budget); do
      slot=\$(docker inspect \"\$container\" --format '{{ index .Config.Labels \"com.zutomayo.release-slot\" }}')
      budget=\$(docker inspect \"\$container\" --format '{{ index .Config.Labels \"com.zutomayo.pg-pool-budget\" }}')
      service=\$(docker inspect \"\$container\" --format '{{ index .Config.Labels \"com.docker.compose.service\" }}')
      name=\$(docker inspect \"\$container\" --format '{{.Name}}')
      name=\${name#/}
      test \"\$budget\" -ge 0 2>/dev/null
      if test \"\$slot\" != '$target_slot'; then
        managed_connections=\$((managed_connections + budget))
        item=\$(jq -cn --arg name \"\$name\" --arg slot \"\$slot\" --arg service \"\$service\" --argjson budget \"\$budget\" '{name:\$name,slot:\$slot,service:\$service,budget:\$budget}')
        managed_containers=\$(jq -cn --argjson current \"\$managed_containers\" --argjson item \"\$item\" '\$current + [\$item]')
      fi
    done

    legacy_connections=0
    legacy_services='[]'
    if docker ps -q --filter label=com.docker.compose.project=zutomayo-card-online --filter label=com.docker.compose.service=game | grep -q .; then
      legacy_connections=\$((legacy_connections + $LEGACY_GAME_PG_POOL_BUDGET))
      legacy_services=\$(jq -cn --argjson current \"\$legacy_services\" --arg service game --argjson budget '$LEGACY_GAME_PG_POOL_BUDGET' '\$current + [{service:\$service,budget:\$budget}]')
    fi
    if docker ps -q --filter label=com.docker.compose.project=zutomayo-card-online --filter label=com.docker.compose.service=api | grep -q .; then
      legacy_connections=\$((legacy_connections + $LEGACY_API_PG_POOL_BUDGET))
      legacy_services=\$(jq -cn --argjson current \"\$legacy_services\" --arg service api --argjson budget '$LEGACY_API_PG_POOL_BUDGET' '\$current + [{service:\$service,budget:\$budget}]')
    fi

    jq -cn \
      --arg checkedAt \"\$(date -u +%Y-%m-%dT%H:%M:%SZ)\" \
      --arg sourceHost \"\$(hostname)\" \
      --arg targetSlot '$target_slot' \
      --argjson maxConnections \"\$max_connections\" \
      --argjson superuserReservedConnections \"\$superuser_reserved\" \
      --argjson reservedConnections \"\$reserved_connections\" \
      --argjson currentClientConnections \"\$current_connections\" \
      --argjson existingManagedConnections \"\$managed_connections\" \
      --argjson legacyConnections \"\$legacy_connections\" \
      --argjson managedContainers \"\$managed_containers\" \
      --argjson legacyServices \"\$legacy_services\" \
      '{schemaVersion:1,checkedAt:\$checkedAt,sourceHost:\$sourceHost,targetSlot:\$targetSlot,postgres:{maxConnections:\$maxConnections,superuserReservedConnections:\$superuserReservedConnections,reservedConnections:\$reservedConnections,currentClientConnections:\$currentClientConnections},reservations:{existingManagedConnections:\$existingManagedConnections,legacyConnections:\$legacyConnections},managedContainers:\$managedContainers,legacyServices:\$legacyServices}'"
}

evaluate_pg_budget() {
  local target_slot="$1" persist="${2:-false}" planned_connections="${3:-$PG_SLOT_WEB_CONNECTION_BUDGET}" snapshot artifact_file status remote_name remote_incoming temp_dir
  validate_slot "$target_slot"
  [[ "$planned_connections" =~ ^[0-9]+$ ]] || die 'planned PostgreSQL connections must be a non-negative integer'
  snapshot="$(collect_pg_budget_snapshot "$target_slot")"
  temp_dir="$(mktemp -d)"
  artifact_file="$temp_dir/pg-budget.json"
  trap 'rm -rf "$temp_dir"' EXIT RETURN
  if printf '%s\n' "$snapshot" | node "$SCRIPT_DIR/check-server4-pg-budget.mjs" \
    --input - \
    --output "$artifact_file" \
    --planned-slot-connections "$planned_connections" \
    --transient-connections "$PG_STAGE_TRANSIENT_BUDGET" \
    --minimum-headroom-connections "$PG_MINIMUM_HEADROOM"; then
    status=0
  else
    status=$?
  fi
  if [[ "$persist" == true ]]; then
    remote_name="pg-budget-$target_slot-$(date -u +%Y%m%dT%H%M%SZ)-$planned_connections-$$-$RANDOM.json"
    remote_incoming="$REMOTE_DIR/.pg-budget.$target_slot.$$.$RANDOM.incoming.json"
    scp_to "$artifact_file" "$remote_incoming"
    ssh_run "set -euo pipefail
      exec 9>'$REMOTE_LOCK_FILE'
      flock -n 9 || { echo 'another parallel deployment mutation is already running' >&2; exit 1; }
      cd '$REMOTE_DIR'
      trap \"rm -f -- '$remote_incoming'\" EXIT
      test -e '$MANAGED_MARKER'
      install -m 0644 '$remote_incoming' 'evidence/$remote_name'"
  fi
  [[ "$status" == 0 ]] || die "PostgreSQL connection budget blocks staging $target_slot"
  trap - EXIT RETURN
}

remote_preflight() {
  ssh_run "set -euo pipefail
    command -v docker >/dev/null
    command -v jq >/dev/null
    command -v openssl >/dev/null
    command -v flock >/dev/null
    command -v sha256sum >/dev/null
    command -v systemctl >/dev/null
    getent group '$RETENTION_SERVICE_GROUP' >/dev/null
    test -f /etc/systemd/system/zutomayo-retention.service
    systemctl is-enabled zutomayo-retention.timer >/dev/null
    docker compose version >/dev/null
    test -d '$LEGACY_DIR'
    test -f '$LEGACY_DIR/.env'
    docker network inspect 1panel-network >/dev/null
    if test -e '$REMOTE_DIR' && test ! -e '$REMOTE_DIR/$MANAGED_MARKER'; then
      echo 'runtime directory exists without the repository ownership marker' >&2
      exit 1
    fi
    legacy_api=\$(docker ps -q --filter label=com.docker.compose.project=zutomayo-card-online --filter label=com.docker.compose.service=api | head -n 1 || true)
    if test -n \"\$legacy_api\"; then
      docker inspect \"\$legacy_api\" --format '{{json .Mounts}}' \
        | jq -c 'map(select(.Destination == \"/app/data/feedback-uploads\"))[0] // {type:\"none\",name:\"\",source:\"\",destination:\"/app/data/feedback-uploads\"}'
    else
      echo '{\"legacyApi\":\"not-running\"}'
    fi
    docker ps --format '{{.Names}} {{.Image}} {{.Status}}' | sort"
  evaluate_pg_budget blue false "$PG_SLOT_WEB_CONNECTION_BUDGET"
}

install_control_plane() {
  require_confirm
  local incoming="$REMOTE_DIR/.incoming.$(date -u +%Y%m%dT%H%M%SZ).$$.$RANDOM"
  cleanup_control_plane_incoming() {
    ssh_run "if test -e '$REMOTE_DIR/$MANAGED_MARKER'; then rm -rf -- '$incoming'; fi" >/dev/null 2>&1 || true
  }
  trap cleanup_control_plane_incoming EXIT RETURN
  ssh_run "set -euo pipefail
    exec 9>'$REMOTE_LOCK_FILE'
    flock -n 9 || { echo 'another parallel deployment mutation is already running' >&2; exit 1; }
    if test -e '$REMOTE_DIR' && test ! -e '$REMOTE_DIR/$MANAGED_MARKER'; then
      echo 'refusing to claim an unmarked runtime directory' >&2
      exit 1
    fi
    install -d -m 0750 '$REMOTE_DIR' '$REMOTE_DIR/scripts' '$REMOTE_DIR/evidence'
    chgrp '$RETENTION_SERVICE_GROUP' '$REMOTE_DIR'
    chmod 0750 '$REMOTE_DIR'
    : > '$REMOTE_DIR/$MANAGED_MARKER'
    chmod 0640 '$REMOTE_DIR/$MANAGED_MARKER'
    if test ! -f '$REMOTE_DIR/.env'; then
      if test '$COPY_LEGACY_ENV' = true; then install -m 0600 '$LEGACY_DIR/.env' '$REMOTE_DIR/.env'
      else echo 'runtime .env is missing; use --copy-legacy-env for the one-time bootstrap' >&2; exit 1
      fi
    fi
    env_file='$REMOTE_DIR/.env'
    append_env() {
      key=\$1
      value=\$2
      count=\$(grep -Ec \"^\${key}=\" \"\$env_file\" || true)
      test \"\$count\" -le 1 || { echo \"runtime .env contains duplicate \${key}\" >&2; exit 1; }
      if test \"\$count\" = 0; then printf '%s=%s\\n' \"\$key\" \"\$value\" >> \"\$env_file\"; fi
    }
    random_hex() { openssl rand -hex 32; }

    legacy_api=\$(docker ps -q --filter label=com.docker.compose.project=zutomayo-card-online --filter label=com.docker.compose.service=api | head -n 1 || true)
    public_base=\$(sed -n 's/^PUBLIC_BASE_URL=//p' \"\$env_file\")
    if test -z \"\$public_base\"; then public_base=\$(sed -n 's/^OAUTH_PUBLIC_BASE_URL=//p' \"\$env_file\"); fi
    if test -z \"\$public_base\" && test -n \"\$legacy_api\"; then
      public_base=\$(docker inspect \"\$legacy_api\" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^OAUTH_PUBLIC_BASE_URL=//p')
    fi
    case \"\$public_base\" in https://*) ;; *) echo 'cannot derive PUBLIC_HOST from an HTTPS OAUTH_PUBLIC_BASE_URL' >&2; exit 1 ;; esac
    public_host=\${public_base#https://}
    public_host=\${public_host%%/*}
    echo \"\$public_host\" | grep -Eq '^[A-Za-z0-9.-]+(:[0-9]{1,5})?\$' || { echo 'derived PUBLIC_HOST is invalid' >&2; exit 1; }
    append_env PUBLIC_BASE_URL \"\$public_base\"
    append_env PUBLIC_HOST \"\$public_host\"

    redis_ref=\$(docker inspect redis --format '{{.Config.Image}}')
    redis_digest=\$(docker image inspect \"\$redis_ref\" --format '{{index .RepoDigests 0}}')
    echo \"\$redis_digest\" | grep -Eq '^([a-z0-9._/-]+/)?redis@sha256:[a-f0-9]{64}\$' || { echo 'running Redis image has no immutable RepoDigest' >&2; exit 1; }
    append_env COLYSEUS_REDIS_IMAGE \"\$redis_digest\"
    append_env COLYSEUS_REDIS_PASSWORD \"\$(random_hex)\"
    append_env FEEDBACK_UPLOADS_VOLUME '$FEEDBACK_UPLOADS_VOLUME_DEFAULT'
    append_env GATEWAY_EDGE_NETWORK '$EDGE_NETWORK'
    append_env METRICS_TOKEN \"\$(random_hex)\"
    append_env ADMIN_TOTP_ENCRYPTION_KEY \"\$(random_hex)\"
    append_env OAUTH_TOKEN_ENCRYPTION_KEY \"\$(random_hex)\"
    append_env PLATFORM_SEAT_TOKEN_SECRET \"\$(random_hex)\"
    append_env ACCOUNT_EXPORT_PSEUDONYM_KEY \"\$(random_hex)\"
    chmod 0600 \"\$env_file\"

    feedback_volume=\$(sed -n 's/^FEEDBACK_UPLOADS_VOLUME=//p' \"\$env_file\")
    echo \"\$feedback_volume\" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}\$' || { echo 'FEEDBACK_UPLOADS_VOLUME is invalid' >&2; exit 1; }
    docker volume inspect \"\$feedback_volume\" >/dev/null 2>&1 || docker volume create \"\$feedback_volume\" >/dev/null
    configured_edge_network=\$(sed -n 's/^GATEWAY_EDGE_NETWORK=//p' \"\$env_file\")
    test \"\$configured_edge_network\" = '$EDGE_NETWORK' || { echo \"GATEWAY_EDGE_NETWORK must remain $EDGE_NETWORK, found \$configured_edge_network\" >&2; exit 1; }
    docker network inspect \"\$configured_edge_network\" >/dev/null 2>&1 || docker network create --driver bridge \"\$configured_edge_network\" >/dev/null
    install -d -m 0750 '$incoming'"
  scp_to "$PROJECT_DIR/$SLOT_COMPOSE_FILE" "$incoming/$SLOT_COMPOSE_FILE"
  scp_to "$PROJECT_DIR/$GATEWAY_COMPOSE_FILE" "$incoming/$GATEWAY_COMPOSE_FILE"
  scp_to "$PROJECT_DIR/$RETENTION_COMPOSE_FILE" "$incoming/$RETENTION_COMPOSE_FILE"
  scp_to "$PROJECT_DIR/$ROLE_TLS_SMOKE_COMPOSE_FILE" "$incoming/$ROLE_TLS_SMOKE_COMPOSE_FILE"
  scp_to "$PROJECT_DIR/$POSTGRES_OPS_COMPOSE_FILE" "$incoming/$POSTGRES_OPS_COMPOSE_FILE"
  scp_to "$PROJECT_DIR/scripts/project-compose-role-env.jq" "$incoming/project-compose-role-env.jq"
  scp_to "$PROJECT_DIR/scripts/verify-compose-role-env.mjs" "$incoming/verify-compose-role-env.mjs"
  scp_to "$PROJECT_DIR/scripts/collect-server4-canary-metrics.mjs" "$incoming/collect-server4-canary-metrics.mjs"
  scp_to "$PROJECT_DIR/scripts/verify-server4-active-canary.sh" "$incoming/verify-server4-active-canary.sh"
  ssh_run "set -euo pipefail
    exec 9>'$REMOTE_LOCK_FILE'
    flock -n 9 || { echo 'another parallel deployment mutation is already running' >&2; exit 1; }
    test -e '$REMOTE_DIR/$MANAGED_MARKER'
    install -m 0644 '$incoming/$SLOT_COMPOSE_FILE' '$REMOTE_DIR/$SLOT_COMPOSE_FILE'
    install -m 0644 '$incoming/$GATEWAY_COMPOSE_FILE' '$REMOTE_DIR/$GATEWAY_COMPOSE_FILE'
    install -m 0644 '$incoming/$RETENTION_COMPOSE_FILE' '$REMOTE_DIR/$RETENTION_COMPOSE_FILE'
    install -m 0644 '$incoming/$ROLE_TLS_SMOKE_COMPOSE_FILE' '$REMOTE_DIR/$ROLE_TLS_SMOKE_COMPOSE_FILE'
    install -m 0644 '$incoming/$POSTGRES_OPS_COMPOSE_FILE' '$REMOTE_DIR/$POSTGRES_OPS_COMPOSE_FILE'
    install -m 0644 '$incoming/project-compose-role-env.jq' '$REMOTE_DIR/scripts/project-compose-role-env.jq'
    install -m 0644 '$incoming/verify-compose-role-env.mjs' '$REMOTE_DIR/scripts/verify-compose-role-env.mjs'
    install -m 0644 '$incoming/collect-server4-canary-metrics.mjs' '$REMOTE_DIR/scripts/collect-server4-canary-metrics.mjs'
    install -m 0755 '$incoming/verify-server4-active-canary.sh' '$REMOTE_DIR/scripts/verify-server4-active-canary.sh'
    rmdir '$incoming'
    for key in PUBLIC_BASE_URL PUBLIC_HOST COLYSEUS_REDIS_IMAGE COLYSEUS_REDIS_PASSWORD FEEDBACK_UPLOADS_VOLUME GATEWAY_EDGE_NETWORK METRICS_TOKEN ADMIN_TOTP_ENCRYPTION_KEY OAUTH_TOKEN_ENCRYPTION_KEY PLATFORM_SEAT_TOKEN_SECRET ACCOUNT_EXPORT_PSEUDONYM_KEY PG_WAL_OPERATOR_USER PG_WAL_OPERATOR_DATABASE PG_WAL_OPERATOR_PGPASS_FILE PG_WAL_AGE_IDENTITY_FILE PG_WAL_S3_CREDENTIALS_FILE PG_WAL_OFFSITE_URI PG_WAL_S3_REGION POSTGRES_OPS_SECRETS_GID; do
      grep -Eq \"^\${key}=.+\" '$REMOTE_DIR/.env' || { echo \"runtime .env is missing \${key}\" >&2; exit 1; }
    done
    docker volume inspect \"\$(sed -n 's/^FEEDBACK_UPLOADS_VOLUME=//p' '$REMOTE_DIR/.env')\" >/dev/null
    configured_edge_network=\$(sed -n 's/^GATEWAY_EDGE_NETWORK=//p' '$REMOTE_DIR/.env')
    test \"\$configured_edge_network\" = '$EDGE_NETWORK'
    docker network inspect \"\$configured_edge_network\" >/dev/null
    echo 'parallel control plane installed'"
  trap - EXIT RETURN
}

stage_slot() {
  require_confirm
  validate_slot "$SLOT"
  [[ -n "$MANIFEST_FILE" ]] || die 'stage-slot requires --manifest'
  validate_manifest "$MANIFEST_FILE" false
  verify_manifest_artifacts
  if [[ "$WITH_WORKERS" == true ]]; then
    evaluate_pg_budget "$SLOT" true "$PG_SLOT_CONNECTION_BUDGET"
  else
    evaluate_pg_budget "$SLOT" true "$PG_SLOT_WEB_CONNECTION_BUDGET"
  fi
  local remote_manifest="$REMOTE_DIR/.release.$SLOT.env"
  local remote_incoming="$REMOTE_DIR/.release.$SLOT.$(date -u +%Y%m%dT%H%M%SZ).$$.$RANDOM.incoming.env"
  scp_to "$MANIFEST_FILE" "$remote_incoming"
  ssh_run "set -euo pipefail
    exec 9>'$REMOTE_LOCK_FILE'
    flock -n 9 || { echo 'another parallel deployment mutation is already running' >&2; exit 1; }
    cd '$REMOTE_DIR'
    trap \"rm -f -- '$remote_incoming'\" EXIT
    test -e '$MANAGED_MARKER'
    test -f .env

    gateway_ids=\$(docker ps -q \
      --filter label=com.docker.compose.project=zutomayo-release-gateway \
      --filter label=com.docker.compose.service=gateway)
    gateway_count=\$(printf '%s\\n' \"\$gateway_ids\" | sed '/^\$/d' | wc -l | tr -d ' ')
    test \"\$gateway_count\" -le 1 || { echo 'multiple release gateway containers are running' >&2; exit 1; }
    if test \"\$gateway_count\" = 1 && test ! -f '$GATEWAY_ACTIVE_STATE'; then
      echo 'running gateway has no canonical active-state artifact' >&2
      exit 1
    fi
    if test -f '$GATEWAY_ACTIVE_STATE'; then
      jq -e '.schemaVersion == 1 and (.deploymentMode == \"bootstrap\" or .deploymentMode == \"canary\") and (.gateway.stableSlot == \"blue\" or .gateway.stableSlot == \"green\") and (.gateway.candidateSlot == \"blue\" or .gateway.candidateSlot == \"green\")' '$GATEWAY_ACTIVE_STATE' >/dev/null
      if test \"\$gateway_count\" = 1; then
        runtime_marker=\$(docker exec \"\$gateway_ids\" wget -qO- http://127.0.0.1:8404/config 2>/dev/null || true)
        state_marker=\$(jq -r '.gateway.activeConfigId // empty' '$GATEWAY_ACTIVE_STATE')
        test -n \"\$runtime_marker\" && test \"\$runtime_marker\" = \"\$state_marker\" || {
          echo 'gateway runtime marker does not match the canonical active-state artifact' >&2
          exit 1
        }
      fi
      active_mode=\$(jq -r '.deploymentMode' '$GATEWAY_ACTIVE_STATE')
      active_stable=\$(jq -r '.gateway.stableSlot' '$GATEWAY_ACTIVE_STATE')
      active_candidate=\$(jq -r '.gateway.candidateSlot' '$GATEWAY_ACTIVE_STATE')
      if test \"\$active_mode\" = bootstrap && test '$SLOT' = \"\$active_stable\"; then
        echo 'refusing to stage the bootstrap gateway active slot: $SLOT' >&2
        exit 1
      fi
      if test \"\$active_mode\" = canary && { test '$SLOT' = \"\$active_stable\" || test '$SLOT' = \"\$active_candidate\"; }; then
        echo 'refusing to overwrite a slot referenced by the active canary; first return the promoted stable release to bootstrap mode' >&2
        exit 1
      fi
    fi

    release_manifest='$remote_incoming'
    manifest_value() {
      key=\$1
      count=\$(grep -Ec \"^\${key}=\" \"\$release_manifest\" || true)
      test \"\$count\" = 1 || { echo \"release manifest must contain exactly one \${key}\" >&2; exit 1; }
      sed -n \"s/^\${key}=//p\" \"\$release_manifest\"
    }
    expected_release_sha=\$(manifest_value RELEASE_SHA)
    expected_game_image=\$(manifest_value GAME_IMAGE)
    expected_api_image=\$(manifest_value API_IMAGE)
    expected_platform_image=\$(manifest_value PLATFORM_IMAGE)
    expected_retention_image=\$(manifest_value RETENTION_IMAGE)
    expected_ops_image=\$(manifest_value OPS_IMAGE)
    SLOT='$SLOT'
    PROJECT='zutomayo-$SLOT'
    role_tls_smoke_compose() { docker compose --env-file .env --env-file \"\$release_manifest\" -p \"\$PROJECT-role-tls\" -f '$ROLE_TLS_SMOKE_COMPOSE_FILE' --profile postgres-role-tls-smoke \"\$@\"; }
    postgres_ops_compose() { docker compose --env-file .env --env-file \"\$release_manifest\" -p \"\$PROJECT-postgres-ops\" -f '$POSTGRES_OPS_COMPOSE_FILE' --profile postgres-ops \"\$@\"; }
    compose() { RELEASE_SLOT=\"\$SLOT\" COMPOSE_PROJECT_NAME=\"\$PROJECT\" docker compose --env-file .env --env-file \"\$release_manifest\" -p \"\$PROJECT\" -f '$SLOT_COMPOSE_FILE' \"\$@\"; }
    assert_runtime_service() {
      service=\$1
      expected_count=\$2
      expected_image=\$3
      ids=\$(docker ps -q \
        --filter \"label=com.docker.compose.project=\$PROJECT\" \
        --filter \"label=com.docker.compose.service=\$service\")
      actual_count=\$(printf '%s\\n' \"\$ids\" | sed '/^\$/d' | wc -l | tr -d ' ')
      test \"\$actual_count\" = \"\$expected_count\" || { echo \"\$service expected \$expected_count running containers, found \$actual_count\" >&2; exit 1; }
      for id in \$ids; do
        actual_image=\$(docker inspect \"\$id\" --format '{{.Config.Image}}')
        test \"\$actual_image\" = \"\$expected_image\" || { echo \"\$service image mismatch: \$actual_image\" >&2; exit 1; }
        actual_build=\$(docker inspect \"\$id\" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^APP_BUILD_ID=//p')
        test \"\$actual_build\" = \"\$expected_release_sha\" || { echo \"\$service APP_BUILD_ID mismatch: \$actual_build\" >&2; exit 1; }
        actual_slot=\$(docker inspect \"\$id\" --format '{{ index .Config.Labels \"com.zutomayo.release-slot\" }}')
        test \"\$actual_slot\" = \"\$SLOT\" || { echo \"\$service release-slot label mismatch: \$actual_slot\" >&2; exit 1; }
        health=\$(docker inspect \"\$id\" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}')
        test \"\$health\" = healthy || { echo \"\$service container is not healthy\" >&2; exit 1; }
      done
    }
    compose --profile background-workers config --no-env-resolution --quiet
    PG_DEPLOY_GATE_HOST=\$(compose config --format json | jq -er '.services.migrate.environment.PG_HOST | select(type == \"string\" and length > 0)')
    PG_DEPLOY_GATE_PORT=\$(compose config --format json | jq -er '.services.migrate.environment.PG_PORT | tostring | select(test(\"^[0-9]+$\"))')
    test \"\$PG_DEPLOY_GATE_PORT\" -ge 1 && test \"\$PG_DEPLOY_GATE_PORT\" -le 65535
    export PG_DEPLOY_GATE_HOST PG_DEPLOY_GATE_PORT
    role_tls_smoke_compose config --quiet
    postgres_ops_compose config --quiet
    compose --profile background-workers pull --quiet
    docker pull \"\$expected_retention_image\" >/dev/null
    docker image inspect \"\$expected_retention_image\" >/dev/null
    docker pull \"\$expected_ops_image\" >/dev/null
    docker image inspect \"\$expected_ops_image\" >/dev/null
    compose --profile background-workers config --no-env-resolution --format json \
      | jq -c -f scripts/project-compose-role-env.jq \
      | compose run --rm --no-deps -T migrate node scripts/verify-compose-role-env.mjs --require-pgsslmode=verify-full --require-rediss
    compose run --rm --no-deps migrate
    role_tls_evidence='.slot.$SLOT.role-tls.next.'\$\$
    : > \"\$role_tls_evidence\"
    for role in api game platform retention monitor backup; do
      report=\$(role_tls_smoke_compose run --rm --no-deps -T \"postgres-role-tls-\$role\")
      printf '%s\n' \"\$report\" | jq -e --arg role \"\$role\" '.schemaVersion == 1 and .artifactType == \"zutomayo-postgres-role-tls-smoke\" and .ok == true and .role == \$role' >/dev/null
      printf '%s\n' \"\$report\" >> \"\$role_tls_evidence\"
      printf '%s\n' \"\$report\"
    done
    mv -f \"\$role_tls_evidence\" '.slot.$SLOT.role-tls.jsonl'
    wal_report=\$(postgres_ops_compose run --rm --no-deps -T postgres-wal-operational-smoke)
    wal_evidence=\$(printf '%s\n' \"\$wal_report\" | jq -ce --arg releaseSha \"\$expected_release_sha\" --arg opsImage \"\$expected_ops_image\" 'select(.schemaVersion == 1 and .artifactType == \"zutomayo-pg-wal-operational-smoke\" and .ok == true) | . + {releaseSha:\$releaseSha,opsImage:\$opsImage}')
    printf '%s\n' \"\$wal_evidence\" > '.slot.$SLOT.wal-operational-smoke.json'
    printf '%s\n' \"\$wal_evidence\"
    compose up -d --no-deps --wait --wait-timeout 120 colyseus-redis
    compose up -d --no-deps --wait --wait-timeout 180 game api platform-p1 platform-p2
    assert_runtime_service game 2 \"\$expected_game_image\"
    assert_runtime_service api 2 \"\$expected_api_image\"
    assert_runtime_service platform-p1 1 \"\$expected_platform_image\"
    assert_runtime_service platform-p2 1 \"\$expected_platform_image\"
    manifest_sha=\$(sha256sum \"\$release_manifest\" | awk '{print \$1}')
    state_next='.slot.$SLOT.state.next.'\$\$
    jq -n \
      --arg slot \"\$SLOT\" \
      --arg releaseSha \"\$expected_release_sha\" \
      --arg manifestSha256 \"\$manifest_sha\" \
      --arg gameImage \"\$expected_game_image\" \
      --arg apiImage \"\$expected_api_image\" \
      --arg platformImage \"\$expected_platform_image\" \
      --arg retentionImage \"\$expected_retention_image\" \
      --arg opsImage \"\$expected_ops_image\" \
      --arg verifiedAt \"\$(date -u +%Y-%m-%dT%H:%M:%SZ)\" \
      '{schemaVersion:1,manifestFormat:"current-seven",slot:\$slot,releaseSha:\$releaseSha,manifestSha256:\$manifestSha256,images:{game:\$gameImage,api:\$apiImage,platform:\$platformImage,retention:\$retentionImage,ops:\$opsImage},verifiedAt:\$verifiedAt}' > \"\$state_next\"
    manifest_next='$remote_manifest.next.'\$\$
    install -m 0640 \"\$release_manifest\" \"\$manifest_next\"
    mv -f \"\$manifest_next\" '$remote_manifest'
    mv -f \"\$state_next\" '.slot.$SLOT.state.json'
    date -u +%Y-%m-%dT%H:%M:%SZ > '.slot.$SLOT.staged-at'
    compose ps"
  if [[ "$WITH_WORKERS" == true ]]; then
    start_workers "$SLOT"
  fi
}

render_and_apply_gateway() {
  require_confirm
  local mode="$1" temp_dir config_file artifact_file remote_prefix active_config_id gateway_image stable_gateway_image
  local stable_manifest_sha256 candidate_manifest_sha256 remote_config_incoming remote_artifact_incoming
  local stable_manifest_format
  temp_dir="$(mktemp -d)"
  config_file="$temp_dir/haproxy.cfg"
  artifact_file="$temp_dir/gateway-config.json"
  trap 'rm -rf "$temp_dir"' EXIT RETURN

  if [[ "$mode" == bootstrap ]]; then
    validate_slot "$STABLE_SLOT"
    [[ -n "$MANIFEST_FILE" ]] || die 'bootstrap-gateway requires --manifest'
    validate_manifest "$MANIFEST_FILE" false
    verify_manifest_artifacts
    stable_manifest_format="$MANIFEST_FORMAT"
    gateway_image="$GATEWAY_IMAGE"
    stable_manifest_sha256="$(sha256_file "$MANIFEST_FILE")"
    node "$SCRIPT_DIR/render-server4-gateway.mjs" --bootstrap-manifest "$MANIFEST_FILE" \
      --stable-slot "$STABLE_SLOT" --config-out "$config_file" --artifact-out "$artifact_file"
  else
    validate_slot "$STABLE_SLOT"
    validate_slot "$CANDIDATE_SLOT"
    [[ "$STABLE_SLOT" != "$CANDIDATE_SLOT" ]] || die 'stable and candidate slots must differ'
    [[ "$WEIGHT" == 0 || "$WEIGHT" == 10 || "$WEIGHT" == 50 || "$WEIGHT" == 100 ]] || die 'weight must be 0, 10, 50, or 100'
    [[ -n "$STABLE_MANIFEST_FILE" && -n "$CANDIDATE_MANIFEST_FILE" ]] || {
      die 'switch requires --stable-manifest and --candidate-manifest'
    }
    validate_manifest "$STABLE_MANIFEST_FILE" true
    verify_manifest_artifacts
    stable_manifest_format="$MANIFEST_FORMAT"
    stable_gateway_image="$GATEWAY_IMAGE"
    stable_manifest_sha256="$(sha256_file "$STABLE_MANIFEST_FILE")"
    validate_manifest "$CANDIDATE_MANIFEST_FILE" false
    verify_manifest_artifacts
    [[ "$MANIFEST_FORMAT" == current-seven ]] || die 'candidate manifest must use the current seven-image format'
    candidate_manifest_sha256="$(sha256_file "$CANDIDATE_MANIFEST_FILE")"
    gateway_image="$stable_gateway_image"
    node "$SCRIPT_DIR/render-server4-gateway.mjs" --stable-manifest "$STABLE_MANIFEST_FILE" \
      --candidate-manifest "$CANDIDATE_MANIFEST_FILE" --stable-slot "$STABLE_SLOT" \
      --candidate-slot "$CANDIDATE_SLOT" --weight "$WEIGHT" --config-out "$config_file" --artifact-out "$artifact_file"
  fi

  remote_prefix="gateway-$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1])).candidateReleaseSha.slice(0,12)" "$artifact_file")-$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1])).traffic.candidateWeightPercent" "$artifact_file")-$(date -u +%Y%m%dT%H%M%SZ)-$$-$RANDOM"
  active_config_id="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1])).gateway.activeConfigId" "$artifact_file")"
  [[ "$active_config_id" =~ ^(bootstrap|canary)-[a-f0-9]{12}-(0|10|50|100)-(blue|green)-(blue|green)$ ]] || {
    die 'rendered gateway active config id is invalid'
  }
  remote_config_incoming="$REMOTE_DIR/.haproxy.$(date -u +%Y%m%dT%H%M%SZ).$$.$RANDOM.incoming.cfg"
  remote_artifact_incoming="$REMOTE_DIR/.gateway-config.$(date -u +%Y%m%dT%H%M%SZ).$$.$RANDOM.incoming.json"
  scp_to "$config_file" "$remote_config_incoming"
  scp_to "$artifact_file" "$remote_artifact_incoming"
  ssh_run "set -euo pipefail
    exec 9>'$REMOTE_LOCK_FILE'
    flock -n 9 || { echo 'another parallel deployment mutation is already running' >&2; exit 1; }
    cd '$REMOTE_DIR'
    trap \"rm -f -- '$remote_config_incoming' '$remote_artifact_incoming'\" EXIT
    test -e '$MANAGED_MARKER'
    test -f .env
    rollback_started_at=''
    if test '$mode' = canary && test '$WEIGHT' = 0; then
      rollback_started_at=\$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
    fi

    manifest_value() {
      manifest=\$1
      key=\$2
      count=\$(grep -Ec \"^\${key}=\" \"\$manifest\" || true)
      test \"\$count\" = 1 || { echo \"\$manifest must contain exactly one \${key}\" >&2; exit 1; }
      sed -n \"s/^\${key}=//p\" \"\$manifest\"
    }
    assert_service_runtime() {
      slot=\$1
      service=\$2
      expected_count=\$3
      expected_image=\$4
      expected_build=\$5
      require_runtime=\$6
      project=\"zutomayo-\$slot\"
      if test \"\$require_runtime\" = true; then
        ids=\$(docker ps -q \
          --filter \"label=com.docker.compose.project=\$project\" \
          --filter \"label=com.docker.compose.service=\$service\")
      else
        ids=\$(docker ps -aq \
          --filter \"label=com.docker.compose.project=\$project\" \
          --filter \"label=com.docker.compose.service=\$service\")
      fi
      actual_count=\$(printf '%s\\n' \"\$ids\" | sed '/^\$/d' | wc -l | tr -d ' ')
      if test \"\$require_runtime\" = true; then
        test \"\$actual_count\" = \"\$expected_count\" || { echo \"\$slot/\$service expected \$expected_count running containers, found \$actual_count\" >&2; exit 1; }
      fi
      for id in \$ids; do
        actual_image=\$(docker inspect \"\$id\" --format '{{.Config.Image}}')
        test \"\$actual_image\" = \"\$expected_image\" || { echo \"\$slot/\$service image mismatch: \$actual_image\" >&2; exit 1; }
        actual_build=\$(docker inspect \"\$id\" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^APP_BUILD_ID=//p')
        test \"\$actual_build\" = \"\$expected_build\" || { echo \"\$slot/\$service APP_BUILD_ID mismatch: \$actual_build\" >&2; exit 1; }
        actual_slot=\$(docker inspect \"\$id\" --format '{{ index .Config.Labels \"com.zutomayo.release-slot\" }}')
        test \"\$actual_slot\" = \"\$slot\" || { echo \"\$slot/\$service release-slot label mismatch: \$actual_slot\" >&2; exit 1; }
        if test \"\$require_runtime\" = true; then
          health=\$(docker inspect \"\$id\" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}')
          test \"\$health\" = healthy || { echo \"\$slot/\$service container is not healthy\" >&2; exit 1; }
        fi
      done
    }
    assert_slot_release() {
      slot=\$1
      expected_manifest_sha=\$2
      require_runtime=\$3
      manifest_format=\$4
      manifest_file=\".release.\$slot.env\"
      state_file=\".slot.\$slot.state.json\"
      test -f \"\$manifest_file\" || { echo \"slot \$slot has no active release manifest\" >&2; exit 1; }
      test -f \"\$state_file\" || { echo \"slot \$slot has no verified runtime state\" >&2; exit 1; }
      actual_manifest_sha=\$(sha256sum \"\$manifest_file\" | awk '{print \$1}')
      test \"\$actual_manifest_sha\" = \"\$expected_manifest_sha\" || { echo \"slot \$slot remote manifest does not match the supplied verified manifest\" >&2; exit 1; }
      release_sha=\$(manifest_value \"\$manifest_file\" RELEASE_SHA)
      game_image=\$(manifest_value \"\$manifest_file\" GAME_IMAGE)
      api_image=\$(manifest_value \"\$manifest_file\" API_IMAGE)
      platform_image=\$(manifest_value \"\$manifest_file\" PLATFORM_IMAGE)
      retention_image=\$(manifest_value \"\$manifest_file\" RETENTION_IMAGE)
      if test \"\$manifest_format\" = current-seven; then
        ops_image=\$(manifest_value \"\$manifest_file\" OPS_IMAGE)
        jq -e \
          --arg slot \"\$slot\" \
          --arg releaseSha \"\$release_sha\" \
          --arg manifestSha256 \"\$actual_manifest_sha\" \
          --arg gameImage \"\$game_image\" \
          --arg apiImage \"\$api_image\" \
          --arg platformImage \"\$platform_image\" \
          --arg retentionImage \"\$retention_image\" \
          --arg opsImage \"\$ops_image\" \
          '.schemaVersion == 1 and .manifestFormat == \"current-seven\" and .slot == \$slot and .releaseSha == \$releaseSha and .manifestSha256 == \$manifestSha256 and .images.game == \$gameImage and .images.api == \$apiImage and .images.platform == \$platformImage and .images.retention == \$retentionImage and .images.ops == \$opsImage' \
          \"\$state_file\" >/dev/null
        docker image inspect \"\$ops_image\" >/dev/null || { echo \"slot \$slot OPS image is not present locally\" >&2; exit 1; }
      elif test \"\$manifest_format\" = legacy-six; then
        test \"\$(grep -Ec '^OPS_IMAGE=' \"\$manifest_file\" || true)\" = 0 || { echo \"legacy slot \$slot must not contain OPS_IMAGE\" >&2; exit 1; }
        jq -e \
          --arg slot \"\$slot\" \
          --arg releaseSha \"\$release_sha\" \
          --arg manifestSha256 \"\$actual_manifest_sha\" \
          --arg gameImage \"\$game_image\" \
          --arg apiImage \"\$api_image\" \
          --arg platformImage \"\$platform_image\" \
          --arg retentionImage \"\$retention_image\" \
          '.schemaVersion == 1 and (.manifestFormat == null or .manifestFormat == \"legacy-six\") and .slot == \$slot and .releaseSha == \$releaseSha and .manifestSha256 == \$manifestSha256 and .images.game == \$gameImage and .images.api == \$apiImage and .images.platform == \$platformImage and .images.retention == \$retentionImage and (.images | has(\"ops\") | not)' \
          \"\$state_file\" >/dev/null
      else
        echo \"slot \$slot manifest format is invalid\" >&2
        exit 1
      fi
      docker image inspect \"\$retention_image\" >/dev/null || { echo \"slot \$slot retention image is not present locally\" >&2; exit 1; }
      assert_service_runtime \"\$slot\" game 2 \"\$game_image\" \"\$release_sha\" \"\$require_runtime\"
      assert_service_runtime \"\$slot\" api 2 \"\$api_image\" \"\$release_sha\" \"\$require_runtime\"
      assert_service_runtime \"\$slot\" platform-p1 1 \"\$platform_image\" \"\$release_sha\" \"\$require_runtime\"
      assert_service_runtime \"\$slot\" platform-p2 1 \"\$platform_image\" \"\$release_sha\" \"\$require_runtime\"
    }

    assert_slot_release '$STABLE_SLOT' '$stable_manifest_sha256' true '$stable_manifest_format'
    if test '$mode' = canary; then
      if test '$WEIGHT' = 0; then candidate_runtime_required=false; else candidate_runtime_required=true; fi
      assert_slot_release '$CANDIDATE_SLOT' '$candidate_manifest_sha256' \"\$candidate_runtime_required\" current-seven
    fi

    gateway_ids=\$(docker ps -q \
      --filter label=com.docker.compose.project=zutomayo-release-gateway \
      --filter label=com.docker.compose.service=gateway)
    gateway_count=\$(printf '%s\\n' \"\$gateway_ids\" | sed '/^\$/d' | wc -l | tr -d ' ')
    test \"\$gateway_count\" -le 1 || { echo 'multiple release gateway containers are running' >&2; exit 1; }
    if test \"\$gateway_count\" = 1 && test ! -f '$GATEWAY_ACTIVE_STATE'; then
      echo 'running gateway has no canonical active-state artifact' >&2
      exit 1
    fi
    if test -f '$GATEWAY_ACTIVE_STATE'; then
      jq -e '.schemaVersion == 1 and (.deploymentMode == \"bootstrap\" or .deploymentMode == \"canary\")' '$GATEWAY_ACTIVE_STATE' >/dev/null
      if test \"\$gateway_count\" = 1; then
        runtime_marker=\$(docker exec \"\$gateway_ids\" wget -qO- http://127.0.0.1:8404/config 2>/dev/null || true)
        state_marker=\$(jq -r '.gateway.activeConfigId // empty' '$GATEWAY_ACTIVE_STATE')
        test -n \"\$runtime_marker\" && test \"\$runtime_marker\" = \"\$state_marker\" || {
          echo 'gateway runtime marker does not match the canonical active-state artifact' >&2
          exit 1
        }
      fi
      current_mode=\$(jq -r '.deploymentMode' '$GATEWAY_ACTIVE_STATE')
      current_stable=\$(jq -r '.gateway.stableSlot' '$GATEWAY_ACTIVE_STATE')
      current_candidate=\$(jq -r '.gateway.candidateSlot' '$GATEWAY_ACTIVE_STATE')
      current_weight=\$(jq -r '.traffic.candidateWeightPercent' '$GATEWAY_ACTIVE_STATE')
      if test '$mode' = canary; then
        if test \"\$current_mode\" = bootstrap; then
          test \"\$current_stable\" = '$STABLE_SLOT' || { echo 'canary stable slot does not match the active bootstrap slot' >&2; exit 1; }
          test '$WEIGHT' = 10 || { echo 'the first canary transition from bootstrap must be 10%' >&2; exit 1; }
        else
          test \"\$current_stable\" = '$STABLE_SLOT' && test \"\$current_candidate\" = '$CANDIDATE_SLOT' || { echo 'canary slot roles do not match the active rollout' >&2; exit 1; }
          current_candidate_sha=\$(jq -r '.candidateReleaseSha' '$GATEWAY_ACTIVE_STATE')
          requested_candidate_sha=\$(jq -r '.candidateReleaseSha' '$remote_artifact_incoming')
          test \"\$current_candidate_sha\" = \"\$requested_candidate_sha\" || { echo 'candidate release SHA changed during an active rollout' >&2; exit 1; }
          case \"\$current_weight:$WEIGHT\" in
            10:0|10:10|10:50|50:0|50:50|50:100|100:0|100:100|0:0) ;;
            *) echo \"invalid canary transition: \$current_weight -> $WEIGHT\" >&2; exit 1 ;;
          esac
          case \"\$current_weight:$WEIGHT\" in
            10:50|50:100)
              scripts/verify-server4-active-canary.sh \
                --expected-weight \"\$current_weight\" \
                --expected-stable-slot '$STABLE_SLOT' \
                --expected-candidate-slot '$CANDIDATE_SLOT'
              ;;
            10:0|50:0|100:0)
              scripts/verify-server4-active-canary.sh \
                --expected-weight \"\$current_weight\" \
                --expected-stable-slot '$STABLE_SLOT' \
                --expected-candidate-slot '$CANDIDATE_SLOT' \
                --best-effort \
                || echo 'warning: rollback is proceeding without a complete pre-rollback observation' >&2
              ;;
          esac
        fi
      else
        if test \"\$current_mode\" = bootstrap; then
          test \"\$current_stable\" = '$STABLE_SLOT' || { echo 'bootstrap cannot replace a different active stable slot' >&2; exit 1; }
        elif test \"\$current_weight\" = 100; then
          test \"\$current_candidate\" = '$STABLE_SLOT' || { echo 'post-promotion bootstrap must target the promoted candidate slot' >&2; exit 1; }
          scripts/verify-server4-active-canary.sh \
            --expected-weight 100 \
            --expected-stable-slot \"\$current_stable\" \
            --expected-candidate-slot '$STABLE_SLOT'
          for service in game-worker api-worker; do
            owner_ids=\$(docker ps -q --filter \"label=com.docker.compose.service=\$service\")
            owner_count=\$(printf '%s\\n' \"\$owner_ids\" | sed '/^\$/d' | wc -l | tr -d ' ')
            test \"\$owner_count\" = 1 || { echo \"\$service must have exactly one owner before promotion bootstrap\" >&2; exit 1; }
            owner_slot=\$(docker inspect \"\$owner_ids\" --format '{{ index .Config.Labels \"com.zutomayo.release-slot\" }}')
            test \"\$owner_slot\" = '$STABLE_SLOT' || { echo \"\$service owner must already be '$STABLE_SLOT' before promotion bootstrap\" >&2; exit 1; }
          done
        elif test \"\$current_weight\" = 0; then
          test \"\$current_stable\" = '$STABLE_SLOT' || { echo 'post-rollback bootstrap must target the restored stable slot' >&2; exit 1; }
          for service in game-worker api-worker; do
            owner_ids=\$(docker ps -q --filter \"label=com.docker.compose.service=\$service\")
            owner_count=\$(printf '%s\\n' \"\$owner_ids\" | sed '/^\$/d' | wc -l | tr -d ' ')
            test \"\$owner_count\" = 1 || { echo \"\$service must have exactly one owner before rollback bootstrap\" >&2; exit 1; }
            owner_slot=\$(docker inspect \"\$owner_ids\" --format '{{ index .Config.Labels \"com.zutomayo.release-slot\" }}')
            test \"\$owner_slot\" = '$STABLE_SLOT' || { echo \"\$service owner must already be '$STABLE_SLOT' before rollback bootstrap\" >&2; exit 1; }
          done
        else
          echo 'cannot enter bootstrap mode during a mixed canary stage' >&2
          exit 1
        fi
      fi
    elif test '$mode' = canary; then
      echo 'cannot start canary without an active bootstrap gateway state' >&2
      exit 1
    fi

    gateway_compose_image() {
      selected_image=\$1
      config_file=\$2
      shift 2
      GATEWAY_IMAGE=\"\$selected_image\" GATEWAY_CONFIG_FILE=\"\$config_file\" docker compose --env-file .env -p zutomayo-release-gateway -f '$GATEWAY_COMPOSE_FILE' \"\$@\"
    }
    gateway_compose() {
      config_file=\$1
      shift
      gateway_compose_image '$gateway_image' \"\$config_file\" \"\$@\"
    }
    gateway_container_id() {
      ids=\$(docker ps -q \
        --filter label=com.docker.compose.project=zutomayo-release-gateway \
        --filter label=com.docker.compose.service=gateway)
      count=\$(printf '%s\\n' \"\$ids\" | sed '/^\$/d' | wc -l | tr -d ' ')
      test \"\$count\" = 1 || return 1
      printf '%s' \"\$ids\"
    }
    active_marker() {
      gateway_id=\$(gateway_container_id)
      docker exec \"\$gateway_id\" wget -qO- http://127.0.0.1:8404/config 2>/dev/null
    }
    wait_for_marker() {
      expected_marker=\$1
      attempts=0
      while test \"\$attempts\" -lt 30; do
        marker=\$(active_marker || true)
        if test \"\$marker\" = \"\$expected_marker\"; then return 0; fi
        attempts=\$((attempts + 1))
        sleep 1
      done
      return 1
    }
    gateway_compose '$remote_config_incoming' config --quiet
    gateway_compose '$remote_config_incoming' pull --quiet gateway
    gateway_compose '$remote_config_incoming' run --rm --no-deps -T gateway haproxy -c -f /usr/local/etc/haproxy/haproxy.cfg
    running_gateway=\$(gateway_container_id 2>/dev/null || true)
    if test -z \"\$running_gateway\"; then
      install -m 0644 '$remote_config_incoming' haproxy.cfg
      gateway_compose '$REMOTE_DIR/haproxy.cfg' up -d --wait --wait-timeout 120 gateway
      wait_for_marker '$active_config_id'
    else
      test -f haproxy.cfg || { echo 'running gateway has no canonical HAProxy config' >&2; exit 1; }
      previous_marker=\$(active_marker || true)
      previous_gateway_image=\$(docker inspect \"\$running_gateway\" --format '{{.Config.Image}}')
      cp -p haproxy.cfg haproxy.cfg.previous
      if test \"\$previous_gateway_image\" != '$gateway_image'; then
        test '$mode' = bootstrap || { echo \"gateway runtime image mismatch: running \$previous_gateway_image, requested $gateway_image; rotate it in stable-only bootstrap mode\" >&2; exit 1; }
        cp '$remote_config_incoming' haproxy.cfg
        replacement_ok=true
        gateway_compose '$REMOTE_DIR/haproxy.cfg' up -d --force-recreate --wait --wait-timeout 120 gateway || replacement_ok=false
        if test \"\$replacement_ok\" = true && ! wait_for_marker '$active_config_id'; then replacement_ok=false; fi
        if test \"\$replacement_ok\" = true; then
          replacement_id=\$(gateway_container_id)
          replacement_image=\$(docker inspect \"\$replacement_id\" --format '{{.Config.Image}}')
          test \"\$replacement_image\" = '$gateway_image' || replacement_ok=false
        fi
        if test \"\$replacement_ok\" != true; then
          echo 'gateway image replacement failed; restoring previous image and config' >&2
          cp haproxy.cfg.previous haproxy.cfg
          restore_ok=true
          gateway_compose_image \"\$previous_gateway_image\" '$REMOTE_DIR/haproxy.cfg' up -d --force-recreate --wait --wait-timeout 120 gateway || restore_ok=false
          if test \"\$restore_ok\" = true && test -n \"\$previous_marker\" && ! wait_for_marker \"\$previous_marker\"; then restore_ok=false; fi
          if test \"\$restore_ok\" != true; then echo 'CRITICAL: previous gateway image/config did not recover' >&2; fi
          exit 1
        fi
      else
        cp '$remote_config_incoming' haproxy.cfg
        running_gateway=\$(gateway_container_id)
        if ! docker exec \"\$running_gateway\" haproxy -c -f /usr/local/etc/haproxy/haproxy.cfg; then
          cp haproxy.cfg.previous haproxy.cfg
          exit 1
        fi
        reload_ok=true
        docker kill --signal USR2 \"\$running_gateway\" >/dev/null || reload_ok=false
        if test \"\$reload_ok\" = true && ! wait_for_marker '$active_config_id'; then reload_ok=false; fi
        if test \"\$reload_ok\" = true; then
          running_gateway=\$(gateway_container_id)
          docker exec \"\$running_gateway\" wget --spider -q http://127.0.0.1:8080/ready || reload_ok=false
        fi
        if test \"\$reload_ok\" != true; then
          echo 'gateway reload validation failed; restoring previous config' >&2
          cp haproxy.cfg.previous haproxy.cfg
          restore_ok=true
          running_gateway=\$(gateway_container_id)
          docker kill --signal USR2 \"\$running_gateway\" >/dev/null || restore_ok=false
          if test -n \"\$previous_marker\" && ! wait_for_marker \"\$previous_marker\"; then restore_ok=false; fi
          running_gateway=\$(gateway_container_id 2>/dev/null || true)
          if test -z \"\$running_gateway\" || ! docker exec \"\$running_gateway\" wget --spider -q http://127.0.0.1:8080/ready; then restore_ok=false; fi
          if test \"\$restore_ok\" != true; then echo 'CRITICAL: previous gateway config did not recover readiness' >&2; fi
          exit 1
        fi
      fi
    fi
    gateway_id=\$(gateway_container_id)
    runtime_gateway_image=\$(docker inspect \"\$gateway_id\" --format '{{.Config.Image}}')
    test \"\$runtime_gateway_image\" = '$gateway_image' || { echo \"gateway runtime image mismatch after apply: \$runtime_gateway_image\" >&2; exit 1; }
    expected=\$(sha256sum '$remote_config_incoming' | awk '{print \$1}')
    actual=\$(docker exec \"\$gateway_id\" sha256sum /usr/local/etc/haproxy/haproxy.cfg | awk '{print \$1}')
    test \"\$actual\" = \"\$expected\"
    test \"\$(active_marker)\" = '$active_config_id'
    docker exec \"\$gateway_id\" wget --spider -q http://127.0.0.1:8080/health
    docker exec \"\$gateway_id\" wget --spider -q http://127.0.0.1:8080/ready
    active_state_next='.$GATEWAY_ACTIVE_STATE.next.'\$\$
    install -m 0644 '$remote_artifact_incoming' \"\$active_state_next\"
    mv -f \"\$active_state_next\" '$GATEWAY_ACTIVE_STATE'
    if test '$mode' = bootstrap; then
      retention_manifest_next='.release.retention.env.next.'\$\$
      install -m 0640 '.release.$STABLE_SLOT.env' \"\$retention_manifest_next\"
      chgrp '$RETENTION_SERVICE_GROUP' \"\$retention_manifest_next\"
      mv -f \"\$retention_manifest_next\" .release.retention.env
      retention_image=\$(manifest_value '.release.$STABLE_SLOT.env' RETENTION_IMAGE)
      retention_state_next='.retention-owner.json.next.'\$\$
      jq -n \
        --arg slot '$STABLE_SLOT' \
        --arg releaseSha \"\$(manifest_value '.release.$STABLE_SLOT.env' RELEASE_SHA)\" \
        --arg manifestSha256 \"\$(sha256sum '.release.$STABLE_SLOT.env' | awk '{print \$1}')\" \
        --arg retentionImage \"\$retention_image\" \
        --arg activatedAt \"\$(date -u +%Y-%m-%dT%H:%M:%SZ)\" \
        '{schemaVersion:1,ownerMode:\"stable-bootstrap\",slot:\$slot,releaseSha:\$releaseSha,manifestSha256:\$manifestSha256,retentionImage:\$retentionImage,activatedAt:\$activatedAt}' > \"\$retention_state_next\"
      mv -f \"\$retention_state_next\" .retention-owner.json
    fi
    install -m 0644 '$remote_artifact_incoming' 'evidence/$remote_prefix.json'
    install -m 0644 '$remote_config_incoming' 'evidence/$remote_prefix.cfg'
    active_marker > 'evidence/$remote_prefix.active-config.txt'
    docker inspect \"\$gateway_id\" | jq '.[0] | {containerId:.Id,imageId:.Image,imageReference:.Config.Image,restartCount:.RestartCount,state:{status:.State.Status,running:.State.Running,startedAt:.State.StartedAt,pid:.State.Pid}}' > 'evidence/$remote_prefix.container.json'
    if test '$mode' = canary && test '$WEIGHT' = 0; then
      printf '%s\n' \"\$rollback_started_at\" > 'evidence/$remote_prefix.rollback-started-at'
      date -u +%Y-%m-%dT%H:%M:%S.000Z > 'evidence/$remote_prefix.rollback-finished-at'
    fi
    docker exec \"\$gateway_id\" wget -qO- 'http://127.0.0.1:8405/stats;csv' > 'evidence/$remote_prefix.stats-start.csv'
    date -u +%Y-%m-%dT%H:%M:%S.000Z > 'evidence/$remote_prefix.applied-at'
    if test '$mode' = canary && test '$WEIGHT' != 0; then
      observation_state_next='.$GATEWAY_OBSERVATION_STATE.next.'\$\$
      jq -n \
        --arg activeConfigId '$active_config_id' \
        --arg evidencePrefix '$remote_prefix' \
        --arg gatewayConfigSha256 \"\$(sha256sum 'evidence/$remote_prefix.json' | awk '{print \$1}')\" \
        --arg startedAt \"\$(cat 'evidence/$remote_prefix.applied-at')\" \
        --argjson candidateWeightPercent '$WEIGHT' \
        '{schemaVersion:1,activeConfigId:\$activeConfigId,evidencePrefix:\$evidencePrefix,gatewayConfigSha256:\$gatewayConfigSha256,candidateWeightPercent:\$candidateWeightPercent,startedAt:\$startedAt}' \
        > \"\$observation_state_next\"
      mv -f \"\$observation_state_next\" '$GATEWAY_OBSERVATION_STATE'
    else
      rm -f '$GATEWAY_OBSERVATION_STATE'
    fi
    echo 'gateway config applied: $remote_prefix'"
  trap - EXIT RETURN
}

start_workers() {
  local slot="$1"
  validate_slot "$slot"
  evaluate_pg_budget "$slot" true "$PG_SLOT_CONNECTION_BUDGET"
  ssh_run "set -euo pipefail
    exec 9>'$REMOTE_LOCK_FILE'
    flock -n 9 || { echo 'another parallel deployment mutation is already running' >&2; exit 1; }
    cd '$REMOTE_DIR'
    test -f '.release.$slot.env'
    worker_compose() { RELEASE_SLOT='$slot' COMPOSE_PROJECT_NAME='zutomayo-$slot' docker compose --env-file .env --env-file '.release.$slot.env' -p 'zutomayo-$slot' -f '$SLOT_COMPOSE_FILE' --profile background-workers \"\$@\"; }
    assert_healthy_service() {
      service=\$1
      expected=\$2
      ids=\$(worker_compose ps -q \"\$service\")
      test \"\$(printf '%s\\n' \"\$ids\" | sed '/^\$/d' | wc -l | tr -d ' ')\" = \"\$expected\"
      for id in \$ids; do test \"\$(docker inspect \"\$id\" --format '{{.State.Health.Status}}')\" = healthy; done
    }
    assert_no_legacy_worker_owner() {
      legacy_game=\$(docker ps -q --filter label=com.docker.compose.project=zutomayo-card-online --filter label=com.docker.compose.service=game)
      legacy_api=\$(docker ps -q --filter label=com.docker.compose.project=zutomayo-card-online --filter label=com.docker.compose.service=api)
      test -z \"\$legacy_game\$legacy_api\" || { echo 'legacy game/API must be stopped before parallel workers start' >&2; exit 1; }
    }
    assert_no_other_worker_owner() {
      service=\$1
      for id in \$(docker ps -q --filter \"label=com.docker.compose.service=\$service\"); do
        owner=\$(docker inspect \"\$id\" --format '{{ index .Config.Labels \"com.zutomayo.release-slot\" }}')
        test \"\$owner\" = '$slot' || { echo \"\$service is already owned by slot \${owner:-unknown}\" >&2; exit 1; }
      done
    }
    running_count() {
      docker ps -q \
        --filter \"label=com.docker.compose.project=zutomayo-$slot\" \
        --filter \"label=com.docker.compose.service=\$1\" \
        | wc -l | tr -d ' '
    }
    assert_no_legacy_worker_owner
    assert_no_other_worker_owner game-worker
    assert_no_other_worker_owner api-worker
    before_game=\$(running_count game-worker)
    before_api=\$(running_count api-worker)
    test \"\$before_game\" = \"\$before_api\" || { echo 'target slot has a partial worker owner state' >&2; exit 1; }
    { test \"\$before_game\" = 0 || test \"\$before_game\" = 1; } || { echo 'target slot has duplicate workers' >&2; exit 1; }
    assert_healthy_service game 2
    assert_healthy_service api 2
    assert_healthy_service platform-p1 1
    assert_healthy_service platform-p2 1
    started_new=false
    if test \"\$before_game\" = 0; then started_new=true; fi
    cleanup_failed_start() {
      status=\$?
      if test \"\$status\" != 0 && test \"\$started_new\" = true; then
        worker_compose stop -t 45 game-worker api-worker >/dev/null 2>&1 || true
      fi
      exit \"\$status\"
    }
    trap cleanup_failed_start EXIT
    worker_compose up -d --no-deps --wait --wait-timeout 120 game-worker api-worker
    assert_healthy_service game-worker 1
    assert_healthy_service api-worker 1
    test \"\$(docker ps -q --filter label=com.docker.compose.service=game-worker | wc -l | tr -d ' ')\" = 1
    test \"\$(docker ps -q --filter label=com.docker.compose.service=api-worker | wc -l | tr -d ' ')\" = 1
    trap - EXIT"
}

transfer_workers() {
  require_confirm
  validate_slot "$FROM_SLOT"
  validate_slot "$TO_SLOT"
  [[ "$FROM_SLOT" != "$TO_SLOT" ]] || die 'worker source and destination slots must differ'
  evaluate_pg_budget "$TO_SLOT" true "$PG_SLOT_CONNECTION_BUDGET"
  ssh_run "set -euo pipefail
    exec 9>'$REMOTE_LOCK_FILE'
    flock -n 9 || { echo 'another parallel deployment mutation is already running' >&2; exit 1; }
    cd '$REMOTE_DIR'
    test -f '.release.$FROM_SLOT.env'
    test -f '.release.$TO_SLOT.env'
    active_weight=\$(jq -r '.traffic.candidateWeightPercent // empty' '$GATEWAY_ACTIVE_STATE')
    case \"\$active_weight\" in
      100)
        scripts/verify-server4-active-canary.sh \
          --expected-weight 100 \
          --expected-stable-slot '$FROM_SLOT' \
          --expected-candidate-slot '$TO_SLOT'
        ;;
      0)
        scripts/verify-server4-active-canary.sh \
          --expected-weight 0 \
          --expected-stable-slot '$TO_SLOT' \
          --expected-candidate-slot '$FROM_SLOT'
        ;;
      *)
        echo \"worker transfer requires an active 100% rollout or 0% rollback, found \${active_weight:-unknown}%\" >&2
        exit 1
        ;;
    esac
    from_compose() { RELEASE_SLOT='$FROM_SLOT' COMPOSE_PROJECT_NAME='zutomayo-$FROM_SLOT' docker compose --env-file .env --env-file '.release.$FROM_SLOT.env' -p 'zutomayo-$FROM_SLOT' -f '$SLOT_COMPOSE_FILE' --profile background-workers \"\$@\"; }
    to_compose() { RELEASE_SLOT='$TO_SLOT' COMPOSE_PROJECT_NAME='zutomayo-$TO_SLOT' docker compose --env-file .env --env-file '.release.$TO_SLOT.env' -p 'zutomayo-$TO_SLOT' -f '$SLOT_COMPOSE_FILE' --profile background-workers \"\$@\"; }
    healthy_service() {
      compose_name=\$1
      service=\$2
      expected=\$3
      if test \"\$compose_name\" = from; then ids=\$(from_compose ps -q \"\$service\"); else ids=\$(to_compose ps -q \"\$service\"); fi
      count=\$(printf '%s\\n' \"\$ids\" | sed '/^\$/d' | wc -l | tr -d ' ')
      test \"\$count\" = \"\$expected\" || return 1
      for id in \$ids; do test \"\$(docker inspect \"\$id\" --format '{{.State.Health.Status}}')\" = healthy || return 1; done
    }
    legacy_game=\$(docker ps -q --filter label=com.docker.compose.project=zutomayo-card-online --filter label=com.docker.compose.service=game)
    legacy_api=\$(docker ps -q --filter label=com.docker.compose.project=zutomayo-card-online --filter label=com.docker.compose.service=api)
    test -z \"\$legacy_game\$legacy_api\" || { echo 'legacy game/API must be stopped before worker transfer' >&2; exit 1; }
    healthy_service to game 2 || { echo 'target game web replicas are not healthy' >&2; exit 1; }
    healthy_service to api 2 || { echo 'target API web replicas are not healthy' >&2; exit 1; }
    healthy_service to platform-p1 1 || { echo 'target platform-p1 is not healthy' >&2; exit 1; }
    healthy_service to platform-p2 1 || { echo 'target platform-p2 is not healthy' >&2; exit 1; }
    healthy_service from game-worker 1 || { echo 'source game worker is not the healthy owner' >&2; exit 1; }
    healthy_service from api-worker 1 || { echo 'source API worker is not the healthy owner' >&2; exit 1; }
    test -z \"\$(to_compose ps -q game-worker)\$(to_compose ps -q api-worker)\" || { echo 'target slot already has running workers' >&2; exit 1; }
    for service in game-worker api-worker; do
      ids=\$(docker ps -q --filter \"label=com.docker.compose.service=\$service\")
      count=\$(printf '%s\\n' \"\$ids\" | sed '/^\$/d' | wc -l | tr -d ' ')
      test \"\$count\" = 1 || { echo \"expected exactly one global \$service owner before transfer\" >&2; exit 1; }
      owner=\$(docker inspect \"\$ids\" --format '{{ index .Config.Labels \"com.zutomayo.release-slot\" }}')
      test \"\$owner\" = '$FROM_SLOT' || { echo \"\$service owner is \$owner, not $FROM_SLOT\" >&2; exit 1; }
    done
    if ! from_compose stop -t 45 game-worker api-worker; then
      echo 'source workers did not stop cleanly; restoring them before aborting' >&2
      from_compose up -d --no-deps --wait --wait-timeout 120 game-worker api-worker || true
      exit 1
    fi
    transfer_ok=true
    to_compose up -d --no-deps --wait --wait-timeout 120 game-worker api-worker || transfer_ok=false
    if test \"\$transfer_ok\" = true; then healthy_service to game-worker 1 || transfer_ok=false; fi
    if test \"\$transfer_ok\" = true; then healthy_service to api-worker 1 || transfer_ok=false; fi
    if test \"\$transfer_ok\" = true; then
      test \"\$(docker ps -q --filter label=com.docker.compose.service=game-worker | wc -l | tr -d ' ')\" = 1 || transfer_ok=false
      test \"\$(docker ps -q --filter label=com.docker.compose.service=api-worker | wc -l | tr -d ' ')\" = 1 || transfer_ok=false
    fi
    if test \"\$transfer_ok\" != true; then
      echo 'target worker start failed; restoring the previous owner' >&2
      to_compose stop -t 45 game-worker api-worker >/dev/null 2>&1 || true
      restore_ok=true
      from_compose up -d --no-deps --wait --wait-timeout 120 game-worker api-worker || restore_ok=false
      if test \"\$restore_ok\" = true; then healthy_service from game-worker 1 || restore_ok=false; fi
      if test \"\$restore_ok\" = true; then healthy_service from api-worker 1 || restore_ok=false; fi
      if test \"\$restore_ok\" != true; then echo 'CRITICAL: previous worker owner did not recover' >&2; fi
      exit 1
    fi
    evidence_prefix='workers-$FROM_SLOT-to-$TO_SLOT-'\$(date -u +%Y%m%dT%H%M%SZ)-\$\$
    date -u +%Y-%m-%dT%H:%M:%SZ > \"evidence/\$evidence_prefix.transferred-at\"
    docker ps --filter label=com.docker.compose.service=game-worker --filter label=com.zutomayo.release-slot='$TO_SLOT' --format '{{json .}}' > \"evidence/\$evidence_prefix.game.jsonl\"
    docker ps --filter label=com.docker.compose.service=api-worker --filter label=com.zutomayo.release-slot='$TO_SLOT' --format '{{json .}}' > \"evidence/\$evidence_prefix.api.jsonl\""
}

activate_retention() {
  require_confirm
  validate_slot "$SLOT"
  ssh_run "set -euo pipefail
    exec 9>'$REMOTE_LOCK_FILE'
    flock -n 9 || { echo 'another parallel deployment mutation is already running' >&2; exit 1; }
    cd '$REMOTE_DIR'
    test -e '$MANAGED_MARKER'
    test -f '.release.$SLOT.env'
    test -f '.release.retention.env'
    retention_release_sha=\$(sed -n 's/^RELEASE_SHA=//p' '.release.$SLOT.env')
    retention_manifest_sha=\$(sha256sum .release.retention.env | awk '{print \$1}')
    jq -e --arg slot '$SLOT' --arg releaseSha \"\$retention_release_sha\" --arg manifestSha256 \"\$retention_manifest_sha\" '.schemaVersion == 1 and .slot == \$slot and .releaseSha == \$releaseSha and .manifestSha256 == \$manifestSha256' .retention-owner.json >/dev/null
    test -f /etc/systemd/system/zutomayo-retention.service
    systemctl is-enabled zutomayo-retention.timer >/dev/null
    if systemctl is-active --quiet zutomayo-retention.service; then
      echo 'retention service is currently running; retry after it finishes' >&2
      exit 1
    fi
    install -d -m 0755 /etc/systemd/system/zutomayo-retention.service.d
    dropin='/etc/systemd/system/zutomayo-retention.service.d/parallel-runtime.conf'
    previous_dropin=\"\$dropin.previous.\$(date -u +%Y%m%dT%H%M%SZ).\$\$\"
    had_previous=false
    if test -f \"\$dropin\"; then cp -p \"\$dropin\" \"\$previous_dropin\"; had_previous=true; fi
    dropin_next=\"\$dropin.next.\$\$\"
    printf '%s\\n' '[Service]' \"WorkingDirectory=$REMOTE_DIR\" 'ExecStart=' \"ExecStart=/usr/bin/docker compose --env-file $REMOTE_DIR/.release.retention.env -f $REMOTE_DIR/docker-compose.retention.yml run --rm --no-deps retention\" > \"\$dropin_next\"
    install -m 0644 \"\$dropin_next\" \"\$dropin\"
    rm -f \"\$dropin_next\"
    activation_ok=true
    systemctl daemon-reload || activation_ok=false
    if test \"\$activation_ok\" = true; then systemctl show zutomayo-retention.service -p WorkingDirectory --value | grep -Fx '$REMOTE_DIR' >/dev/null || activation_ok=false; fi
    if test \"\$activation_ok\" = true; then systemctl cat zutomayo-retention.service | grep -F -- '$REMOTE_DIR/.release.retention.env' >/dev/null || activation_ok=false; fi
    if test \"\$activation_ok\" != true; then
      echo 'retention systemd activation failed; restoring the previous drop-in' >&2
      if test \"\$had_previous\" = true; then cp -p \"\$previous_dropin\" \"\$dropin\"; else rm -f \"\$dropin\"; fi
      systemctl daemon-reload || true
      exit 1
    fi
    install -m 0644 .retention-owner.json 'evidence/retention-owner-activated-$SLOT.json'
    echo 'retention timer activated for parallel runtime'"
}

case "$COMMAND" in
  preflight)
    remote_preflight
    ;;
  install)
    remote_preflight
    install_control_plane
    ;;
  stage-slot)
    stage_slot
    ;;
  bootstrap-gateway)
    render_and_apply_gateway bootstrap
    ;;
  switch)
    render_and_apply_gateway canary
    ;;
  transfer-workers)
    transfer_workers
    ;;
  activate-retention)
    activate_retention
    ;;
  start-workers)
    require_confirm
    validate_slot "$SLOT"
    start_workers "$SLOT"
    ;;
  *)
    usage >&2
    die "unknown command: $COMMAND"
    ;;
esac
