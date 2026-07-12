#!/bin/bash
# deploy-server4.sh — ZUTOMAYO Card Online 標準部署腳本
#
# 一鍵完成:備份 → server4 git reset → 更新 APP_BUILD_ID → tag rollback → build → up → verify
#
# 用法:
#   ./scripts/deploy-server4.sh                    # 直接執行
#   ./scripts/deploy-server4.sh --confirm          # 執行前二次確認
#   ./scripts/deploy-server4.sh --sha <sha>       # 指定要部署的 commit(預設=本地 HEAD)
#   ./scripts/deploy-server4.sh --dry-run          # 只顯示會做什麼,不真的執行
#   ./scripts/deploy-server4.sh --rollback         # 回滾到上一版 image (:rollback tag)
#
# 環境變數覆寫:
#   SERVER_HOST=149.104.6.238 SERVER_PORT=4649 ./scripts/deploy-server4.sh

set -euo pipefail

# --- 設定 ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER_HOST="${SERVER_HOST:-149.104.6.238}"
SERVER_PORT="${SERVER_PORT:-4649}"
SERVER_USER="${SERVER_USER:-root}"
REMOTE_DIR="${REMOTE_DIR:-/opt/zutomayo-card-online}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.server4.yml}"
REDIS_CONTAINER="${REDIS_CONTAINER:-redis}"
GHCR_OWNER="${GHCR_OWNER:-lyangjyehaur}"
GAME_IMAGE="ghcr.io/${GHCR_OWNER}/zutomayo-card-online-game"
API_IMAGE="ghcr.io/${GHCR_OWNER}/zutomayo-card-online-api"
PLATFORM_IMAGE="ghcr.io/${GHCR_OWNER}/zutomayo-card-online-platform"
MIGRATE_IMAGE="ghcr.io/${GHCR_OWNER}/zutomayo-card-online-migrate"

# --- 旗標解析 ---
CONFIRM=false
DRY_RUN=false
TARGET_SHA=""
ROLLBACK=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --confirm) CONFIRM=true; shift ;;
        --dry-run) DRY_RUN=true; shift ;;
        --rollback) ROLLBACK=true; shift ;;
        --sha)
            [[ $# -ge 2 ]] || { echo "--sha 需要 commit SHA" >&2; exit 2; }
            TARGET_SHA="$2"
            shift 2
            ;;
        -h|--help)
            sed -n '2,15p' "$0"
            exit 0
            ;;
        *) echo "未知參數: $1" >&2; exit 2 ;;
    esac
done

# --- 工具函式 ---
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $*"; }
ok()   { echo -e "${GREEN}[$(date +%H:%M:%S)] ✓${NC} $*"; }
warn() { echo -e "${YELLOW}[$(date +%H:%M:%S)] ⚠${NC} $*"; }
err()  { echo -e "${RED}[$(date +%H:%M:%S)] ✗${NC} $*" >&2; }

ssh_run() { ssh -p "$SERVER_PORT" "$SERVER_USER@$SERVER_HOST" "$@"; }

verify_remote_runtime_config() {
    ssh_run "
set -e
cd '$REMOTE_DIR'
CONFIG_FILE=\$(mktemp)
trap 'rm -f \"\$CONFIG_FILE\"' EXIT
docker compose -f '$COMPOSE_FILE' config --format json > \"\$CONFIG_FILE\"
python3 - \"\$CONFIG_FILE\" <<'PY'
import json
import sys

config = json.load(open(sys.argv[1], encoding='utf-8'))
services = config.get('services', {})
values = {}
for name in ('game', 'api', 'platform'):
    environment = services.get(name, {}).get('environment', {})
    if isinstance(environment, dict):
        values[name] = str(environment.get('REDIS_DB', ''))
    else:
        values[name] = next((item.split('=', 1)[1] for item in environment if item.startswith('REDIS_DB=')), '')
if not values['game'] or len(set(values.values())) != 1:
    raise SystemExit('Redis DB mismatch: ' + repr(values))
print('Redis DB consistent: ' + values['game'])
PY

# server4 uses an external Redis container on 1panel-network. Refuse an
# eviction policy that could remove blacklist/auth:revoked-before keys.
REDIS_PASSWORD=\$(sed -n 's/^REDIS_PASSWORD=//p' .env | tail -n 1)
POLICY=\$(docker exec -e \"REDISCLI_AUTH=\$REDIS_PASSWORD\" '$REDIS_CONTAINER' redis-cli --no-auth-warning CONFIG GET maxmemory-policy | tail -n 1)
if [ \"\$POLICY\" != 'noeviction' ]; then
    echo \"External Redis maxmemory-policy must be noeviction (got: \$POLICY)\" >&2
    exit 1
fi
echo 'External Redis eviction policy: noeviction'
"
}

run_or_dry() {
    if [[ "$DRY_RUN" == true ]]; then
        echo -e "${YELLOW}[DRY-RUN]${NC} $*"
    else
        "$@"
    fi
}

# 驗證部署健康狀態；回傳 0 = 全部通過，1 = 有失敗
verify_health() {
    local failed=0
    GAME_VERSION=$(curl -fsS --max-time 5 "http://$SERVER_HOST:3000/api/version" 2>/dev/null || echo "FAILED")
    API_VERSION=$(curl -fsS --max-time 5 "http://$SERVER_HOST:3001/api/version" 2>/dev/null || echo "FAILED")
    PLATFORM_HEALTH=$(curl -fsS --max-time 5 "http://$SERVER_HOST:3002/health" 2>/dev/null || echo "FAILED")
    PLATFORM_READY=$(curl -fsS --max-time 5 "http://$SERVER_HOST:3002/ready" 2>/dev/null || echo "FAILED")
    GAME_HTTP=$(curl -fsSI --max-time 5 "http://$SERVER_HOST:3000/" 2>/dev/null | head -1 || echo "FAILED")
    API_HTTP=$(curl -fsSI --max-time 5 "http://$SERVER_HOST:3001/health" 2>/dev/null | head -1 || echo "FAILED")
    PLATFORM_HTTP=$(curl -fsSI --max-time 5 "http://$SERVER_HOST:3002/health" 2>/dev/null | head -1 || echo "FAILED")

    echo "  game /api/version : $GAME_VERSION"
    echo "  api  /api/version : $API_VERSION"
    echo "  platform /health  : $PLATFORM_HEALTH"
    echo "  platform /ready   : $PLATFORM_READY"
    echo "  game HTTP         : $GAME_HTTP"
    echo "  api  HTTP         : $API_HTTP"
    echo "  platform HTTP     : $PLATFORM_HTTP"

    [[ "$GAME_VERSION" == "FAILED" ]] && { warn "game /api/version 失敗"; failed=1; }
    [[ "$API_VERSION" == "FAILED" ]] && { warn "api /api/version 失敗"; failed=1; }
    [[ "$PLATFORM_HEALTH" == "FAILED" ]] && { warn "platform /health 失敗"; failed=1; }
    [[ "$PLATFORM_READY" == "FAILED" ]] && { warn "platform /ready 失敗"; failed=1; }
    [[ "$GAME_HTTP" == "FAILED" ]] && { warn "game HTTP 失敗"; failed=1; }
    [[ "$API_HTTP" == "FAILED" ]] && { warn "api HTTP 失敗"; failed=1; }
    [[ "$PLATFORM_HTTP" == "FAILED" ]] && { warn "platform HTTP 失敗"; failed=1; }
    return $failed
}

# 回滾到 :rollback tag 的 image
perform_rollback() {
    log "回滾到 :rollback tag 的 image"
    ssh_run "
cd $REMOTE_DIR
TAG=rollback docker compose -f $COMPOSE_FILE up -d --wait --wait-timeout 180
docker compose -f $COMPOSE_FILE ps
"
}

# --- Rollback 模式（--rollback flag）---
if [[ "$ROLLBACK" == true ]]; then
    log "=== ZUTOMAYO Card Online Rollback ==="
    log "Server: $SERVER_USER@$SERVER_HOST:$SERVER_PORT"
    log "Remote: $REMOTE_DIR"

    cd "$PROJECT_DIR"

    # SSH 連線
    if ! ssh_run "echo ok" >/dev/null 2>&1; then
        err "無法 SSH 到 $SERVER_USER@$SERVER_HOST:$SERVER_PORT"
        exit 1
    fi
    ok "SSH 連線正常"

    # server4 .env 存在
    if ! ssh_run "test -f $REMOTE_DIR/.env" >/dev/null 2>&1; then
        err "server4 上 $REMOTE_DIR/.env 不存在,請先建立"
        exit 1
    fi
    ok "server4 .env 存在"
    if [[ "$DRY_RUN" != true ]]; then
        verify_remote_runtime_config
    else
        warn "DRY-RUN：略過外部 Redis policy / compose runtime 驗證"
    fi

    if [[ "$CONFIRM" == true ]]; then
        warn "即將回滾 $SERVER_HOST 上的服務到 :rollback image"
        read -rp "確認繼續? [y/N] " ans
        [[ "$ans" =~ ^[Yy]$ ]] || { err "取消"; exit 1; }
    fi

    log ""
    log "執行 rollback..."
    run_or_dry perform_rollback

    log ""
    log "驗證 rollback 結果"
    echo ""
    if verify_health; then
        echo ""
        echo "================================================================"
        ok "Rollback 完成 ★ 已恢復上一版 image"
        echo "  訪問: http://$SERVER_HOST:3000"
        echo "  API:  http://$SERVER_HOST:3001"
        echo "  Platform: http://$SERVER_HOST:3002/health"
        echo "================================================================"
    else
        echo ""
        err "Rollback 後驗證仍失敗，請手動檢查:"
        err "  ssh -p $SERVER_PORT $SERVER_USER@$SERVER_HOST 'docker compose -f $COMPOSE_FILE logs --tail=50'"
        exit 1
    fi
    exit 0
fi

# --- 前置檢查 ---
log "=== ZUTOMAYO Card Online 部署腳本 ==="
log "Server: $SERVER_USER@$SERVER_HOST:$SERVER_PORT"
log "Remote: $REMOTE_DIR"

cd "$PROJECT_DIR"

# 1. 工作樹乾淨
if ! git diff --quiet HEAD 2>/dev/null; then
    err "工作樹有未提交變更,請先 commit 或 stash"
    git status --short
    exit 1
fi
ok "工作樹乾淨"

# 2. 確認已 push 到 origin
git fetch origin

if [[ -n "$TARGET_SHA" ]]; then
    [[ "$TARGET_SHA" =~ ^[0-9a-fA-F]{7,64}$ ]] || { err "無效的 --sha: $TARGET_SHA"; exit 2; }
    HEAD_SHA=$(git rev-parse "${TARGET_SHA}^{commit}" 2>/dev/null) || { err "找不到 commit: $TARGET_SHA"; exit 1; }
else
    HEAD_SHA=$(git rev-parse HEAD)
fi
HEAD_SHORT=$(git rev-parse --short "$HEAD_SHA")

# 確認 origin/master = HEAD(都已 push)
ORIGIN_SHA=$(git rev-parse origin/master 2>/dev/null || echo "")
if [[ -z "$TARGET_SHA" && -n "$ORIGIN_SHA" && "$ORIGIN_SHA" != "$HEAD_SHA" ]]; then
    err "本地 HEAD ($HEAD_SHORT) 跟 origin/master ($(git rev-parse --short origin/master 2>/dev/null)) 不一致"
    err "請先 git push origin master 再部署"
    exit 1
fi
if ! git branch -r --contains "$HEAD_SHA" | grep -q 'origin/'; then
    err "目標 commit $HEAD_SHORT 尚未出現在 origin"
    exit 1
fi
ok "目標 commit: $HEAD_SHORT (origin 已包含)"

# 3. server4 可達
if ! ssh_run "echo ok" >/dev/null 2>&1; then
    err "無法 SSH 到 $SERVER_USER@$SERVER_HOST:$SERVER_PORT"
    exit 1
fi
ok "SSH 連線正常"

# 4. server4 .env 存在
if ! ssh_run "test -f $REMOTE_DIR/.env" >/dev/null 2>&1; then
    err "server4 上 $REMOTE_DIR/.env 不存在,請先建立"
    exit 1
fi
ok "server4 .env 存在"
if [[ "$DRY_RUN" != true ]]; then
    verify_remote_runtime_config
    ok "server4 Redis policy 與三服務 DB 設定通過"
else
    warn "DRY-RUN：略過外部 Redis policy / compose runtime 驗證"
fi

# 5. 二次確認
if [[ "$CONFIRM" == true ]]; then
    warn "即將部署 commit $HEAD_SHORT 到 $SERVER_HOST"
    warn "影響容器: zutomayo-card-online-game-1, zutomayo-card-online-api-1, zutomayo-card-online-platform-1"
    read -rp "確認繼續? [y/N] " ans
    [[ "$ans" =~ ^[Yy]$ ]] || { err "取消"; exit 1; }
fi

# --- Step 1:備份 ---
log ""
log "Step 1/7: 備份 server4 .env 與 $COMPOSE_FILE"
run_or_dry ssh_run "
cd $REMOTE_DIR
TS=\$(date +%Y%m%d%H%M%S)
cp -p .env .env.bak.\$TS
cp -p $COMPOSE_FILE $COMPOSE_FILE.bak.\$TS
ls -la .env.bak.\$TS $COMPOSE_FILE.bak.\$TS
"
ok "備份完成"

# --- Step 2:server4 git 對齊 ---
log ""
log "Step 2/7: server4 git reset 到 $HEAD_SHORT"
run_or_dry ssh_run "
set -e
cd $REMOTE_DIR
git config --global --add safe.directory $REMOTE_DIR 2>/dev/null || true
git fetch origin 2>&1 | tail -3
git cat-file -e '$HEAD_SHA^{commit}'

BEHIND=\$(git rev-list --count HEAD..origin/master 2>/dev/null || echo 0)
AHEAD=\$(git rev-list --count origin/master..HEAD 2>/dev/null || echo 0)
echo \"  server4 HEAD 落後 origin/master: \$BEHIND 個 commit\"
echo \"  server4 HEAD 領先 origin/master: \$AHEAD 個 commit\"

if [[ \$AHEAD -gt 0 ]]; then
    echo '  ⚠ server4 有未推回 origin 的 commit,將會丟失'
    git log --oneline origin/master..HEAD
fi

git reset --hard $HEAD_SHA
git log --oneline -3
"
ok "git reset 完成"

# Re-check the checked-out compose file, not only the preflight version that
# was present before the remote git update.
if [[ "$DRY_RUN" != true ]]; then
    verify_remote_runtime_config
    ok "checked-out compose 的 Redis policy 與 DB 設定通過"
fi

# --- Step 3:更新 APP_BUILD_ID / APP_VERSION / GAME_RULES_VERSION ---
# 三個都要從 package.json 跟 HEAD 同步，避免依賴 Docker/Compose 的空值 fallback。
log ""
log "Step 3/7: 同步 server4 .env 的版本號(APP_BUILD_ID / APP_VERSION / GAME_RULES_VERSION)"
PACKAGE_VERSION=$(python3 -c "import json; print(json.load(open('$PROJECT_DIR/package.json'))['version'])")
run_or_dry ssh_run "
cd $REMOTE_DIR

# APP_BUILD_ID = commit short SHA(部署時動態填)
sed -i.bak \"s/^APP_BUILD_ID=.*/APP_BUILD_ID=$HEAD_SHORT/\" .env

# APP_VERSION = package.json version(沒有的話新增)
if grep -q '^APP_VERSION=' .env; then
    sed -i 's/^APP_VERSION=.*/APP_VERSION=$PACKAGE_VERSION/' .env
else
    echo 'APP_VERSION=$PACKAGE_VERSION' >> .env
fi

# GAME_RULES_VERSION = package.json version(沒有的話新增;rules 改版時手動 bump)
if grep -q '^GAME_RULES_VERSION=' .env; then
    sed -i 's/^GAME_RULES_VERSION=.*/GAME_RULES_VERSION=$PACKAGE_VERSION/' .env
else
    echo 'GAME_RULES_VERSION=$PACKAGE_VERSION' >> .env
fi

grep -E '^(APP_|GAME_RULES)' .env
"
ok "版本號已同步"

# --- Step 4:標記現有 image 為 :rollback（供回滾用）---
log ""
log "Step 4/7: 標記現有 image 為 :rollback（供回滾用）"
run_or_dry ssh_run "
cd $REMOTE_DIR
for IMG in $GAME_IMAGE $API_IMAGE $PLATFORM_IMAGE $MIGRATE_IMAGE; do
    if docker image inspect \"\${IMG}:latest\" >/dev/null 2>&1; then
        docker tag \"\${IMG}:latest\" \"\${IMG}:rollback\"
        echo \"  tagged \${IMG}:rollback\"
    else
        echo \"  skip \${IMG} (無 :latest image，首次部署)\"
    fi
done
"
ok "rollback tag 完成"

# --- Step 5:build ---
log ""
log "Step 5/7: docker compose build(可能要 1-3 分鐘)"
run_or_dry ssh_run "
cd $REMOTE_DIR
docker compose -f $COMPOSE_FILE build --progress=plain 2>&1 | tail -20
"
ok "build 完成"

# --- Step 6:up -d ---
log ""
log "Step 6/7: docker compose up -d"
run_or_dry ssh_run "
cd $REMOTE_DIR
docker compose -f $COMPOSE_FILE config --quiet
docker compose -f $COMPOSE_FILE run --rm migrate
docker compose -f $COMPOSE_FILE up -d --wait --wait-timeout 180
docker compose -f $COMPOSE_FILE ps
"
ok "容器重啟完成"

# --- Step 7:verify + 自動 rollback ---
log ""
log "Step 7/7: 驗證部署"
echo ""
if verify_health; then
    VERIFY_OK=true
else
    VERIFY_OK=false
fi

# 驗證 game log 訊息
if [[ "$DRY_RUN" != true ]]; then
    GAME_LOG=$(ssh_run "docker logs --tail 10 zutomayo-card-online-game-1" 2>&1)
    if echo "$GAME_LOG" | grep -q "Loaded 422 cards"; then
        ok "game 載入 422 張卡成功"
    else
        warn "game 載入卡數訊息未見,請檢查 log"
    fi

    PLATFORM_LOG=$(ssh_run "docker logs --tail 20 zutomayo-card-online-platform-1" 2>&1)
    if echo "$PLATFORM_LOG" | grep -q "Zutomayo platform server running"; then
        ok "platform 啟動訊息正常"
    else
        warn "platform 啟動訊息未見,請檢查 log"
    fi
fi

echo ""

# 驗證失敗 → 自動 rollback
if [[ "$VERIFY_OK" != true ]]; then
    err "驗證失敗，啟動自動 rollback..."
    if [[ "$DRY_RUN" != true ]]; then
        perform_rollback
        echo ""
        log "重新驗證 rollback 結果"
        echo ""
        if verify_health; then
            echo ""
            echo "================================================================"
            ok "Rollback 成功 ★ 已恢復上一版 image"
            echo "  訪問: http://$SERVER_HOST:3000"
            echo "  API:  http://$SERVER_HOST:3001"
            echo "  Platform: http://$SERVER_HOST:3002/health"
            echo "================================================================"
        else
            echo ""
            err "Rollback 後驗證仍失敗，請手動檢查:"
            err "  ssh -p $SERVER_PORT $SERVER_USER@$SERVER_HOST 'docker compose -f $COMPOSE_FILE logs --tail=50'"
        fi
    else
        warn "[DRY-RUN] 跳過實際 rollback"
    fi
    exit 1
fi

echo "================================================================"
ok "部署完成 ★ commit=$HEAD_SHORT"
echo "  訪問: http://$SERVER_HOST:3000"
echo "  API:  http://$SERVER_HOST:3001"
echo "  Platform: http://$SERVER_HOST:3002/health"
echo "  Domain: https://battle.zutomayocard.online"
echo "  Rollback: ./scripts/deploy-server4.sh --rollback"
echo "================================================================"
