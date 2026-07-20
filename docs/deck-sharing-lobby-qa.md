# 牌組分享與分享大廳 QA 記錄

更新日期：2026-07-20

分支：`codex/deck-sharing-lobby`

## 自動化驗收

- Migration/schema gate：up/down contract、缺表／欄位／索引與 feature guard。
- Service/API：public、unlisted、unpublished、hidden、雙向 block、cursor、複製交易、idempotency、按讚、檢舉與管理審核。
- Client：URL/query encoding、JSON body、credentials、CSRF 與 admin session refresh。
- UI 純狀態：query parse/serialize、非法篩選清理、cursor append 去重、複製規則問題與 optimistic like rollback。
- Playwright：8 條 Chromium 流程通過：
  - 鍵盤進入大廳詳情與卡牌 Sheet。
  - 登入按讚、檢舉與伺服器複製。
  - 擁有者不顯示自讚與自我檢舉。
  - unlisted 不出現在大廳，訪客可透過直接連結複製到本機。
  - 發布、更新快照、取消與重新發布。
  - blocked/hidden 大廳與直接 ID 一致不可見。
  - 管理員隱藏與恢復分享。
  - 360x800、768x1024、1440x900 無水平溢出，分享大廳與重要 Dialog 無 serious/critical axe violation。
- Production build：`npm run build`。
- Repository CI mirror：`npm run verify`。

## 實際瀏覽器檢查

使用本機 mock API 與實際開發版前端檢查：

- 大廳卡牌、元素、角色卡數、讚與複製數正常呈現。
- 詳情頁顯示發布／更新時間、完整牌組與互動控制。
- 點擊卡牌後開啟卡牌詳情 Sheet，焦點落在關閉鍵，背景處於 modal 隔離狀態。
- Sheet 顯示充能、攻擊、時計、效果與歌曲資訊，且無水平溢出。
- Web Share API 可用時走系統分享路徑；Playwright 無 Web Share 環境另驗證 clipboard fallback 與成功提示。

## 錯誤與邊界狀態

- 首頁、篩選無結果、首次載入失敗、下一頁失敗與 404 有獨立狀態。
- 舊 rules version 顯示非阻斷警告。
- 缺少卡、非 20 張或同卡超過 2 張時，複製按鈕停用並顯示具體原因。
- 後端在複製交易中仍重新驗證，前端檢查不是信任邊界。

## Release 前外部條件

- 確認 Public Beta 功能凍結已解除或取得豁免，再於 production 設定 `DECK_SHARING_ENABLED=true`。
- rebase 後確認 `000037_service_integrations.js` 先於 `000038_deck_sharing.js`。
- 在具有真實 PostgreSQL、Redis 與登入帳號的 staging 執行一次非 mock smoke test；這是部署前環境驗收，不是程式實作缺口。
