# 對戰分析資料保存與修補計劃

- Status: Active
- Owner: Repository maintainer / service operator
- Established: 2026-07-31
- Last reviewed: 2026-07-31
- Review cadence: 每次工作項目狀態變更時更新；上線後首月每週複核
- Scope: 正式環境所有線上對局，包括 ranked、休閒、guest、快速配對、自訂房與邀請對局

## 1. 目的

本計劃修補正式對局完成後缺少長期分析落點的問題。目標不是永久保存可恢復房間的原始 runtime state，而是在刪除 runtime state 前，以伺服器權威資料建立去識別、可驗證、可長期分析的完成對局與事件資料。

本文件是此工作流的執行與驗收來源。實作、資料政策、部署與正式環境驗證必須依工作項目 ID 更新，不得只以「已有資料表」或「程式碼已合併」宣告完成。

## 2. 正式環境觀察基線

- 觀察時間：2026-07-31 13:02-13:08（Asia/Taipei）
- 部署版本：`0.2.5`
- 觀察方式：透過既有部署權限對正式 PostgreSQL 與受保護 metrics 進行唯讀彙總；原始識別資料未寫入 repository

| 項目                                     |                       觀察結果 | 判讀                                   |
| ---------------------------------------- | -----------------------------: | -------------------------------------- |
| 註冊帳號                                 |                             24 | 服務已有真實帳號資料                   |
| 已存牌組                                 |                             18 | 已存在可供牌組分析的產品使用行為       |
| `matches` 完成對局                       |                              0 | 沒有長期保存的 canonical／計分對局     |
| `platform_match_participants` 對戰 shell |                             46 | 曾有 46 個登入帳號參與過的 shell       |
| 對戰 shell 參與資料列                    |                             75 | 共涉及 9 個不同登入帳號                |
| 觀察開始時仍存在的完成對局               |                              5 | 皆有完整終局與 action log              |
| 觀察結束時仍存在的完成對局               |                              4 | 查詢期間已有一場被 stale cleanup 刪除  |
| 近期結果狀態                             |             5 場皆為 `unrated` | 每場只有一個 ranked-eligible 席位      |
| 正式 ranked 設定                         | `RANKED_MATCHES_ENABLED=false` | 所有完成對局目前都不會形成長期計分紀錄 |

近期五場共有 222 筆 action；四場出現逾時，共 11 次，其中三場由登入玩家在 `effectOrder` 階段逾時。這些資料已能提示操作流程問題，但樣本量不足以推論牌組、卡牌或座位平衡。

歷史 46 個對戰 shell 中，41 個已找不到對應 `bjg_matches`。參與證據仍在，但牌組、終局與 action log 已無法從 live database 還原。

## 3. 根因

### 3.1 資料生命週期錯誤耦合

目前有四種責任混在同一流程：

1. `bjg_matches` 保存 boardgame.io 可恢復 runtime state。
2. `bjg_match_result_outbox` 暫存完成結果與 action log。
3. `matches` 保存玩家歷史、ELO 與賽季結果。
4. 分析需求直接依賴上述 operational tables，沒有獨立資料產品。

Game server 每 5 分鐘掃描一次超過 30 分鐘未更新的對局。`PostgresAdapter.wipe()` 只保護 `pending` 或 `processing` outbox；`unrated` 與 `delivered` 可以刪除。`bjg_match_result_outbox.source_match_id` 又以 `ON DELETE CASCADE` 依附 `bjg_matches`，因此清理 runtime state 時會一併刪除完成結果、座位與 replay 資料。

### 3.2 Ranked 與分析錯誤綁定

`matches` 的主要責任是帳號歷史、ELO 與賽季完整性。正式環境目前關閉 ranked；guest 或未計分席位也不符合 canonical result 條件。這使「是否計分」實際上同時決定「是否保存」，但兩者不應是同一個產品決策。

### 3.3 缺少權威來源與品質標記

現有資料無法可靠區分：

- 快速配對、自訂房、邀請、直接建立或部署 smoke；
- 真人、guest、AI、operator controlled test；
- 正常完成、投降、斷線、放置、權威逾時或規則造成的終局；
- 玩家看不懂操作與網路中斷造成的同一種 timeout 表象。

`platform_match_participants` 只保存首次加入與最後看見時間，不是連線事件時間線。Prometheus reconnect counters 會隨 process 重啟歸零，不能取代 durable match evidence。

### 3.4 政策與實作不一致

[`DATA_RETENTION.md`](DATA_RETENTION.md) 宣告完成對局保存 365 天，移除直接帳號資料後保留匿名統計；action log／replay 保存 180 天。實際上所有 unrated 完成對局約 30 分鐘後即被刪除。永久保存去識別統計符合現有目的，但永久保存逐動作 replay 前必須更新公開政策與實際 `/legal/privacy` 內容。

## 4. 設計決策

| ID         | 決策                                                                            | 理由                                         |
| ---------- | ------------------------------------------------------------------------------- | -------------------------------------------- |
| MA-DEC-001 | Runtime state 與分析資料分離                                                    | 房間可安全清理，分析資料不隨之消失           |
| MA-DEC-002 | 所有伺服器權威終局都保存，不以 ranked 為條件                                    | 計分資格不是分析價值的判斷條件               |
| MA-DEC-003 | 分析寫入由 Game server 的 terminal-state transaction 觸發                       | 不依賴某個瀏覽器成功上報結果                 |
| MA-DEC-004 | 永久層不保存直接帳號、聊天、IP、憑證或原始 match ID                             | 降低隱私、帳號刪除與資料外洩風險             |
| MA-DEC-005 | 去識別 match facts 與 allowlisted replay 無固定到期；玩家可連結資料維持既有期限 | 同時保留長期遊戲研究價值與資料最小化         |
| MA-DEC-006 | 清理完成對局前必須證明分析資料已 durable                                        | 保存失敗時 fail closed，不得靜默刪除唯一來源 |
| MA-DEC-007 | 測試、AI、operator 與正常 production traffic 必須可分流                         | 避免合成或集中測試污染平衡結論               |
| MA-DEC-008 | 低樣本結果只供內部觀察，不發布排行榜式結論                                      | 避免以雜訊誤導卡牌或規則調整                 |

## 5. 目標資料模型

實作前由 MA-01 完成欄位契約與 threat/privacy review；下列為最低要求，不是 migration 的最終 SQL。

### 5.1 `match_analytics`

每個 server-created match 最多一列，完成與未完成 session 都可結案：

- `analytics_match_id`: DB 產生的 UUID，作為分析主鍵。
- `source_match_digest`: 原始 boardgame match ID 的不可逆 digest，只用於冪等與受控關聯。
- `environment`, `traffic_class`, `match_mode`, `rating_mode`。
- `app_version`, `build_id`, `rules_version`, `dataset_sha256`。
- `started_at`, `completed_at`, `duration_seconds`, `turns`。
- `outcome`: `completed`, `draw`, `surrendered`, `abandoned`, `invalidated`。
- `winner_seat`, `initiative_seat`, `janken_winner_seat`, `gameover_reason_code`。
- `final_hp`, `action_count`, `timeout_count`, `disconnect_counts`, `reconnect_counts`, `seat_resume_counts`。
- `seat_classes`: 每席只記錄 `registered`, `guest`, `ai`, `operator_test` 等類型。
- `quality_flags`: timeout-heavy、single-active-seat、short-match、missing-version、invalid-deck 等可複數標記。
- `captured_at`, `capture_schema_version`, `integrity_sha256`。

永久列不得包含 email、暱稱、IP、user agent、聊天、憑證、原始 room／match／invite ID，或可直接回到 `users.id` 的欄位。

配對來源與連線摘要先寫入短期 `bjg_match_telemetry`：只含 server-owned `match_mode`／
`traffic_class`、每席 disconnect／reconnect 計數與時間戳，foreign key 隨 `bjg_matches` 刪除。`/resume`
只增加 `bjg_match_seats.resume_count`。終局／abandoned projector 才把三組固定兩席計數移入永久層；
不保存 room、invite、session、socket、user ID 或 IP。

### 5.2 `match_analytics_decks`

每場每席一列：

- `analytics_match_id`, `seat`, `deck_card_ids`, `deck_hash`。
- `deck_source`: saved、preset、guest、rematch snapshot。
- `deck_validation`: valid、legacy、unknown-card、invalid-size。
- 牌組以對局開始時的權威 20 張快照為準，不讀取日後可能被修改的 `decks`。

### 5.3 `match_analytics_events`

保存經 allowlist 投影的 replay，不複製整個 `G` 或 boardgame.io delta log：

- `analytics_match_id`, `sequence`, `turn`, `step`, `actor_seat`, `event_type`。
- `card_def_id`, `target_seat`, `hp_before`, `hp_after`, `chronos_position`。
- `result_code`, `timeout_phase`, `payload`。
- `payload` 只允許遊戲規則需要的 typed fields；未知或自由文字欄位拒絕落盤。

禁止保存當時仍屬隱藏資訊的牌序、手牌 instance ID、未揭露選擇、client-provided free text 與任何玩家識別。終局牌組快照與規則事件可保存，因其與玩家身分分離且屬遊戲分析資料。

### 5.4 有期限的玩家關聯

需要分析重複玩家、配對公平或同一玩家樣本偏差時，另存按賽季輪替的 HMAC player key。此欄位屬 pseudonymous data，不視為匿名資料：

- 不進永久層的完整性 hash。
- 不跨賽季連結。
- 帳號刪除或最長 365 天後清除。
- key version 與 rotation procedure 必須文件化；HMAC secret 不得進 DB、log 或 repository。

## 6. 保存分層

| Tier               | 內容                                           | 保存期                                        | 存放位置                                    |
| ------------------ | ---------------------------------------------- | --------------------------------------------- | ------------------------------------------- |
| Runtime            | 完整 `bjg_matches`、未公開手牌與可恢復房間狀態 | 完成並成功封存後短期；未完成房依 stale policy | PostgreSQL operational tables               |
| Linked operational | `matches`、ELO、賽季、玩家可連結 replay        | 依現行 180／365 天與 legal hold               | PostgreSQL product tables                   |
| Anonymous facts    | 終局、版本、時長、回合、牌組、品質旗標與彙總   | 無固定到期                                    | PostgreSQL analytics tables／後續 warehouse |
| Sanitized replay   | Allowlisted 規則事件                           | 無固定到期，須先完成政策更新                  | 分割表或壓縮 object storage                 |
| Aggregate          | 每日版本、牌組、卡牌、timeout、完成率統計      | 無固定到期                                    | Materialized views／warehouse               |

永久在此表示正常情況下沒有時間型刪除工作；仍須支援安全事件、法律要求、資料契約錯誤或匿名化失效時的定向刪除。

## 7. 工作追蹤

狀態只允許 `Open`、`In progress`、`Blocked`、`Done`。`Done` 必須同時具備程式碼、測試、文件與指定 evidence，不得只完成其中一項。

| ID    | Priority | 工作項目                                     | Status      | Depends on          | 完成證據                                                                                                             |
| ----- | -------- | -------------------------------------------- | ----------- | ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| MA-00 | P0       | 立即止血與現存資料封存                       | Open        | -                   | 加密封存收據、temporary guard 設定、live row reconciliation                                                          |
| MA-01 | P0       | 完成資料契約、privacy review 與 threat model | In progress | -                   | 欄位 allowlist、資料分級與政策已同步；maintainer review 待完成                                                       |
| MA-02 | P0       | 建立 additive analytics schema 與權限        | In progress | MA-01               | migrations 已在 production 套用且永久列可查；schema/role gates 通過；MA-01 review 待完成                             |
| MA-03 | P0       | 在權威終局 transaction 寫入分析資料          | In progress | MA-02               | transaction、guest/unrated、rollback、idempotency unit tests 已完成；staging E2E 待執行                              |
| MA-04 | P0       | 將 stale cleanup 改成 archive-before-delete  | In progress | MA-03               | production 已封存 61 個零 action 空殼且無 child mismatch；完整 terminal/staging concurrency 證據待補                 |
| MA-05 | P1       | 保存配對來源與連線生命週期摘要               | In progress | MA-01, MA-02        | trusted provenance、disconnect／reconnect／resume 與 terminal／abandon unit fixtures 已完成；staging fixtures 待執行 |
| MA-06 | P1       | 建立匿名 replay projector 與永久保存政策     | In progress | MA-01, MA-02        | typed projector、250-run property fuzz、敏感欄位拒絕測試與公開政策已完成；staging replay review 待完成               |
| MA-07 | P1       | 建立資料品質檢查、metrics 與告警             | In progress | MA-03, MA-04        | production runtime metadata 已有效且 legacy `unknown` 可被告警辨識；staging alert drill 待執行                       |
| MA-08 | P1       | 建立核心分析 queries 與最低樣本規則          | In progress | MA-03, MA-05, MA-06 | 六類 query、Wilson interval、100-appearance gate 與 disposable PG expected results 已完成；staging baseline 待執行   |
| MA-09 | P1       | 評估歷史資料回填與不可恢復範圍               | Open        | MA-01               | isolated restore report、backfill manifest                                                                           |
| MA-10 | P0       | Staging 驗證與 production rollout            | In progress | MA-03, MA-04, MA-07 | production dataset identity 修補已驗證；controlled terminal、replay review 與 24h reconciliation 待完成              |
| MA-11 | P1       | 七日觀察、基線報告與工作流移交               | Open        | MA-08, MA-10        | seven-day report、risk decisions、owner sign-off                                                                     |

## 8. 工作項目驗收

### MA-00：立即止血與現存資料封存

- 對當下仍存在的完成對局建立加密、`0600`、access-controlled 的 raw emergency export；不得提交 repository。
- export 必須記錄 UTC 時間、release、schema migration、row counts 與 SHA-256，但公開 evidence 不得含 match／user ID。
- 暫時延長 completed match TTL，或使 `wipe()` 在 durable analytics 上線前拒絕刪除任何 terminal row。
- 為暫時保留增加 table-size 與 oldest-row 監控，避免以止血造成無界限 operational growth。
- 比對 export 前後 row counts，證明沒有因操作造成資料刪除。

### MA-01：資料契約與隱私

- 對每個欄位標註 authority、用途、敏感級別、保存期與允許查詢者。
- 完成 action payload allowlist；任何未知 key 預設拒絕。
- 確認 deck/card IDs、罕見事件序列與短期 player key 的重識別風險。
- 更新 [`DATA_RETENTION.md`](DATA_RETENTION.md)、[`PRIVACY.md`](PRIVACY.md)、`src/legalContent.ts` 與適用的 API／architecture 文件。
- 永久 replay 在公開政策部署前保持 feature flag 關閉；匿名 match facts 不得被此 gate 阻斷。

### MA-02：Schema 與權限

- 使用下一個可用 migration，全部為 additive change，不修改或刪除既有對局資料。
- `source_match_digest` 唯一約束保證 terminal callback、outbox retry 與多 instance 競爭時只保存一次。
- Game role 只能 insert／必要的 idempotent select；API runtime 預設不可讀永久 replay。
- Retention role 可清理 player-link 欄位，但不得刪除匿名 facts。
- Analytics read role 與 admin/export 權限分離，production 連線使用 TLS。

### MA-03：權威終局寫入

- 從 `canonicalTerminalResult()`、權威 seat reservation、initial state 與 release metadata 投影資料。
- capture 與 terminal result/outbox 進入同一個 durable transaction boundary。
- 包含 ranked、ranked-disabled、guest、draw、surrender 與 effect-driven game over。
- 不依賴贏家瀏覽器呼叫 `POST /api/matches`。
- duplicate callback、stale state write、worker retry 與 process restart 都不得產生重複列。

### MA-04：Archive-before-delete

- 完成對局只有在 analytics row 存在、integrity hash 可驗證且 event count reconciliation 通過後才能 `wipe()`。
- analytics insert、event insert 或 verification 任一步失敗時，保留原始 row、增加 retry，並輸出告警 metric。
- 未完成 stale room 在寫入 `abandoned` session fact 後才能清除。
- cleanup 必須分辨 terminal TTL 與 inactive-room TTL，不再共用模糊的 `STALE_MATCH_TTL_MS`。

### MA-05：來源與連線摘要

- Match provenance 由 server／platform relay 寫入，不信任 client 自稱的 mode 或 test flag。
- 記錄 join、disconnect、reconnect、seat resume、surrender 與 authoritative timeout 的時間摘要。
- 不永久保存 session ID、socket ID 或 IP。
- 能區分「看不懂 effectOrder」、「連線中斷」與「仍連線但放置」三種分析類別；無法判定時明確標為 unknown。

### MA-06：Replay 投影

- 以 typed projector 由 `ActionLogEntry` 產生 allowlisted events，不直接複製 JSON。
- 保存足以重算 HP、Chronos、效果結果與終局的資料。
- property/fuzz tests 證明 nested unknown fields、hidden hand、deck order、free text 與識別資料無法落盤。
- 使用壓縮與月分割；分割不是刪除期限，可在容量增長後搬移到 object storage。

### MA-07：品質、metrics 與告警

至少新增：

- `match_analytics_capture_total{outcome,traffic_class}`。
- `match_analytics_capture_failures_total{stage}`。
- `match_analytics_unarchived_terminal`。
- `match_analytics_oldest_unarchived_seconds`。
- `match_analytics_reconciliation_mismatch_total{kind}`。

告警必須覆蓋 terminal row 超過 5 分鐘未封存、capture failure、清理被 guard 持續阻擋、24 小時完成對局為零但 `F_Match_Start` 非零，以及版本／dataset metadata 缺失。

### MA-08：分析 queries

第一版必須提供：

1. `match start -> completed/abandoned`，按 mode、seat class、版本與日期分組。
2. timeout-affected rate，按 `step`、actor seat、連線狀態與版本分組。
3. initiative／janken／seat 勝率，使用 Wilson interval，不把 seat 0 當成先手。
4. 牌組與單卡 inclusion win rate；排除 abandoned、operator test 與 timeout-heavy 對局。
5. 回合與時長分布、極短終局、滿 HP 終局及 gameover reason。
6. 同版本 matchup matrix；不得跨 `rules_version` 或 `dataset_sha256` 混算。

內部報告必須顯示樣本數與信賴區間。公開牌組／卡牌結論預設至少 100 個有效 appearances；未達門檻只標示 insufficient sample。

### MA-09：歷史回填

- 不在 production database 上進行 restore 或 destructive experiment。
- 在隔離環境檢查 logical backups、physical backups 與 WAL 是否覆蓋已刪除期間。
- 可恢復資料先套用同一 projector，再以 manifest 記錄來源時間範圍、缺口與 digest。
- `platform_match_participants` 只能回填 session participation 摘要，不得偽造勝負、牌組或 completed 狀態。
- 無法恢復的對局以時間範圍和數量記錄為 permanent gap，不以估算值冒充事實。

### MA-10：Rollout

1. 在 staging 開啟 capture、保持 cleanup guard，完成 guest、雙登入、draw、surrender、timeout、disconnect/reconnect controlled matches。
2. 驗證每個 terminal match 恰好一個 fact，event count 與來源 action log 一致。
3. production 先以 facts-only 模式開啟；replay 在 policy gate 通過後再啟用。
4. 觀察 24 小時 capture failure、unarchived、DB growth、query latency 與 cleanup blocked 指標。
5. production rollback 只關閉 writer／reader feature，不 drop analytics tables 或已保存資料。

### MA-11：七日觀察

- 發布匿名 production baseline：started、completed、abandoned、guest/ranked、timeout、reconnect、turns、duration。
- 人工抽查至少 10 場受控 replay 與原始終局一致，但 evidence 不包含玩家識別。
- 記錄容量增長率並估算一年成本；容量不是刪除資料的默認理由。
- 由 Product、Backend、Privacy/Legal 與 Operations 確認查詢用途、權限與 incident procedure。

## 9. 測試與 release gates

每個實作 PR 依變更範圍至少包含：

- Projector unit tests 與敏感欄位拒絕測試。
- Migration/schema gate、role privilege gate 與 rollback compatibility。
- PostgresAdapter terminal transaction、idempotency、concurrency 與 cleanup guard tests。
- Ranked、unrated、guest、draw、surrender、timeout、abandoned E2E fixtures。
- Account deletion與 retention tests，證明 player link 會清除但匿名 facts 不被誤刪。
- Production build 與 repository-required `npm run verify`。

正式 rollout 的 release evidence 必須記錄 Git SHA、app/rules version、dataset SHA、migration、feature flags、controlled match counts、reconciliation result 與告警狀態。

## 10. 風險登錄

| ID         | Risk                                        | Impact                       | Mitigation                                                   | Status    |
| ---------- | ------------------------------------------- | ---------------------------- | ------------------------------------------------------------ | --------- |
| MA-RISK-01 | 現有完成對局持續每 30 分鐘被刪除            | 不可逆失去最有價值的早期資料 | MA-00 立即封存與 temporary guard                             | Open      |
| MA-RISK-02 | 保存 payload 意外帶入隱藏資訊或個資         | 隱私與安全事件               | Typed allowlist、fuzz test、restricted role                  | Open      |
| MA-RISK-03 | Analytics failure 阻塞 cleanup 造成 DB 增長 | Operational exhaustion       | retry、alerts、capacity gauge、受控 emergency override       | Open      |
| MA-RISK-04 | 單一測試者或 smoke 污染勝率                 | 錯誤平衡決策                 | authoritative traffic class、quality flags、sample threshold | Open      |
| MA-RISK-05 | Player HMAC 被當作匿名資料永久保存          | 可連結性違反政策             | 明確列為 pseudonymous、輪替並限期清除                        | Open      |
| MA-RISK-06 | 歷史 restore 影響 production                | 資料毀損或停機               | 只在隔離 restore environment 回填                            | Open      |
| MA-RISK-07 | 事件 schema 隨規則版本漂移                  | 查詢錯算或無法重播           | capture schema version、versioned projector、compat tests    | Open      |
| MA-RISK-08 | 永久 replay 與現行 180 天政策衝突           | 公開承諾與實作不一致         | MA-01 policy gate；未通過前只開 facts                        | Open      |
| MA-RISK-09 | Runtime 未注入 release dataset identity     | 不同卡池資料無法安全分組分析 | production/staging fail closed、deployment smoke、24h 告警   | Mitigated |

## 11. 完成標準

此工作流只有在以下條件全部成立後才能關閉：

1. 所有 production terminal matches，不論 rated 與否，都有 exactly-once analytics fact。
2. Stale cleanup 無法刪除尚未封存或 reconciliation 失敗的完成對局。
3. 永久資料不含直接帳號或通訊識別，player-link retention 經測試證明有效。
4. Guest、雙登入、draw、surrender、timeout、disconnect/reconnect 與 abandoned 均有 staging 證據。
5. Production 連續七天沒有 unarchived terminal 或 capture failure。
6. 核心查詢按 release/rules/dataset 分區，顯示樣本數與信賴區間。
7. Retention、privacy、legal UI、architecture、API、deployment 與 runbook 文件和實際行為一致。
8. 歷史可恢復範圍與不可恢復缺口已形成不可變 evidence 並經 operator review。

## 12. 進度更新規則

- 每次狀態變更，同一 change 更新第 7 節 tracker、相關驗收條目與 evidence register。
- 不重寫正式環境歷史觀察；發現更正時追加 dated correction。
- `Blocked` 必須記錄具體 blocker、owner 與下一個可解除動作。
- 完成 migration 或部署不等於完成工作流；production reconciliation 與觀察期不可省略。
- 任何 emergency override 必須記錄原因、核准者、開始／結束時間、受影響 rows 與後續修補。

## 13. Evidence register

| Evidence ID       | Date       | Work item            | Release / schema                                                                        | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Location                                                                   | Review                            |
| ----------------- | ---------- | -------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------- |
| MA-EV-20260731-01 | 2026-07-31 | Baseline             | Production `0.2.5` / migration `000047`                                                 | Read-only production match retention inspection；確認 0 canonical matches、完成 unrated 對局遭 30 分鐘 cleanup、歷史 shell 與 runtime rows 存在資料斷層                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 本文件第 2 節為去識別摘要；durable raw evidence capture 待 MA-00           | Pending                           |
| MA-EV-20260731-02 | 2026-07-31 | MA-01/02/03/04/06/07 | Branch `codex/match-analytics-retention` / migration `000048`                           | 新增三層匿名 analytics schema、typed projector、terminal transaction capture、abandoned archive-before-delete、digest idempotency、least-privilege gates、policy sync、durable gauges／alerts；`npm run verify` 通過（199 個 test files、1560 tests、coverage 與 production build）                                                                                                                                                                                                                                                                                                                                                                                                             | repository branch；production migration／deployment 尚未執行               | Local verified                    |
| MA-EV-20260731-03 | 2026-07-31 | MA-02/03/04/07/10    | Disposable PostgreSQL role smoke / migration `000048`                                   | 全新 PostgreSQL 實際套用 migration 與 schema gate；GAME role transaction insert+rollback analytics/decks，retention／backup SELECT，API analytics read denied；relationship and social concurrency smoke passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | smoke output 僅含 role/row-count evidence；Compose project 已清理          | Local PG verified                 |
| MA-EV-20260731-04 | 2026-07-31 | MA-02/05/08          | Branch `codex/match-analytics-retention` / migration `000048` checksum `2ddc63e6…d53e6` | 新增 server-owned quick/custom/invite provenance、trusted traffic class、每席 disconnect／reconnect 與獨立 seat resume 計數；terminal／abandoned 永久投影、連線分類 query、schema/role/privacy gates 與 fail-closed conflict tests。`npm run verify` 通過（200 files／1564 tests、coverage、production build），最終 disposable PostgreSQL role smoke 通過                                                                                                                                                                                                                                                                                                                                      | repository branch；staging controlled matches／production rollout 尚未執行 | Local verified                    |
| MA-EV-20260731-05 | 2026-07-31 | MA-06/08             | Branch `codex/match-analytics-retention` / deterministic PostgreSQL fixture             | projector 以 fast-check 執行 250 組 nested unknown／hidden hand／deck order／free text／identifier 注入；六類核心查詢補齊 seat class、exact deck、gameover reason 與同版本 matchup，低於 100 appearances 明確標示 insufficient。disposable PostgreSQL CSV 與 reviewed expected results 逐字比對                                                                                                                                                                                                                                                                                                                                                                                                 | repository branch；staging replay review／production baseline 尚未執行     | Local verified                    |
| MA-EV-20260731-06 | 2026-07-31 | MA-02/04/07/10       | Production `0.2.6` / migrations `000048`、`000049` / SHA `110a48f…`                     | 部署後唯讀 aggregate reconciliation：4 個永久 facts，全部為 `production`／`abandoned`／`direct`，8 個 deck rows、0 event rows；deck/event mismatch 均為 0。runtime canonical matches、seats、telemetry、outbox 均為 0，unarchived terminal 與 oldest unarchived seconds 均為 0。4 筆 `dataset_sha256` 皆為 `unknown`，因此僅證明 abandoned archive-before-delete 生效，不構成 completed-match、replay 或可發布 baseline 證據。資料表大小：facts 65,536 bytes、decks 32,768 bytes、events 24,576 bytes；觀測範圍 `2026-07-31T09:02:40.550Z` 至 `2026-07-31T09:34:54.897Z`。                                                                                                                      | production read-only aggregate inspection；未記錄 match/user ID            | Follow-up required                |
| MA-EV-20260801-07 | 2026-08-01 | MA-04/07/10          | Production `0.2.6` / SHA `fec9501…` / dataset `7bad73a4…5770`                           | `2026-08-01T05:44:54Z` 部署後，公開 `/api/app-version`、game runtime 與 platform runtime 的 build／rules／dataset／environment 均一致，三服務、PostgreSQL、Redis health/ready 通過；platform traffic class 為 `production`。唯讀 aggregate 顯示歷史永久 facts 已增至 61，全部是 `direct`／`unrated`／`abandoned`、0 actions、第二席 `unknown`、時長 0–3 秒，且一致標記 missing seat/provenance/events，證明它們是未形成雙人對局的空殼，不是可分析的完整對戰。部署後 facts、decks、events 均為 0，runtime matches、seats、telemetry、outbox 亦為 0；資料表大小為 122,880／131,072／24,576 bytes。因此 runtime identity 修補已生效，但 completed capture、replay 與 24h baseline 仍無樣本可驗證。 | production read-only aggregate inspection；未記錄 match/user ID            | Identity verified; sample pending |

## 14. Review log

| Date       | Completed                      | Findings / decisions                                                                                                                                                                                                                         | Next actions                                                                                                                                                                                               | Reviewer             |
| ---------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| 2026-07-31 | 建立正式環境基線與修補計劃     | 採用 runtime／analytics 分離、all-terminal capture、archive-before-delete 與永久去識別 facts                                                                                                                                                 | 執行 MA-00；完成 MA-01 欄位契約；準備 MA-02 additive migration                                                                                                                                             | Repository review    |
| 2026-07-31 | 完成 P0 本地實作第一版         | Migration `000048`、權威 transaction capture、typed replay projector、terminal 與 abandoned archive-before-delete、cleanup TTL 分流、權限與公開政策已同步；`npm run verify`（199 files／1560 tests）與 disposable PostgreSQL role smoke 通過 | 進行 maintainer/privacy review；在 staging 跑 controlled ranked／guest／draw／surrender／timeout／abandoned matches；未完成前不得宣稱 production 已修復                                                    | Codex implementation |
| 2026-07-31 | 完成 MA-05 本地實作            | Platform room relay 先寫可信 provenance；match-shell 只對驗證座位彙總連線事件；`/resume` 獨立計數；永久層不含 room/session/socket/user/IP。全量 verify 與最終 PostgreSQL role smoke 通過                                                     | 在 staging 執行 quick/custom/invite、disconnect/reconnect、seat resume、timeout 與 abandoned controlled fixtures；核對 connection class 查詢 expected results                                              | Codex implementation |
| 2026-07-31 | 補齊 MA-06／MA-08 本地證據     | 250-run projector property fuzz；六類分析 query；Wilson interval；100-appearance publication gate；真 PostgreSQL fixture expected-results gate                                                                                               | 在 staging 抽查 replay 與原始終局一致，並以正式 release identity 產生第一份匿名 baseline                                                                                                                   | Codex implementation |
| 2026-07-31 | 檢查首次 production rollout    | `0.2.6` 已保存 4 場 production abandoned facts，deck/event reconciliation 無 mismatch，證明 archive-before-delete 路徑生效；但全部 dataset identity 為 `unknown`，且沒有 completed facts 或 replay events可供驗證                            | 將 receipt digest 注入 game runtime、啟動時 fail closed、deployment smoke 比對 `/api/app-version`、新增 24h metadata 告警；重新部署後補 controlled terminal 與 24h reconciliation，MA-06／MA-08 維持進行中 | Production review    |
| 2026-08-01 | 驗證 dataset identity 修補部署 | Production build `fec9501…` 已以有效 dataset `7bad73a4…5770` 啟動，公開端點與容器 runtime 一致；61 筆 legacy facts 全是零 action、單席空殼，部署後尚無新 facts，不能以空集合 reconciliation 宣稱 completed／replay 通過                      | 不在關閉註冊與 Quick Match 的 production 製造 synthetic 流量；在 HTTPS/WSS staging 執行雙登入 controlled terminal/replay fixtures，或等待自然 production 完整終局後重跑 24h aggregate                      | Production review    |
