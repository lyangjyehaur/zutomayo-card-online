# Meilisearch 統一全文搜尋計劃

狀態：第一階段與搜尋體驗增強均已完成
目標版本：0.2.5 後續功能分支
分支：`codex/meilisearch-unified-search`

## 1. 問題與目標

目前卡牌圖鑑、官方 Q&A、勘誤、完整規則與牌組分享各自實作搜尋：有些在瀏覽器逐筆比對，有些由 PostgreSQL `ILIKE` 處理。這會造成以下問題：

- 中文、日文與韓文輸入法組字期間可能反覆觸發路由與昂貴的全文比對。
- 卡牌名稱、歌名、效果、Q&A 與規則章節無法跨內容類型搜尋。
- 多語名稱、標準術語與同義詞規則分散，搜尋結果不一致。
- 長規則文件只能在已載入的單一文件內搜尋，無法定位跨文件章節。
- 各頁面分別維護排序、錯字容忍與命中摘要，容易再次出現字串排序或翻譯遺漏。

本次目標是建立一個以 Meilisearch 為主要引擎、PostgreSQL 為唯一真實資料來源的公開知識搜尋層，同時服務：

1. 全站搜尋頁。
2. 卡牌圖鑑內搜尋。
3. 官方 Q&A 內搜尋。
4. Grand Rules／Floor Rules 章節搜尋。
5. 官方勘誤搜尋。
6. 公開牌組分享搜尋。

## 2. 非目標

- 不把帳號私有牌組、實體卡持有狀態、聊天或管理員草稿放入公開索引。
- 不以 Meilisearch 取代 PostgreSQL；搜尋索引必須能從 PostgreSQL 完整重建。
- 不讓瀏覽器持有 Meilisearch master key 或直接依賴內部搜尋服務位址。
- 不讓搜尋服務故障影響對戰、登入、卡牌詳情或官方規則原文的可用性。
- 不在本輪建立推薦系統或語意向量搜尋。

## 3. 使用者體驗

### 3.1 全站搜尋

- 路由為 `/search`，可由所有標準頁首進入。
- 支援「全部、卡牌、Q&A、規則、勘誤、牌組」範圍切換。
- 每筆結果顯示內容類型、標題、命中摘要、關聯資訊與正確目的頁面。
- URL 保存 `q` 與 `scope`，可分享、重新整理及使用瀏覽器上一頁。
- 空查詢不送出搜尋請求，顯示可搜尋的內容範圍。

### 3.2 頁面內搜尋

- 各頁面使用相同 `/api/search` 契約，但固定自己的 `scope` 和結構化篩選。
- 原頁面的展示元件、權限判斷與業務篩選不由通用搜尋結果取代。
- 搜尋服務不可用時，卡牌、Q&A、規則與勘誤保留現有本地搜尋；牌組分享保留 PostgreSQL 搜尋。

### 3.3 輸入法與請求節奏

- 輸入框使用本地 controlled state。
- `compositionstart` 至 `compositionend` 期間不得更新 URL 或發送請求。
- 組字完成或一般輸入停止 250ms 後才套用查詢。
- 新請求開始時取消或忽略舊請求，不允許舊結果覆蓋新查詢。
- 搜尋套用時重設頁碼，但保留其他有效篩選。

## 4. 索引模型

使用單一版本化索引，邏輯名稱預設為 `zutomayo_knowledge`。每一項公開內容依語言建立一筆文件，主鍵格式只使用 Meilisearch 允許的英數、連字號與底線。

```ts
interface KnowledgeDocument {
  uid: string;
  type: 'card' | 'qa' | 'rule' | 'errata' | 'deck';
  locale: 'ja' | 'zh-TW' | 'zh-CN' | 'zh-HK' | 'en' | 'ko';
  sourceId: string;
  title: string;
  subtitle: string;
  body: string;
  aliases: string[];
  tags: string[];
  keywords: string[];
  relatedCardIds: string[];
  url: string;
  image: string;
  pack: string;
  rarity: string;
  element: string;
  cardType: string;
  distributionType: string;
  documentId: string;
  sortNumber: number;
  publishedAt: number;
  updatedAt: number;
}
```

### 4.1 內容映射

- 卡牌：各語言已發布名稱與效果、所有語言別名、歌名、編號、卡包、稀有度、屬性、類型、關鍵字。
- Q&A：問題為標題，回答為本文，分類及關聯卡牌為 facet。
- 規則：每個章節獨立一筆；文件摘要也獨立索引。不得把整份規則合成單筆長文件。
- 勘誤：卡牌名稱與編號為標題，錯誤文字、修正文字、原因及使用政策組成本​​文。
- 牌組：僅 `public + published + visible`，索引牌組名稱、作者暱稱、卡牌編號與已發布卡牌名稱；不索引私人或 unlisted 牌組。

### 4.2 多語搜尋

- 回傳文件以請求的 `locale` 顯示。
- `aliases` 收錄同一來源在其他已發布語言的名稱、問題或章節標題，因此使用日文或英文仍可找到當前語言結果。
- 由標準翻譯字典逐項校驗的跨語術語群組生成索引 synonyms；同步測試在字典變更但搜尋設定未更新時會失敗。索引內容不得採用未複核翻譯。
- 卡牌 ID、Q&A 編號與規則編號優先精確匹配，並對識別碼欄位停用 typo tolerance。

### 4.3 Meilisearch 設定

- searchable：`sourceId`, `title`, `aliases`, `keywords`, `tags`, `subtitle`, `body`, `relatedCardIds`。
- filterable：`type`, `locale`, `pack`, `rarity`, `element`, `cardType`, `distributionType`, `documentId`, `tags`, `relatedCardIds`。
- sortable：`sortNumber`, `publishedAt`, `updatedAt`。
- displayed：僅公開展示欄位，不存放內部複核備註或帳號識別資料。

## 5. 後端與安全邊界

### 5.1 公開 API

```http
GET /api/search?q=回溯&scope=card,qa&lang=zh-TW&limit=24&offset=0
```

支援的結構化參數：

- `scope`: `all` 或允許類型的逗號分隔值。
- `lang`: 六種已支援語言。
- `pack`, `rarity`, `element`, `cardType`, `distributionType`, `documentId`, `tag`, `cardId`。
- `limit`: 1–100；`offset`: 0–10000。牌組分享的伺服器內部候選查詢使用受控的 500 筆上限，再交由 PostgreSQL 套用公開狀態、封鎖、排序與 cursor。

回應包含 `hits`, `estimatedTotalHits`, `limit`, `offset`, `processingTimeMs`, `engine`。`engine` 僅用於診斷，可為 `meilisearch` 或 `postgres-fallback`。

### 5.2 安全

- `MEILI_MASTER_KEY` 僅存在 API、索引器與 Meilisearch runtime，不得使用 `VITE_` 前綴。
- Meilisearch 不對公網發布 port；瀏覽器只能呼叫 `/api/search`。
- API 對 query 長度、scope、filter、limit 與 offset 進行 allowlist 驗證。
- 命中高亮只當作文字資料處理，前端不得以未消毒 HTML 插入。
- 牌組搜尋結果返回前仍需由 PostgreSQL 套用公開狀態、封鎖關係與可見性規則。

## 6. 索引同步與故障策略

### 6.1 原子重建

1. 從 PostgreSQL 讀取當前已發布內容。
2. 建立臨時索引並套用完整設定。
3. 分批寫入文件並等待所有 Meilisearch task 成功。
4. 使用 index swap 原子替換正式索引。
5. 刪除舊臨時索引。

任何步驟失敗都不得清空或部分覆蓋目前正式索引。

### 6.2 同步時機

- 部署流程在卡牌、官方裁定與規則文件發布完成後執行一次完整重建。
- API 啟動後執行非阻塞同步；Redis 分散式鎖避免多個 API replica 同時重建。
- 低頻背景對帳修正漏掉的外部資料更新。
- 後續若資料量或更新頻率顯著增加，再以 outbox 增量同步取代完整重建。

### 6.3 降級

- Meilisearch 未設定、逾時或回傳錯誤時，API 使用短期快取的 PostgreSQL 衍生文件做標準化 substring 搜尋。
- `/health` 不因搜尋服務失敗而失敗；`/ready` 保持核心服務語意。
- `/api/search/status` 顯示是否啟用 Meilisearch、索引版本、最後成功同步時間與文件數，不洩漏位址或 key。
- Prometheus 記錄查詢總數、引擎、結果、延遲、同步狀態與索引文件數。

## 7. 部署與維運

- 本地與 E2E Compose 加入固定版本及 digest 的 Meilisearch，使用獨立 volume。
- Server4 Compose 加入內網限定的 Meilisearch 服務與持久 volume，API 使用 service DNS 連線。
- production 必須設定至少 16 字元的 `MEILI_MASTER_KEY`；不得使用預設值。
- Meilisearch 資料卷不納入唯一備份來源，災難復原以 PostgreSQL 完整重建為準。
- 提供 `npm run search:reindex` 與 `npm run search:check`。
- 部署 smoke 驗證搜尋狀態、代表性卡牌、Q&A 與規則章節查詢。

## 8. 實作階段

### Phase A：索引與 API

- 建立文件產生器、Meilisearch HTTP client、設定與原子重建流程。
- 建立輸入驗證、公開搜尋 API、狀態 API、fallback 與 metrics。
- 建立單元測試，覆蓋公開資料邊界、多語 aliases、filter 轉義、原子交換與失敗降級。

### Phase B：全站搜尋

- 新增 `/search` 頁面與全站頁首入口。
- 建立共用 composition-aware 防抖 hook 與可取消搜尋 client。
- 完成 scope tabs、結果摘要、空白／載入／錯誤／無結果狀態及響應式版面。

### Phase C：頁面內整合

- 卡牌圖鑑以 `card` scope 取得命中 ID，再套用持有狀態與展示篩選。
- Q&A、勘誤及規則章節使用對應 scope；失敗時保留既有本地搜尋。
- 牌組分享由後端以 Meilisearch 找候選 ID，再由 PostgreSQL完成可見性、封鎖及排序檢查。

### Phase D：部署與 QA

- Compose、Server4、環境文件、部署重建與 smoke。
- Chromium 桌面與手機 viewport 測試 IME、URL 同步、scope、跨語搜尋及故障降級。
- 執行 `npm run verify`，並審查計劃中的每一項驗收條件。

### Phase E：搜尋體驗增強

- 新增最多 8 筆的搜尋建議 API 與可使用鍵盤操作的 combobox；建議只返回公開索引欄位，輸入法組字期間不請求。
- API 回傳標題與摘要的純文字命中區間，前端以 React 節點渲染，不插入 Meilisearch 或使用者提供的 HTML。
- 以 PostgreSQL 匿名聚合零結果查詢，不記錄帳號、IP 或 request ID；疑似 email、URL、憑證或超長內容只計入 Prometheus，不保存查詢文字。
- 管理後台卡牌與官方裁定搜尋共用 composition-aware 防抖及公開索引的跨語命中；未發布、草稿及審核欄位仍由管理端既有權限內搜尋補足，不進公開索引。
- 零結果聚合只透過已授權管理 API 查看，並設置有限保留期與清理策略。

## 9. 驗收條件

- 中文／日文 IME 組字 1 秒期間不改 URL、不請求搜尋 API。
- 停止輸入 250ms 後只套用最後查詢，舊結果不能覆蓋新結果。
- 使用任一已發布語言的卡牌名稱或效果，都能返回目前介面語言的卡牌結果。
- 全站搜尋可命中卡牌效果、Q&A 回答、規則章節本文、勘誤本文與公開牌組。
- 卡牌編號依自然數值語意排序，不使用字串排序。
- 私人、unlisted、未發布、被管理員隱藏的牌組不出現在索引或結果。
- 未複核翻譯、管理備註、帳號私有資料不進入公開索引。
- Meilisearch 停止時，核心頁面可載入，頁面內搜尋可降級，全站搜尋明確標示暫時降級而非無限載入。
- 重建中查詢只能看到完整舊索引或完整新索引，不能看到空索引或部分資料。
- 本地、CI Compose 與 Server4 配置驗證通過，正式環境 key 不進 Git、映像或前端 bundle。
- 搜尋建議支援方向鍵、Enter、Escape 與螢幕閱讀器狀態；組字期間不得打開或更新建議。
- 命中高亮不使用 `dangerouslySetInnerHTML`，Meilisearch 標記不得直接進入畫面。
- 零結果查詢不包含使用者識別資料，疑似敏感內容不以明文保存，管理 API 不可公開存取。
- 管理後台搜尋不得因公開索引未包含草稿而隱藏未發布內容。
