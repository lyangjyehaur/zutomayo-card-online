# P0-P5 生產成熟化實作追蹤

> 分支：`codex/deferred-production-hardening`
>
> 原則：只有程式、測試與實際 gate 都能證明行為時才標記完成。既有 roadmap 的「已完成」不自動沿用。
>
> 狀態：延後開發。此分支包含九角色、HA／canary、PITR、供應鏈證據與完整營運演練，現階段不得直接合併或部署到 server4；beta 必要修補必須在 `codex/server4-beta-essential` 重組並獨立驗證。

## 2026-07-13 重新基線

目前判定為「可進 controlled beta／內部測試」，不可宣稱成熟 production，也不建議直接開放 public beta。核心規則與 authoritative match 約 7/10；工程化與供應鏈約 6/10；資料復原、HA 與營運證據約 3-4/10；玩家主流程與無障礙約 5-6/10。

後續每一項分開記錄四層證據：`code`、`automated test`、`staging evidence`、`production evidence`。只有必要層級全數完成才可勾選；舊版 [`release-review.md`](./release-review.md) 只作歷史快照，其中 auth、Feedback semantics、modal focus 與 E2E 等部分 finding 已有新實作，必須以當前分支重新跑視覺／service-backed E2E 後判定。

## 2026-07-18 current-tree evidence

- Current merge tree 的 `npm run verify` 通過：Vitest 167 個 test files、1442 tests、dependency patch、資料來源政策、release/operational config、i18n 與 production/PWA build；coverage statements 64.99%、branches 57.44%、functions 66.31%、lines 68.45%。前一個 pushed hardening commit `d3b82e0f` 的 GitHub CI run `29631772333` 四個 jobs 全部通過；本次尚未 push 的變更仍須通過相同 remote CI 才能視為最終自動化證據。
- `npm run rule:audit` 對本機 422 張線上資料副本通過：250 張效果卡、267 行效果全部解析，`unparsedLines=0`、`parsedButPartial=0`、`falseDraw=0`。
- 當前 merge tree 的 Fresh PostgreSQL 九角色 smoke 通過 canonical `000001`→`000033`、API role matrix、platform 獨立最小權限 schema gate、relationship outbox、social/account-deletion concurrency、boardgame metadata、admin credential lifecycle，以及 QuickMatch block／Invite friendship-removal writer transaction 與真 platform relay 的 distinct-role 並行競態；另自動重現 card-first 歷史，補套 `000019`–`000027`與 `000031`–`000033`、正規化為 30 筆 canonical migration metadata，再以 `checkOrder=true` 嚴格重跑。
- Legacy deleted-account backfill 已改為受審核、精確數量、fail-closed 的 release step。單元測試覆蓋零筆 no-op、未核准、數量漂移、逐筆成功與 hash-only failure；真 PostgreSQL smoke 造出既有 tombstone，驗證 legal-hold/account lock、全 identity-domain 匿名化、purge/retry 與 `users.identity_anonymized_at` marker。API 與 platform schema gate 都拒絕任何未清零 tombstone。
- 由未修改的 card-first 本機資料庫（2 users、422 cards、`000028`–`000030` 已存在而 `000019`–`000027` 缺失）建立全新 clone，上一次 `db:migrate:release` 基線已成功升到 28 筆 canonical migrations／`000031`，匯入並 gate 422 cards、12 errata、1 筆 signed dataset ledger、0 pending tombstones；第二次 release 顯示 no migrations 並保留 audited edits。原資料庫未修改。當前 merge tree 新增 linked-admin、將 canonical ledger 移至 `000032`，並以 `000033` 強制登入模式契約；fresh 與 synthetic card-first smoke 已證明 30 筆 canonical history，但含 422 張真實資料的 production-copy clone 仍需在本 merge tree 另行重跑。
- Fresh-volume Compose 重新 build current-tree images，migration/seed 後 Chromium 40/40 通過，包含 service-backed accessibility，authenticated QuickMatch/Invite/chat/reconnect，以可控強弱 synthetic deck 自然完成對局，以及兩個獨立重新登入 browser context 證明跨裝置 history 各只有同一筆 canonical result。Distinct platform role 同時驗證 participant/chat writer 只用共用 advisory fence 與最小 `users(id, deleted_at)` live check，不需要 `users` UPDATE 權限。
- boardgame.io 的 async Master 已套用版本鎖定 patch，將 subscriber/transport 終局發布移到 state/metadata durable write 成功之後；整合測試證明 terminal transaction 拋錯時不發布 phantom 終局，成功路徑順序固定為 persist → subscriber → broadcast。Patch 會在 install、CI verify 與 Docker builder fail closed 套用，production runtime 明確複製同一已修補 bundle。
- Fresh-volume authenticated process-restart E2E 通過：兩個 browser 完成 setup 並停在持久化 `turnSet`，宿主機實際重啟 game/platform 容器且驗證兩者 `StartedAt` 改變與 health 恢復；原 browser 離開 disconnected/reconnecting 後從同一局投降結算，雙方 server history 對該 source match 各恰好一筆且共用同一 canonical history ID。
- GitHub `master` branch protection 已於 2026-07-17 透過 API 建立並回讀：要求最新 `Lint & Test`、`E2E Tests`、PR、linear history 與 resolved conversations，套用至管理員且禁止 force-push／刪除。`production` environment 要求 `lyangjyehaur` 明確批准、只接受 protected branch 且關閉 admin bypass；`staging` 同樣只接受 protected branch。
- Repository 已補 daily logical backup 的 exact S3 artifact/checksum `VersionId` receipt、SHA-256 綁定、最近成功狀態保留、weekly version-pinned restore systemd timer，以及 logical/physical backup 最新一次執行失敗的即時告警。自動測試真實執行 shell，覆蓋雙 upload 成功、任一 `VersionId: null`、receipt stale/writable/symlink/malformed 與 restore child failure；仍缺 versioned off-site bucket 與隔離 runner 的 staging/production 實跑、restore evidence 及 alert firing/resolved 外部證據。
- 以上應用程式驗證仍是 local/current-tree automated evidence，不是 staging/server4/production evidence；GitHub Actions 尚未配置任何 repository/environment deploy secrets，因此 signed-image staging rehearsal、HA/canary/off-site restore/load/alert、provider account E2E、production admin recovery 與法務項目仍阻擋 production。

## 修補波次

### P0：Release blockers

1. 建立 database role matrix 與 bootstrap/gate：game、api、platform、retention、monitor、logical backup、base backup/WAL replication 與獨立 WAL switch operator 各自最小權限；fresh cluster 必須能直接跑 migration、retention、backup 與監控 smoke。
2. 擴充 schema gate，驗證 retention、season result、account deletion 關鍵欄位的 type、nullability、default、PK/FK/unique/check/index；已套用 migration 缺本地檔案時 fail closed。
3. 統一 PostgreSQL/Redis production connection contract：`PGSSLMODE`、CA、required `REDIS_URL`、TLS/ACL，不允許 localhost/passwordless fallback；rendered Compose 與真實連線 smoke 都要通過。
4. 完成 legal-hold 持續 reconciliation 與 account deletion hold gate；任何 account 衍生 match/conversation/message/report/feedback hold 都必須阻擋破壞性刪除。
5. 完成帳號刪除全表策略：platform participants、boardgame seats/outbox、season data、match/leaderboard identifier 都必須刪除或不可逆匿名化。
6. 加固 OAuth：state 綁 browser session、PKCE、session ticket 一次性 consume；所有 provider/Logto request 有 timeout、retry budget 與 recovery circuit breaker。
7. 以 fresh staging 驗證七個 signed image（含 gateway 與 non-root PostgreSQL OPS）、migration、retention timer、synthetic failure metric、rollback 與 post-deploy build ID；第三方 image/action 全部 pin digest/full SHA。

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

- [x] Base、E2E、staging、legacy server4、parallel slot、gateway、monitoring Compose 靜態 config gate 全部通過並進 CI；current-tree fresh-volume runtime images、migration/seed 與 Chromium 40/40 亦已重跑。
- [x] CI 與 E2E job、CD 的 successful-CI SHA gate 已存在；GitHub `master` branch protection 要求 strict `Lint & Test`／`E2E Tests`、PR、linear history 與 resolved conversations，套用至管理員且禁止 force-push／刪除。
- [x] Migration 使用同一 release digest，失敗時 app 不啟動。
- [x] Deploy `--sha`、health port 與 post-deploy smoke 正確。
- [x] Build once / promote by digest 與 deploy concurrency 已實作；GitHub `production` environment 要求 owner 明確批准、protected branch，並關閉 admin bypass。GitHub Actions deploy secrets 尚未配置，故實際部署仍由 staging gate 阻擋。
- [x] Coverage 正確包含 production API CJS，短期門檻 lines/statements/functions 50%、branches 40%。
- [x] SBOM、依賴／容器／secret scan 與 image signing 已進 release gate。
- [x] Sentry token 等 build secret 不寫入 image layer 或 build arg cache。

## P2：資料復原與高可用

- [ ] PostgreSQL encrypted off-site backup + WAL/PITR：腳本與 runbook 已有，尚缺真實 off-site/restore 證據。
- [ ] server4 維護窗口內啟用並重啟 PostgreSQL continuous archive（`wal_level=replica`、`archive_mode=on`、正式 `archive_command`/provider pipeline），掛入 root-owned PGPASS、age identity、S3 credentials 後，使用 signed `OPS_IMAGE` 取得 live archive/restore gate 證據。OPS runner 不會自行修改 database config 或 production container。
- [ ] Backup checksum、成功告警、每日 age 檢查與自動 restore 驗證。
- [ ] Beta RPO 24h / RTO 4h；production RPO 15m / RTO 30m 有實測報告。Release gate 已將 physical PITR 與 encrypted off-site restore 的最差 RTO 上限固定為 30m，仍缺 provider staging 的實測證據。
- [x] Expand/contract migration 與 schema checksum gate。
- [ ] 至少兩個 app replica、graceful drain 與連線恢復：parallel slot 已定義 game/API 各 2 replicas、platform p1/p2、獨立 Redis、readiness gateway、WebSocket-only transport 與單一 worker owner；HAProxy 3.2 non-root startup/SIGUSR2 reload 與 Docker DNS `nbsrv` contract 有本機隔離 smoke，尚缺可追溯的 server4 artifact、正式 slot 部署與斷線恢復 evidence。
- [ ] Canary 10% → 50% → 100%，能在 5 分鐘內切回已驗證 digest：repo-owned HAProxy controller、warm slots、nested cohort/slot-pin cookies、active config/container/stats evidence 與 raw metrics collector 已完成；仍缺不同 SHA 的 10/50/100 dwell/sample 及 candidate → stable rollback 真實證據。
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

- [x] Authenticated 雙 browser E2E 覆蓋兩個登入 session、server deck、QuickMatch/Invite、聊天、reconnect、投降結算與雙方 history；另以強弱無效果 synthetic deck 自然完成對局，並斷言兩方與獨立重新登入 context 的 source match 各只有一筆。
- [x] E2E 已覆蓋 refresh、斷網重連、觀戰、隱藏資訊與真實 platform 配對；跨 instance full-sync shared-lock race 有真 PG smoke；terminal transaction 失敗由 patched Master 整合測試證明不會先行 broadcast；fresh-volume authenticated smoke 亦實際重啟 game/platform process，原雙 browser 重連同一 `turnSet`、完成結算且 history 無重複。
- [x] 登入玩家的 server match history 為 source of truth；同一自然完成對局已由雙方原 session 與兩個獨立重新登入 context 查詢，並證明四個視角都只對應同一 canonical history ID。
- [x] Replay 使用伺服器 authoritative action log 並綁定 rules version。
- [x] Core routes、Login、Feedback detail、Battle/Result 的 service-backed axe spec 已以 current-tree fresh images/volumes 重跑並包含在 Chromium 40/40。
- [x] 共用 modal focus/inert、Battle drawer 與 Feedback detail dialog test 已有；手牌／mulligan 卡牌 accessible name 包含名稱、充能成本與區域內唯一位置，選取型卡牌暴露 `aria-pressed`。Fresh-volume authenticated E2E 已以 Enter 鍵完成匹配、猜拳、mulligan、選牌、出牌與確認的自然完整對局，並保留雙方與重新登入裝置只對應同一 canonical history 的證據。
- [ ] Chromium PR job、每週兩次多瀏覽器 matrix，以及 production-build 的 PWA standalone／responsive CI job 已定義；本機 production preview 已驗證 Chrome app standalone display mode、service worker control、offline cached-shell reload 與離線 AI 對局，deterministic responsive smoke 也以 44px 觸控下限覆蓋 360/390px 與 Battle 多狀態，並驗證 `/community` 全域／私訊聊天經未讀入口導向 `/online` 房間聊天。成熟度分支的 GitHub CI run `29630633113` 已遠端通過 Responsive & PWA gate；`master` 目前只要求既有 CI/E2E checks，新增 gate 仍待日後合併並加入 required checks。
- [x] 離線支援明確限定為已暖機卡牌資料後的本機 AI 對戰；Workbox card-data cache 依 build/rules 隔離，API response 綁 signed dataset SHA、dataset release SHA、card count 與 app/build/rules，完整 SHA build 另要求 dataset release SHA 相同。Production PWA smoke 會同時將 page 與 service-worker target 真斷網，驗證 versioned cache response、離線 `/ai` 選牌並進入 `.bf-root` 對局；在線服務不承諾離線使用或寫入同步。

## P5：帳號、社交、LiveOps 與合規

- [x] 一次性 email verification / password reset token service 與 migration。
- [x] 郵件 webhook delivery fail closed，不向 public response 洩漏 token。
- [x] Async 帳號匯出、下載授權、物件 expiry/purge 與刪除匿名化 service 已有；000027 對新刪除涵蓋 match/boardgame/direct-chat/translation/admin audit/outbox，legacy tombstone 以精確核准數量回填並由 runtime schema gate 要求清零；fresh PG 已驗證 marker、legal hold、purge/retry 與全域不變量。
- [ ] 帳號 lifecycle routes/UI、step-up 與 durable session revoke 已有；尚缺真實 email/Logto provider E2E 與故障恢復證據。
- [x] Friend request 與 block service / migration；不再直接雙向加好友。
- [x] Direct chat、presence、legacy matchmaking 與 platform 已接 block/mute；QuickMatch/Invite 最終 relay 已加入同 relationship writer advisory-lock fence，鎖後重查 live users、block/friendship。除 room/unit race 外，fresh PostgreSQL 九角色 smoke 亦以獨立 API/platform role 驗證 QuickMatch block writer 與 Invite friendship-removal writer 在 transaction 中暫停時，真 platform relay 會等待同一 advisory fence，commit 後取消房間且不廣播 `boardgameMatchReady`。
- [x] Season / placement / idempotent season rating service 與 migration。
- [x] Season admin、player API/UI、關季與衰減流程。
- [x] 投降、棄賽、reconnect deadline、rematch 與處罰政策落地。
- [ ] Admin 個人帳號、RBAC、TOTP MFA、persisted jti revoke、transactional bootstrap/rotation/recovery CLI 與 secret-safe audit 已實作；disposable PostgreSQL lifecycle smoke 已接 fresh role gate，仍缺 production 執行與恢復演練證據。
- [x] Security、Privacy、Terms、Retention policy 基線已建立。
- [ ] 公開營運者資訊、法務覆核與第三方 IP 書面授權。

## 最終驗收

- [x] `npm run verify`：2026-07-18 current merge tree 通過，Vitest 167 test files / 1442 tests / production-PWA build；前一個 pushed hardening commit `d3b82e0f` 的 GitHub CI run `29631772333` 四個 jobs 全部通過，本次變更待 remote CI。
- [x] `npm run test:coverage`：167 test files / 1442 tests；statements 64.99%、branches 57.44%、functions 66.31%、lines 68.45%。
- [x] Compose-backed Chromium E2E：current-tree fresh images/volumes、migration/seed 後 40/40，含自然完成 authenticated 對局與獨立重新登入跨裝置 history。
- [x] `npm run rule:audit`：422 cards／250 effect cards／267 effect lines，unsupported/partial/false-draw 全為 0。
- [x] Production/development Compose 靜態 config、fresh role matrix、platform least-privilege schema gate 與 fresh-volume E2E 均由 current tree 通過。
- [ ] Migration up / app start / rollback compatibility rehearsal：fresh canonical、card-first deferred lineage、422-card production-copy clone、signed dataset ledger/data gate、第二次 strict/idempotent release 與 reviewed legacy tombstone backfill均已本機通過；仍缺 immutable signed image 的真 staging app start、三次 deploy 與 N+1 rollback smoke。
- [ ] Staging 連續三次 deploy + post-deploy smoke
- [ ] Backup restore、alert delivery、2x soak 與 reconnect chaos drill
- [x] 本任務未修改原始 worktree 的既有使用者變更；所有整合提交都位於隔離 worktree

## 單一 Release Gate

使用 `npm run release:gate -- --evidence-dir artifacts/release` 執行集中式發布檢查。Gate 會逐項執行完整 `verify`、release/operational config、Compose render/role environment，以及 Docker runtime image contract；結果會寫入 `release-gate.json` 與 `release-gate.md`。

Gate 狀態嚴格區分：`passed` 代表所有必要檢查通過，`failed` 代表本機或設定檢查失敗，`blocked` 代表本機檢查沒有失敗但仍缺 staging-only 證據。缺證據永遠不會被當成通過；沒有 `--staging-evidence-dir` 時 staging gate 必然是 `blocked`。若有 staging 證據，放在該目錄的 `staging/` 下，且每份 JSON 必須包含 `schemaVersion: 1`、對應的 `evidenceType`、`status: "passed"`、`environment: "staging"`、與目前（或 `--release-sha` 指定）release 相同的 40 字元 `releaseSha`、七個完整 `game/api/platform/migrate/retention/gateway/ops` `@sha256` image digest，以及 `startedAt`、`finishedAt`、正確相等於兩者差值的 `durationMs` 與過去 168 小時內且不得為未來時間的 `checkedAt`。每種 evidence 還必須提供該 gate 要求的數值 `metrics`、數值 `thresholds` 與全數為 true 的 `results`；Gate 會實際比較 metric/threshold。

`restore-drill`、`chaos-reconnect`、`load-soak` 與 `alertmanager-delivery` 不採信 evidence 自填政策。它們維持 `schemaVersion: 1`，但 `thresholds` 必須精確等於 repository policy：PITR RPO 15 分鐘、RTO 30 分鐘；failover/reconnect 最長 300 秒且 duplicate delivery 為 0；2x peak 至少 30 分鐘、soak 至少 120 分鐘、每一階段 HTTP p95 嚴格小於 500 ms 且 error rate 嚴格小於 1%；firing/resolved alert 都必須在 300 秒內送達。只把 summary threshold 放寬，即使 summary 比較會通過，仍會被阻擋。

這四種 evidence 都必須增加 `rawArtifact: { path, sha256 }`，且 reference 必須逐項等於已通過 path containment、檔案存在與 SHA-256 驗證的 `artifacts[]` entry。Raw JSON 共用 `schemaVersion: 1`、對應的 `artifactType`、`releaseSha`、`startedAt` 與 `finishedAt`。Chaos/load/alert 的 raw interval 必須和外層 evidence 完全一致；restore 外層 interval 則必須涵蓋下述兩份獨立 artifact。Gate 會解析內容並重算 summary，而不是只檢查 hash：restore 的 `rawArtifact` 只負責 physical PITR mechanics，由 target/recovered-through 與實際起訖重算 RPO/RTO，並要求 verified base backup、至少一個 WAL segment、target reached/promoted 與三項 integrity checks；它不能單獨取得 release approval。Restore 另須提供 hash-verified `offsiteArtifact`，由 `pg-restore-drill.sh` 從明確的 artifact/checksum S3 version IDs 產生 `zutomayo-encrypted-offsite-restore-raw`，綁定同一 release SHA，並實證 age checksum/decrypt、expected migration/checksum、core-data 與 legal-hold invariants。Physical PITR raw 單獨負責 marker `fixtureRoundTripPassed`，off-site logical restore 不重複聲稱。Chaos 由 PostgreSQL/Redis outage probes 的三個連續 healthy samples、WebSocket timeline 及 outbox message IDs 重算 recovery/duplicate；load 由 peak/soak 的 target RPS、status counts 與 latency distribution 重算兩階段中最差的 p95/error，要求零 dropped iteration 且 request samples 足以覆蓋 target RPS 乘實測時長；alert 則由同一 alert ID 的 firing/resolved emitted/delivered pair 重算最慢 delivery。修改 artifact 後即使同步更新 hash，語義、樣本或 summary 不一致仍會 fail closed。

`canary-rollback` 另有不可由 evidence 降級的 repository policy：必須依序完成且只完成 10%、50%、100% 三階段，任何跳階都會阻擋；每階段至少觀察 300 秒、1,000 個 HTTP samples、100 個 WebSocket samples，且 candidate 至少有 2 個 ready replicas。`rollout.stableReleaseSet` 與 `rollout.candidateReleaseSet` 至少都要完整列出 game/api/platform immutable `@sha256` references；candidate 三項必須逐一等於本次 `imageDigests`，stable 每一服務都必須使用相同 image repository、但 digest 必須與 candidate 不同，禁止跨 service 混槽。Stable 另外必須提供不同於 candidate 的完整 `stableReleaseSha`，以及 hash-verified `stableManifestArtifact`；Gate 會解析 manifest 中唯一且未加引號的 `RELEASE_SHA`、`GAME_IMAGE`、`API_IMAGE`、`PLATFORM_IMAGE`，並逐項綁定 stable SHA/release set，不能用任意 digest 自稱可回滾版本。每階段要提供 ISO 起訖時間、`gatewayConfigSha256`、對應的 gateway config artifact 與 raw metrics artifact；rollout raw metrics 另須包含和外層 stage 完全一致的 `observation` 起訖、repository policy snapshot 與 `policyPassed: true`，避免用 non-enforcing collector 輸出冒充已通過 dwell gate。Artifact reference 必須和經 hash 驗證的 `artifacts[]` 相符，三個 traffic weight 的 gateway config hash 也必須不同。

Gateway config artifact 不是任意文字檔。Gate 會在驗證 SHA-256 後解析下列 repository-owned JSON schema；`traffic` 必須逐階段精確為 90/10、50/50、0/100，且 artifact 內的兩組 release set 必須和 evidence 宣告完全相符：

```json
{
  "schemaVersion": 1,
  "artifactType": "zutomayo-canary-gateway-config",
  "phase": "rollout",
  "sequence": 1,
  "activeReleaseSet": "mixed",
  "traffic": {
    "stableWeightPercent": 90,
    "candidateWeightPercent": 10
  },
  "releaseSets": {
    "stable": {
      "game": "ghcr.io/example/game@sha256:<stable-digest>",
      "api": "ghcr.io/example/api@sha256:<stable-digest>",
      "platform": "ghcr.io/example/platform@sha256:<stable-digest>"
    },
    "candidate": {
      "game": "ghcr.io/example/game@sha256:<candidate-digest>",
      "api": "ghcr.io/example/api@sha256:<candidate-digest>",
      "platform": "ghcr.io/example/platform@sha256:<candidate-digest>"
    }
  }
}
```

Raw metrics artifact 同樣必須是 `schemaVersion: 1`、`artifactType: "zutomayo-canary-raw-metrics"` 的 JSON。每個 rollout stage 都要逐欄提供 `phase`、`sequence`、stable/candidate weights、`httpSamples`、`websocketSamples`、`readyReplicaCount` 與 `gatewayConfigSha256`；Gate 會和 stage evidence 及已驗證 gateway artifact hash 交叉比對。Rollback raw metrics 另須提供 `rollbackSeconds`，並以相同方式交叉驗證 100/0 weights、post-rollback HTTP/WS samples、ready replicas 與 gateway hash。只更新 evidence 摘要或 artifact hash、但內容語意不一致，仍會被阻擋。

回滾證據必須在 100% 階段後由 candidate 切回 stable，實測不超過 300 秒，完成後至少 2 個 replicas ready，並提供 rollback gateway config 與 raw metrics artifact。Rollback artifact 必須使用同一 schema，並精確宣告 `phase: "rollback"`、`sequence: 4`、`activeReleaseSet: "stable"`、stable/candidate weights 100/0；`fromReleaseSet` 與 `toReleaseSet` 也必須分別等於 candidate 與 stable set。為了讓報表清楚顯示採用的政策，JSON `thresholds` 仍須精確列出 `requiredStages: 3`、`maxRollbackSeconds: 300`、`minStageDwellSeconds: 300`、`minHttpSamplesPerStage: 1000`、`minWebsocketSamplesPerStage: 100`、`minReadyReplicaCount: 2`；但 gate 判定使用的是程式內常數，不信任 evidence 自填值。舊的 schemaVersion 1 evidence 對其他 gate 保持相容，缺少這些 canary 欄位的既有證據則 fail closed 為 `blocked`。

每份 staging JSON 至少要列一個 `artifacts[]` 項目，每項含 evidence 目錄內的相對 `path` 與檔案內容 `sha256`；Gate 會阻擋 path traversal、缺檔與 hash 不符。HTTP(S) `source`/`signer` 只能補充溯源，不能代替實際 artifact。退出碼為 `0`（passed）、`1`（failed）、`2`（blocked）。

若由 CD 下載 GitHub Actions artifact，JSON 也必須帶 `provenance.runId`、`provenance.repository`、`provenance.runUrl`；CD 會以 `--evidence-run-id` 檢查它與下載來源一致。

可用 `--format json` 或 `--format markdown` 只輸出其中一種摘要；正式發布仍應保留兩種格式與可追溯的外部 staging/production artifact。

正式 CD 會以 `--release-manifest .release.env` 將證據中的七個 image digest 與已驗證 manifest 逐一比對；production dispatch 必須另外提供 staging evidence artifact 的 run ID 與名稱，否則 release gate 維持 `blocked` 並阻止部署。
