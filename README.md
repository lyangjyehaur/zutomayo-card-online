# ZUTOMAYO CARD Online — 線上對戰卡牌遊戲

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
- **線上對戰** — boardgame.io WebSocket 即時同步，支援重連

### 卡牌系統
- 422 張完整卡牌數據（4 個卡包）
- 267 行效果文字全部解析（100% 覆蓋率）
- 效果支援條件判斷（屬性、晝夜、HP、能量消耗、區域卡數等）
- 250 張效果卡 × 6 種語言翻譯（LLM 生成）

### UI/UX
- **全屏無滾動** — 100vh/100vw 遊戲介面
- **響應式設計** — 桌面/平板/手機自適應
- **六語言** — 繁體中文（台灣）、粵語（香港）、簡體中文、日本語、English、한국어
- **互動式教學** — 新手引導，逐步學習遊戲規則
- **牌組編輯器** — 422 張卡篩選/排序/組牌
- **對戰紀錄** — 本地歷史記錄
- **排行榜** — ELO 評分系統

### 管理後台
- 卡牌數據瀏覽器（篩選/搜尋/詳情）
- i18n 翻譯管理
- 密碼保護（`/admin` 路由）

---

## 技術架構

```
┌─────────────────────────────────────────────┐
│              前端 (Vite + React)             │
│  React 19 · TypeScript · React Router 7     │
│  boardgame.io Client · Tailwind CSS         │
└──────────────────┬──────────────────────────┘
                   │ HTTP / WebSocket
┌──────────────────┴──────────────────────────┐
│           遊戲伺服器 (port 3000)             │
│  boardgame.io Server · Koa · Socket.IO      │
│  /api/* 代理 → API Server                   │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────┴──────────────────────────┐
│           API 伺服器 (port 3001)             │
│  Express · better-sqlite3 · JWT             │
│  帳號 / 牌組 / 對戰紀錄 / 排行榜            │
└─────────────────────────────────────────────┘
```

### 核心遊戲引擎

```text
猜拳 → 重抽 → 初始設置 → 出牌 → 效果處理 → 戰鬥 → 回合結束
```

- **確定性狀態機** — `GameState.step` 驅動，不依賴 boardgame.io 的回合制
- **效果解析器** — 正則表達式解析日文效果文字，支援 20+ 種條件和動作類型
- **playerView** — 線上對戰時隱藏對手手牌、牌組、蓋牌

### 數據存儲

| 數據 | 存儲位置 | 說明 |
|------|----------|------|
| 卡牌數據 | `cards.json` (git) | 422 張卡，靜態數據 |
| 卡圖 | Cloudflare R2 (`r2.dan.tw`) | 422 張卡圖 CDN |
| 用戶帳號 | SQLite (`api/server.cjs`) | 註冊/登入/ELO |
| 牌組 | SQLite + localStorage | 伺服器同步 + 本地備份 |
| 對戰紀錄 | SQLite + localStorage | ELO 變動 + 歷史 |
| 語言偏好 | localStorage | 瀏覽器本地 |

---

## 本機開發

### 環境需求
- Node.js 22+
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

### 測試

```bash
npm run smoke          # 遊戲邏輯測試
npm run smoke:online   # 線上對戰測試
npm run rule:audit     # 效果解析覆蓋率審計
```

### 構建

```bash
npm run build          # TypeScript 檢查 + Vite 生產構建
```

---

## Docker 部署

```bash
# 構建並啟動雙服務
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
│   │   ├── ai.ts              # AI 對手邏輯
│   │   ├── chronos.ts         # Chronos 晝夜系統
│   │   ├── cards/             # 卡牌數據加載與牌組構建
│   │   └── effects/           # 效果引擎
│   │       ├── parser.ts      # 日文效果文字 → 結構化數據
│   │       ├── executor.ts    # 結構化數據 → 遊戲狀態變更
│   │       ├── types.ts       # 效果類型定義
│   │       └── choices.ts     # 玩家選擇流程
│   ├── components/            # React 組件
│   │   ├── Board.tsx          # 遊戲主畫面
│   │   ├── Card.tsx           # 卡牌渲染 + Popover
│   │   ├── Chronos.tsx        # Chronos 時鐘 SVG
│   │   └── ...
│   ├── pages/                 # 頁面路由
│   │   ├── LobbyPage.tsx      # 大廳
│   │   ├── LocalGamePage.tsx  # 本機對戰
│   │   ├── AIGamePage.tsx     # AI 練習
│   │   ├── OnlineGamePage.tsx # 線上對戰
│   │   └── ...
│   ├── i18n/                  # 國際化
│   │   ├── zh-TW.ts           # 繁體中文（台灣）
│   │   ├── zh-HK.ts           # 粵語（香港）
│   │   ├── zh-CN.ts           # 簡體中文
│   │   ├── ja.ts              # 日本語
│   │   ├── en.ts              # English
│   │   └── ko.ts              # 한국어
│   └── api/                   # API 客戶端
├── api/                       # API 伺服器
│   └── server.cjs             # Express + SQLite
├── scripts/                   # 測試腳本
├── data/                      # 翻譯數據
├── cards.json                 # 422 張卡牌數據
├── qa.json                    # 74 條官方 Q&A
├── rules.md                   # 完整遊戲規則
├── Dockerfile                 # 遊戲伺服器鏡像
├── docker-compose.yml         # 雙服務部署
└── docs/
    ├── API.md                 # REST API 文檔
    └── DEPLOYMENT.md          # 部署指南
```

---

## 效果引擎

### 覆蓋率

```
總卡牌:      422 張
有效果卡:    250 張
效果行:      267 行
已解析:      267 行 (100%)
未解析:      0
部分解析:    0
```

### 解析流程

```text
日文效果文字 → parseEffect() → { trigger, conditions[], action }
                                    ↓
                              executeEffect() → 遊戲狀態變更
```

### 支援的效果類型

| 類型 | 說明 | 數量 |
|------|------|------|
| boostAttack | 攻擊力增加 | 163 |
| elementCondition | 屬性條件 | 52 |
| handManip | 手牌操作 | 28 |
| abyssManip | 深淵操作 | 18 |
| damageReduce | 傷害減免 | 7 |
| heal | HP 回復 | 14 |
| clockEffect | 時鐘操作 | 4 |
| swapAttack | 晝夜逆轉 | 2 |
| 其他 | 特殊效果 | ~30 |

---

## API 端點

| 方法 | 路徑 | 說明 |
|------|------|------|
| POST | `/api/register` | 註冊帳號 |
| POST | `/api/login` | 登入 |
| GET | `/api/profile` | 取得用戶資料 |
| GET | `/api/decks` | 列出牌組 |
| POST | `/api/decks` | 建立牌組 |
| DELETE | `/api/decks/:id` | 刪除牌組 |
| POST | `/api/matches` | 上報對戰結果 |
| GET | `/api/leaderboard` | 排行榜 |

詳見 [docs/API.md](docs/API.md)

---

## 國際化

支援 6 種語言，所有 UI 文字和 250 張效果卡都有對應翻譯：

| 語言 | 代碼 | 旗標 |
|------|------|------|
| 繁體中文（台灣） | zh-TW | 🇹🇼 |
| 粵語（香港） | zh-HK | 🇭🇰 |
| 簡體中文 | zh-CN | 🇨🇳 |
| 日本語 | ja | 🇯🇵 |
| English | en | 🇬🇧 |
| 한국어 | ko | 🇰🇷 |

翻譯管理：`/admin` → i18n 管理頁面

---

## 相關文檔

- [遊戲規則](rules.md) — 完整官方規則
- [官方 Q&A](qa.json) — 74 條官方問答
- [開發計劃](PLAN.md) — 11 個 Phase 完成狀態
- [REST API](docs/API.md) — API 端點文檔
- [部署指南](docs/DEPLOYMENT.md) — Docker 部署說明

---

## 授權

本項目為個人學習用途，卡牌版權歸 ZUTOMAYO / Sony Music Entertainment 所有。
