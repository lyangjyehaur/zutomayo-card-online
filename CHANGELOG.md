# Changelog

本檔案記錄 ZUTOMAYO CARD Online 的所有顯著變更，格式依循 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/)，版本編號依循 [Semantic Versioning](https://semver.org/lang/zh-TW/)。

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

[0.1.3]: https://github.com/lyangjyehaur/zutomayo-card-online/releases/tag/v0.1.3
[0.1.2]: https://github.com/lyangjyehaur/zutomayo-card-online/releases/tag/v0.1.2
[0.1.1]: https://github.com/lyangjyehaur/zutomayo-card-online/releases/tag/v0.1.1
