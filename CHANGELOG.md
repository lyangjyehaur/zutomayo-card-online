# Changelog

本檔案記錄 ZUTOMAYO CARD Online 的所有顯著變更，格式依循 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/)，版本編號依循 [Semantic Versioning](https://semver.org/lang/zh-TW/)。

## [0.2.0] - 2026-07-12

多人平台版本：保留 `boardgame.io` 作為權威對局引擎，新增 Colyseus 平台殼與 ChatService 持久化社交能力，並全面補強教學、戰場回饋、逾時恢復與結算可靠性。

### Added

- **Colyseus 平台層**：新增 lobby、match shell、quick match、custom room 與 invite rooms，支援 Redis presence/driver 和本機 memory mode。
- **多人生命週期**：加入快速配對、自訂房轉交、好友邀請、觀戰 presence、房主恢復與穩定 session／seat token 持久化。
- **好友與聊天**：新增好友關係、好友在線狀態、全域大廳、私聊、自訂房、對局內與賽後聊天。
- **ChatService 工作流**：新增跨對話未讀、已讀游標、可配置翻譯 provider、舉報證據 snapshot、管理審核與 durable mute sanctions。
- **對戰呈現**：新增戰場動畫、效果提示、響應式戰場視覺與 Battle Visual QA 頁面。
- **測試與文檔**：補齊平台 room contract、身份／權限邊界、聊天路由、schema migration、對戰流程與 Windows 跨平台測試。
- **端到端測試**：加入 Playwright 認證、牌組、教學與 smoke 場景，CI 以隔離 Compose stack 執行並保存報告。
- **負載測試**：加入 k6 API、WebSocket、認證與配對壓測腳本及專用 Compose overlay。
- **持續部署**：加入 GHCR 三服務 image build、staging／production tags、隔離 staging Compose 與手動 SSH 部署／rollback 流程。

### Changed

- **權威邊界**：Colyseus 只管理平台殼與不含文字的同步訊號；卡牌狀態仍由 `boardgame.io` 管理，聊天與證據由 PostgreSQL 管理。
- **線上配對**：快速配對與自訂房改走 Colyseus relay；平台失敗會顯示可重試錯誤，不再靜默回退舊 REST 配對流程。
- **教學流程**：重新設計新手遮罩、聚焦與說明流程，改善桌面與手機操作。
- **部署拓撲**：Compose 增加一次性 migration 與 `platform:3002` 服務，生產環境使用 PostgreSQL／Redis durable stores。
- **開發紀律**：README 三語文檔改為同結構入口，Prettier 支援 LF／CRLF，CI 同時執行 `npm run verify` 與 Playwright E2E，hooks 對齊本機快速 gate。

### Fixed

- **對戰卡住**：為猜拳、重抽、初始設置、出牌、效果順序與 pending choices 加入權威逾時恢復。
- **斷線與轉交**：修復配對／邀請／自訂房離房、重連、重複建房、終態重入與 host relay 的多個競態。
- **結算可靠性**：ELO／戰績提交可重試且具冪等性；雙方同時提交可恢復既有結果，本地歷史不會因重試重複。
- **並發與授權**：ELO 更新使用 `SELECT ... FOR UPDATE` 防止 lost update；戰績 log 只允許實際參與者存取。
- **聊天權限**：收緊好友、對局與房間參與者 ACL，拒絕匿名持久聊天、角色冒用、文字 preview 旁路與無證據舉報。
- **安全性**：refresh token 改用 Redis `GETDEL` 原子輪替，加入雙提交 CSRF、獨立 OAuth token 金鑰、Redis 密碼與 trusted proxy allowlist，並強化 seat token 與管理操作證據。
- **平台健康度**：platform `/health` 實際檢查 PostgreSQL／Redis，相應部署 smoke 驗證 HTTP readiness 與 lobby WebSocket join/leave。
- **CD 映像建置**：runtime production dependencies 安裝時停用 lifecycle scripts，避免缺少 dev-only Husky 導致 game／platform image build 失敗。

## [0.1.3] - 2026-07-09

M1+M2 安全與運維補強：修補多處未認證存取漏洞、補齊安全標頭與運維觀測能力，並強化開發流程的型別與 migration 紀律。

### Fixed

- **安全修復**：修復 `/api/matches/:id/log` 未認證存取漏洞，避免對戰紀錄遭未授權讀取。
- **安全修復**：啟用 CSP（Content-Security-Policy）並補齊安全標頭（Helmet）。
- **安全修復**：`/metrics` 端點加入 token 認證，防止監控指標外洩。
- **安全修復**：上傳路由獨立限流並加入 magic byte 驗證，防止惡意檔案與濫用。
- **版本同步**：統一版本號來源，消除硬編碼漂移（`APP_VERSION` / `GAME_RULES_VERSION`）。

### Added

- **稽核日誌**：admin 操作寫入稽核日誌，強化特權操作可追蹤性。
- **Schema migration**：導入 [node-pg-migrate](https://github.com/salsita/node-pg-migrate) 作為 PostgreSQL schema migration 工具。

### Changed

- **型別嚴格**：`scripts` 目錄啟用 `strictNullChecks`，提升腳本型別安全。
- **輸入驗證**：deck update 路由補齊 Zod schema 驗證。

### DevOps

- 加入 `husky` 與 `lint-staged` git hooks（pre-commit 格式化/lint、pre-push 型別檢查/測試）。
- 新增完整驗證指令 `npm run verify`，對齊 CI 流程。

## [0.1.2] - 2026-07-07

Logto OAuth 整合與生產強化（phase 1/2）：導入帳號體系、錯誤追蹤、結構化日誌、監控指標與限流，完成容器與資料備份強化。

### Added

- **Logto OAuth 整合**：支援 4 個 OAuth provider，整合帳號中心、Cookie Session 與個人頁，並提供老用戶遷移腳本。
- **錯誤追蹤**：接入 GlitchTip/Sentry 監控與 source map 上傳。
- **健康檢查**：新增 `/health` 端點。
- **結構化日誌**：導入 `pino` 結構化日誌。
- **監控指標**：導入 `prom-client` Prometheus metrics。
- **限流**：API 加入 rate limiting。
- **輸入驗證**：導入 `zod` 進行請求輸入驗證。

### Security

- **安全標頭**：導入 `koa-helmet` 補齊安全標頭。
- **容器權限**：Dockerfile 改以 `USER node` 執行，降低容器權限。
- **資料備份**：PostgreSQL 備份機制。

## [0.1.1] - 2026-06

初期功能版本：完成核心對戰引擎、卡牌數據、教學模式與多語 PWA 殼。

### Added

- **boardgame.io 對戰**：本機雙人對戰、AI 練習（簡單/普通/困難）、線上即時對戰與配對佇列，支援斷線重連。
- **卡牌效果引擎**：422 張卡牌數據（4 個卡包），267 行效果文字 100% 解析，支援 30+ 種動作類型與 15+ 種條件類型。
- **Chronos 晝夜系統**：圓形時鐘決定夜(NIGHT)/晝(DAY)，影響角色攻擊力。
- **教學模式**：引導新手理解遊戲規則。
- **PWA**：可安裝至桌面/手機，支援離線可用與手動檢查更新。
- **i18n**：支援 6 種語言（含 250 張效果卡翻譯）。

[0.2.0]: https://github.com/lyangjyehaur/zutomayo-card-online/releases/tag/v0.2.0
[0.1.3]: https://github.com/lyangjyehaur/zutomayo-card-online/releases/tag/v0.1.3
[0.1.2]: https://github.com/lyangjyehaur/zutomayo-card-online/releases/tag/v0.1.2
[0.1.1]: https://github.com/lyangjyehaur/zutomayo-card-online/releases/tag/v0.1.1
