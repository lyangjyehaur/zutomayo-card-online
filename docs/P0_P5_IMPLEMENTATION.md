# P0-P5 生產成熟化實作追蹤

> 分支：`codex/p0-p5-production`
>
> 原則：只有程式、測試與實際 gate 都能證明行為時才標記完成。既有 roadmap 的「已完成」不自動沿用。

## 2026-07-13 重新基線

目前判定為「可進 controlled beta／內部測試」，不可宣稱成熟 production，也不建議直接開放 public beta。核心規則與 authoritative match 約 7/10；工程化與供應鏈約 6/10；資料復原、HA 與營運證據約 3-4/10；玩家主流程與無障礙約 5-6/10。

後續每一項分開記錄四層證據：`code`、`automated test`、`staging evidence`、`production evidence`。只有必要層級全數完成才可勾選；舊版 [`release-review.md`](./release-review.md) 只作歷史快照，其中 auth、Feedback semantics、modal focus 與 E2E 等部分 finding 已有新實作，必須以當前分支重新跑視覺／service-backed E2E 後判定。

## 修補波次

### P0：Release blockers

1. 建立 database role matrix 與 bootstrap/gate：game、api、platform、retention、monitor、logical backup、base backup/WAL 各自最小權限；fresh cluster 必須能直接跑 migration、retention、backup 與監控 smoke。
2. 擴充 schema gate，驗證 retention、season result、account deletion 關鍵欄位的 type、nullability、default、PK/FK/unique/check/index；已套用 migration 缺本地檔案時 fail closed。
3. 統一 PostgreSQL/Redis production connection contract：`PGSSLMODE`、CA、required `REDIS_URL`、TLS/ACL，不允許 localhost/passwordless fallback；rendered Compose 與真實連線 smoke 都要通過。
4. 完成 legal-hold 持續 reconciliation 與 account deletion hold gate；任何 account 衍生 match/conversation/message/report/feedback hold 都必須阻擋破壞性刪除。
5. 完成帳號刪除全表策略：platform participants、boardgame seats/outbox、season data、match/leaderboard identifier 都必須刪除或不可逆匿名化。
6. 加固 OAuth：state 綁 browser session、PKCE、session ticket 一次性 consume；所有 provider/Logto request 有 timeout、retry budget 與 recovery circuit breaker。
7. 以 fresh staging 驗證五個 signed image、migration、retention timer、synthetic failure metric、rollback 與 post-deploy build ID；第三方 image/action 全部 pin digest/full SHA。

### P1：Security and data correctness

1. QuickMatch 在 reserve、join、matched 前重查 block；Invite 在 accept/join 重查 friendship/block；Lobby 對已連線使用者即時撤銷 visibility。
2. DSAR 從同步 row cap 升級為 async snapshot/export job，支援 object storage、expiry、audit、重試與下載授權。
3. Restore drill 驗證 schema gate、outbox、retention/legal-hold invariant 與 fixture round-trip，不以幾個 table 非空代替完整性。
4. 對 ranking、season close/reward、account deletion saga、outbox 補真實 PostgreSQL concurrency 與 crash-recovery tests。

### P2：Reliability and release evidence

1. 部署至少兩個 stateless replicas、readiness load balancing 與 10% -> 50% -> 100% canary；5 分鐘內可切回上一 verified digest。
2. 完成 2x peak 30 分鐘、2 小時 soak、Redis/PostgreSQL failover、WebSocket reconnect、outbox 重送與 DLQ/alert 驗收。
3. 保存三次連續 staging deploy、backup restore、Alertmanager firing/resolved、RPO/RTO/MTTA/MTTR 與 quarterly game-day 報告。

### P3：Public beta quality and compliance

1. 新增真正 authenticated 雙 browser 流程：登入、選 server deck、QuickMatch/Invite、完整對局、結算、跨裝置 history；現有直接 create/join credential E2E 不能替代此流程。
2. 實跑 Login/Profile/Feedback/Deck/Lobby/Battle/Result axe，補 Feedback detail modal、鍵盤完整對局、mobile Battle 主行動提示與 card inspection 一致性。
3. 建立 Chromium PR gate，以及 WebKit iPhone、Android viewport、Firefox、PWA standalone nightly；完成 360/390px 視覺回歸。
4. 完成公開營運者資訊、privacy/retention 實際流程、moderation/support SLA、第三方 IP 書面授權與法務覆核。

## P0：止血與信任鏈

- [x] Ranked / match submission 在 production 預設 fail closed，需顯式啟用。
- [x] Join 身分只能來自已驗證 session；拒絕 body `userId` spoof。
- [x] Seat token 綁定 `matchId + userId + seat + expiry` 並防重放。
- [x] MatchShell / CustomRoom 不能由 spectator 偽造持久 participant。
- [x] Chat ACL 只信任伺服器建立的玩家／觀戰授權。
- [x] QuickMatch 保存並驗證雙方牌組 reservation，host 不能代替 guest 選牌。
- [x] Match result、turns、duration、action log 由 game server 產生。
- [x] ELO 與 season rating 只接受伺服器已驗證、冪等的 canonical result。
- [x] Spectator 不被視為 player 0，也不能寫入／提交結果。
- [x] CSRF header 經 proxy 與 CORS 正確傳遞；mutation integration test 通過。
- [x] Proxy request body 有上限；XFF、Origin、JWT revocation 與 room creation rate limit 正確。
- [x] Game / platform / presence / chat 在斷線期限內可重連，UI 顯示明確狀態。

## P1：發布與供應鏈

- [x] Base、E2E、staging、server4、monitoring Compose config 全部通過並進 CI。
- [x] E2E 失敗會阻擋 merge；CD 只部署已通過 CI 的 commit。
- [x] Migration 使用同一 release digest，失敗時 app 不啟動。
- [x] Deploy `--sha`、health port 與 post-deploy smoke 正確。
- [x] Build once / promote by digest；production environment 有 approval 與 concurrency。
- [x] Coverage 正確包含 production API CJS，短期門檻 lines/statements/functions 50%、branches 40%。
- [x] SBOM、依賴／容器／secret scan 與 image signing 已進 release gate。
- [x] Sentry token 等 build secret 不寫入 image layer 或 build arg cache。

## P2：資料復原與高可用

- [ ] PostgreSQL encrypted off-site backup + WAL/PITR：腳本與 runbook 已有，尚缺真實 off-site/restore 證據。
- [ ] Backup checksum、成功告警、每日 age 檢查與自動 restore 驗證。
- [ ] Beta RPO 24h / RTO 4h；production RPO 15m / RTO 30m 有實測報告。
- [x] Expand/contract migration 與 schema checksum gate。
- [ ] 至少兩個 app replica、graceful drain 與連線恢復：程式有 drain，現有 Compose 未部署 replicas。
- [ ] Canary 10% → 50% → 100%，能在 5 分鐘內切回已驗證 digest：目前只有 runbook，尚無 rollout 實作／證據。
- [ ] 2x 預估峰值、2 小時 soak 達到 SLO。

## P3：可觀測性與營運流程

- [ ] Platform 已暴露實際 `/metrics`；Prometheus scrape config 已有，尚缺 staging 全服務 scrape 證據。
- [ ] Alertmanager 或 Grafana-managed notification 能在 5 分鐘內送達／恢復通知。
- [x] Dashboard 與 alert query 全部對應實際 metric，rules 有 CI unit test。
- [x] API/game/platform 的 request ID、logs、trace、Sentry 可串聯。
- [ ] Synthetic probe 程式、systemd timer、fail-closed metrics 已有；尚缺 staging timer 與 Alertmanager firing/resolved 送達驗收。
- [x] SLO、error budget 與資料復原目標文件化：[`SLO.md`](./SLO.md)。
- [x] 事故、DB restore、部署／回滾 runbook 已建立：[`runbooks/`](./runbooks/)。
- [ ] 每季 game day 與 MTTA/MTTR 記錄流程實際演練。

## P4：玩家品質、E2E 與無障礙

- [ ] 已有雙 browser game credential E2E、觀戰、斷網重連與完整結算；仍缺兩個真實登入 session、QuickMatch/Invite 與 server deck reservation 流程。
- [ ] E2E 已覆蓋部分 refresh、斷網重連、觀戰與隱藏資訊；聊天、服務重啟與真實 platform 配對尚待 service-backed 驗收。
- [ ] 登入玩家的 server match history 為 source of truth，跨裝置同步並去重。
- [x] Replay 使用伺服器 authoritative action log 並綁定 rules version。
- [ ] axe spec 已建立，Login dialog targeted run 已通過；其餘頁面與真實 Battle/Result 尚未全量 service-backed 執行。
- [ ] 共用 modal focus/inert 與 Battle drawer test 已有；Feedback detail modal、card accessible name 與鍵盤完整對局仍待完成。
- [ ] Chromium PR gate；WebKit iPhone、Android viewport、Firefox、PWA standalone nightly 通過。
- [ ] 明確定義離線支援，卡牌／ruleset 資料與 engine 版本一致。

## P5：帳號、社交、LiveOps 與合規

- [x] 一次性 email verification / password reset token service 與 migration。
- [x] 郵件 webhook delivery fail closed，不向 public response 洩漏 token。
- [x] 帳號資料匯出與匿名化刪除 service。
- [ ] 帳號 lifecycle routes/UI、step-up 與 durable session revoke 已有；尚缺真實 email/Logto provider E2E 與故障恢復證據。
- [x] Friend request 與 block service / migration；不再直接雙向加好友。
- [ ] Direct chat、presence、legacy matchmaking 與 platform 已接 block/mute；已連線即時撤銷與 join/matched race 尚未完整。
- [x] Season / placement / idempotent season rating service 與 migration。
- [x] Season admin、player API/UI、關季與衰減流程。
- [x] 投降、棄賽、reconnect deadline、rematch 與處罰政策落地。
- [ ] Admin 個人帳號、RBAC、TOTP MFA、persisted jti revoke 與 audit 已實作；尚缺 production bootstrap/rotation/recovery E2E。
- [x] Security、Privacy、Terms、Retention policy 基線已建立。
- [ ] 公開營運者資訊、法務覆核與第三方 IP 書面授權。

## 最終驗收

- [x] `npm run verify`（2026-07-13：100 test files / 833 tests / production build 通過）
- [x] `npm run test:coverage`（statements 60.45%、branches 52.31%、functions 63.59%、lines 63.69%）
- [ ] `npm run e2e`
- [ ] `npm run rule:audit` 並在 unsupported effect 時失敗
- [ ] 五套 Compose config gate
- [ ] Migration up / app start / rollback compatibility rehearsal
- [ ] Staging 連續三次 deploy + post-deploy smoke
- [ ] Backup restore、alert delivery、2x soak 與 reconnect chaos drill
- [ ] 原始 worktree 未被修改；只有隔離 worktree 包含本任務變更

## 單一 Release Gate

使用 `npm run release:gate -- --evidence-dir artifacts/release` 執行集中式發布檢查。Gate 會逐項執行完整 `verify`、release/operational config、Compose render/role environment，以及 Docker runtime image contract；結果會寫入 `release-gate.json` 與 `release-gate.md`。

Gate 狀態嚴格區分：`passed` 代表所有必要檢查通過，`failed` 代表本機或設定檢查失敗，`blocked` 代表本機檢查沒有失敗但仍缺 staging-only 證據。缺證據永遠不會被當成通過；沒有 `--staging-evidence-dir` 時 staging gate 必然是 `blocked`。若有 staging 證據，放在該目錄的 `staging/` 下，且每份 JSON 必須包含 `schemaVersion: 1`、對應的 `evidenceType`、`status: "passed"`、`environment: "staging"`、與目前（或 `--release-sha` 指定）release 相同的 40 字元 `releaseSha`、五個完整 `game/api/platform/migrate/retention` `@sha256` image digest，以及 `startedAt`、`finishedAt`、正確相等於兩者差值的 `durationMs` 與過去 168 小時內且不得為未來時間的 `checkedAt`。每種 evidence 還必須提供該 gate 要求的數值 `metrics`、數值 `thresholds` 與全數為 true 的 `results`；Gate 會實際比較 metric/threshold。

每份 staging JSON 至少要列一個 `artifacts[]` 項目，每項含 evidence 目錄內的相對 `path` 與檔案內容 `sha256`；Gate 會阻擋 path traversal、缺檔與 hash 不符。HTTP(S) `source`/`signer` 只能補充溯源，不能代替實際 artifact。退出碼為 `0`（passed）、`1`（failed）、`2`（blocked）。

若由 CD 下載 GitHub Actions artifact，JSON 也必須帶 `provenance.runId`、`provenance.repository`、`provenance.runUrl`；CD 會以 `--evidence-run-id` 檢查它與下載來源一致。

可用 `--format json` 或 `--format markdown` 只輸出其中一種摘要；正式發布仍應保留兩種格式與可追溯的外部 staging/production artifact。

正式 CD 會以 `--release-manifest .release.env` 將證據中的五個 image digest 與已驗證 manifest 逐一比對；production dispatch 必須另外提供 staging evidence artifact 的 run ID 與名稱，否則 release gate 維持 `blocked` 並阻止部署。
