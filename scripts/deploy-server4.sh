#!/bin/bash
# deploy-server4.sh — ZUTOMAYO Card Online 標準部署腳本
#
# 一鍵完成:備份 → server4 git reset → 更新 APP_BUILD_ID → build → up → verify
#
# 用法:
#   ./scripts/deploy-server4.sh                    # 直接執行
#   ./scripts/deploy-server4.sh --confirm          # 執行前二次確認
#   ./scripts/deploy-server4.sh --sha <sha>       # 指定要部署的 commit(預設=本地 HEAD)
#   ./scripts/deploy-server4.sh --dry-run          # 只顯示會做什麼,不真的執行
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

# --- 旗標解析 ---
CONFIRM=false
DRY_RUN=false
TARGET_SHA=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --confirm) CONFIRM=true; shift ;;
        --dry-run) DRY_RUN=true; shift ;;
        --sha) TARGET_SHA="$2"; shift 2 ;;
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

run_or_dry() {
    if [[ "$DRY_RUN" == true ]]; then
        echo -e "${YELLOW}[DRY-RUN]${NC} $*"
    else
        "$@"
    fi
}

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
HEAD_SHA=$(git rev-parse HEAD)
HEAD_SHORT=$(git rev-parse --short HEAD)

# 確認 origin/master = HEAD(都已 push)
git fetch origin >/dev/null 2>&1 || true
ORIGIN_SHA=$(git rev-parse origin/master 2>/dev/null || echo "")
if [[ -n "$ORIGIN_SHA" && "$ORIGIN_SHA" != "$HEAD_SHA" ]]; then
    err "本地 HEAD ($HEAD_SHORT) 跟 origin/master ($(git rev-parse --short origin/master 2>/dev/null)) 不一致"
    err "請先 git push origin master 再部署"
    exit 1
fi
ok "目標 commit: $HEAD_SHORT(已 push 到 origin/master)"

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

# 5. 二次確認
if [[ "$CONFIRM" == true ]]; then
    warn "即將部署 commit $HEAD_SHORT 到 $SERVER_HOST"
    warn "影響容器: zutomayo-card-online-game-1, zutomayo-card-online-api-1"
    read -rp "確認繼續? [y/N] " ans
    [[ "$ans" =~ ^[Yy]$ ]] || { err "取消"; exit 1; }
fi

# --- Step 1:備份 ---
log ""
log "Step 1/6: 備份 server4 .env 與 $COMPOSE_FILE"
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
log "Step 2/6: server4 git reset 到 origin/master"
run_or_dry ssh_run "
set -e
cd $REMOTE_DIR
git config --global --add safe.directory $REMOTE_DIR 2>/dev/null || true
git fetch origin 2>&1 | tail -3

BEHIND=\$(git rev-list --count HEAD..origin/master 2>/dev/null || echo 0)
AHEAD=\$(git rev-list --count origin/master..HEAD 2>/dev/null || echo 0)
echo \"  server4 HEAD 落後 origin/master: \$BEHIND 個 commit\"
echo \"  server4 HEAD 領先 origin/master: \$AHEAD 個 commit\"

if [[ \$AHEAD -gt 0 ]]; then
    echo '  ⚠ server4 有未推回 origin 的 commit,將會丟失'
    git log --oneline origin/master..HEAD
fi

git reset --hard origin/master
git log --oneline -3
"
ok "git reset 完成"

# --- Step 3:更新 APP_BUILD_ID / APP_VERSION / GAME_RULES_VERSION ---
# 三個都要從 package.json 跟 HEAD 同步，避免依賴 Docker/Compose 的空值 fallback。
log ""
log "Step 3/6: 同步 server4 .env 的版本號(APP_BUILD_ID / APP_VERSION / GAME_RULES_VERSION)"
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

# --- Step 4:build ---
log ""
log "Step 4/6: docker compose build(可能要 1-3 分鐘)"
run_or_dry ssh_run "
cd $REMOTE_DIR
docker compose -f $COMPOSE_FILE build --progress=plain 2>&1 | tail -20
"
ok "build 完成"

# --- Step 5:up -d ---
log ""
log "Step 5/6: docker compose up -d"
run_or_dry ssh_run "
cd $REMOTE_DIR
docker compose -f $COMPOSE_FILE up -d 2>&1 | tail -10
sleep 8
docker compose -f $COMPOSE_FILE ps
"
ok "容器重啟完成"

# --- Step 6:verify ---
log ""
log "Step 6/6: 驗證部署"
echo ""
GAME_VERSION=$(curl -s --max-time 5 http://$SERVER_HOST:3000/api/version 2>/dev/null || echo "FAILED")
API_VERSION=$(curl -s --max-time 5 http://$SERVER_HOST:3001/api/version 2>/dev/null || echo "FAILED")
GAME_HTTP=$(curl -sI --max-time 5 http://$SERVER_HOST:3000/ 2>/dev/null | head -1 || echo "FAILED")
API_HTTP=$(curl -sI --max-time 5 http://$SERVER_HOST:3001/ 2>/dev/null | head -1 || echo "FAILED")

echo "  game /api/version : $GAME_VERSION"
echo "  api  /api/version : $API_VERSION"
echo "  game HTTP         : $GAME_HTTP"
echo "  api  HTTP         : $API_HTTP"
echo ""

# 驗證 game log 訊息
if [[ "$DRY_RUN" != true ]]; then
    GAME_LOG=$(ssh_run "docker logs --tail 10 zutomayo-card-online-game-1" 2>&1)
    if echo "$GAME_LOG" | grep -q "Loaded 422 cards"; then
        ok "game 載入 422 張卡成功"
    else
        warn "game 載入卡數訊息未見,請檢查 log"
    fi
fi

echo ""
echo "================================================================"
ok "部署完成 ★ commit=$HEAD_SHORT"
echo "  訪問: http://$SERVER_HOST:3000"
echo "  API:  http://$SERVER_HOST:3001"
echo "  Domain: https://battle.zutomayocard.online"
echo "================================================================"
