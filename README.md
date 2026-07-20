# ZUTOMAYO CARD Online — 線上對戰卡牌遊戲

**語言 / Languages：** [繁體中文](README.md) | [日本語](README.ja.md) | [English](README.en.md)

目前版本：**0.2.2**

> ZUTOMAYO CARD（ずっと真夜中でいいのに。官方 TCG）的非官方數位化對戰平台。
> 支援本機雙人、AI 練習、互動式教學與即時線上對戰。

## 專案現況

0.2.0 將專案從單一對戰應用擴充為多人平台：`boardgame.io` 繼續掌管權威卡牌狀態，Colyseus 負責大廳、配對、房間、邀請與觀戰 presence，ChatService 負責可持久化聊天、未讀、翻譯、舉報與管理審核。

0.2.2 新增卡組分享大廳，以及由 PostgreSQL 提供的官方日文 Q&A／勘誤資料、六語頁面、後台校訂與來源同步流程。

### 遊戲與對戰

- 本機雙人與簡單／普通／困難 AI；困難 AI 使用 lookahead 模擬。
- 422 張卡牌、4 個卡包，267 行效果文字完整解析。
- 猜拳、重抽、初始設置、效果順序、玩家選擇、戰鬥與 Chronos 晝夜流程。
- 權威階段計時與逾時恢復，斷線或無回應玩家不再永久卡住對局。
- 對戰動畫、響應式戰場、手機觸控操作與重新設計的新手教學遮罩。
- 結算頁可重試 ELO／戰績提交；伺服器提交具冪等性，本地歷史可去重並保存賽後聊天來源。

### 多人平台

- Colyseus 快速配對、自訂房、好友邀請、觀戰與大廳好友 presence。
- 穩定的房間轉交與斷線恢復；線上 session 保存平台身份、座位憑證與 boardgame.io credentials。
- 生產環境使用 Redis driver/presence，開發環境可使用 memory mode。
- Colyseus 僅保存平台殼狀態，不接觸手牌、牌組、效果或其他權威遊戲資料。

### 社交與聊天

- 好友管理、好友在線狀態與對戰邀請。
- 全域大廳、好友私聊、自訂房、對局內及賽後聊天。
- 跨對話未讀摘要、已讀游標、訊息翻譯、舉報與刪除後證據快照。
- 管理員可檢視完整對話證據、處理舉報並建立跨對話禁言處分。
- ChatService 以 PostgreSQL 作為事實來源；Colyseus 只發送不含文字內容的同步訊號。

### 其他產品能力

- 六語 UI：繁中、粵語、簡中、日文、英文、韓文。
- 牌組編輯器、卡組分享大廳、排行榜、跨裝置戰績、個人頁、OAuth 身份與反饋看板。
- 官方日文 Q&A／勘誤、在地化閱讀頁面，以及人工校訂與來源同步後台。
- PWA 安裝／更新提示與 app、build、rules 三層版本相容檢查。
- 卡牌、翻譯、使用者、ELO、聊天證據、處分與反饋管理後台。
- Playwright 核心 E2E、k6 API／WebSocket／認證／配對負載測試，以及 staging／production CD pipeline。

## 架構

```text
Browser / PWA
  ├─ HTTP + Socket.IO ──> game :3000
  │                        boardgame.io 權威對局、靜態前端、/api 代理
  ├─ HTTP ──────────────> api :3001
  │                        帳號、牌組、戰績、好友、ChatService、管理
  └─ WebSocket ─────────> platform :3002
                           Colyseus 大廳、配對、房間、邀請、觀戰

game / api / platform
  ├─ PostgreSQL：持久資料、對局狀態、參與者與聊天證據
  └─ Redis：Pub/Sub、Colyseus presence/driver、限流與暫態協調
```

### 權威邊界

| 領域     | 事實來源                     | 職責                                              |
| -------- | ---------------------------- | ------------------------------------------------- |
| 卡牌對局 | `boardgame.io` + `GameLogic` | 隱藏資訊、合法行動、計時、效果、勝負與 action log |
| 多人平台 | Colyseus                     | 大廳、房間生命週期、配對、邀請、presence、觀戰者  |
| 聊天     | ChatService + PostgreSQL     | 歷史、ACL、未讀、翻譯、舉報、審核與禁言           |
| 產品資料 | PostgreSQL                   | 帳號、牌組、戰績、好友、設定與反饋                |
| 暫態協調 | Redis                        | 跨節點同步、room discovery、限流與相容佇列        |

### 主要技術

| 層級 | 技術                                                             |
| ---- | ---------------------------------------------------------------- |
| Web  | React 19、React Router 7、TypeScript 5.8、Vite 7、Tailwind CSS 4 |
| 對局 | boardgame.io 0.50、確定性 `GameState.step` 狀態機                |
| 平台 | Colyseus、`colyseus.js`、Redis presence/driver                   |
| 後端 | Node.js、Koa／Node HTTP、PostgreSQL、Redis、Zod                  |
| 品質 | Vitest、fast-check、Playwright、k6、ESLint、Prettier、Husky      |
| 運維 | Docker Compose、GitHub Actions CI/CD、Pino、Prometheus、Sentry   |

## 本機開發

### 需求

- Node.js `>=20`；CI 與 Docker 使用 Node 22。
- npm 10+。
- 完整線上流程需要 PostgreSQL 與 Redis；Colyseus 可在 memory mode 單獨啟動。

### 安裝與啟動

```bash
npm ci
cp .env.example .env

# 後端依賴、schema、REST API 與 Colyseus platform
docker compose up -d postgres redis migrate api platform

# Vite 前端（HMR），http://localhost:3000
npm run dev
```

需要實際 boardgame.io 伺服器時，直接啟動 Compose 的 `game`，或先在已匯入 `.env` 變數的 shell 執行 `npm run build && npm run server`。`npm run platform` 可用 memory mode 單獨啟動平台服務；獨立 API 則在匯入環境變數後以 `cd api && npm ci && npm start` 啟動。

### 常用命令

| 命令                                           | 用途                                                        |
| ---------------------------------------------- | ----------------------------------------------------------- |
| `npm run verify`                               | 依序執行格式、policy、設定、Lint、型別、coverage 與生產建置 |
| `npm test` / `npm run test:watch`              | Vitest 單次／監看模式                                       |
| `npm run typecheck`                            | 檢查應用與伺服器 TypeScript                                 |
| `npm run typecheck:scripts`                    | 檢查 scripts TypeScript                                     |
| `npm run lint`                                 | ESLint                                                      |
| `npm run format:check:tracked`                 | 只檢查 Git 追蹤檔案的 Prettier 格式                         |
| `npm run build`                                | 型別檢查後建立正式前端 bundle                               |
| `npm run server`                               | 啟動 game／boardgame.io 伺服器                              |
| `npm run platform`                             | 啟動 Colyseus 平台服務                                      |
| `npm run db:migrate`                           | 套用 PostgreSQL migrations                                  |
| `npm run import:official-rulings-translations` | 從本機未追蹤來源匯入官方裁定翻譯至 PostgreSQL               |
| `npm run sync:official-rulings`                | 唯讀檢查官方 Q&A／勘誤是否有差異                            |
| `npm run translate:official-rulings`           | 產生缺少的官方規則衍生語言翻譯                              |
| `npm run smoke`                                | 核心遊戲流程 smoke                                          |
| `npm run smoke:api`                            | REST API 整合 smoke                                         |
| `npm run smoke:online`                         | boardgame.io 線上對戰 smoke                                 |
| `npm run smoke:platform-deployment`            | 驗證 platform 健康度與真實 lobby WebSocket join/leave       |
| `npm run smoke:responsive`                     | 全部響應式瀏覽器 smoke                                      |
| `npm run rule:audit`                           | 卡牌效果解析覆蓋審計                                        |
| `npm run e2e` / `npm run e2e:ui`               | Playwright 完整 E2E／互動 UI                                |
| `npm run load:api` / `load:ws`                 | k6 API／WebSocket 負載測試（需另行安裝 k6）                 |

## Docker 部署

```bash
cp .env.example .env
# 至少設定 PG_PASSWORD、REDIS_PASSWORD 與長度 >= 32 的 JWT_SECRET
docker compose up -d --build
docker compose ps
```

Compose 包含六個單元：`postgres`、`redis`、一次性的 `migrate`、`game`、`api` 與 `platform`。

另提供 `docker-compose.e2e.yml`、`docker-compose.load-test.yml` 與隔離 port／資料庫的 `docker-compose.staging.yml`。Production-hardening CD 目前隔離在 `codex/deferred-production-hardening`；staging／production SSH 部署由 `workflow_dispatch` 以已驗證 artifacts 明確觸發。

| Port   | 服務     | 說明                                            |
| ------ | -------- | ----------------------------------------------- |
| `3000` | game     | Web/PWA、boardgame.io、Socket.IO、`/api/*` 代理 |
| `3001` | api      | REST API、ChatService、帳號與管理               |
| `3002` | platform | Colyseus WebSocket rooms、`/health`、`/ready`   |

生產環境、外部 PostgreSQL／Redis、備份、migration 與水平擴展說明見 [部署指南](docs/DEPLOYMENT.md)；官方 Q&A／勘誤的同步、匯入與翻譯流程見 [官方規則資料庫指南](docs/official-rulings.md)。

## 目錄導覽

```text
src/game/             權威規則、AI、效果、卡牌載入與對戰測試
src/components/       對戰、教學、大廳與共用 React feature
src/ui/               design tokens、primitives、layout 與戰場元件
src/pages/            路由頁面
src/platform/         Colyseus runtime、rooms、身份與持久化 adapter
src/chat/             私聊鍵、對局聊天 ACL、未讀導航
src/server/           boardgame.io 的 PG、Redis、限流與可觀測性擴展
api/                  REST API 與帳號、好友、聊天、戰績、管理服務
migrations/           node-pg-migrate schema 歷史
scripts/              smoke、資料遷移、部署與審計工具
e2e/                  Playwright 認證、牌組、教學與 smoke 場景
load-tests/           k6 API、WebSocket、認證與配對壓測
docs/                 架構、API、部署、多人平台與 UI/UX 文檔
```

主要頁面包括 `/online`、`/ai`、`/tutorial`、`/deck-builder`、`/history`、`/leaderboard`、`/feedback`、`/profile`、`/rules/qa`、`/rules/errata` 與 `/admin`。

## 安全與運維

- Cookie session 與 legacy Bearer token 相容；refresh token 以 Redis `GETDEL` 原子輪替，並具雙提交 CSRF 防護。
- OAuth token 加密金鑰與 JWT secret 分離；Colyseus 使用同一帳號 session 驗證身份。
- 對局座位憑證、聊天參與證據與伺服器端 ACL 防止客戶端冒用角色。
- Redis 生產密碼、受信任代理 allowlist、參與者限定的戰績 log 與交易鎖避免限流繞過、IDOR 和 ELO 並發覆蓋。
- 具 PostgreSQL／Redis 依賴檢查的 platform `/health`、`/ready`、受保護的 `/metrics`、結構化 log、request ID 與 Sentry metadata。
- Git hooks：pre-commit 執行 staged format/lint；pre-push 執行型別檢查與測試。

## 文檔

- [完整架構](docs/ARCHITECTURE.md)
- [REST API](docs/API.md)
- [卡牌文本 i18n 維護指南](docs/card-text-i18n.md)
- [部署指南](docs/DEPLOYMENT.md)
- [多人平台架構](docs/MULTIPLAYER_PLATFORM_ARCHITECTURE.md)
- [多人平台對齊審計](docs/MULTIPLAYER_PLATFORM_ALIGNMENT_AUDIT.md)
- [貢獻指南](CONTRIBUTING.md)
- [版本紀錄](CHANGELOG.md)
- [負載測試](load-tests/README.md)
- [遊戲規則](rules.md) / [官方 Q&A](https://battle.zutomayocard.online/rules/qa) / [官方勘誤](https://battle.zutomayocard.online/rules/errata)

## 授權

本專案僅供個人學習與技術研究。卡牌、美術與相關商標版權歸 ZUTOMAYO／Sony Music Entertainment 及其權利人所有。
