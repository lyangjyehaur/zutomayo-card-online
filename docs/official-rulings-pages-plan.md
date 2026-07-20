# 官方 Q&A 與勘誤頁面實作計畫

## 目標

在站內提供可搜尋、可深連結、支援既有六種語言的官方規則資料庫，整合：

- 官方 Q&A：<https://zutomayocard.net/qa/>
- 官方勘誤：<https://zutomayocard.net/errata/>

玩家不需要離開本站即可查看內容，但每筆資料都必須保留日文原文、官方來源連結、同步時間與翻譯狀態。翻譯不得標示為官方翻譯。

## 現況與限制

- 官方來源目前公開 74 筆 Q&A；初始匯入應直接寫入 PostgreSQL，不使用 Git 追蹤 JSON 作為執行期或部署 fallback。
- `data/card-official-errata.json` 已包含目前 12 筆官方勘誤；現有 PostgreSQL schema 與卡片 API 也已保存勘誤的核心欄位。
- Q&A 的關聯卡牌 ID 與目前卡牌資料 ID 相容，可直接連到卡片預覽或牌組編輯器。
- 固定 UI 文案已有 `zh-TW`、`zh-HK`、`zh-CN`、`ja`、`en`、`ko` 六種 locale。
- 本 worktree 從 `master` 的 `a98acfe6` 建立，不包含原工作目錄尚未提交的翻譯設定相關修改。此功能先保持獨立；該批修改落地後再整合共用翻譯 provider。
- 官方 Q&A 的原始資料可能包含尚未公開的紀錄。同步時只能接受明確標記為 `公開` 的項目，不可使用「不是非公開就視為公開」的寬鬆條件。

## 範圍

### MVP 必須完成

- `/rules/qa` Q&A 清單與搜尋頁。
- `/rules/qa/:number` Q&A 詳情頁。
- `/rules/errata` 勘誤清單頁。
- `/rules/errata/:id` 勘誤詳情頁。
- 從 PostgreSQL 提供公開 API，不讓前端直接存取官方網站。
- 日文原文與至少繁體中文顯示路徑。
- 分類、關鍵字、關聯卡牌篩選。
- 卡牌預覽／卡牌詳情與官方勘誤頁互相連結。
- 官方來源、翻譯狀態及最後同步時間。
- 行動裝置、鍵盤操作、螢幕閱讀器與 PWA build 驗證。

### 後續階段

- 其餘四種衍生語言翻譯與審核。
- 管理端的同步差異預覽、翻譯重試及人工核准。
- 每日自動同步與異常通知。
- 規則術語表與跨 Q&A 搜尋強化。

### 不在本次範圍

- iframe 或代理顯示整個官方頁面。
- 在玩家請求期間即時抓取官方網站或呼叫翻譯模型。
- 取代現有卡片有效文字的權威資料來源。
- 自動改動遊戲規則程式；Q&A 只提供裁定內容與關聯資訊。

## 核心設計決策

### 1. 固定 UI 與動態內容分離

- 頁面標題、篩選器、狀態訊息放在 `src/i18n/*.ts`。
- Q&A 和勘誤正文放 PostgreSQL，不加入靜態翻譯字典。
- API 同時回傳日文來源與選定 locale 的有效內容，讓前端可切換原文。

### 2. 翻譯採內容版本化

- 日文問題、答案、分類或關聯卡牌變更時更新 `content_version`。
- 翻譯以 `(resource_id, content_version, locale)` 唯一。
- 舊版本翻譯保留歷史但不再公開使用。
- 公開 fallback：`verified` -> `machine`（若允許）-> 日文原文。
- 規則型內容優先要求人工複核；機器翻譯必須顯示「非官方翻譯」。

### 3. 修正後卡片文字不重複保存

- 勘誤頁的「修正後」名稱或效果直接使用現有卡片有效本地化文字。
- 勘誤翻譯表只保存錯誤文字、變更原因、交換／修正政策與使用說明。
- 避免勘誤頁、牌組編輯器與實際遊戲顯示三套不同內容。

### 4. 同步失敗時保留上一版

- parser 或驗證失敗時整批中止，不做部分更新。
- 官方消失的項目先標記 inactive，不直接刪除。
- 玩家頁永遠讀取最後一個已驗證且已發布的本地版本。

## 資料庫設計

### `official_qa_items`

| 欄位                            | 用途                      |
| ------------------------------- | ------------------------- |
| `id text primary key`           | 官方穩定 ID，例如 `qa_74` |
| `number integer unique`         | 顯示編號與深連結          |
| `published_at date`             | 官方日期                  |
| `question_ja text`              | 日文問題原文              |
| `answer_ja text`                | 日文答案原文              |
| `tags text[]`                   | 官方分類                  |
| `related_card_ids text[]`       | 關聯卡牌 ID               |
| `source_url text`               | 官方 Q&A 頁面             |
| `content_hash text`             | 正規化內容雜湊            |
| `content_version integer`       | 翻譯失效與歷史版本依據    |
| `publication_status text`       | `published` / `inactive`  |
| `source_updated_at timestamptz` | 官方提供的日期（若有）    |
| `last_seen_at timestamptz`      | 最近一次同步仍存在        |
| `created_at`, `updated_at`      | 本地稽核時間              |

### `official_qa_translations`

| 欄位                                 | 用途                                                 |
| ------------------------------------ | ---------------------------------------------------- |
| `qa_id`                              | 對應 Q&A                                             |
| `content_version`                    | 對應原文版本                                         |
| `locale`                             | 六種既有 locale 之一，`ja` 不建立翻譯列              |
| `question_text`                      | 翻譯問題                                             |
| `answer_text`                        | 翻譯答案                                             |
| `status`                             | `pending_review` / `machine` / `verified` / `failed` |
| `provider`, `model`                  | 生成來源                                             |
| `review_note`                        | 術語或裁定複核備註                                   |
| `reviewed_by_user_id`, `reviewed_at` | 人工複核紀錄                                         |
| `created_at`, `updated_at`           | 稽核時間                                             |

唯一鍵：`(qa_id, content_version, locale)`。

### 現有 `card_official_errata` 擴充

- `reason_ja text`
- `replacement_policy_ja text`
- `usage_policy_ja text`
- `content_hash text`
- `content_version integer`
- `publication_status text`
- `last_seen_at timestamptz`

### `card_official_errata_translations`

- `errata_id`
- `content_version`
- `locale`
- `incorrect_text`
- `reason_text`
- `replacement_policy_text`
- `usage_policy_text`
- 與 Q&A 相同的翻譯狀態、provider、model 及 review 欄位。

唯一鍵：`(errata_id, content_version, locale)`。

## 後端服務與 API

新增 `api/officialRulingsService.cjs`，負責 locale 正規化、fallback、查詢與 response mapping。

### 公開 API

- `GET /api/official/qa`
  - query：`lang`、`query`、`tag`、`cardId`
  - MVP 可一次回傳全部 74 筆；server 仍應支援 filter，保留擴充性。
- `GET /api/official/qa/:number`
- `GET /api/official/errata`
  - query：`lang`、`cardId`
- `GET /api/official/errata/:id`

每筆 response 至少包含：

- 穩定 ID、編號、日期與關聯卡牌。
- `source`：日文原文。
- `localized`：有效 locale 內容。
- `requestedLocale`、`effectiveLocale`。
- `translationStatus`。
- `sourceUrl`、`lastSyncedAt`。

快取：`Cache-Control: public, max-age=300, stale-while-revalidate=1800`，並以 locale 與資料版本產生 ETag。

### 管理 API（第二階段）

- `POST /api/admin/official-content/sync`
- `GET /api/admin/official-content/sync-status`
- `GET /api/admin/official-content/translations`
- `PUT /api/admin/official-content/translations/:resourceType/:id/:locale`
- `POST /api/admin/official-content/translations/:resourceType/:id/:locale/generate`

所有寫入操作必須留下管理稽核紀錄。

## 官方資料同步

新增 `scripts/sync-official-rulings.ts`，支援：

- `--check`：抓取並驗證，只輸出 diff，不寫資料庫。
- `--apply`：在 transaction 中套用經驗證內容。
- `--fixture-dir`：測試時使用固定 HTML／JSON，不依賴外網。

### Q&A 驗證

- 僅匯入 `public === '公開'`。
- ID、number 必須唯一且為正數。
- question、answer 不可為空。
- `<br>` 正規化為換行；移除其他 HTML，禁止直接保存可執行 markup。
- tags 只接受非空字串。
- related card ID 必須存在於 `cards`。
- 初始基準預期為 74 筆；後續數量變化只警告，但大量減少應中止。

### 勘誤驗證

- 從列表頁取得所有詳情 URL，處理分頁。
- 詳情必須包含錯誤文字、修正文字、卡名、商品、卡號及官方來源 URL。
- 依商品與卡號映射 card ID，並和既有 `data/card-official-errata.json` 交叉驗證。
- 修正後日文必須等於 `cards` 中目前有效的名稱或效果。
- HTML 結構不符合預期時 fail closed。

### 排程

- MVP：人工執行 `--check`，確認 diff 後執行 `--apply`。
- 第二階段：每日排程只做 check；有差異時通知管理者。
- 第三階段：低風險新增項目可自動匯入日文原文，但翻譯仍走審核狀態。

## 前端資訊架構

### 路由

- `/rules/qa`
- `/rules/qa/:number`
- `/rules/errata`
- `/rules/errata/:id`

不使用 `/qa` 作正式路由，避免與現有 `/qa/battle` 視覺測試 namespace 混淆。

### 頁面與元件

- `src/pages/OfficialQaPage.tsx`
- `src/pages/OfficialQaDetailPage.tsx`
- `src/pages/OfficialErrataPage.tsx`
- `src/pages/OfficialErrataDetailPage.tsx`
- `src/components/rules/RulesPageHeader.tsx`
- `src/components/rules/TranslationStatusBadge.tsx`
- `src/components/rules/SourceTextToggle.tsx`
- `src/components/rules/RelatedCardLinks.tsx`

清單頁：

- Q&A／勘誤 tab。
- 關鍵字搜尋。
- 分類 chip。
- 卡牌篩選與清除條件。
- URL search params 保存搜尋狀態，方便分享與返回。
- loading、empty、error、offline fallback 狀態。

詳情頁：

- 本地化內容為主要閱讀區。
- 可展開日文原文。
- 顯示翻譯狀態及非官方翻譯說明。
- 關聯卡牌使用既有卡片名稱 i18n 與 `CardImage`。
- 外部官方來源使用新分頁並加 `rel="noreferrer"`。
- 勘誤頁顯示錯誤／修正對照、原因、交換政策與使用說明。

### 導覽入口

- 首頁 drawer／資源區新增「規則 Q&A／勘誤」。
- 牌組編輯器的官方勘誤徽章可進入 `/rules/errata/:id`。
- 卡牌詳情可列出相關 Q&A，先以 `cardId` filter 連到清單頁，避免第一版增加額外卡牌 API 聚合。

## i18n 與翻譯品質

- 新增固定 UI key：頁面標題、搜尋、分類、原文切換、翻譯狀態、來源與同步日期等。
- 卡名一律透過 `getLocalizedCardName()`，不交給翻譯模型自由改寫。
- 送翻譯前將卡名轉成 `[[CARD:<id>]]` token，完成後再代回本地化卡名。
- 建立規則術語表，至少鎖定：Chronos、Abyss、Power Charger、Set Zone、Battle Zone、SEND TO POWER、Character、Enchant、Area Enchant。
- 保留 `★`、數字、區域 A/B/C 與卡牌 ID。
- 翻譯 response 必須通過 JSON schema、token 完整性及數字一致性檢查。
- `verified` 由管理者人工核准；機器輸出不可自行升級為 verified。

## 測試計畫

### 單元測試

- Q&A／勘誤 row mapping。
- locale 正規化與 fallback。
- content hash 與 version bump。
- 僅匯入 `public === '公開'`。
- HTML 正規化與 XSS payload 移除。
- 關聯卡牌 ID 驗證。
- 翻譯 token、數字與符號一致性。

### API 測試

- 清單、詳情、404、filter、locale fallback。
- machine／verified／日文 fallback 狀態。
- cache header 與 inactive 項目不可公開。
- 資料庫或翻譯不可用時仍可回傳日文來源。

### 前端測試

- 搜尋、分類、清除條件與 URL state。
- locale 切換後重新取得動態內容。
- 原文展開、來源連結與相關卡牌連結。
- loading、empty、error、offline。
- 鍵盤操作、focus、landmark、heading hierarchy。

### E2E

- 從首頁進入 Q&A。
- 搜尋並打開詳情，再返回保留條件。
- 從牌組編輯器的勘誤徽章進入對應詳情。
- 切換 `zh-TW`／`ja` 並驗證原文和翻譯狀態。
- 行動版 drawer 與主要搜尋流程。

## 分階段交付

### Phase 1：可查看的日文資料庫

- migration 與 seed/import。
- 公開 Q&A／勘誤 API。
- 四個路由與基本搜尋。
- 日文原文、來源連結、關聯卡牌。
- 首頁入口與勘誤徽章連結。

驗收：玩家可在桌面與行動版完成查詢，不依賴官方網站即時可用性。

### Phase 2：繁中與翻譯狀態

- 翻譯表、fallback 與繁中內容。
- 原文切換與非官方翻譯標示。
- 術語／token 驗證。
- 管理端人工編輯與 verified 狀態。

驗收：繁中使用者能閱讀完整內容，且可清楚區分官方日文與本站翻譯。

### Phase 3：六語系與同步維運

- 其餘 locale。
- 翻譯 provider 整合與背景生成。
- 官方來源 diff、同步狀態、管理通知。
- PWA cache 與監控指標。

驗收：官方新增或修改內容可被偵測、版本化、翻譯並安全發布。

## 預計修改範圍

- `migrations/`：Q&A、翻譯及勘誤擴充 schema。
- `api/server.cjs`、`api/schemas.cjs`：公開與管理路由。
- `api/officialRulingsService.cjs`：查詢、fallback、mapping。
- `scripts/sync-official-rulings.ts`：同步與差異偵測。
- `src/api/client.ts`：公開資料型別與請求函式。
- `src/App.tsx`：lazy routes 與 fullscreen route 判定。
- `src/pages/Official*Page.tsx`：清單與詳情頁。
- `src/components/rules/`：共用規則內容元件。
- `src/i18n/*.ts`：固定 UI 文案。
- `src/pages/LobbyPage.tsx`、`src/components/DeckEditor.tsx`：入口與連結。
- `api/__tests__/`、`src/**/__tests__/`、`e2e/`：服務、UI 與流程測試。

## Definition of Done

- 官方公開的 74 筆 Q&A 與 12 筆勘誤可在站內查看。
- 所有關聯卡牌 ID 有效，勘誤詳情與卡片有效文字一致。
- 日文原文永遠可查看，翻譯狀態與來源清楚。
- 不會匯入未明確標記公開的 Q&A。
- 前端不直接呼叫官方來源或翻譯 provider。
- 同步與 parser 有 fixtures、schema 驗證與 fail-closed 測試。
- 桌面／行動／鍵盤／螢幕閱讀器主要流程通過。
- `npm run verify` 與額外的 `npm run build` 通過後才可提交或推送。
