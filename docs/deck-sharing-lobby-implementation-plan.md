# 卡組分享與分享大廳實作計畫

更新日期：2026-07-20

狀態：已完成實作與驗證，待合併

工作目錄：`/Users/danersaka/Projects/zutomayo-card-online-deck-sharing-lobby`

工作分支：`codex/deck-sharing-lobby`

需求基準：[deck-sharing-lobby-spec.md](./deck-sharing-lobby-spec.md)

驗收記錄：[deck-sharing-lobby-qa.md](./deck-sharing-lobby-qa.md)

## 執行結果

- Phase 0–7 的 release guard、migration、API、前端、互動、審核與資料生命週期已完成。
- Phase 8 已補齊 service、route、client、純狀態函式、Playwright、responsive 與 axe 驗證。
- 原計畫中的 `DeckShareFilters.tsx` 與 `DeckShareDeckList.tsx` 為預計拆分；實作保留在單一大廳頁並將 query、合併與驗證邏輯抽至 `src/deckShareUi.ts`，避免為拆檔而拆檔。
- 正式環境仍預設關閉 `DECK_SHARING_ENABLED`，不視為實作缺口；啟用屬於 release 決策。
- `000038_deck_sharing.js` 合併前必須確認目標分支已含使用者所有的 `000037_service_integrations.js`。

## 1. 執行策略

採用「後端契約先行、垂直切片、逐階段可驗收」的方式：

1. 先完成發布快照的資料模型與公開讀取 API。
2. 讓分享大廳與詳情頁在沒有按讚／檢舉前即可獨立運作。
3. 再接卡組編輯器的發布管理與複製流程。
4. 最後加入社交互動、管理審核、資料生命週期與完整驗證。

功能必須保留在獨立 worktree；目前 Public Beta 功能凍結仍有文件紀錄，因此預設以 release guard 關閉正式環境入口，待解除凍結後再啟用。

## 2. Phase 0：基線與契約鎖定

### 工作

- 確認需求規格中的建議決策直接作為 MVP 預設，不在開發途中擴增留言、自由描述、自訂封面或勝率排行。
- 開始 migration 前同步目標分支，檢查主 worktree 的未提交 migration；目前已觀察到使用者擁有的 `000037_service_integrations.js`，不得覆蓋或重用其編號。
- 依同步後的實際 migration 序列選擇下一個編號，例如 `000038_deck_sharing.js`；不要在分支落後時硬編號。
- 建立 release guard：API 與前端共用 `deck_sharing_enabled` 公開設定。開發／測試可啟用，正式環境預設關閉，直到功能凍結解除。
- 鎖定 API DTO、錯誤碼、cursor 格式與分享狀態轉移。

### 狀態轉移

```text
未建立 ──首次發布──> published/visible
published ──取消發布──> unpublished/visible
unpublished ──重新發布──> published/visible
published ──管理隱藏──> published/hidden
hidden ──管理恢復──> published/visible
```

`visibility` 獨立為 `public | unlisted`，不能取代 publication 或 moderation 狀態。

### 退出條件

- API contract 與狀態轉移寫入測試案例名稱或文件。
- migration 編號不與其他 worktree 衝突。
- 未取得解除凍結確認前，不把正式環境預設值設為開啟。

## 3. Phase 1：資料模型與 schema gate

### Migration

新增：

- `deck_shares`
- `deck_share_likes`
- `deck_share_copy_events`
- `deck_share_reports`

必要約束：

- 分享 ID 使用 `ds_` 前綴。
- `deck_shares.source_deck_id` 參照 `decks(id)` 並在原牌組刪除時 `SET NULL`。
- `deck_shares.owner_user_id` 參照 `users(id)` 並在帳號刪除時 `CASCADE`。
- 非 null 的 `source_deck_id` 唯一，維持一個牌組一個分享 ID。
- `deck_share_likes` 使用 `(share_id, user_id)` 唯一鍵。
- `deck_share_reports` 限制 reason、status 與 moderation status 的允許值。
- `card_ids` 必須是 JSON array；完整牌組規則仍由 service 驗證，不只依賴 DB check。

索引：

- 公開列表：publication、moderation、visibility、updated_at、id。
- 熱門排序：分享 ID 外鍵索引，計數由聚合查詢取得。
- 作者管理：owner_user_id、source_deck_id。
- 檢舉佇列：status、created_at。
- 封鎖過濾沿用既有 `user_blocks` 索引。

### 預計修改

- `migrations/NNNNNN_deck_sharing.js`
- `api/schemaGate.cjs`
- migration／schema gate 測試
- 必要時更新 migration checksum／release schema 證據

### 測試

- migration up/down。
- FK、unique、check constraint 與 cascade／set-null 行為。
- schema gate 能偵測缺表、缺欄、缺索引與錯誤約束。

### 退出條件

- 新舊資料庫皆可安全 migrate。
- schema gate 與 migration tests 通過。
- 不修改或刪除其他 worktree 的 migration。

## 4. Phase 2：核心分享 service 與 API

### Service 設計

新增 `api/deckShareService.cjs`，將 SQL 與商業規則從 `api/server.cjs` 分離。

核心方法：

- `publishDeckShare(pool, userId, deckId, visibility, rulesVersion)`
- `getOwnedDeckShare(pool, userId, deckId)`
- `updateDeckShare(pool, userId, shareId, input, rulesVersion)`
- `unpublishDeckShare(pool, userId, shareId)`
- `listDeckShares(pool, viewerUserId, query)`
- `getDeckShare(pool, viewerUserId, shareId)`

重要規則：

- 發布與更新只接收 `deckId`／分享 ID、可見性與動作，不接受前端傳入的名稱或 card IDs。
- Service 必須從擁有者的 `decks` 讀取最新內容、重新驗證，再寫入分享快照。
- 首次發布與重試採 idempotent 行為，不產生第二個分享。
- 更新快照保留 share ID、首次發布時間、讚與複製事件。
- 公開列表只回傳 `published + visible + public`。
- unlisted 只可由直接詳情 ID 查到。
- hidden、unpublished、封鎖關係與不存在的分享對一般讀者都使用 404 語意。
- 擁有者管理查詢可看到 unpublished／hidden，但不能自行恢復 hidden。

### HTTP routes

- `GET /api/deck-shares`
- `GET /api/deck-shares/:shareId`
- `GET /api/decks/:deckId/share`
- `POST /api/deck-shares`
- `PUT /api/deck-shares/:shareId`
- `DELETE /api/deck-shares/:shareId`

### 列表查詢

- `sort=newest|popular|most-copied`
- `q`
- `element`
- `cursor`
- `limit`，預設 24、設合理上限

列表 DTO 不需要回傳完整 20 張牌，僅回傳：

- 基本資訊與作者暱稱
- 元素／卡種摘要
- 3 張代表卡 ID
- like／copy 聚合數字
- viewer 是否已讚

詳情 DTO 才回傳完整 card IDs。

### Cursor

- newest：`updated_at + id`
- popular：`like_count + updated_at + id`
- most-copied：`copy_count + updated_at + id`
- cursor 使用不透明 base64url payload，service 驗證版本與欄位，不接受任意 SQL 排序值。

### 預計修改

- `api/deckShareService.cjs`
- `api/schemas.cjs`
- `api/server.cjs`
- `api/__tests__/deckShareService.test.ts`
- `api/__tests__/server.routes.test.ts` 或獨立 route test

### 測試

- 所有權、合法牌組、已刪除 source deck、重複發布與狀態轉移。
- public/unlisted/unpublished/hidden 的讀取矩陣。
- 封鎖雙向過濾。
- 三種排序的 cursor 穩定性、limit、搜尋與元素篩選。
- 公開 DTO 不洩露 email、source deck ID 或管理資訊。
- auth、CSRF、Zod validation、rate limit 與 feature guard。

### 退出條件

- 透過 API 可以完成「發布 → 大廳列表 → 詳情 → 更新 → 取消 → 重新發布」。
- 上述流程有 service 與 route 自動測試。

## 5. Phase 3：前端資料層與公開頁面

### Client 與型別

在既有 session-aware API client 中加入：

- `DeckShareSummary`
- `DeckShareDetail`
- `OwnedDeckShare`
- list/detail/publish/update/unpublish functions
- cursor page response 與錯誤正規化

避免另建一套不一致的 token refresh、CSRF 與 Sentry 邏輯。

### 頁面與元件

新增：

- `src/pages/DeckShareLobbyPage.tsx`
- `src/pages/DeckShareDetailPage.tsx`
- `src/components/deck-sharing/DeckShareCard.tsx`
- `src/components/deck-sharing/DeckShareFilters.tsx`
- `src/components/deck-sharing/DeckShareDeckList.tsx`
- 必要的純函式與單元測試

整合：

- `src/App.tsx` routes、fullscreen route 與 lazy import。
- 首頁功能入口、桌面導覽與行動選單。
- i18n 六種 locale；先建立完整 key contract，不能只補 zh-TW。

### 分享大廳

- query string 為篩選狀態的 source of truth。
- 搜尋 300 ms debounce；返回／前進能還原。
- 每頁 24 筆，以「載入更多」接 cursor。
- 下一頁失敗時保留已載入內容。
- skeleton、首次空狀態、篩選無結果、API error 分開呈現。
- 讚與複製尚未接入時先顯示 server 聚合數字，互動在後續 phase 啟用。

### 詳情頁

- 完整 20 張牌按卡號合併張數。
- 沿用現有 `CardImage` 與 Card Detail sheet/popover。
- 顯示元素、卡種、Character 推薦與舊 rules version 警告。
- 提供分享連結；Web Share API 不可用時使用既有 clipboard fallback。

### 測試

- query state parse/serialize。
- API client response normalization。
- list append 去重、篩選切換清頁、下一頁失敗保留內容。
- 詳情對 404、舊版本、未知卡與 feature disabled 的狀態。
- 基本 a11y roles、labels 與鍵盤操作。

### 退出條件

- 訪客可從首頁進入大廳、篩選、載入更多、開啟詳情並複製分享連結。
- 360x800、平板與寬螢幕沒有水平溢出或不可達控制。

## 6. Phase 4：卡組編輯器發布管理

### UI 狀態

為選中的伺服器牌組載入 `OwnedDeckShare`：

- `not-published`
- `published-current`
- `published-outdated`
- `unpublished`
- `moderation-hidden`
- loading/error

新增分享管理 Dialog／Sheet：

- 首次發布與 public/unlisted 選擇。
- 更新發布快照。
- 切換可見性。
- 複製連結／查看分享。
- 取消發布二次確認。
- hidden 狀態只顯示說明，不提供自行恢復。

### 整合原則

- 只有登入、合法、已同步且已儲存的 server deck 可以發布。
- 未儲存變更時提供「先儲存」而非偷偷發布舊內容。
- 發布成功後更新 share state，不重新載入整個應用。
- 切換牌組時取消舊請求或忽略過期 response。
- source deck 刪除確認加入「分享快照仍會保留」提示；若現有 UI 尚未支援刪除伺服器牌組，先完成 API 語意與測試，不額外擴大編輯器刪除功能。

### 預計修改

- `src/pages/DeckEditorPage.tsx`
- `src/components/DeckEditor.tsx`
- 新增 `DeckShareManagerDialog.tsx`
- API client 與 i18n

### 測試

- 各發布狀態的按鈕文案與 enable/disable 條件。
- 未儲存變更、登入切換、牌組切換與 race condition。
- publish/update/visibility/unpublish 成功與錯誤回復。

### 退出條件

- 擁有者可完全從卡組編輯器管理分享生命週期。
- 私人儲存與公開發布不會被混為同一個動作。

## 7. Phase 5：複製與按讚

### 伺服器複製

新增 `POST /api/deck-shares/:shareId/copy`：

- 登入必須有效。
- 在交易中鎖定／讀取可見分享、用目前 cards 與規則重新驗證。
- 建立新的私人 `decks` row。
- 寫入 `deck_share_copy_events`。
- 使用 client idempotency key 避免重複點擊建立多副牌組。
- 回傳新 `DeckResponse` 與更新後 copy count。

### 訪客複製

- 從公開詳情的 card IDs 呼叫既有 `saveCustomDeck`。
- 新增而不覆蓋目前本機牌組。
- 捕捉 localStorage quota／security error。
- 不增加可信任 copy count。

### 按讚

- `PUT /api/deck-shares/:shareId/like`
- `DELETE /api/deck-shares/:shareId/like`
- 自己的分享回傳 400/403，不允許影響熱門排序。
- hidden/unpublished/block 關係使用與詳情相同的不存在語意。
- 前端 optimistic update，失敗回滾；列表與詳情共用快取更新規則。

### 測試

- 複製重新驗證、名稱截斷、transaction rollback、idempotency。
- 訪客本機新增與寫入失敗。
- like 唯一性、取消、自讚、封鎖、競態與 optimistic rollback。

### 退出條件

- 登入／訪客複製都可前往編輯器使用新牌組。
- popular 與 most-copied 排序反映可信任伺服器事件。

## 8. Phase 6：檢舉、封鎖與管理審核

### 玩家檢舉

新增 `POST /api/deck-shares/:shareId/reports`：

- 固定 reason enum，note 最多 300 字。
- 不可檢舉自己。
- 同一玩家對同一分享只允許一個未結案檢舉。
- rate limit 與既有安全日誌。

### 管理端

新增 service／routes：

- 列出 pending reports。
- 查看分享快照與必要的報告證據。
- hidden／visible moderation 操作。
- resolved／dismissed report 狀態。
- 每次操作寫入 `admin_audit_log`。

前端在既有 AdminPage 加入獨立區塊，避免重構整個管理頁。

### Block 行為

- 大廳、搜尋、詳情、like、copy、report 都套用雙向 block 過濾。
- 擁有者管理自己的分享不受 block query 影響。
- 管理員審核不套用一般玩家 block 過濾。

### 測試

- report 去重、自我檢舉、hidden visibility、admin role boundary。
- 管理隱藏後所有公開讀寫 endpoint 一致不可見。
- 恢復後重新可見，share ID 與互動數據保留。
- admin audit log 內容不包含不必要私人資料。

### 退出條件

- 公開 UGC 有完整的檢舉、隱藏、恢復與稽核路徑。
- 玩家無法利用直接 ID 繞過 moderation 或 block。

## 9. Phase 7：資料生命週期、隱私與分析

### 帳號匯出與刪除

- 匯出自己的 shares、likes、copy events、reports。
- 不匯出其他玩家 email、私有牌組、檢舉者或管理審核備註。
- 帳號刪除時驗證 FK cascade／匿名化符合政策。
- 原始牌組刪除只將 source deck 設 null，不刪分享快照。

### Retention

- report／moderation evidence 對齊 365 天政策與 legal hold 行為。
- copy events 只保留提供聚合與防濫用所需資料；帳號刪除時刪除或匿名化 user reference。
- retention dry-run、batch、metrics 與測試納入新表。

### 文件與公開法律內容

- `docs/PRIVACY.md`
- `docs/DATA_RETENTION.md`
- `src/legalContent.ts`
- 必要的 legal content tests

### 分析

- 使用既有 allowlist funnel helper。
- 不傳 share ID、deck name、card IDs 或原始 user ID。
- 新事件與允許欄位依需求規格建立 contract test。

### 退出條件

- account export/delete、retention、legal hold 與 privacy copy 有測試證據。
- 分析事件不含牌組內容或直接玩家識別資料。

## 10. Phase 8：整合驗證與交付

### 自動化測試

依變更逐步執行精準測試，最後執行：

1. Deck share service、route、client、state 與 component unit tests。
2. Migration、schema gate、account export/delete、retention tests。
3. Playwright：
   - 訪客瀏覽公開／unlisted 分享。
   - 登入發布、更新、取消、重新發布。
   - 登入與訪客複製。
   - like optimistic UI。
   - report 與 admin hide／restore。
   - block 後列表／詳情不可見。
4. Accessibility：鍵盤、focus、Dialog／Sheet、loading 與錯誤播報。
5. Responsive：360x800、390x844、tablet、desktop。
6. `npm run build`。
7. `npm run verify`。

### 手動 QA

- 分享 URL 在未登入、不同帳號、重新整理與 PWA standalone 下可用。
- Web Share API 與 clipboard fallback。
- 慢網路、重複點擊、請求取消、401 refresh、409 idempotency、404 moderation。
- 舊 rules version 與未知卡牌的非崩潰狀態。
- 長名稱、CJK／日文／韓文與 60 字元截斷。

### Git 與提交

- 每次 staging 前執行 `git status --short`，只 stage 本功能檔案。
- 建議提交切分：
  1. `feat(deck-share): 建立牌組分享資料模型與 API`
  2. `feat(deck-share): 新增分享大廳與牌組詳情`
  3. `feat(deck-share): 整合發布、複製與按讚流程`
  4. `feat(deck-share): 加入檢舉審核與資料生命週期`
  5. `test(deck-share): 補齊整合與響應式驗證`
- commit 或 push 前必須在 repository root 完整通過 `npm run verify`。
- 未經使用者明確要求不 push。

### 最終退出條件

- 規格中的 MVP 驗收標準全部有自動或手動證據。
- `npm run verify` 與 production build 通過。
- worktree 沒有混入主 worktree 的使用者變更。
- release guard 的正式環境狀態與功能凍結決策已記錄。

## 11. 估計工作量與依賴

| Phase | 內容                        | 相對工作量 | 依賴          |
| ----- | --------------------------- | ---------- | ------------- |
| 0     | 基線、flag、contract        | S          | 目標分支狀態  |
| 1     | Migration、schema           | M          | Phase 0       |
| 2     | 核心 API                    | L          | Phase 1       |
| 3     | 大廳與詳情 UI               | L          | Phase 2       |
| 4     | 編輯器發布管理              | M-L        | Phase 2、3    |
| 5     | 複製與按讚                  | M          | Phase 2、3    |
| 6     | 檢舉與管理審核              | L          | Phase 2、3    |
| 7     | 匯出、刪除、retention、文件 | M-L        | Phase 1、2、6 |
| 8     | E2E、responsive、完整驗證   | L          | 全部 phase    |

整體屬於大型跨層功能。主要風險不是卡片列表 UI，而是公開 UGC 的權限一致性、migration 併行、帳號刪除／retention，以及 `App.tsx`、i18n 和 AdminPage 與其他 worktree 的合併衝突。

## 12. 執行時優先風險清單

1. **Migration 編號衝突**：實作前同步，不使用已被其他 worktree 佔用的編號。
2. **公開內容意外同步**：任何更新都由 server 從 source deck 建立明確快照。
3. **權限資訊洩漏**：hidden、unpublished、blocked 與不存在對一般使用者統一 404。
4. **熱門數據灌票**：只計唯一登入 like 與成功 server copy；不採匿名 view count。
5. **帳號刪除不完整**：在 migration 階段就設計 FK，並補 export/delete/retention tests。
6. **前端狀態競態**：切換牌組、登入狀態與重複發布都使用 request identity／idempotency 防護。
7. **發布凍結衝突**：保留 release guard，未核准前不讓正式環境入口出現。
