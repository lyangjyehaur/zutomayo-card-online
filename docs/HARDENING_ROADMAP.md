# 生產成熟度強化路線圖

> **文件定位（2026-07-16）：歷史規劃快照。** 本文件保留於
> `codex/deferred-production-hardening` 作為成熟化需求的原始盤點，不是目前
> `master` 或 server4 的部署基線，也不應直接合併或部署。項目狀態與 commit
> 證據停留在 `master@d375b8c5`；後續判定以
> [`P0_P5_IMPLEMENTATION.md`](./P0_P5_IMPLEMENTATION.md) 及當前程式碼驗證為準。
>
> 本文件追蹤「ZUTOMAYO CARD Online」專案朝向成熟線上遊戲服務的演進計畫。
> 第一版計畫分為四階段；本文件記錄各項目的完成狀態，並針對未完成項目展開詳細實作計畫。
>
> 最後更新：2026-07-12（M6 可觀測性進階完成，merge `codex/m6-observability` 至 master `d375b8c5`）

---

## 一、四階段完成狀態總覽

### 第一階段（緊急，1-2 週）— ✅ 全部完成

| # | 項目 | 狀態 | 落地證據 |
|---|------|------|---------|
| 1.1 | 接入 Sentry（前後端） | ✅ | [src/sentry.ts](../src/sentry.ts)、[src/main.tsx](../src/main.tsx)、[src/components/ErrorBoundary.tsx](../src/components/ErrorBoundary.tsx)、`Sentry.init` in [src/server.ts](../src/server.ts) 與 [api/server.cjs](../api/server.cjs) |
| 1.2 | /health 端點 + healthcheck | ✅ | [src/server.ts](../src/server.ts) `/health` 同時檢查 PG（`SELECT 1`）+ Redis（`ping`），degraded 回 503 |
| 1.3 | Helmet + Admin constant-time 比較 | ✅ | `koa-helmet` in [src/server.ts](../src/server.ts)；API server 手動 `X-Content-Type-Options` / `X-Frame-Options`；`crypto.timingSafeEqual` in [api/adminService.cjs](../api/adminService.cjs) |
| 1.4 | API Dockerfile USER node | ✅ | [api/Dockerfile](../api/Dockerfile) multi-stage + `USER node` |
| 1.5 | PG 自動備份 cron | ✅ | [scripts/pg-backup.sh](../scripts/pg-backup.sh)（`pg_dump | gzip`、7 天 retention、含 cron 範例註解） |

**備註：** cron job 本身需在 server4 上手動配置（`crontab -e`），腳本已就緒。

---

### 第二階段（重要，2-4 週）— ✅ 全部完成

| # | 項目 | 狀態 | 說明 |
|---|------|------|------|
| 2.1 | pino 結構化日誌 + request ID | ✅ | [src/server/observability/logger.ts](../src/server/observability/logger.ts) AsyncLocalStorage + requestId；[api/observability.cjs](../api/observability.cjs) |
| 2.2 | 資料庫遷移系統（node-pg-migrate） | ✅ | B1 完成 — `migrations/` 目錄 + `scripts/db-migrate.cjs` + docker-compose `migrate` service（commit `5658c687`） |
| 2.3 | 擴大測試覆蓋率到 API + server 層 | ✅ | B2 完成 — coverage 擴至 `src/**` + `api/**`，新增 executor/GameLogic/ai/server.routes 測試，測試數 135→330（commit `e6e38240`） |
| 2.4 | Token refresh 機制 + 黑名單 | ✅ | B3 完成 — Access token 1hr + refresh token 7d（Redis）+ 黑名單 + `/api/auth/refresh`（commit `0fea3100`）；M4.5 E1 改用 GETDEL 原子操作修復 TOCTOU（commit `8bf328e2`） |
| 2.5 | Game server rate limiting | ✅ | [src/server/rateLimit.ts](../src/server/rateLimit.ts) Koa middleware，`/games/*` 120 req/min/IP，Redis 斷線 fail open |

**完成度：5/5（100%）**

---

### 第三階段（功能擴展，1-2 個月）— 部分完成

| # | 項目 | 狀態 | 說明 |
|---|------|------|------|
| 3.1 | 密碼找回 + 郵箱驗證 | ❌ | 本地註冊無 email 驗證；密碼找回依賴 Logto account center（已整合但非本地流程）→ C1（M7） |
| 3.2 | 牌組代碼導入導出 + 分享 | ⚠️ | JSON 匯入/匯出已實作（[src/game/cards/customDeck.ts](../src/game/cards/customDeck.ts)），**無短碼分享系統** → C2（M7） |
| 3.3 | 聊天系統（遊戲內 emoji/快捷語） | ✅ | **已實作** — platform server chat room + OnlineGame.tsx 聊天 UI + i18n（E13 補齊翻譯） |
| 3.4 | 好友系統 | ✅ | **已實作** — `user_friends` 表 + `/api/friends` GET/POST/DELETE 路由 + `migrations/000006_user_friends.js`（E7 補 migration） |
| 3.5 | 回放系統 | ❌ | 僅有 action log 文字，無 replay → C5（M7） |

**完成度：2.5/5（50%，聊天 + 好友已完成，牌組 JSON 匯入匯出部分完成）**

---

### 第四階段（成熟化，長期）— 部分完成

| # | 項目 | 狀態 | 說明 |
|---|------|------|------|
| 4.1 | E2E 測試 + 負載測試 | ✅ | **M5 完成** — Playwright（26 tests）+ k6（4 scripts）+ `@requires-backend` tag 模式（commit `36bc4a98`/`36dd8774`） |
| 4.2 | 自動部署 pipeline + staging 環境 | ✅ | **M5 完成** — GitHub Actions CD pipeline + `docker-compose.staging.yml` + GHCR image tagging + rollback 機制（commit `ca53b675`） |
| 4.3 | 賽季/段位系統 | ⚠️ | 段位「顯示」已實作（金輝 V / 朱痕 IV / 幽影 III / 殘月 II / 新月 I），但**無賽季重置/衰減機制** → C6（M7） |
| 4.4 | OAuth 登入 | ✅ | **提前完成** — Logto + Google + GitHub + Discord 四 provider（[api/server.cjs](../api/server.cjs) OAuth callback flow） |
| 4.5 | SSR/SSG（若需 SEO） | ❌ | 純 SPA，未評估需求 → D6（視需求） |

**完成度：3/5（60%，E2E + CD + OAuth 完成，段位部分完成）**

---

## 二、整體完成度統計

| 階段 | 完成數 | 總數 | 完成率 |
|------|--------|------|--------|
| 第一階段（緊急） | 5 | 5 | 100% |
| 第二階段（重要） | 5 | 5 | 100% |
| 第三階段（功能擴展） | 2.5 | 5 | 50% |
| 第四階段（成熟化） | 3 | 5 | 60% |
| **合計** | **15.5** | **20** | **77.5%** |

---

## 三、未完成項目詳細計畫

以下針對未完成項目重新分組為三個新階段，依優先級與依賴關係編排。
優先級標記：🔴 P0（安全/正確性風險）、🟠 P1（成熟度關鍵）、🟡 P2（品質提升）、🟢 P3（功能擴充）。

---

### 階段 A：安全與運維補強（建議 1-2 週）

> 對應原計畫第二階段剩餘項目 + 審查發現的 P0 安全缺口。

#### A1. ✅ 已完成 — 修復 `GET /api/matches/:id/log` 認證漏洞

- **影響面：** 任何人可讀取任意對戰的 action log（含玩家行為、HP、chronos）
- **修復內容：** 路由 handler 開頭加 `getAuthUserId` 認證檢查，未登入回 401
- **commit：** `a6cc2ec4 fix(security): 修復 /api/matches/:id/log 未認證存取漏洞`

#### A2. ✅ 已完成 — 啟用 CSP + API server 補完整 helmet

- **影響面：** CSP 停用無 XSS 縱深防禦；API server 缺 HSTS、Referrer-Policy、Permissions-Policy
- **修復內容：**
  - Game server：移除 `contentSecurityPolicy: false`，改用明確 directives（default-src 'self'、img-src 含 r2.dan.tw、connect-src 含 wss:、frame-ancestors 'none'）
  - API server：補 HSTS、Referrer-Policy、Permissions-Policy
- **commit：** `da70876e fix(security): 啟用 CSP 與補齊安全標頭`

#### A3. ✅ 已完成（驗證通過，無需修改）— 驗證 `api/Dockerfile` 依賴安裝

- **影響面：** `api/package.json` 只列 `ioredis` + `pg`，但 `api/observability.cjs` 與 `api/server.cjs` `require('pino')` / `require('prom-client')` / `require('@sentry/node')` 可能未安裝
- **驗證結果：** api 容器依賴已齊全，`api/package.json` 已列 pino/prom-client/@sentry/node/zod，無需補齊

#### A4. ✅ 已完成 — `/metrics` endpoint 加認證

- **影響面：** Prometheus 指標（含 HTTP 請求量、active connections、queue depth）公開可讀
- **修復內容：**
  - 新增 `METRICS_TOKEN` 環境變數做 bearer token 驗證
  - 未設定 token 時 warn 但允許存取（開發模式）
  - 已設定則檢查 `Authorization: Bearer <token>`，不符回 401
  - game server + api server 兩端皆套用
- **commit：** `244007df fix(security): /metrics 端點加 token 認證`

#### A5. ✅ 已完成 — 版本號同步統一

- **影響面：** package.json / api/package.json / src/version.ts 三處版本號脫鉤
- **修復內容：**
  - `src/version.ts` 改為 `import packageJson from '../package.json'`，`PACKAGE_VERSION = packageJson.version`（single source of truth）
  - `api/package.json` version 對齊 root（0.1.3）
  - `.env.example`、`docker-compose.yml`、`docker-compose.server4.yml`、`Dockerfile`、`api/Dockerfile` 所有 fallback 值對齊 0.1.3
- **commit：** `42c3545e fix(version): 統一版本號來源，消除硬編碼漂移`

#### A6. ✅ 已完成 — 補 admin_audit_log 寫入

- **影響面：** `admin_audit_log` 表已建但全專案無 INSERT 語句，admin 操作（reset ELO、卡片管理）無稽核
- **修復內容：** 在 `api/adminService.cjs` 加 `writeAuditLog()` 函數，所有 admin 操作（resetUserElo、upsertCard、upsertCardI18n、updateGameConfig、deleteFeedbackPost 等）記錄 admin_user_id、action、target、details
- **commit：** `2b8d2eb7 feat(admin): admin 操作寫入稽核日誌`

#### A7. ✅ 已完成 — `/api/feedback/uploads` 獨立 rate limit + magic byte 驗證

- **影響面：** 3MB body 上傳可被濫用耗資源；圖片無 magic byte 驗證
- **修復內容：**
  - 上傳路由獨立 rate limit（10 req/min/IP，key prefix `rl:upload:`）
  - 圖片加 magic byte 驗證（PNG/JPG/GIF/WEBP 檔頭檢查）
- **commit：** `1ca0b545 fix(security): 上傳路由獨立限流與 magic byte 驗證`

#### A8. ✅ 已完成 — 加 husky / lint-staged git hooks

- **影響面：** 本地 commit/push 無自動檢查
- **修復內容：**
  - `.husky/pre-commit` 跑 `lint-staged`（prettier + eslint on staged files）
  - `.husky/pre-push` 跑 `typecheck + typecheck:scripts + test`
  - `package.json` 加 `lint-staged` 配置與 `prepare: husky` script
- **commit：** `9c497189 chore(dev): 加入 husky 與 lint-staged git hooks`

#### A9. ✅ 已完成 — 補齊 deck update/delete 路由的 Zod 驗證

- **影響面：** `PUT /api/decks/:id` 繞過 schema 驗證
- **修復內容：** PUT 路由加 `validateBody(S.deckCreateSchema, __body)`；DELETE 路由無 body 不需驗證
- **commit：** `96a48678 fix(validation): deck update 路由補齊 Zod 驗證`

#### A10. ✅ 已完成 — 統一 tsconfig.scripts.json strictNullChecks

- **影響面：** scripts 目錄關閉 strictNullChecks 與 app 端不一致
- **修復內容：** 移除 `strictNullChecks: false`；修復 `scripts/game-smoke.ts` 和 `scripts/online-smoke.ts` 2 處型別錯誤
- **commit：** `2379ecfc fix(typescript): scripts 目錄啟用 strictNullChecks`

---

### 階段 B：資料庫與測試強化（建議 2-3 週）

> 對應原計畫第二階段剩餘 + 第三/四階段測試相關。

#### B1. ✅ 已完成 — 導入 node-pg-migrate schema migration 工具

- **影響面：** 目前靠 `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN IF NOT EXISTS`，無法處理不可逆變更
- **修復內容：**
  - 安裝 `node-pg-migrate@^8.0.4`（devDependency）
  - 建立 `migrations/000001_init_schema.js`：將 `initSchema()` 的所有表與索引轉為 `pgm.createTable` / `pgm.createIndex` / `pgm.addColumn`，全部 `ifNotExists: true` 確保向後相容
  - 建立 `scripts/db-migrate.cjs` CLI wrapper，橋接 PG_* 環境變數至 databaseUrl
  - `api/server.cjs` 新增 `runMigrations()`，偵測 `migrations/` 目錄存在時跑 migration，否則 fallback 至 `initSchema()`
  - `docker-compose.yml` / `docker-compose.server4.yml` 新增 `migrate` service，`api` 透過 `depends_on: service_completed_successfully` 等待
  - `package.json` 加 `db:migrate` / `db:migrate:down` / `db:migrate:make` scripts
  - `docs/DEPLOYMENT.md` 加 migration 說明
- **commit：** `5658c687 feat(db): 導入 node-pg-migrate schema migration 工具`

#### B2. ✅ 已完成 — 擴大測試覆蓋率

- **影響面：** `vitest.config.ts` coverage 只含 `src/game/**`；關鍵模組零測試
- **修復內容：**
  - `vitest.config.ts` coverage include 改為 `['src/**', 'api/**']`，設定 threshold（lines 50, functions 50, branches 40, statements 50）
  - 新增 `src/game/effects/__tests__/executor.test.ts`：79 tests，覆蓋所有 38 個 effect handler
  - 新增 `src/game/__tests__/GameLogic.test.ts`：69 tests，覆蓋 setup、janken、mulligan、setCard/confirmReady/resolveTurn/resolveBattle/finishTurn、endIf、playerView
  - 新增 `src/game/__tests__/ai.test.ts`：13 tests，覆蓋 easy/normal/hard 決策、scoreCard
  - 新增 `api/__tests__/server.routes.test.ts`：34 tests，覆蓋 security headers、CORS、health、input validation、auth middleware、rate limiting
  - 測試總數從 135 提升至 330
- **commit：** `e6e38240 test: 擴大測試覆蓋率至 effects executor、GameLogic、AI、server routes`

#### B3. ✅ 已完成 — Token refresh 機制 + 黑名單

- **影響面：** JWT 7 天長效 token 無 refresh、無撤銷；登出僅清 cookie
- **修復內容：**
  - Access token TTL 7天→1小時，payload 加 jti
  - 新增 refresh token（7 天，存 Redis `refresh:{jti}`）
  - `verifyToken` 加黑名單檢查（Redis `blacklist:{jti}`，TTL=剩餘壽命）
  - `POST /api/auth/refresh` 路由（rotate refresh token）
  - logout 撤銷 access + refresh token
  - 前端 `src/api/client.ts` 攔截 401 自動 refresh
  - 向後相容：舊 JWT 無 jti 仍可驗證
- **commit：** `0fea3100 feat(auth): Token refresh 機制與 JWT 黑名單`

#### B4. ✅ 已完成 — OAuth token 加密金鑰獨立

- **影響面：** OAuth token 加密金鑰從 JWT_SECRET 衍生，JWT_SECRET 洩漏即破解所有 OAuth token
- **修復內容：**
  - `secretEncryptionKey()` 優先使用 `OAUTH_TOKEN_ENCRYPTION_KEY`
  - `decryptSecret()` 失敗時 fallback 嘗試舊金鑰（向後相容）
  - `validateSecurityConfig()` 加長度檢查
  - `.env.example` 加說明
- **commit：** `fff5609 fix(security): OAuth token 加密金鑰獨立於 JWT_SECRET`

#### B5. ✅ 已完成 — 補 CONTRIBUTING.md / CHANGELOG / commit 規範

- **修復內容：**
  - 新增 `CONTRIBUTING.md`：開發流程、commit 規範（Conventional Commits 繁中）、分支策略、測試要求、PR 流程
  - 新增 `CHANGELOG.md`：Keep a Changelog 格式，回填 0.1.1/0.1.2/0.1.3 三個版本
  - 安裝 `@commitlint/cli` + `@commitlint/config-conventional`
  - 建立 `commitlint.config.cjs`（允許繁中 subject）
  - 新增 `.husky/commit-msg` hook
- **commit：** `c26009cf docs: 新增 CONTRIBUTING.md、CHANGELOG.md 與 commit 規範`

#### B6. ✅ 已完成 — CSRF token 機制

- **影響面：** 僅靠 SameSite=Lax 防 CSRF，跨站 POST 仍可能透過表單觸發
- **修復內容：**
  - Double-submit cookie pattern：`zutomayo_csrf` cookie
  - CSRF middleware 驗證 POST/PUT/DELETE，豁免 login/register/refresh/logout 等 7 個路由
  - `GET /api/csrf-token` 路由
  - 前端自動加 `X-CSRF-Token` header
- **commit：** `484f70a feat(security): CSRF token 雙提交 cookie 防護`

#### B7. ✅ 已完成 — 補獨立架構文檔

- **修復內容：** 新增 `docs/ARCHITECTURE.md`（676 行），涵蓋 9 大章節：
  1. 系統概觀（三層架構圖 + mermaid 請求流向）
  2. 前端架構（React+Vite SPA、boardgame.io client、PWA、i18n）
  3. Game Server 架構（PostgresAdapter 樂觀鎖、雙層 Redis 水平擴展、playerView）
  4. API Server 架構（13 個 service 模組、OAuth flow、防作弊五步驗證鏈）
  5. 遊戲邏輯架構（狀態機流程圖、效果引擎 mermaid、AI 三難度）
  6. 資料層架構（PG 兩 database、Redis DB index 隔離、node-pg-migrate）
  7. 線上對戰流程（matchmaking、斷線重連 state mismatch 偵測、ELO 計算）
  8. 可觀測性架構（pino ALS、Prometheus、Sentry）
  9. 部署架構（Docker multi-stage、水平擴展策略）
- **commit：** `4fcf443a docs: 新增獨立架構文檔 ARCHITECTURE.md`

---

### 階段 C：功能擴展（建議 1-2 個月）

> 對應原計畫第三階段 + 第四階段剩餘功能。

#### C1. 🟢 P3 — 密碼找回 + 郵箱驗證（本地帳號）

- **現狀：** Logto 模式下已有密碼找回（透過 account center）；本地帳號無流程
- **實作步驟：**
  1. `POST /api/auth/forgot-password`：產生 reset token（Redis，10 分鐘 TTL），寄信
  2. `POST /api/auth/reset-password`：驗證 token 後重設密碼
  3. 本地註冊加 email 驗證：寄驗證信，`email_verified` 欄位
  4. SMTP 複用 Logto 的 Resend connector 設定
- **預估工作量：** 3 天
- **備註：** 若 `AUTH_MODE=logto` 為主，本項優先級可降低

#### C2. 🟢 P3 — 牌組短碼分享系統

- **現狀：** JSON 匯入/匯出已實作，缺短碼
- **實作步驟：**
  1. `POST /api/decks/share`：將牌組存入 `shared_decks` 表，回傳 6-8 字元短碼
  2. `GET /api/decks/shared/:code`：用短碼取回牌組
  3. 前端 DeckEditor 加「分享」按鈕，產生分享連結
  4. 加「匯入分享碼」輸入框
- **預估工作量：** 2 天

#### C3. ✅ 已完成 — 聊天系統（遊戲內 emoji / 快捷語）

- **實作內容：** platform server chat room + OnlineGame.tsx 聊天 UI；E13 補齊 15 個 `chat.match*` i18n key 到 6 語系
- **落地證據：** [src/platform/server.ts](../src/platform/server.ts) chat room、[src/components/OnlineGame.tsx](../src/components/OnlineGame.tsx) 聊天 UI、`migrations/000002_chat_report_snapshots.js` + `000005_chat_user_sanctions.js`
- **備註：** 含聊天檢舉與制裁機制（chat report snapshots + user sanctions）

#### C4. ✅ 已完成 — 好友系統

- **實作內容：** `user_friends` 表 + `/api/friends` GET/POST/DELETE 路由 + `friendService.cjs`
- **落地證據：** [api/server.cjs](../api/server.cjs) 第 2533-2558 行好友路由、[api/friendService.cjs](../api/friendService.cjs)、`migrations/000006_user_friends.js`（E7 補 migration 消除 schema drift）
- **備註：** 簡化版（直接加好友，無 pending/accept 流程）；線上狀態可整合 platform presence

#### C5. 🟢 P3 — 回放系統

- **實作步驟：**
  1. 對戰結束時將完整 `G` + `ctx` + `actionLog` 序列化存入 `match_replays` 表（或 S3/R2）
  2. `GET /api/matches/:id/replay`：取回 replay 資料
  3. 前端 ReplayPlayer：用 boardgame.io reducer 重播，含播放/暫停/快轉/拖曳進度條
  4. 對戰歷史加「觀看回放」按鈕
- **預估工作量：** 7 天

#### C6. 🟢 P3 — 賽季/段位系統完善

- **現狀：** 段位「顯示」已實作，缺賽季機制
- **實作步驟：**
  1. `seasons` 表（id, name, start_at, end_at）
  2. `user_season_stats` 表（user_id, season_id, elo, peak_elo, matches, wins）
  3. 賽季結束時：快照最終 ELO、發放段位獎勵（badge/border）、軟重置 ELO（如回歸 1000 + 保留 50% 差值）
  4. ProfilePage 顯示歷史賽季紀錄
  5. 段位邊框應用於頭像
- **預估工作量：** 5 天

#### C7. 🟢 P3 — ELO 配對（matchmaking 改進）

- **現狀：** matchmaking Lua 腳本似僅 FIFO 配對，未依 ELO 匹配
- **實作步驟：**
  1. 修改 `mmTryMatch` Lua 腳本：優先匹配 ELO 差距 ≤ 200 的玩家，擴大窗口隨排隊時間增長
  2. 加入 `queued_at` 時間戳，超時（如 30s）放寬匹配範圍
  3. 前端顯示預估等待時間
  4. 配對成功通知（整合 C10 通知系統）
- **預估工作量：** 3 天

#### C8. 🟢 P3 — 卡牌名稱 i18n

- **現狀：** 僅卡牌效果有 i18n（250 張 6 語），卡牌名稱/屬性/類型固定日文
- **實作步驟：**
  1. 在 `card_effects_i18n` 表加 `name` 欄位（或獨立 `card_names_i18n` 表）
  2. 補齊 422 張卡的 6 語名稱（可先用機翻 + 人工校對）
  3. `getTranslatedCardName(cardId, locale)` API
  4. 前端 CardBrowser / DeckEditor / Board 改用 i18n 名稱
  5. 屬性名稱（闇/炎/電気/風/カオス）加 i18n key
- **預估工作量：** 3 天（不含翻譯校對）

#### C9. 🟢 P3 — 離線對戰 + PWA API 快取

- **現狀：** PWA 快取靜態資源與卡圖，但對戰依賴 API 載入卡牌資料，離線無法玩
- **實作步驟：**
  1. Workbox runtimeCaching 加 `cards` / `card-effects-i18n` API 回應（StaleWhileRevalidate，長 TTL）
  2. 確保卡牌資料快取後 AI 對戰可離線運作
  3. 離線時隱藏配對/排行榜等需連線功能
  4. 加離線提示頁面引導用戶連線
- **預估工作量：** 2 天

#### C10. 🟢 P3 — 通知系統

- **現狀：** 反饋狀態變動、配對成功、對手斷線等皆無推播通知
- **實作步驟：**
  1. `notifications` 表（user_id, type, payload, read_at, created_at）
  2. `GET /api/notifications`、`POST /api/notifications/:id/read`
  3. 觸發點：反饋狀態變動、配對成功、好友請求、對戰結束
  4. 前端 NotificationBell + dropdown
  5. （可選）Web Push API 推播
- **預估工作量：** 4 天

#### C11. 🟢 P3 — 牌組統計面板

- **現狀：** DeckEditor 無屬性分布、cost 曲線、攻擊力分布圖表
- **實作步驟：**
  1. `getDeckStats(deck)`：計算屬性分布、card type 分布、power cost 直方圖、attack power 分布、chronos 分布
  2. DeckEditor 加統計面板（雷達圖/直方圖，用 recharts 或純 SVG）
  3. 響應式：desktop 側邊面板、mobile sheet
- **預估工作量：** 2 天

---

### 階段 D：成熟化與自動化（長期，1-2 個月）

> 對應原計畫第四階段。

#### D1. 🟠 P1 — E2E 測試框架

- **實作步驟：**
  1. `npm i -D @playwright/test`
  2. `playwright.config.ts`：多瀏覽器（chromium/firefox/webkit）、mobile viewport
  3. 核心 E2E 場景：註冊→登入→編輯牌組→配對→對戰→結果顯示
  4. 教學模式完整跑完
  5. CI 加 `e2e` job（用 docker-compose 起完整環境）
- **預估工作量：** 5 天

#### D2. 🟠 P1 — 負載測試

- **實作步驟：**
  1. `npm i -D k6`
  2. `tests/load/socket.io.test.js`：模擬 100/500/1000 並發 WebSocket 連線
  3. `tests/load/api.test.js`：模擬配對佇列、對戰提交高頻請求
  4. `tests/load/matchmaking.test.js`：模擬 100 人同時排隊配對
  5. 記錄 P50/P95/P99 latency、錯誤率、PG/Redis 連線數
- **預估工作量：** 3 天

#### D3. 🟠 P1 — 自動部署 pipeline + staging 環境

- **實作步驟：**
  1. GitHub Actions `cd.yml`：push tag `v*` → build Docker images → push GHCR
  2. image tagging：`latest`、`{version}`、`{git-sha}`
  3. staging 環境（docker-compose.staging.yml）：獨立 PG/Redis DB index
  4. staging 部署後自動跑 smoke tests
  5. 手動 approval → promote staging image 到 production
  6. rollback 機制：保留前 3 個 image，一鍵 `docker compose rollback`
- **預估工作量：** 5 天

#### D4. ✅ 已完成 — Grafana dashboard + alerting

- **修復內容：**
  - 4 個 Grafana dashboard：game-server（8 panels）、api-server（7 panels）、platform-server（5 panels）、infrastructure（6 panels）
  - 8 條告警規則：HighErrorRate5xx、PgPoolWaitingHigh、PgConnectionsNearMax、RedisMemoryNearMax、WebSocketConnectionsNearLimit、HighEventLoopLag、ServiceDown、MatchmakingQueueDepthHigh
  - Slack（critical）+ Email（warning）contact points，用 `$__env{...}` 變數替換
  - Prometheus scrape config（6 jobs）+ Grafana provisioning（datasources + dashboards）
  - `docker-compose.monitoring.yml`：prometheus:9090、grafana:3003、postgres-exporter:9187、redis-exporter:9121、cadvisor:8080
- **commit：** `ba8b53dc feat(observability): Grafana dashboards、告警規則與 Prometheus 配置`
- **已知限制：** platform server 無 `/metrics` endpoint，platform dashboard 為前瞻配置

#### D5. ✅ 已完成 — 分散式追蹤（OpenTelemetry）

- **修復內容：**
  - 安裝 11 個 `@opentelemetry/*` 套件
  - game server tracing（[src/server/observability/tracing.ts](../src/server/observability/tracing.ts)）：http、koa、ioredis、pg、socket.io instrumentation
  - api server tracing（[api/tracing.cjs](../api/tracing.cjs)）：http、ioredis、pg instrumentation
  - platform server tracing（[src/platform/tracing.ts](../src/platform/tracing.ts)）：http、express、ioredis、pg instrumentation
  - pino logger 加 `traceContextMixin` 注入 traceId/spanId
  - docker-compose 加 Jaeger all-in-one（UI: 16686、OTLP HTTP: 4318）
  - 未設定 `OTEL_EXPORTER_OTLP_ENDPOINT` 時為 no-op
- **commit：** `bbd49a12 feat(observability): OpenTelemetry 分散式追蹤與 Jaeger 整合`

#### D6. 🟢 P3 — SSR/SSG（若需 SEO）

- **實作步驟：**
  1. 評估 SEO 需求（卡牌資料、牌組指南、排行榜是否需被搜尋引擎收錄）
  2. 若需要：用 Astro/Next.js 重寫首頁 + 卡牌瀏覽頁為 SSG
  3. 對戰頁保持 SPA
- **預估工作量：** 視需求評估，5-10 天

#### D7. ✅ 已完成 — PgBouncer 連線池管理

- **影響面：** 多實例 game server 各自開 25 條 PG 連線（cardPool 5 + PostgresAdapter 20），10 個實例 = 250 條，逼近 PG 預設 `max_connections=100`
- **修復內容：**
  - [observability/pgbouncer/pgbouncer.ini](../observability/pgbouncer/pgbouncer.ini)：transaction mode、3 個 database alias、max_client_conn=200、default_pool_size=20
  - [observability/pgbouncer/Dockerfile](../observability/pgbouncer/Dockerfile)（基於 edoburu/pgbouncer）
  - [docker-compose.pgbouncer.yml](../docker-compose.pgbouncer.yml)：overlay 將 game/api/platform 的 PG_HOST 指向 pgbouncer:6432
  - [docs/DEPLOYMENT.md](../DEPLOYMENT.md) 加 PgBouncer 說明（啟用方式、transaction vs session mode、boardgame.io adapter 警告）
- **commit：** `71202390 feat(infra): PgBouncer 連線池代理與水平擴展配置`
- **已知限制：** boardgame.io `PostgresAdapter.fetchStateForUpdate()` 跨 fetch→setState 持有事務，transaction mode 不相容；game server 若遇問題應改用 session mode

#### D8. ✅ 已完成 — i18n 缺翻譯警示與管理

- **影響面：** 6 語 key 數不完全一致（zh-TW 787 / ko 800 / en 798），缺翻譯無自動偵測
- **修復內容：**
  - [scripts/check-i18n.ts](../scripts/check-i18n.ts)：以 zh-TW（871 keys）為基線，檢查 en/ja/ko/zh-HK/zh-CN 缺失 key、空值、可疑值（與 zh-TW 相同的非中文值）
  - zh-HK/zh-CN 豁免可疑值檢查（中文變體）
  - 缺失 key exit 1，可疑值 exit 0 並印 warning
  - `package.json` 加 `"i18n:check": "tsx scripts/check-i18n.ts"`
  - CI（[.github/workflows/ci.yml](../.github/workflows/ci.yml)）加 "Check i18n completeness" step
  - 驗證結果：6 語所有 key 皆存在，僅有少數刻意保留的英文專有名詞被標為可疑（如 "HP"、"Chronos"、"Discord"）
- **commit：** `9b8b46c7 feat(i18n): 缺翻譯檢查腳本與 CI 整合`

---

### 階段 E：第三輪審查快速修復（M4.5，建議 1-2 天）

> 基於第三輪深度審查（HEAD `ca717aa2`），涵蓋 209 個新 commit 帶來的 Colyseus 平台、聊天系統、自訂房間等模組。

#### E1. ✅ 已完成 — Refresh token TOCTOU race condition

- **修復內容：** 新增 `consumeRefreshTokenJti(jti)` 用 Redis GETDEL 原子操作；fallback 支援舊版 Redis
- **commit：** `8bf328e2 fix(security): refresh token 改用 Redis GETDEL 原子操作防止 TOCTOU 競態`

#### E2. ✅ 已完成 — Redis 無密碼保護

- **修復內容：** docker-compose.yml redis 加 `--requirepass`；REDIS_URL 加密碼；.env.example 加 REDIS_PASSWORD
- **commit：** `d254ea02 fix(security): Redis 加密碼保護與 REDIS_PASSWORD 環境變數`

#### E3. ✅ 已完成 — `/api/matches/:id/log` IDOR

- **修復內容：** `getMatchActionLog` 加 userId 參數 + SQL `AND (player0_id = $2 OR player1_id = $2)`；查無回 403
- **commit：** `6b82d968 fix(security): matches/log 路由加授權檢查防止 IDOR 越權讀取`

#### E4. ✅ 已完成 — `seatToken` 不安全預設密鑰

- **修復內容：** platform server 啟動時加 `validateSecurityConfig()`，production 無密鑰則 exit(1)
- **commit：** `ca632a77 fix(security): platform server 啟動時強制檢查 seatToken 密鑰`

#### E5. ✅ 已完成 — ELO lost update race condition

- **修復內容：** `SELECT * FROM users WHERE id = $1 FOR UPDATE`
- **commit：** `87312d27 fix(match): ELO 計算加 SELECT FOR UPDATE 防止並發 lost update`

#### E6. ✅ 已完成 — playerView 未 redact setZoneC/powerCharger/abyss

- **修復內容：** `redactPlayerForViewer` 補上 setZoneC/powerCharger/abyss 的 redactHiddenCard
- **commit：** `d8847ad9 fix(game): playerView 補 redact setZoneC/powerCharger/abyss 防止資訊洩漏`

#### E7. ✅ 已完成 — `user_friends` 表缺 migration

- **修復內容：** 新增 `migrations/000006_user_friends.js`
- **commit：** `e9c69a90 feat(db): 新增 user_friends 表 migration 消除 schema drift`

#### E8. ✅ 已完成 — `MAX_CONN_PER_IP` env var 被 ignore

- **修復內容：** 改為 `Number(process.env.MAX_CONN_PER_IP) || 10`
- **commit：** `0fe6e0a6 fix(server): MAX_CONN_PER_IP 改讀環境變數`

#### E9. ✅ 已完成 — Platform `/health` 不檢查依賴

- **修復內容：** `/health` 加 PG SELECT 1 + Redis ping，失敗回 503
- **commit：** `477b88e0 fix(platform): /health 端點加 PG/Redis 依賴檢查`

#### E10. ✅ 已完成 — `X-Forwarded-For` 偽造繞過限流

- **修復內容：** 加 `TRUSTED_PROXY` 環境變數 + `getClientIp()` helper；API port 改為 expose 不暴露
- **commit：** `13fa496d fix(security): 加 TRUSTED_PROXY 設定防止 X-Forwarded-For 偽造繞過限流`

#### E11. ✅ 已完成 — QuickMatchRoom 同使用者 TOCTOU

- **修復內容：** 新增 `authenticatedUserIds = new Set<string>()`，onAuth 階段原子標記
- **commit：** `496062dd fix(platform): QuickMatchRoom onAuth 階段原子標記 userId 防止 TOCTOU 重複加入`

#### E12. ✅ 已完成 — CustomRoom host 在 ready 狀態斷線卡死

- **修復內容：** host 替換邏輯擴展到 ready 狀態，找不到同 userId 替換時讓最早加入的 player 接管
- **commit：** `da1eb34c fix(platform): CustomRoom host 在 ready 狀態斷線時允許其他 player 接管`

#### E13. ✅ 已完成 — OnlineGame.tsx 聊天 UI 繞過 i18n

- **修復內容：** 新增 15 個 `chat.match*` i18n key 到 6 語系；替換所有硬編碼字串
- **commit：** `e6bb2f39 fix(i18n): OnlineGame 聊天 UI 補齊 i18n 翻譯`

---

## 四、優先級與時程建議

### 里程碑時程

| 里程碑 | 內容 | 預估週數 | 累計 |
|--------|------|---------|------|
| **M1：安全補強** ✅ | A1-A5（P0 全部） | 1 週 | 1 週 |
| **M2：運維補強** ✅ | A6-A10 + B1（migration） | 2 週 | 3 週 |
| **M3：測試強化** ✅ | B2 + B5 + B7（架構文檔） | 2 週 | 5 週 |
| **M4：Token 安全** ✅ | B3 + B4 + B6（CSRF） | 2.5 週 | 7.5 週 |
| **M4.5：第三輪快速修復** ✅ | E1-E13（P1×9 + P2×4） | 0.3 週 | 7.8 週 |
| **M5：E2E + 負載 + CD** ✅ | D1-D3（PgBouncer 移至 M6） | 3.5 週 | 11.3 週 |
| **M6：可觀測性進階** ✅ | D4-D5 + D7-D8（Grafana/OTel/PgBouncer/i18n check） | 1.5 週 | 12.8 週 |
| **M7：功能擴展** | C1-C11（視需求挑選） | 6-8 週 | 18-20 週 |

### 關鍵路徑

```
M1 (安全) → M2 (運維) → M3 (測試) → M5 (E2E/CD)
                              ↘ M4 (Token) ↗
```

- M1 是阻塞性的（安全漏洞不修無法放心上線新功能）
- M2 的 migration 工具是後續所有 schema 變更的基礎
- M3 的測試防線是 M5 CD 自動化的前提
- M4 可與 M3 並行
- M6/M7 可視資源彈性調整

---

## 五、風險與注意事項

1. **CSP 啟用可能影響前端功能**：PWA、inline style、WebSocket 都可能被 CSP 阻擋，需逐一測試
2. **node-pg-migrate 遷移既有 schema**：需確保初始 migration 與現有 DB 狀態一致，避免重跑時衝突
3. **Token refresh 改動影響全端**：前後端需同步更新，否則 401 風暴
4. **CD pipeline 需配合 server4 環境**：1panel-network、既有 PG/Redis、.env 管理
5. **負載測試勿在 production 跑**：用獨立 staging 或本地 docker-compose
6. **賽季系統需考慮資料量**：`user_season_stats` 會隨賽季累積，需加索引與清理策略

---

## 六、歷史記錄

| 日期 | 事件 |
|------|------|
| 2026-07-07 | 初版路線圖建立。Phase 1（Sentry/health/Helmet/Dockerfile/backup）+ Phase 2 部分（pino/rate-limit）+ OAuth（提前完成）已落地於 `codex/prod-hardening-stage1` 分支並 merge 至 master |
| 2026-07-07 | 第二輪深度審查後補充：新增 A9（deck route Zod）、A10（tsconfig 嚴格度）、B6（CSRF）、B7（架構文檔）、C7（ELO 配對）、C8（卡名 i18n）、C9（離線對戰）、C10（通知系統）、C11（牌組統計）、D7（PgBouncer）、D8（i18n 警示）共 11 項 |
| 2026-07-09 | M1（安全補強）完成於 worktree `codex/m1-security-p0`。A1-A5 全部完成（4 commits + A3 驗證通過無需修改）。typecheck/lint/format/test(135)/build 全綠 |
| 2026-07-09 | M2（運維補強）完成。A6-A10 + B1 全部完成（7 commits）。typecheck/lint/format/test(135) 全綠 |
| 2026-07-09 | M3（測試強化）完成。B2 + B5 + B7 全部完成（3 commits）。測試從 135 提升至 330。typecheck/lint/format/test(330) 全綠 |
| 2026-07-09 | M4（Token 安全）完成。B3 + B4 + B6 全部完成（3 commits）。typecheck/lint/format/test(335) 全綠 |
| 2026-07-09 | M1-M4 merge 至 master（`d4aa3dc1`）。6 個衝突檔解決（版本號為主）。typecheck/lint/test(336) 全綠 |
| 2026-07-12 | 第三輪深度審查（基於 HEAD `ca717aa2`，含 209 個新 commit：Colyseus 平台、聊天系統、自訂房間、配對快照恢復、卡牌戰場動畫）。發現 15 個 P1 + 20 個 P2 新問題。finishMulligan splice 已修復、CardView 鍵盤可操作性已修復 |
| 2026-07-12 | M4.5（第三輪快速修復）完成於 worktree `codex/m45-third-round-fixes`。E1-E13 全部完成（16 commits）。typecheck/lint/format/test(617) 全綠 |
| 2026-07-12 | M4.5 merge 至 master（`70b3a8a7`）並 push。617 tests 全綠 |
| 2026-07-12 | M5（E2E + 負載 + CD）完成於 worktree `codex/m5-test-cd`。D1 Playwright（26 tests）+ D2 k6（4 scripts）+ D3 CD pipeline + staging（3 commits）。typecheck/lint/format/test(617) 全綠 |
| 2026-07-12 | M6（可觀測性進階）完成於 worktree `codex/m6-observability`。D4 Grafana 4 dashboards + 8 alert rules + Prometheus（commit `ba8b53dc`）、D5 OpenTelemetry 3 tracing configs + Jaeger + pino traceId（commit `bbd49a12`）、D7 PgBouncer transaction pool + compose overlay（commit `71202390`）、D8 i18n check script + CI step（commit `9b8b46c7`）。4 commits、28 files、+2801/-54 行。typecheck/lint/format/test(617)/i18n:check 全綠 |
| 2026-07-12 | M6 merge 至 master（`d375b8c5`）並 push。617 tests 全綠。至此 M1-M6 全部完成，僅剩 M7 功能擴展（C1-C11）視需求挑選 |
