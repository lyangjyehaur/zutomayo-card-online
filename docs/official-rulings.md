# 官方 Q&A 與勘誤資料庫

站內規則資料庫整合官方 [Q&A](https://zutomayocard.net/qa/) 與[勘誤](https://zutomayocard.net/errata/)，公開路由為：

- `/rules/qa`、`/rules/qa/:number`
- `/rules/errata`、`/rules/errata/:errataId`

日文內容永遠是權威來源。衍生語言會標示 `machine` 或 `verified`，未有可公開翻譯時自動回退日文，詳情頁仍可展開原文核對。固定介面文案使用既有六語系字典；Q&A 與勘誤正文則保存於 PostgreSQL。

## 資料與同步

- PostgreSQL 是 Q&A、勘誤與翻譯的唯一執行期事實來源；API 不提供 repository JSON fallback。
- 官方日文內容由同步程式直接抓取並與 PostgreSQL 比對，不建立或更新 Git 追蹤快照。
- `npm run sync:official-rulings`：從官方來源抓取並與 PostgreSQL 比對。發現差異時以 exit code `2` 結束。
- `npm run sync:official-rulings -- --apply`：以 transaction 將剛抓取且驗證通過的日文 Q&A／勘誤直接寫入 PostgreSQL。
- `--baseline-api=<url>` 或 `OFFICIAL_RULINGS_BASELINE_API_URL` 可透過已部署的公開 API 讀取 PostgreSQL baseline，供無資料庫憑證的排程唯讀檢查使用。
- `npm run sync:official-rulings -- --fixture-dir=<path>`：改讀固定 Q&A JSON 與勘誤 HTML，供 parser／CLI 測試使用。
- `npm run sync:official-rulings -- --report=<path>`：輸出含 `added`、`updated`、`removed` 的 machine-readable JSON diff。

Q&A 同步只接受 `public === '公開'`。parser、筆數或必要欄位不符合預期時會整批中止；官方消失的 Q&A 只標記 `inactive`，不刪除歷史資料。

`.github/workflows/official-rulings-sync.yml` 每日 03:15 UTC 透過已部署 API 取得 PostgreSQL baseline 後執行唯讀 check。有差異時會建立或更新 GitHub issue，並保存 30 天 diff artifact；排程不會自動寫入資料庫。

## 部署與初次匯入順序

官方規則同步依賴真實卡牌與既有 `card_official_errata` 資料，因此不能在空資料庫剛完成 migration 時自動執行。新環境固定依照以下順序：

1. `npm run db:migrate`：建立 `official_qa_*`、勘誤翻譯與版本欄位。
2. 匯入／seed 正式卡牌資料與官方卡牌文本，例如 `npm run seed:cards`、`npm run import:card-official-texts`。
3. `npm run sync:official-rulings -- --apply`：從官方網站直接匯入日文 Q&A 與勘誤至 PostgreSQL。
4. 將本機已複核、受 `.gitignore` 保護的 `data/official-rulings-translations.json` 放好後，執行 `npm run import:official-rulings-translations` 匯入 430 份翻譯。
5. 啟動或重啟 API，檢查 `/api/official/qa?lang=ja` 與 `/api/official/errata?lang=ja`。

內容 JSON 不得提交 GitHub，也不會複製進 API 或 migration image。內容匯入須從持有本機受控來源檔的維護環境執行；部署映像只包含程式與 schema migration。

```bash
npm run sync:official-rulings -- --apply
npm run import:official-rulings-translations
```

同步會驗證所有 Q&A 關聯卡牌 ID、勘誤卡牌 ID，以及修正後日文是否等於 canonical 卡名／效果；任何一項失敗都會 rollback。翻譯匯入會用 PostgreSQL 中的日文內容重新計算來源 hash，舊翻譯無法套用到新版裁定。

## 產生與審核翻譯

初次匯入不需要 translation provider。五個目標語系的受控來源只保存在本機，不進 Git；匯入 PostgreSQL 後狀態為 `machine`，可直接公開並在管理頁逐筆複核。來源 hash 不一致時 import 會 fail closed，避免舊翻譯對應到新版日文裁定。

未來官方新增或修改內容時，可設定共用 HTTP translation provider，以 generator 補上缺少的新版本翻譯：

```bash
# 產生所有缺少的五種衍生語言翻譯
npm run translate:official-rulings

# 只產生繁中，最多處理 20 筆
npm run translate:official-rulings -- --locale=zh-TW --limit=20
```

generator 只寫入 `machine`，不會覆蓋 `verified`。卡名會先轉為 `[[CARD:<id>]]` token，並驗證卡牌 token、數字、`★` 與 `SEND TO POWER` 沒有被模型改動。管理後台的「官方規則」頁籤提供語言／類型／狀態篩選、覆蓋率、原文對照、單筆生成、人工複核與來源差異檢查。

管理 API 全部受 `config:write` 權限保護，翻譯寫入與來源檢查會留下 audit log：

- `GET /api/admin/official-content/translations?locale=&resourceType=&status=&query=`
- `PUT /api/admin/official-content/translations/:resourceType/:id/:locale`
- `POST /api/admin/official-content/translations/:resourceType/:id/:locale/generate`
- `POST /api/admin/official-content/sync`
- `GET /api/admin/official-content/sync-status`

管理端同步只執行 fail-closed check／diff，不會直接套用遠端內容。正式發布仍需人工檢查 CLI diff 後執行 `--apply`。

只有內容完整的 `machine`／`verified` 列會公開；來源內容變更會增加 `content_version`，舊版本翻譯不會再被讀取。

本機翻譯匯入不會覆蓋資料庫內既有的 `verified` 翻譯。沒有 provider 時，管理頁的「重新產生」會明確回傳 `Translation provider is not configured`，但已匯入 PostgreSQL 的五語正文、人工編輯與日文 fallback 都不受影響。

## 公開 API 與快取

- `GET /api/official/qa?lang=&query=&tag=&cardId=`
- `GET /api/official/qa/:number?lang=`
- `GET /api/official/errata?lang=&cardId=`
- `GET /api/official/errata/:errataId?lang=`

成功回應包含日文 `source`、實際顯示的 `localized`、`requestedLocale`、`effectiveLocale`、翻譯狀態、官方來源與同步時間。公開回應使用五分鐘快取、stale-while-revalidate 與內容雜湊 ETag。

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

同步有官方差異時先人工檢查 diff，再決定是否 `--apply`；不要在未審查的情況下直接套用。
