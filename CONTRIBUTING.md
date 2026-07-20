# 貢獻指南 / Contributing Guide

感謝你有意參與 ZUTOMAYO CARD Online 的開發！本文件說明如何在本機設定開發環境、遵守的程式碼風格、Commit 規範與 PR 流程。

## 專案簡介

ZUTOMAYO CARD Online 是一款以日本樂團「ずっと真夜中でいいのに」為主題的線上對戰卡牌遊戲（TCG）數位化平台。`boardgame.io` 負責權威卡牌對局，Colyseus 負責大廳／配對／房間／邀請／觀戰，ChatService 負責持久化聊天與審核。

支援本機雙人對戰、AI 練習與線上即時對戰，前端使用 React 19 + Vite + Tailwind CSS，後端為 Node.js + Koa + PostgreSQL + Redis，並透過 PWA 提供離線可用與安裝到桌面/手機的能力，內建 6 種語系 i18n。

## 開發環境需求

- **Node.js `>=20`**（見 `package.json` 的 `engines`，Docker image 使用 Node 22）
- **npm**（專案使用 `package-lock.json` 鎖定依賴版本）
- 作業系統：macOS / Linux / Windows 皆可

## 本機開發流程

```bash
# 1. Clone 專案
git clone https://github.com/lyangjyehaur/zutomayo-card-online.git
cd zutomayo-card-online

# 2. 安裝依賴（使用 lockfile，確保版本一致）
npm ci

# 3. 啟動開發伺服器（Vite HMR）
npm run dev

# 4.（可選）啟動 boardgame.io server
npm run server

# 5.（可選）啟動 Colyseus platform（預設 port 3002）
npm run platform

# 6.（可選）啟動獨立 REST API（預設 port 3001）
cd api && npm ci && npm start
```

環境變數請參考 `.env.example`，複製為 `.env` 後依實際需求填寫。開發時若需要 PostgreSQL / Redis，可使用 `docker-compose.yml` 啟動本地服務。

### 常用指令

| 指令                           | 說明                                                           |
| ------------------------------ | -------------------------------------------------------------- |
| `npm run dev`                  | 啟動 Vite 前端開發伺服器                                       |
| `npm run server`               | 啟動 boardgame.io game server                                  |
| `npm run platform`             | 啟動 Colyseus platform server                                  |
| `npm run build`                | 型別檢查 + 生產打包                                            |
| `npm test`                     | 執行 vitest 單元測試                                           |
| `npm run test:watch`           | 測試監聽模式                                                   |
| `npm run lint`                 | ESLint 檢查                                                    |
| `npm run lint:fix`             | ESLint 自動修復                                                |
| `npm run format`               | Prettier 格式化                                                |
| `npm run format:check:tracked` | 檢查 Git 追蹤檔的 Prettier 格式                                |
| `npm run version:check`        | 驗證 root / api package 版本與 managed fallback                |
| `npm run typecheck`            | TypeScript 型別檢查（app）                                     |
| `npm run typecheck:scripts`    | TypeScript 型別檢查（scripts 目錄）                            |
| `npm run verify`               | 完整驗證（format/policy/config/lint/typecheck/coverage/build） |
| `npm run db:migrate`           | 執行 PostgreSQL schema migration                               |
| `npm run e2e`                  | 執行 Playwright 端到端測試                                     |
| `npm run e2e:ui`               | 啟動 Playwright 互動測試 UI                                    |
| `npm run load:api`             | 執行 k6 API 負載測試（需另行安裝 k6）                          |

## 程式碼風格規範

專案使用 **ESLint + Prettier** 維持一致的程式碼風格，並透過 `husky` + `lint-staged` 在 commit 時自動檢查與修復。

- **Prettier**：設定見 `.prettierrc.json`（semi、singleQuote、trailingComma `all`、printWidth `120`、tabWidth `2`、跨平台 EOL）。
- **ESLint**：設定見 `eslint.config.js`，基於 `typescript-eslint` recommended 與 React recommended。
- **禁止使用 `any` 型別**：`@typescript-eslint/no-explicit-any` 規則已啟用，請為變數與函式標注明確型別；若遇第三方型別不足，以 `unknown` 搭配型別窄化處理。
- **未使用變數**：以底線前綴（`_foo`）標記刻意忽略的參數與變數。
- **縮排與換行**：統一 2 空格縮排、LF 換行、檔尾換行（見 `.editorconfig`）。

提交前請在本機執行：

```bash
npm run format:check:tracked
npm run version:check
npm run lint
npm run typecheck
npm run typecheck:scripts
```

## Commit 規範

專案採用 [Conventional Commits](https://www.conventionalcommits.org/) 格式，並透過 `commitlint` 強制檢查（見 `commitlint.config.cjs` 與 `.husky/commit-msg`）。

### 格式

```
<type>(<scope>): <description>
```

- **type**（英文，小寫）：`feat` / `fix` / `chore` / `docs` / `refactor` / `test` / `style` / `perf` / `build` / `ci`
- **scope**（可選，英文）：受影響的模組，例如 `auth` / `security` / `battle` / `ui` / `api` / `pwa` / `db`
- **description**（繁體中文）：簡述變更內容，動詞起首，句末不加句號

### 範例

```
feat(auth): 新增 Logto OAuth 整合
fix(security): 修復 /api/matches/:id/log 未認證存取漏洞
docs: 新增 CONTRIBUTING.md 與 CHANGELOG.md
chore(deps): 升級 boardgame.io 至 0.50.2
refactor(battle): 抽離 Chronos 時鐘計算邏輯
test(deck): 補齊牌組驗證單元測試
style(format): 修正 Prettier 格式
```

### 規則重點

- `subject-case` 規則已關閉，允許繁體中文 description。
- description 請以繁體中文撰寫，避免中英混雜造成閱讀困難。
- 單一 commit 只處理一件事；若涉及多個面向，請拆分為多個 commit。

## 版本與文件同步

任何 release version 升級都必須在同一個 PR 同步修訂相關專案文件，不能只修改 `package.json`。版本變更至少需要完成以下檢查：

- 同步 root 與 `api/` 的 `package.json`、`package-lock.json` 版本。
- 在 `CHANGELOG.md` 新增當前版本章節、日期、顯著變更與 release tag 連結。
- 同步 `README.md`、`README.en.md`、`README.ja.md` 的目前版本。
- 依實際變更檢查 `docs/API.md`、`docs/ARCHITECTURE.md`、`docs/DEPLOYMENT.md`、`docs/PLAN.md`、release／runbook 文件及環境變數範例。
- 文件不只更新版本號，也要同步新增功能、相容性、migration、部署步驟、環境變數與操作限制。
- 歷史稽核、既有 release evidence 與已完成 baseline 中的舊版本屬於事實紀錄，不應機械式取代。

完成版本升級前，使用 `rg` 搜尋舊版本並逐項判斷，最後執行：

```bash
npm run version:check
npm run verify
```

`version:check` 會自動驗證 manifests、lockfiles、三語 README、`CHANGELOG.md` 最新 release 與 `docs/PLAN.md` 當前版本；API、架構、部署、runbook 與其他專題文件仍需依版本實際內容人工審查。

## 分支策略

- **`master`** 為主分支，永遠保持可部署狀態。所有發布皆以 `master` 為準。
- **Feature branch** 由 `master` 開出，命名使用前綴：
  - `codex/`：自動化或 Codex 產出的分支，例如 `codex/m1-security-p0`
  - `feat/`：新功能開發，例如 `feat/online-matchmaking`
  - `fix/`：問題修復，例如 `fix/auth-redirect`
- 分支名稱使用小寫英文與連字號（kebab-case）。
- 合併至 `master` 一律透過 Pull Request，不可直接 push 到 `master`。

## 測試要求

- **`npm test` 必須通過**：所有 PR 在合併前須通過單元測試。
- **新功能需附測試**：新增功能或修正 bug 時，請補上對應的 vitest 單元測試（測試檔案命名 `*.test.ts` / `*.test.tsx`，與原始檔案同目錄或集中於 `__tests__`）。
- **不修改既有測試**：除非該測試本身有誤或需求變更，否則請勿調整既有測試的斷言。
- **使用者流程需 E2E**：涉及登入、牌組、教學或跨服務導航時，更新 `e2e/` Playwright 場景；CI 會透過 `docker-compose.e2e.yml` 執行。
- **容量敏感改動需壓測**：API、WebSocket、認證或配對熱路徑變更時，使用 `load-tests/` 的 k6 腳本確認門檻。
- 本機推送前可執行 `npm run verify`，完整比對 CI 流程。

## PR 流程

1. 從 `master` 開出 feature branch。
2. 完成開發後，確保本機 `npm run verify` 通過（`pre-push` hook 會自動執行 `typecheck`、`typecheck:scripts` 與 `test`）。
3. 將分支 push 至 origin，並對 `master` 建立 Pull Request。
4. PR 說明請涵蓋：
   - 變更摘要（做了什麼、為什麼）
   - 關聯 issue（若有）
   - 測試方式（如何驗證此變更有效）
   - 是否影響部署或環境變數
5. PR 需通過 GitHub Actions CI（format、data/image/version policy、lint、typecheck、i18n、coverage、build、Playwright E2E）全數綠燈。
6. 經 review 通過後合併至 `master`。

## 部署流程

生產部署使用 `docker-compose.yml`，包含 `postgres`、`redis`、一次性的 `migrate`、`game`、`api`、`platform` 六個單元。詳細的部署步驟、環境變數、連接埠與備份策略請參考 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。

CI 會在每次 push / PR 至 `master` 時執行完整驗證（見 `.github/workflows/ci.yml`）。`smoke:*` 系列腳本需要真實卡牌數據與運行中的伺服器，故未納入 CI，請在本機或部署後另行執行。
