# 官方規則、Q&A 與勘誤資料庫

站內規則資料庫整合官方 [Grand Rules／基本 Floor Rules](https://zutomayocard.net/rule/)、[Q&A](https://zutomayocard.net/qa/) 與[勘誤](https://zutomayocard.net/errata/)，公開路由為：

- `/rules/qa`、`/rules/qa/:number`
- `/rules/errata`、`/rules/errata/:errataId`
- `/rules/grand`、`/rules/floor`

日文內容永遠是權威來源。正式 active release 要求五個衍生語言全部為 `verified` 且內容完整；詳情頁仍可展開原文核對。固定介面文案使用既有六語系字典；Q&A、勘誤、翻譯與 release manifest 都保存於 PostgreSQL。

## 資料與同步

- PostgreSQL 是規則文件、Q&A、勘誤與翻譯的唯一執行期事實來源；API 不提供 repository JSON fallback。
- `npm run release:official-rule-documents`：讀取 `OFFICIAL_RULE_DOCUMENTS_FILE` 指定的未追蹤五語文件來源，確認官方規則索引仍指向兩份來源 PDF，重新下載並核對 SHA-256 與五語完整性，再原子切換兩份文件的 active version。
- 官方日文內容由同步程式直接抓取並與 PostgreSQL 比對，不建立或更新 Git 追蹤快照。
- `npm run sync:official-rulings`：從官方來源抓取並與 PostgreSQL 比對。發現差異時以 exit code `2` 結束。
- `npm run sync:official-rulings -- --apply`：僅供維護／開發資料庫更新日文 candidate；正式發布不得以此取代 release gate。
- `npm run export:official-rulings-translations -- --baseline-api=<url> --output=data/official-rulings-translations.json`：從目前 active PostgreSQL API 匯出既有五語翻譯，將 Q&A 中辨識到的卡名改為 `[[CARD:<id>]]`，並以最新官方日文來源 hash 產生受 `.gitignore` 保護的發布來源。匯出時若無法辨識卡名、缺少已複核卡名或內容無法通過 release gate 驗證，會直接失敗。
- `npm run release:official-rulings -- --translations=- --app-version=<version> --build-id=<sha>`：從 stdin 接收未追蹤的五語靜態翻譯，重新抓取官方來源並原子發布。
- `--baseline-api=<url>` 或 `OFFICIAL_RULINGS_BASELINE_API_URL` 可透過已部署的公開 API 讀取 PostgreSQL baseline，供無資料庫憑證的排程唯讀檢查使用。
- `npm run sync:official-rulings -- --fixture-dir=<path>`：改讀固定 Q&A JSON 與勘誤 HTML，供 parser／CLI 測試使用。
- `npm run sync:official-rulings -- --report=<path>`：輸出含 `added`、`updated`、`removed` 的 machine-readable JSON diff。

Q&A 同步只接受 `public === '公開'`。parser、筆數或必要欄位不符合預期時會整批中止；官方消失的 Q&A 只標記 `inactive`，不刪除歷史資料。

`.github/workflows/official-rulings-sync.yml` 每日 03:15 UTC 透過已部署 API 取得 PostgreSQL baseline 後執行唯讀 check。有差異時會建立或更新 GitHub issue，並保存 30 天 diff artifact；排程不會自動寫入資料庫。

## 部署與初次發布順序

官方規則同步依賴真實卡牌與既有 `card_official_errata` 資料，因此不能在空資料庫剛完成 migration 時自動執行。新環境固定依照以下順序：

1. `npm run db:migrate`：建立來源、翻譯、release snapshot、manifest 與 active pointer。
2. 匯入／seed 正式卡牌資料與官方卡牌文本，例如 `npm run seed:cards`、`npm run import:card-official-texts`。
3. 將本機已複核、受 `.gitignore` 保護的 `data/official-rulings-translations.json` 與 `data/official-rule-documents-*.json` 放好。
4. 以 `release:official-rulings` 及 `release:official-rule-documents` 完成即時來源驗證、五語匯入、完整性檢查及 active pointer 切換。
5. 啟動或重啟 API，檢查 `/api/official/status` 的 `buildId`，並抽查 Grand Rules、基本 Floor Rules、Q&A 與勘誤六種語言。

內容 JSON 不得提交 GitHub，也不會複製進 API 或 migration image。內容發布須從持有本機受控來源檔的維護環境執行；server4 部署透過 SSH stdin 將內容直接送進一次性 migration container。

```bash
npm run export:official-rulings-translations -- \
  --baseline-api=https://<目前部署網址> \
  --output=data/official-rulings-translations.json

cat data/official-rulings-translations.json | npm run release:official-rulings -- \
  --translations=- --app-version=0.2.3 --build-id="$(git rev-parse HEAD)"

OFFICIAL_RULE_DOCUMENTS_FILE=data/official-rule-documents-20260721.json \
  npm run release:official-rule-documents
```

發布命令會驗證所有 Q&A 關聯卡牌 ID、勘誤卡牌 ID、修正後日文、卡牌資料集 hash，以及每筆當前內容版本的五語完整翻譯。Q&A 日文原文出現關聯卡名時，英文必須使用 `cards.en_name_official`，繁中、簡中、粵語與韓文必須使用 `card_texts_i18n` 中 `review_status='verified'` 的卡名；翻譯來源也可填入 `[[CARD:<id>]]`，由 release gate 以該語言 canonical 卡名解析。缺少已複核卡名、保留未解析 token 或自行重譯卡名都會 rollback。全形／半形括號與空白會先正規化後再核對卡名。

每次成功發布會建立 `official_rulings_releases` manifest、兩張不可變內容 snapshot，並更新 `official_rulings_active_release`。公開 API 只讀 active snapshot；要回復前一份內容時可在資料庫 transaction 內將舊 manifest 改回 `active` 並切換 pointer，不需刪除新版內容。

## 產生與審核翻譯

正式發布不需要也不讀取 translation provider 設定。五個目標語系是直接翻譯並經人工複核的靜態來源，只保存在本機、不進 Git；release gate 匯入 PostgreSQL 時標記為 `verified`。來源 hash 不一致時發布會 fail closed，避免舊翻譯對應到新版日文裁定。

複核時必須先理解完整 question／answer 的規則情境，再以目標語言重寫自然、可獨立理解的句子，不得逐句對譯或只修正個別字詞。繁中是中文裁定的語意基準，簡中由已複核繁中轉換後再檢查用字；`zh-HK` 使用自然書面粵語，英語與韓語則直接依完整裁定語境重寫並核對 Power Cost 足夠／不足等正反條件。日文正文中明確出現的完整卡名即使未列在官方 `relatedCardIds`，也必須從完整卡牌目錄辨識並轉為 `[[CARD:<id>]]`；卡名不得由譯者自行翻譯。

規則專有名詞必須遵守[規則術語 i18n 字典](./rules-terminology.md)：`Power`、`Power Cost`、`SEND TO POWER` 與 `HP` 保留標記；`Chronos` 在中英文保留，日文使用 `クロノス`、韓文使用 `크로노스`；卡牌種類、區域、屬性與 Q&A 分類使用各語言本地名稱。中文與韓文裁定不得直接保留 `Character`、`Area Enchant`、`Power Charger`、`Abyss`、`Battle Zone` 或 `Set Zone`。

勘誤也必須逐欄複核完整語境：`incorrectText` 要忠實保留印刷錯誤及其實際規則差異，不能把錯誤文本直接翻成更正後語義；日文文法誤植若無法在目標語言重現，應明確標示原誤植。訂正原因、換卡政策及使用政策要以自然目標語言重寫。`correctedText` 不在勘誤翻譯表重複保存，名稱勘誤取自 `cards` 的官方有效卡名，效果勘誤取自 `card_texts_i18n` 中 `review_status='verified'` 且來源為勘誤翻譯的 canonical 效果；因此修改效果勘誤譯文時，必須先依[卡牌文本 i18n 維護指南](./card-text-i18n.md)更新並稽核卡牌效果，再發布官方裁定。

未來官方新增或修改內容時，可設定共用 HTTP translation provider，以 generator 補上缺少的新版本翻譯：

```bash
# 產生所有缺少的五種衍生語言翻譯
npm run translate:official-rulings

# 只產生繁中，最多處理 20 筆
npm run translate:official-rulings -- --locale=zh-TW --limit=20
```

generator 只寫入 `machine`，不會覆蓋 `verified`。卡名會先轉為 `[[CARD:<id>]]` token，provider 只翻譯裁定正文；回存前由 PostgreSQL 的已複核卡名還原，並驗證卡牌 token、數字、`★` 與 `SEND TO POWER` 沒有被模型改動。管理員手動將翻譯標記為 `machine` 或 `verified` 時也會執行同一 canonical 卡名檢查。管理後台的「官方規則」頁籤提供語言／類型／狀態篩選、覆蓋率、原文對照、單筆生成、人工複核與來源差異檢查。

管理 API 全部受 `config:write` 權限保護，翻譯寫入與來源檢查會留下 audit log：

- `GET /api/admin/official-content/translations?locale=&resourceType=&status=&query=`
- `PUT /api/admin/official-content/translations/:resourceType/:id/:locale`
- `POST /api/admin/official-content/translations/:resourceType/:id/:locale/generate`
- `POST /api/admin/official-content/sync`
- `GET /api/admin/official-content/sync-status`

管理端同步只執行 fail-closed check／diff，不會直接套用遠端內容。正式發布仍需人工檢查 CLI diff 後執行 `--apply`。

只有通過 release gate 的 active snapshot 會公開；來源內容變更會增加 `content_version`，但舊版本翻譯與 snapshot 保留供回復。

正式 release 會以本機受控來源原子更新當前內容版本的 `verified` 翻譯；管理頁的人工校訂若尚未回寫受控來源，會在下一次 release 被該來源覆蓋。沒有 provider 時，管理頁的「重新產生」會明確回傳 `Translation provider is not configured`，但已發布至 PostgreSQL 的五語正文、人工編輯與日文 fallback 都不受影響。

## 公開 API 與快取

- `GET /api/official/status`
- `GET /api/official/qa?lang=&query=&tag=&cardId=`
- `GET /api/official/qa/:number?lang=`
- `GET /api/official/errata?lang=&cardId=`
- `GET /api/official/errata/:errataId?lang=`
- `GET /api/official/rules/:documentId?lang=`，其中 `documentId` 為 `grand` 或 `floor`

成功回應包含日文 `source`、實際顯示的 `localized`、`requestedLocale`、`effectiveLocale`、翻譯狀態、官方來源與同步時間。Q&A 另同時回傳官方日文 `tagIds` 與本地化 `tags`；前端以 `tagIds` 保留篩選狀態，以 `tags` 顯示文字，因此切換語言不會丟失分類篩選。公開回應使用五分鐘快取、stale-while-revalidate 與內容雜湊 ETag。

PWA 對四類公開清單／詳情 API 使用 `NetworkFirst`：4 秒 network timeout、最多 200 筆、保留 7 天。已成功讀取的規則可在 API 暫時中斷時由 service worker cache 回傳；管理 API 不進入離線快取。

## 監控

API `/metrics` 提供以下低基數 Prometheus 指標：

- `official_rulings_sync_runs_total{status,trigger_source}`
- `official_rulings_sync_changes_total{resource_type,change_type}`
- `official_rulings_translation_writes_total{resource_type,locale,status,operation}`
- `official_rulings_translation_failures_total{resource_type,locale,operation}`

建議至少針對來源檢查 `failed`、連續出現 `changes` 未處理，以及翻譯生成失敗率建立告警。來源差異的逐筆 ID 仍以 sync run 的 JSON diff／GitHub artifact 為準，不放進 metric label，避免高基數。

## 發布前檢查

```bash
npm run sync:official-rulings
npm run verify
npm run e2e -- official-rulings.spec.ts
npm run e2e:pwa
```

同步有官方差異時先人工檢查 diff、更新並複核本機五語靜態翻譯，再執行原子發布。`sync --apply` 與舊的分段翻譯匯入不能作為正式發布完成的依據。
