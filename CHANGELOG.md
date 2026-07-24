# Changelog

本檔案記錄 ZUTOMAYO CARD Online 的所有顯著變更，格式依循 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/)，版本編號依循 [Semantic Versioning](https://semver.org/lang/zh-TW/)。

## [Unreleased]

## [0.2.3] - 2026-07-22

官方規則與對局體驗更新：加入 Grand Rules／基本 Floor Rules 五語閱讀頁與原子發布流程，補完整 AI 結算操作、對戰記錄及首訪導覽，並修復分析代理、晝側操作和牌組建立問題。

### Added

- **官方規則文件**：新增 Grand Rules 與基本 Floor Rules 頁面、章節目錄、全文搜尋、來源頁碼、日文原文對照、官方 PDF 指紋與六語介面。
- **規則文件 PostgreSQL 發布**：以版本化文件、段落、五語翻譯與 active pointer 保存內容；Server4 部署會驗證官方索引、PDF SHA-256、術語與翻譯完整性後原子啟用。
- **結算對戰記錄**：對局結束後可直接展開本場 action log，查看卡牌、HP、Chronos 與效果處理明細。
- **首訪教學入口**：Welcome 提示除牌組編輯器外，新增直接前往新手教學的六語入口。

### Changed

- **AI 賽後流程**：結算頁提供再戰、調整牌組與難度、返回大廳三個明確去向；再戰以新的本機對局 instance 啟動，不再重新整理整個頁面。
- **AI 牌組傳遞**：本地與帳號牌組改以實際卡牌 ID 傳入 AI 對局，使再戰保留原先選擇的完整牌組內容。
- **規則導覽與離線快取**：規則資料庫導覽擴充為 Grand Rules、基本 Floor Rules、Q&A 與勘誤，公開規則文件 API 納入 PWA `NetworkFirst` 快取。

### Fixed

- **Umami 同源代理**：前端改由 game service 的 `/analytics` 固定端點載入腳本及上報事件，上游地址改為 runtime `UMAMI_UPSTREAM_URL`，避免第三方腳本被 CSP 阻擋，並使更換分析服務時無須重建前端。
- **Umami 訪客識別**：同源代理以包含 Cloudflare CIDR 的可信代理鏈解析訪客 IP，寫入 Umami 官方事件欄位並覆蓋客戶端偽造值，避免上游 CDN／反向代理將所有訪客誤判為 Server4。
- **晝側操作辨識度**：出牌與檢視按鈕改用玩家陣營感知配色，確保在晝側淺色戰場上仍有清楚的主次層級、文字對比與鍵盤焦點。
- **新牌組建立**：修復登入後建立空白牌組會立刻被第一副 Server 牌組覆蓋的問題，並加入明確的建立成功提示。
- **規則文件部署映像**：補齊 migration 映像中的 Grand Rules／Floor Rules 發布器，並加入 Docker runtime contract 測試，避免規則發布閘門因缺少執行檔而中止。

## [0.2.2] - 2026-07-21

公開測試內容擴充版本：加入卡組分享、官方 Q&A／勘誤資料庫與完整多語閱讀流程，同時完成教學、卡圖交付、PWA 與 CI 穩定性修正。

### Added

- **卡組分享大廳**：支援發布、更新、取消發布、公開／不公開連結、搜尋篩選、按讚、複製、檢舉與管理隱藏／恢復。
- **官方裁定資料庫**：將官方日文 Q&A 與勘誤直接同步至 PostgreSQL，提供清單／詳情 API、六語頁面、來源回退與內容版本控制。
- **官方裁定發布閘門**：以單一 PostgreSQL transaction 驗證即時官方來源、卡牌資料集與五語靜態翻譯，保存 release manifest／快照並原子切換 active pointer。
- **裁定卡名一致性**：Q&A 翻譯中的卡牌名稱改由 PostgreSQL 已複核卡名解析；provider、人工發布與 Server4 release gate 均拒絕自行重譯或缺少 canonical 卡名的內容。
- **裁定五語複核**：74 條 Q&A 的繁中、簡中、粵語、英語與韓語正文改按完整問答語境重寫，移除逐句直譯、反義條件、簡繁混用與不自然遊戲用語。
- **勘誤五語複核**：12 條勘誤的錯誤文本、訂正原因、換卡政策與使用政策依完整語境重寫，並重新校對 10 張效果勘誤卡的繁中、簡中、粵語及韓語 canonical 效果文本。
- **規則術語字典**：統一 UI、教學、卡牌效果、Q&A 與勘誤用詞；完整覆蓋卡面標記、卡種、區域、屬性、Q&A 標籤、對戰流程、規則動作與勝負狀態，保留 `Power Cost`、`SEND TO POWER` 等官方標記，並統一韓語 `크로노스` 譯名。
- **官方裁定管理**：新增翻譯覆蓋率、人工校訂、來源差異檢查、audit log、Prometheus 指標與每日唯讀來源排程。
- **教學章節系統**：新增章節 hub、戰場預覽、卡牌元素素材與更完整的六語教學內容。
- **翻譯設定管理**：新增共用翻譯 provider 設定、加密保存與管理介面，供官方裁定、公告與聊天共用。

### Changed

- **資料來源政策**：PostgreSQL 成為卡牌文本與官方裁定的唯一 runtime 來源；原始／翻譯 JSON 不再追蹤或打包進 Docker image。
- **卡圖交付**：玩家端卡圖統一經同源 imgproxy 與尺寸化 `srcset` 載入，PWA 不再直接快取原始卡圖來源。
- **公開測試體驗**：改善首頁、法律頁、牌組頁、教學、手機戰場、字體與 PWA 更新流程。
- **首頁資訊架構**：將線上對戰、AI 與教學提升為開始入口，公告改為 broadcast strip，牌組、分享、規則庫、排行榜、紀錄與社群收斂為第二層頻道；背景卡圖加入預載、緩慢縮小與交叉淡化輪播。
- **分享大廳體驗**：以手機一欄至寬螢幕四欄的等高網格呈現牌組，保留代表卡、元素、作者與互動統計，同時提高大量牌組的首屏資訊密度；登入玩家可直接選擇帳號牌組並發布，本機空資料庫則提供四副僅限開發環境的預覽牌組。
- **牌組編輯器操作**：重新整理手機版名稱、同步、分享與儲存控制；分享入口在頁首及牌組抽屜保持可達，尚未儲存到帳號或存在未儲存變更時改為顯示明確提示。
- **規則資料庫體驗**：Q&A 改為官方標籤計數、排序與分批載入的可掃讀清單；勘誤新增卡名／編號全文搜尋、修正範圍與卡包篩選，並在列表直接呈現修正前後差異。四個詳情與清單頁同步改善手機篩選、返回條件保留、原文核對與修正文字複製。
- **測試覆蓋**：加入卡組分享、官方裁定、PWA 離線、可訪問性與管理流程 E2E，並以固定無效果卡牌穩定線上測試；發布前響應式矩陣擴大至 14 個主要頁面、12 種桌面／平板／手機尺寸。

### Fixed

- **線上流程**：修復對局同步、超時阻塞、教學隨機卡牌效果與跨服務狀態轉移問題。
- **無障礙與版面**：修復官方規則文字對比、核心按鈕對比、手機捲動、卡圖尺寸與中文字體顯示。
- **Q&A 分類篩選**：將中韓文的卡種與戰鬥標籤完整本地化，並改用穩定官方標籤 ID，避免切換語言後篩選結果清空。
- **線上大廳圖標**：修復匿名名稱、聊天室與好友操作的固定尺寸按鈕因 padding 擠壓而令 SVG 圖標縮至不可見，並統一改用共用 `IconButton`。
- **首訪操作流程**：手機線上大廳改為先選牌組再進入快速配對，AI 大廳選牌後依序帶到對手與難度設定；桌面版不做不必要的視窗跳動，並尊重減少動態效果設定。
- **空狀態與教學**：修復實戰教學操作提示正文在手機被壓縮、返回步驟後 tooltip 遮擋確認鍵、空白對戰紀錄仍顯示無效清除／分頁、社群與個人頁未登入時缺少直接登入入口。
- **行動觸控區**：牌組勘誤入口、分享／Q&A 排序、勘誤卡包與管理篩選統一至少 44px；管理資料表在 1024px 改用可掃讀資料卡；修正 Battle Visual QA fixture 與正式教學劇本卡牌不一致。
- **排行榜入口**：恢復 `/leaderboard` 實際頁面路由，避免首頁 CH.06 點擊後無提示返回首頁。
- **部署相容**：保留卡牌文本回滾相容，並讓 migration、seed、API 與 PWA build 對齊 `0.2.2` schema。
- **Server4 部署**：自動解析最新 migration，透過 stdin 傳入未追蹤翻譯來源；官方內容不完整、過期或與部署 build 不一致時不啟動新版服務。

## [0.2.1] - 2026-07-18

Public Beta 生產強化版本：完成資料庫、權限、發布證據與營運閘門，將卡牌文本遷移至 PostgreSQL，並補強線上社群與管理能力。

### Added

- **發布與營運閘門**：新增 schema checksum、卡牌資料集、staging journey、備份／還原、alert delivery 與 release evidence 驗證。
- **PostgreSQL 權限矩陣**：拆分 migration、game、API、platform、retention、monitor 與 backup 角色，並加入角色 smoke tests。
- **卡牌文本維護**：新增官方日英文本、勘誤資料、多語人工複核與管理後台維護流程。
- **社群能力**：新增公告、訪客對局聊天與管理員帳號角色維護。

### Changed

- **權威資料來源**：停止追蹤原始卡牌 JSON，卡牌、翻譯、勘誤與設定改由 PostgreSQL schema／匯入流程管理。
- **生產安全**：強制 TLS PostgreSQL／Redis、最小權限角色、immutable image manifest 與 migration checksum。
- **部署流程**：server4 更新、回滾、資料保留與帳號刪除流程改為 fail-closed 並保存可驗證證據。

### Fixed

- **線上對局**：修復 WebSocket 傳輸、權威同步、選牌互動、逾時恢復與跨服務一致性。
- **CI／E2E**：修復 Compose 隔離、固定卡牌 seed、服務啟動順序、容器漏洞掃描與失敗診斷。
- **管理與安全**：修復後台 CSRF session 續期、卡牌 migration 相容與容器檔案權限。

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

[0.2.3]: https://github.com/lyangjyehaur/zutomayo-card-online/releases/tag/v0.2.3
[0.2.2]: https://github.com/lyangjyehaur/zutomayo-card-online/releases/tag/v0.2.2
[0.2.1]: https://github.com/lyangjyehaur/zutomayo-card-online/releases/tag/v0.2.1
[0.2.0]: https://github.com/lyangjyehaur/zutomayo-card-online/releases/tag/v0.2.0
[0.1.3]: https://github.com/lyangjyehaur/zutomayo-card-online/releases/tag/v0.1.3
[0.1.2]: https://github.com/lyangjyehaur/zutomayo-card-online/releases/tag/v0.1.2
[0.1.1]: https://github.com/lyangjyehaur/zutomayo-card-online/releases/tag/v0.1.1
