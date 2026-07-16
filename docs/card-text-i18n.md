# 卡牌文本 i18n 維護指南

本文件描述卡牌名稱與效果文本的資料來源、PostgreSQL 結構、前端顯示規則，以及英文 OCR、人工複核、勘誤與衍生翻譯的維護流程。

這套資料流與一般介面文案 i18n 不同。介面文案位於 `src/i18n/*.ts`；卡牌名稱和效果由 PostgreSQL 提供，不應加入介面文案檔案。

## 不可破壞的資料契約

1. `cards.name` 與 `cards.effect` 是官方修正後日文的權威來源，不得由英文 OCR、既有翻譯或卡面錯字覆蓋。
2. `cards.en_name_official` 與 `cards.en_effect_official` 保存卡面印刷的官方英文。這兩個欄位不是一般翻譯，也不代表勘誤後英文。
3. `card_texts_i18n` 保存統一的各語言名稱與效果、來源及複核狀態。日文與英文是官方來源的鏡像；其他語言是衍生翻譯。
4. 衍生翻譯必須同時參考官方日文和卡面官方英文；兩者有歧義時，以官方修正後日文語義為準。
5. `pending_review` 的衍生翻譯不得展示給玩家。只有 `verified`（或官方來源使用的 `official`）可以進入顯示鏈路。
6. 勘誤影響的欄位不得回退到已失效的卡面英文。其英文及其他語言必須使用已複核的勘誤文本；尚未複核時回退到官方日文。
7. 本機受控來源 `data/card-english-extraction.json` 中的英文必須先完成人工卡面複核，才能批量匯入 PostgreSQL；該檔及其他卡牌文本來源不得提交到 Git 或進入容器映像。
8. 舊式 `card_effects_i18n.lang='en'` 是已停用流程產生的英文翻譯，必須刪除且不得重新建立。英文效果只可來自 `cards.en_effect_official`；受勘誤影響時使用已複核的勘誤英文。

## 資料模型

### `cards`

| 欄位                                     | 含義                                   |
| ---------------------------------------- | -------------------------------------- |
| `name`, `effect`                         | 官方修正後日文名稱與效果，日文權威來源 |
| `en_name_official`, `en_effect_official` | 經人工複核的卡面印刷英文               |
| `has_official_errata`                    | 是否存在官方勘誤，供列表快速篩選       |
| `official_errata_id`                     | 官方勘誤編號                           |
| `official_errata_affects_name`           | 勘誤是否影響名稱                       |
| `official_errata_affects_effect`         | 勘誤是否影響效果                       |
| `official_errata_url`                    | 官方勘誤頁面                           |

### `card_texts_i18n`

每張卡、每個語言一列，主鍵為 `(card_id, lang)`。

| 欄位                           | 含義                                           |
| ------------------------------ | ---------------------------------------------- |
| `name_text`, `effect_text`     | 該語言的卡名與效果                             |
| `name_source`, `effect_source` | 名稱與效果各自的來源，不能只用一個來源推定兩者 |
| `review_status`                | `official`、`verified` 或 `pending_review`     |
| `review_note`                  | 複核依據、歧義或勘誤連結等備註                 |

支援的語言代碼為 `ja`、`en`、`zh-TW`、`zh-CN`、`zh-HK`、`ko`。舊式 `zhTW`、`zhCN`、`zhHK` 只作 API 輸入相容，新資料應使用帶連字號的正式代碼。

狀態規則：

- `official`：只用於官方日文、卡面英文或官方直接提供的文本。
- `verified`：人工核對完成的衍生翻譯或勘誤後翻譯。
- `pending_review`：草稿或既有但尚未重新核對的翻譯；前端不使用。

常用來源值：

- `official_card_print`：官方卡面印刷文本。
- `admin_bilingual_translation`：同時參考官方日文與英文完成的後台翻譯。
- `official_errata_notice`：官方勘誤直接提供的文本。
- `official_card_print_unaffected`：勘誤未改變卡面英文的語義，可沿用卡面文本。
- `official_card_print_corrected`：以卡面英文為基礎作最小必要訂正。
- `official_japanese_errata_translation`：依官方修正後日文重新翻譯。

### `card_official_errata`

完整保存 12 條官方勘誤，包括錯誤文本、修正後日文、修正後英文、複核狀態、英文來源類型和官方網址。`cards` 上的勘誤欄位是便於查詢與顯示的摘要，不能代替此表。

`corrected_english_source` 只能是：

- `official_errata_notice`
- `official_card_print_unaffected`
- `official_card_print_corrected`
- `official_japanese_errata_translation`

## 前端顯示規則

顯示入口統一使用 `src/game/cards/i18n.ts` 的 `getLocalizedCardName()` 與 `getLocalizedCardEffect()`，不要在元件內自行讀取欄位或重寫 fallback。

### 沒有勘誤影響的欄位

| 使用語言 | 顯示順序                                   |
| -------- | ------------------------------------------ |
| `ja`     | 官方日文                                   |
| `en`     | 卡面官方英文，缺失時回退官方日文           |
| 其他語言 | 已複核衍生翻譯 -> 卡面官方英文 -> 官方日文 |

### 有勘誤影響的欄位

| 使用語言 | 顯示順序                                                           |
| -------- | ------------------------------------------------------------------ |
| `ja`     | 官方修正後日文                                                     |
| `en`     | 已複核且來源屬於勘誤來源的英文 -> 官方日文                         |
| 其他語言 | 已複核且來源屬於勘誤來源的該語言文本 -> 已複核勘誤英文 -> 官方日文 |

勘誤只保護實際受影響的欄位。例如勘誤只改效果時，名稱仍可正常使用卡面官方英文。

## 主要資料與程式入口

下表中的 JSON 來源／複核檔只存在於維護者本機或受控備份，不受 Git 追蹤，也會由 `.dockerignore` 排除。GitHub 只保存處理程式、schema、測試及維護指南。

| 路徑                                          | 用途                                                |
| --------------------------------------------- | --------------------------------------------------- |
| `data/card-english-extraction.json`           | 422 張卡的日文對照、卡面英文、複核狀態與證據        |
| `data/card-english-human-reviews.json`        | 本機網頁複核留下的人工決定與時間                    |
| `data/card-official-errata.json`              | 12 條官方勘誤及英文來源判定                         |
| `scripts/card-english-ocr-overrides.json`     | OCR 合併階段的已知覆蓋值                            |
| `scripts/audit-card-official-texts.ts`        | 卡數、複核狀態、常見 OCR 錯字、數字與語義一致性稽核 |
| `scripts/import-card-official-texts-pg.ts`    | 驗證後以交易寫入 PostgreSQL                         |
| `data/card-derived-effects-review.json`       | 本機衍生效果複核範圍、依據及來源檔雜湊              |
| `scripts/audit-card-derived-effects.ts`       | 稽核 1,000 條衍生效果、語言混入、數值及舊英文       |
| `scripts/import-card-derived-effects-pg.ts`   | 交易匯入已複核衍生效果並清除舊英文                  |
| `scripts/card-official-text-review-server.ts` | 僅監聽本機的人工複核服務                            |
| `api/cardDataService.cjs`                     | 對外卡牌及多語言文本查詢                            |
| `api/adminCardService.cjs`                    | 衍生翻譯寫入、狀態限制與管理稽核紀錄                |
| `src/game/cards/i18n.ts`                      | 玩家端唯一顯示與 fallback 策略                      |

相關 schema migration 為：

- `migrations/000007_card_official_texts_i18n.js`
- `migrations/000008_card_official_errata.js`
- `migrations/000009_card_official_errata_english_source.js`

## 日常翻譯流程

1. 在管理頁選擇卡牌並進入「多語言」。日文與英文不在這個編輯器內修改。
2. 翻譯名稱與效果時，同時核對官方修正後日文及卡面英文。
3. 尚未完成核對時保持 `pending_review`，並在 `review_note` 記錄歧義或待確認事項。
4. 人工確認語義、術語、數值、卡牌數量及作用範圍後，改為 `verified`。
5. 若卡牌有勘誤，受影響欄位必須以官方修正後日文為準。管理頁會將其來源寫成 `official_japanese_errata_translation`。
6. 驗證實際 UI，不要只檢查資料庫值，因為玩家端還會套用複核與 fallback 規則。

衍生翻譯不能標記為 `official`，API 會拒絕此操作。管理端的修改會寫入管理稽核紀錄。

目前 250 張有效果卡的 `zh-TW`、`zh-CN`、`zh-HK`、`ko` 效果已同時依官方修正後日文及人工校對的卡面英文複核。複核來源檔 `data/card-effects-i18n.json` 與本機 review manifest 以 SHA-256 鎖定確切版本，兩者都不進 Git。來源檔不得含 `en`，英文只維護於官方英文資料流。

CI/E2E 不使用線上卡牌快照；`scripts/create-e2e-card-seed.ts` 會在測試容器內生成無正式卡名、效果及翻譯的合成卡牌資料。

## 英文卡面複核流程

目前基準資料已完成 422/422 個英文名稱及 250/250 個有效果卡的英文效果人工複核；另外 172 張卡沒有印刷效果。

一般修改不應重新跑 OCR。只有新增卡牌、官方更換卡圖或需要重建提取資料時，才使用以下流程。

### 1. 下載卡圖並執行 OCR

OCR 工具依賴見 `scripts/requirements-card-ocr.txt`。卡圖屬暫存證據，不提交到 Git。

```bash
python scripts/download-card-images.py \
  --cards-json path/to/cards.json \
  --output-dir path/to/card-images

python scripts/extract-card-english-ocr.py \
  --cards-json path/to/cards.json \
  --images-dir path/to/card-images \
  --output path/to/card-english-ocr-raw.json
```

可用 `--ids 3rd_8 3rd_22` 只處理指定卡牌。不要把 OCR 原始輸出直接當成官方英文。

### 2. 合併候選值與既有人工決定

```bash
python scripts/merge-card-english-ocr.py \
  --raw path/to/card-english-ocr-raw.json \
  --prior-json data/card-english-extraction.json \
  --overrides scripts/card-english-ocr-overrides.json \
  --human-reviews data/card-english-human-reviews.json \
  --output data/card-english-extraction.json
```

合併不等於人工確認。凡是卡面無法可靠辨識、OCR 與既有值不一致、數字或關鍵術語有疑義的欄位，都必須保留待複核狀態。

### 3. 使用本機複核服務

```bash
npm run review:card-official-texts -- \
  --images-dir path/to/card-images \
  --port 4175
```

服務只監聽 `127.0.0.1`。瀏覽 `http://127.0.0.1:4175`，逐欄比對實際卡面並確認；網頁提交的結果均視為人工複核，寫入提取資料與人工複核 ledger，不要求另填複核者名稱。

### 4. 稽核

```bash
npm run audit:card-official-texts
```

稽核必須通過後才能匯入。目前預期摘要為：422 張卡、422 個唯一 ID、422/422 個人工複核名稱、250/250 個人工複核效果。

## 官方勘誤流程

官方來源為 <https://zutomayocard.net/errata/>。新增或修改勘誤時：

1. 更新 `data/card-official-errata.json`，保留官方編號、日期、受影響欄位、錯誤文本、修正後日文和來源網址。
2. 確認 `correctedJapaneseText` 與 `cards.name` 或 `cards.effect` 中的官方修正後日文完全一致。
3. 逐欄判斷英文來源類型。能沿用卡面英文語序時作最小修正，不要無理由整段重寫；官方日文刪除 `すべて` 等語義時，英文也必須刪除對應的 `all`。
4. 卡面使用英文數字單詞時，修正文本延續官方風格，例如 `one card`，不要擅自改成 `1 card` 或 `a card`。
5. 只有人工核對完成後才能使用 `official` 或 `verified`；否則保持 `pending_review`。
6. 執行卡牌文本稽核和 i18n 單元測試。

```bash
npm run audit:card-official-texts
npm test -- src/game/cards/__tests__/i18n.test.ts api/__tests__/cardDataService.test.ts
```

## 匯入 PostgreSQL

匯入會同時更新卡面官方英文、日英 `card_texts_i18n`、12 條勘誤及卡牌勘誤摘要欄位。腳本使用 transaction，任何一致性檢查失敗都會 rollback。

先套用 migration，再以目標資料庫的 `PG_HOST`、`PG_PORT`、`PG_USER`、`PG_PASSWORD`、`PG_DATABASE` 執行：

```bash
npm run db:migrate
npm run import:card-official-texts
```

匯入前腳本會拒絕以下情況：

- 任何有印刷內容的英文名稱或效果未完成人工複核。
- 卡牌數量或 ID 與 PostgreSQL 不一致。
- 提取資料中的日文與 PostgreSQL 官方日文不一致。
- 勘誤不是 12 張唯一卡牌。
- 勘誤修正後日文與官方卡牌資料不一致。
- 標記為 `official_card_print_unaffected` 的英文並未與已複核卡面英文完全一致。

生產匯入前必須備份資料庫。匯入後至少驗證：

- `/api/cards` 返回 422 張卡。
- 422 張卡均有 `enNameOfficial`。
- 250 張有效果卡均有 `enEffectOfficial`。
- `hasOfficialErrata` 共 12 張。
- `/api/cards/texts` 返回 422 張卡的文本資料。
- 英文、日文和至少一個衍生語言實際 UI 的名稱、效果與勘誤 fallback。

### 匯入已複核的衍生效果

衍生效果匯入使用獨立 transaction，並先執行：

```bash
npm run audit:card-derived-effects
npm run import:card-derived-effects
```

腳本會拒絕來源雜湊、卡牌 ID、官方日文、人工校對卡面英文或勘誤集合不一致的資料，也會拒絕任何已填入但尚未複核的衍生卡名，避免共用的 `review_status` 誤把卡名標記為已複核。匯入成功後會：

- 寫入 4 種語言共 1,000 條效果並標記為 `verified`。
- 一般卡使用 `admin_bilingual_translation`；效果勘誤卡使用 `official_japanese_errata_translation`。
- 刪除 `card_effects_i18n` 中所有舊 `en` 列，但保留 `card_texts_i18n` 的官方英文鏡像。
- 寫入一筆批次管理稽核紀錄。

生產匯入前必須備份資料庫。匯入後確認每種衍生語言各有 250 條 `verified` 效果、舊英文列為 0，並重新載入 game 服務的卡牌資料或重啟 game 服務。

## 修改時的最小驗證

只改衍生翻譯時：

```bash
npm run audit:card-derived-effects
npm test -- src/game/cards/__tests__/i18n.test.ts
npm run typecheck
```

改英文提取、勘誤、schema、API 或顯示策略時：

```bash
npm run audit:card-official-texts
npm test -- src/game/cards/__tests__/i18n.test.ts api/__tests__/cardDataService.test.ts api/__tests__/schemaMigrations.test.ts
npm run typecheck
npm run typecheck:scripts
```

提交前確認沒有把本機卡圖、OCR 暫存輸出、資料庫 dump 或 `.env` 一併加入版本控制。
