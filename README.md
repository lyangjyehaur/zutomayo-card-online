# ZUTOMAYO CARD Online — 線上對戰卡牌遊戲

**語言 / Languages:** [繁體中文](README.md) | [日本語](README.ja.md) | [English](README.en.md)

> ZUTOMAYO CARD（ずっと真夜中でいいのに官方 TCG）的數位化線上對戰平台。
> 支援本機雙人、AI 練習、線上即時對戰，完整實作官方規則。

---

## 遊戲簡介

ZUTOMAYO CARD 是一款 2 人對戰型集換式卡牌遊戲（TCG），以日本樂團「ずっと真夜中でいいのに」為主題。

**核心機制：**

- 每人 20 張牌組，初始 HP 100
- **Chronos 晝夜系統** — 圓形時鐘決定當前是夜(NIGHT)還是晝(DAY)，影響角色攻擊力
- **三種卡牌類型** — Character（角色）、Enchant（附魔）、Area Enchant（區域附魔）
- **五種屬性** — 闇、炎、電気、風、カオス
- **猜拳開局** — 決定夜側玩家
- **追趕機制** — 敗者下回合可出 2 張牌

---

## 功能清單

### 遊戲模式

- **本機對戰** — 同螢幕兩人對戰
- **AI 練習** — 簡單/普通/困難三種難度，困難模式使用 lookahead 模擬
- **線上對戰** — boardgame.io WebSocket 即時同步，配對佇列，支援重連

### 卡牌系統

- 422 張完整卡牌數據（4 個卡包）
- 267 行效果文字全部解析（100% 覆蓋率）
- 效果規則引擎支援 30+ 種動作類型和 15+ 種條件類型
- 250 張效果卡 × 6 種語言翻譯（LLM 生成）

### UI/UX

- **全屏無滾動** — 100vh/100vw 遊戲介面
- **響應式設計** — 桌面/平板/手機自適應
- **六語言** — 繁體中文（台灣）、粵語（香港）、簡體中文、日本語、English、한국어
- **互動式教學** — 新手引導，逐步學習遊戲規則
- **牌組編輯器** — 422 張卡篩選/排序/組牌，支援伺服器同步與本地自訂牌組
- **對戰紀錄** — 本地歷史記錄
- **排行榜** — ELO 評分系統

### 管理後台

- 卡牌數據瀏覽器（篩選/搜尋/詳情）
- i18n 翻譯管理
- 使用者列表與 ELO 重設
- Admin token 登入（`/api/admin/login`，密碼由 `ADMIN_PASSWORD` 環境變數提供）

---

## 技術架構

```
┌─────────────────────────────────────────────┐
│              前端 (Vite + React)             │
│  React 19 · TypeScript · React Router 7     │
│  Tailwind CSS 4 · daisyUI 5 · Lucide        │
│  boardgame.io Client                        │
└──────────────────┬──────────────────────────┘
                   │ HTTP / WebSocket
┌──────────────────┴──────────────────────────┐
│           遊戲伺服器 (port 3000)             │
│  boardgame.io Server · Koa · Socket.IO      │
│  Redis Adapter (Pub/Sub) · /api/* 代理      │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────┴────────────────────────────┐
│           API 伺服器 (port 3001)              │
│  Node HTTP · PostgreSQL · Redis · HMAC tokens │
│  帳號 / 牌組 / 對戰紀錄 / 排行榜             │
└───────────────────────────────────────────────┘
```

### 技術棧

| 領域            | 技術                                           | 版本      |
| --------------- | ---------------------------------------------- | --------- |
| UI 框架         | React                                          | 19        |
| 路由            | React Router                                   | 7         |
| CSS 框架        | Tailwind CSS + daisyUI 5 + Lucide React 圖示   | 4 / 5     |
| 多人遊戲框架    | boardgame.io                                   | 0.50.2    |
| 建構工具        | Vite                                           | 7         |
| 語言            | TypeScript（strict 模式）                      | 5.8       |
| 測試            | vitest（含 `@vitest/coverage-v8`）             | 4         |
| 屬性測試        | fast-check                                     | 4         |
| 程式碼風格      | ESLint（typescript-eslint）                    | 9         |
| 格式化          | Prettier                                       | 3         |
| TypeScript 執行 | tsx                                            | 4         |
| PWA             | vite-plugin-pwa                                | 1         |
| 網站分析        | Umami                                          | -         |
| 後端            | Node HTTP + PostgreSQL + Redis（pg / ioredis） | Node >=20 |

### 核心遊戲引擎

```text
猜拳 → 重抽 → 初始設置 → 出牌 → 效果處理 → 戰鬥 → 回合結束
```

- **確定性狀態機** — `GameState.step` 驅動，不依賴 boardgame.io 的回合制
- **效果規則引擎** — 將日文效果文字映射為結構化遊戲動作，覆蓋 267 行效果（100%），經多輪獨立審查驗證
- **playerView** — 線上對戰時隱藏對手手牌、牌組、蓋牌

### 數據存儲

| 數據         | 存儲位置                      | 說明                                 |
| ------------ | ----------------------------- | ------------------------------------ |
| 卡牌數據     | PostgreSQL (`api/server.cjs`) | API / game server 共用的動態卡牌資料 |
| 卡圖         | Cloudflare R2 (`r2.dan.tw`)   | 422 張卡圖 CDN                       |
| 用戶帳號     | PostgreSQL (`api/server.cjs`) | 註冊/登入/ELO                        |
| 牌組         | PostgreSQL + localStorage     | 伺服器同步 + 本地備份 + 本地自訂牌組 |
| 對戰紀錄     | PostgreSQL + localStorage     | ELO 變動 + 歷史 + 已清理 action log  |
| 線上 Session | localStorage                  | 線上對戰重連資訊                     |
| 語言偏好     | localStorage                  | 瀏覽器本地                           |

---

## 本機開發

### 環境需求

- Node.js `>=20`（見 `package.json` `engines`；CI 與 Docker 使用 Node 22）
- npm 10+

### 安裝與運行

```bash
# 安裝依賴
npm install

# 前端開發（Vite dev server）
npm run dev
# → http://localhost:3000

# API 伺服器
cd api && npm install && npm start
# → http://localhost:3001

# 遊戲伺服器（含 boardgame.io）
npm run build
npm run server
# → http://localhost:3000（含遊戲 + API 代理）
```

### 開發指令清單

| 指令                                    | 說明                                                                       |
| --------------------------------------- | -------------------------------------------------------------------------- |
| `npm run dev`                           | 啟動 Vite dev server                                                       |
| `npm run build`                         | TypeScript 檢查（`typecheck` + `typecheck:scripts`）後執行 Vite 生產構建   |
| `npm run typecheck`                     | `tsc --noEmit` 檢查 app 程式碼                                             |
| `npm run typecheck:scripts`             | `tsc --noEmit -p tsconfig.scripts.json` 檢查 scripts 程式碼                |
| `npm run lint`                          | ESLint 檢查                                                                |
| `npm run lint:fix`                      | ESLint 自動修復                                                            |
| `npm run format`                        | Prettier 格式化寫入                                                        |
| `npm run format:check`                  | Prettier 格式檢查（CI 使用）                                               |
| `npm test`                              | vitest 單元測試（單次執行）                                                |
| `npm run test:watch`                    | vitest 監控模式（自動重跑）                                                |
| `npm run test:coverage`                 | vitest 單元測試含覆蓋率報告                                                |
| `npm run smoke`                         | 遊戲邏輯 smoke 測試                                                        |
| `npm run smoke:api`                     | 帳號/牌組/對戰/排行榜 API loop                                             |
| `npm run smoke:online`                  | 線上對戰 smoke 測試                                                        |
| `npm run smoke:online-consistency`      | 線上對戰一致性 smoke 測試                                                  |
| `npm run smoke:responsive`              | 執行所有響應式 UI smoke 測試                                               |
| `npm run smoke:ui-responsive`           | 大廳/基礎 UI 響應式 smoke 測試                                             |
| `npm run smoke:admin-responsive`        | 管理後台響應式 smoke 測試                                                  |
| `npm run smoke:battle-responsive`       | 對戰畫面響應式 smoke 測試                                                  |
| `npm run smoke:online-lobby-responsive` | 線上大廳響應式 smoke 測試                                                  |
| `npm run smoke:tools-responsive`        | 工具頁面響應式 smoke 測試                                                  |
| `npm run rule:audit`                    | 效果解析覆蓋率審計                                                         |
| `npm run seed:cards`                    | 從 `SEED_CARDS_URL` / `SEED_CARD_API_URL` 匯入卡牌資料到 PostgreSQL        |
| `npm run migrate:sqlite-to-pg`          | 將舊 SQLite 資料遷移至 PostgreSQL（`users`/`decks`/`matches`，可重複執行） |
| `npm run server`                        | 啟動 boardgame.io 遊戲伺服器                                               |
| `npm run preview`                       | 預覽 Vite 生產構建結果                                                     |

### 測試

```bash
npm run smoke          # 遊戲邏輯測試
npm run smoke:api      # 帳號/牌組/對戰/排行榜 API loop
npm run smoke:online   # 線上對戰測試
npm run smoke:responsive # 響應式 UI smoke 測試
npm run rule:audit     # 效果解析覆蓋率審計
```

> `smoke:api` 與 `smoke:online` 需要 PostgreSQL + Redis 容器，執行前先啟動：
>
> ```bash
> docker compose up -d postgres redis
> ```
>
> `smoke`（遊戲邏輯）與 `rule:audit`（效果解析審計）為純遊戲邏輯測試，不需要 PG/Redis。

### 構建

```bash
npm run build          # TypeScript 檢查 + Vite 生產構建
```

---

## Docker 部署

```bash
# 構建並啟動四服務
docker compose up -d --build

# 查看狀態
docker compose ps
docker compose logs -f
```

服務端口：

- `3000` — 遊戲前端 + boardgame.io 多人
- `3001` — API 伺服器（帳號/牌組/戰績）

詳見 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

---

## 項目結構

```
zutomayo-card-online/
├── src/
│   ├── game/                  # 遊戲引擎
│   │   ├── GameLogic.ts       # 核心規則（回合、戰鬥、傷害）
│   │   ├── Game.ts            # boardgame.io Game 定義
│   │   ├── types.ts           # 類型定義
│   │   ├── ai.ts              # AI 對手邏輯（簡單/普通/困難）
│   │   ├── useAIMoves.ts      # React hook：AI 自動出牌
│   │   ├── chronos.ts         # Chronos 晝夜系統
│   │   ├── matchHistory.ts    # 對戰紀錄
│   │   ├── cards/             # 卡牌數據加載與牌組構建
│   │   │   ├── loader.ts      # 卡牌數據加載（本地 + API）
│   │   │   ├── deckBuilder.ts # 牌組構建驗證
│   │   │   ├── presetDecks.ts # 預設牌組
│   │   │   ├── customDeck.ts  # 本地自訂牌組（localStorage）
│   │   │   └── i18n.ts        # 卡牌翻譯工具
│   │   ├── effects/           # 效果引擎
│   │   │   ├── parser.ts      # 日文效果文字 → 結構化數據
│   │   │   ├── executor.ts    # 結構化數據 → 遊戲狀態變更
│   │   │   ├── types.ts       # 效果類型定義
│   │   │   └── choices.ts     # 玩家選擇流程
│   │   └── __tests__/         # 遊戲引擎測試
│   │       ├── chronos.test.ts
│   │       └── invariants.test.ts
│   ├── components/            # React 組件
│   │   ├── Board.tsx          # 遊戲主畫面（~78K）
│   │   ├── Card.tsx           # 卡牌渲染 + Popover
│   │   ├── Chronos.tsx        # Chronos 時鐘 SVG
│   │   ├── AIGame.tsx         # AI 對戰 UI 邏輯
│   │   ├── OnlineGame.tsx     # 線上對戰 UI 邏輯
│   │   ├── OnlineRoomInfo.tsx # 線上房間資訊面板
│   │   ├── DeckEditor.tsx     # 牌組編輯器
│   │   ├── InteractiveTutorial.tsx # 互動式教學
│   │   ├── LanguageSwitcher.tsx # 語言切換器
│   │   ├── MatchHistory.tsx   # 對戰紀錄
│   │   └── lobby/             # 大廳子組件
│   │       ├── AuthSection.tsx      # 登入/註冊區塊
│   │       ├── DeckSelector.tsx     # 牌組選擇器
│   │       ├── DifficultyButtons.tsx # 難度按鈕（AI 模式）
│   │       ├── OnlinePanel.tsx      # 線上配對面板
│   │       └── shared.ts            # 共用類型
│   ├── pages/                 # 頁面路由
│   │   ├── LobbyPage.tsx      # 首頁大廳
│   │   ├── LocalGamePage.tsx  # 本機對戰
│   │   ├── AILobbyPage.tsx    # AI 模式選單
│   │   ├── AIGamePage.tsx     # AI 對戰頁面
│   │   ├── OnlineLobbyPage.tsx # 線上模式選單
│   │   ├── OnlineGamePage.tsx # 線上對戰頁面
│   │   ├── DeckEditorPage.tsx # 牌組編輯器（路由版）
│   │   ├── MatchHistoryPage.tsx # 對戰紀錄
│   │   ├── LeaderboardPage.tsx # 排行榜
│   │   ├── AdminPage.tsx      # 管理後台
│   │   └── I18nManager.tsx    # i18n 翻譯管理
│   ├── i18n/                  # 國際化
│   │   ├── index.ts           # i18n 核心（t() / translate()）
│   │   ├── zh-TW.ts           # 繁體中文（台灣）
│   │   ├── zh-HK.ts           # 粵語（香港）
│   │   ├── zh-CN.ts           # 簡體中文
│   │   ├── ja.ts              # 日本語
│   │   ├── en.ts              # English
│   │   └── ko.ts              # 한국어
│   ├── api/                   # API 客戶端
│   │   └── client.ts          # fetch wrapper（登入/牌組/對戰/配對）
│   ├── server/                # 遊戲伺服器擴展
│   │   ├── db/
│   │   │   └── postgres-adapter.ts # PostgreSQL 適配器
│   │   └── transport/
│   │       └── redis-pubsub.ts     # Redis Pub/Sub 傳輸層
│   ├── onlineSession.ts       # 線上 Session 管理（localStorage 持久化）
│   ├── onlineRoomStatus.ts    # 線上房間狀態輪詢
│   ├── server.ts              # boardgame.io 遊戲伺服器入口
│   ├── App.tsx                # 應用入口（路由 + NavBar + 教學 + 重連）
│   └── main.tsx               # React DOM 掛載點
├── api/                       # API 伺服器
│   ├── server.cjs             # Node HTTP + PostgreSQL + Redis
│   ├── package.json
│   └── Dockerfile
├── scripts/                   # 測試與工具腳本
│   ├── game-smoke.ts          # 遊戲邏輯 smoke test（~148K）
│   ├── api-smoke.ts           # API 整合 smoke test
│   ├── online-smoke.ts        # 線上對戰 smoke test
│   ├── rule-audit.ts          # 效果解析覆蓋率審計
│   ├── effect-smoke.ts        # 效果引擎單元測試
│   ├── seed-cards-pg.ts       # 卡牌數據匯入 PostgreSQL
│   ├── migrate-sqlite-to-pg.ts # SQLite → PostgreSQL 遷移
│   └── semantic-audit-dump.ts # 語意審計數據匯出
├── data/                       # 翻譯數據
├── qa.json                     # 74 條官方 Q&A
├── rules.md                    # 完整遊戲規則
├── Dockerfile                  # 遊戲伺服器鏡像
├── docker-compose.yml          # 四服務部署（PG + Redis + game + api）
└── docs/
    ├── API.md                  # REST API 文檔
    └── DEPLOYMENT.md           # 部署指南
```

---

## 效果引擎

### 覆蓋率

```text
總卡牌: 422 張
有效果卡: 250 張
效果行: 267 行
已解析: 267 行 (100%)
未解析: 0
部分解析: 0
```

### 架構

```text
日文效果文字 → parseEffect() → { trigger, conditions[], action }
                                    ↓
                              executeEffect() → 遊戲狀態變更
```

### 支援的效果類型（按數量排序）

| 類型                    | 說明                         | 數量 |
| ----------------------- | ---------------------------- | ---- |
| boostAttack             | 攻擊力增加                   | 150  |
| requestChoice           | 玩家選擇（深淵/手牌/排序等） | 30   |
| heal                    | HP 回復                      | 13   |
| damageReduce            | 傷害減免                     | 7    |
| moveSelfAreaEnchant     | 區域附魔自動移動             | 5    |
| clockSet                | 時鐘設定                     | 4    |
| returnAreaEnchantToDeck | 區域附魔回牌組               | 4    |
| useFromAbyss            | 從深淵使用卡牌               | 3    |
| reduceAttack            | 攻擊力減少                   | 3    |
| swapAttack              | 晝夜攻擊力逆轉               | 2    |
| drawCards               | 抽牌                         | 2    |
| millDeckToAbyss         | 磨牌進深淵                   | 2    |
| directDamage            | 直接傷害                     | 2    |
| clockAdvance            | 時鐘推進                     | 2    |
| 其他（17 種）           | 特殊效果                     | 各 1 |

### 支援的條件類型

| 條件                              | 說明              |
| --------------------------------- | ----------------- |
| chronos                           | 晝夜判定（夜/晝） |
| opponentElement / selfElement     | 屬性檢查          |
| hpLessOrEqual / hpComparison      | HP 條件           |
| opponentPowerCost / selfPowerCost | 能量消耗條件      |
| zoneCountComparison               | 區域卡數比較      |
| previousCharElement               | 上回合角色屬性    |
| namedCardInBattleZone             | 命名卡在戰鬥區    |
| specificElements                  | 特定屬性集合      |
| drawOccurredThisEffect            | 本效果曾抽牌      |
| battleLost                        | 戰鬥失敗          |

---

## 路由結構

| 路徑                    | 頁面             | 說明                       |
| ----------------------- | ---------------- | -------------------------- |
| `/`                     | LobbyPage        | 首頁大廳（模式切換）       |
| `/online`               | OnlineLobbyPage  | 線上對戰選單               |
| `/ai`                   | AILobbyPage      | AI 練習選單                |
| `/play/local`           | LocalGamePage    | 本機雙人對戰               |
| `/play/ai`              | AIGamePage       | AI 對戰                    |
| `/play/online/:matchID` | OnlineGamePage   | 線上對戰                   |
| `/deck-builder`         | DeckEditorPage   | 牌組編輯器                 |
| `/history`              | MatchHistoryPage | 對戰紀錄                   |
| `/leaderboard`          | LeaderboardPage  | 排行榜                     |
| `/admin`                | AdminPage        | 管理後台（需 admin token） |
| `/admin/i18n`           | I18nManager      | i18n 翻譯管理              |

---

## API 端點

| 方法   | 路徑                       | 認證  | 說明                           |
| ------ | -------------------------- | ----- | ------------------------------ |
| POST   | `/api/register`            | 無    | 註冊帳號                       |
| POST   | `/api/login`               | 無    | 登入                           |
| GET    | `/api/profile`             | JWT   | 取得用戶資料                   |
| PUT    | `/api/profile`             | JWT   | 修改暱稱                       |
| GET    | `/api/decks`               | JWT   | 列出牌組                       |
| POST   | `/api/decks`               | JWT   | 建立牌組                       |
| DELETE | `/api/decks/:id`           | JWT   | 刪除牌組                       |
| POST   | `/api/matches`             | JWT   | 上報對戰結果（認證者須為贏家） |
| GET    | `/api/matches`             | JWT   | 取得認證使用者的對戰歷史       |
| GET    | `/api/matches/:id/log`     | 無    | 取得已清理 action log          |
| GET    | `/api/leaderboard`         | 無    | 排行榜                         |
| POST   | `/api/admin/login`         | 無    | Admin 登入，回傳 admin token   |
| GET    | `/api/admin/users`         | Admin | 取得使用者列表                 |
| GET    | `/api/admin/matches`       | Admin | 取得所有對戰列表               |
| PUT    | `/api/admin/users/:id/elo` | Admin | 重設使用者 ELO                 |
| POST   | `/api/matchmaking/queue`   | JWT   | 加入配對佇列                   |
| GET    | `/api/matchmaking/status`  | JWT   | 查詢配對狀態                   |
| DELETE | `/api/matchmaking/queue`   | JWT   | 離開佇列                       |
| PUT    | `/api/matchmaking/match`   | JWT   | host 回報 boardgame.io matchID |

速率限制：`/api/login`、`/api/register`、`/api/admin/login` 為 10/min，其餘 120/min。

詳見 [docs/API.md](docs/API.md)

---

## 國際化

支援 6 種語言，所有 UI 文字和 250 張效果卡都有對應翻譯：

| 語言             | 代碼  |
| ---------------- | ----- |
| 繁體中文（台灣） | zh-TW |
| 粵語（香港）     | zh-HK |
| 簡體中文         | zh-CN |
| 日本語           | ja    |
| English          | en    |
| 한국어           | ko    |

翻譯管理：`/admin` → i18n 管理頁面

---

## 相關文檔

- [遊戲規則](rules.md) — 完整官方規則
- [官方 Q&A](qa.json) — 74 條官方問答
- [開發計劃](docs/PLAN.md) — Phase 完成狀態
- [REST API](docs/API.md) — API 端點文檔
- [部署指南](docs/DEPLOYMENT.md) — Docker 部署說明

---

## 授權

本項目為個人學習用途，卡牌版權歸 ZUTOMAYO / Sony Music Entertainment 所有。
