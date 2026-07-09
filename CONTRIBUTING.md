# 貢獻指南 / Contributing Guide

感謝你有意參與 ZUTOMAYO CARD Online 的開發！本文件說明如何在本機設定開發環境、遵守的程式碼風格、Commit 規範與 PR 流程。

## 專案簡介

ZUTOMAYO CARD Online 是一款以日本樂團「ずっと真夜中でいいのに」為主題的線上對戰卡牌遊戲（TCG）數位化平台。專案基於 [boardgame.io](https://boardgame.io/) 實作 WebSocket 即時對戰，完整實作官方規則（每人 20 張牌組、初始 HP 100、Chronos 晝夜系統）。

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

# 4.（可選）啟動後端 API 與 boardgame.io server
npm run server
```

環境變數請參考 `.env.example`，複製為 `.env` 後依實際需求填寫。開發時若需要 PostgreSQL / Redis，可使用 `docker-compose.yml` 啟動本地服務。

### 常用指令

| 指令                        | 說明                                                                |
| --------------------------- | ------------------------------------------------------------------- |
| `npm run dev`               | 啟動 Vite 前端開發伺服器                                            |
| `npm run server`            | 啟動 Node.js 後端伺服器（tsx 直接執行）                             |
| `npm run build`             | 型別檢查 + 生產打包                                                 |
| `npm test`                  | 執行 vitest 單元測試                                                |
| `npm run test:watch`        | 測試監聽模式                                                        |
| `npm run lint`              | ESLint 檢查                                                         |
| `npm run lint:fix`          | ESLint 自動修復                                                     |
| `npm run format`            | Prettier 格式化                                                     |
| `npm run format:check`      | Prettier 格式檢查（不修改檔案）                                     |
| `npm run typecheck`         | TypeScript 型別檢查（app）                                          |
| `npm run typecheck:scripts` | TypeScript 型別檢查（scripts 目錄）                                 |
| `npm run verify`            | 完整驗證（等同 CI：format:check → lint → typecheck → test → build） |
| `npm run db:migrate`        | 執行 PostgreSQL schema migration                                    |

## 程式碼風格規範

專案使用 **ESLint + Prettier** 維持一致的程式碼風格，並透過 `husky` + `lint-staged` 在 commit 時自動檢查與修復。

- **Prettier**：設定見 `.prettierrc.json`（semi、singleQuote、trailingComma `all`、printWidth `120`、tabWidth `2`）。
- **ESLint**：設定見 `eslint.config.js`，基於 `typescript-eslint` recommended 與 React recommended。
- **禁止使用 `any` 型別**：`@typescript-eslint/no-explicit-any` 規則已啟用，請為變數與函式標注明確型別；若遇第三方型別不足，以 `unknown` 搭配型別窄化處理。
- **未使用變數**：以底線前綴（`_foo`）標記刻意忽略的參數與變數。
- **縮排與換行**：統一 2 空格縮排、LF 換行、檔尾換行（見 `.editorconfig`）。

提交前請在本機執行：

```bash
npm run format:check
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
5. PR 需通過 GitHub Actions CI（format:check、lint、typecheck、typecheck:scripts、test、build）全數綠燈。
6. 經 review 通過後合併至 `master`。

## 部署流程

生產部署使用 `docker-compose.yml`，包含 `postgres`、`redis`、`migrate`、`game`、`api` 五個服務。詳細的部署步驟、環境變數、連接埠與備份策略請參考 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。

CI 會在每次 push / PR 至 `master` 時執行完整驗證（見 `.github/workflows/ci.yml`）。`smoke:*` 系列腳本需要真實卡牌數據與運行中的伺服器，故未納入 CI，請在本機或部署後另行執行。
