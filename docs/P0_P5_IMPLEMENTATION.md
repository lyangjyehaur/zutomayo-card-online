# P0-P5 生產成熟化實作追蹤

> 分支：`codex/p0-p5-hardening`
>
> 原則：只有程式、測試與實際 gate 都能證明行為時才標記完成。既有 roadmap 的「已完成」不自動沿用。

## P0：止血與信任鏈

- [ ] Ranked / match submission 在 production 預設 fail closed，需顯式啟用。
- [ ] Join 身分只能來自已驗證 session；拒絕 body `userId` spoof。
- [ ] Seat token 綁定 `matchId + userId + seat + expiry` 並防重放。
- [ ] MatchShell / CustomRoom 不能由 spectator 偽造持久 participant。
- [ ] Chat ACL 只信任伺服器建立的玩家／觀戰授權。
- [ ] QuickMatch 保存並驗證雙方牌組 reservation，host 不能代替 guest 選牌。
- [ ] Match result、turns、duration、action log 由 game server 產生。
- [ ] ELO 與 season rating 只接受伺服器已驗證、冪等的 canonical result。
- [ ] Spectator 不被視為 player 0，也不能寫入／提交結果。
- [ ] CSRF header 經 proxy 與 CORS 正確傳遞；mutation integration test 通過。
- [ ] Proxy request body 有上限；XFF、Origin、JWT revocation 與 room creation rate limit 正確。
- [ ] Game / platform / presence / chat 在斷線期限內可重連，UI 顯示明確狀態。

## P1：發布與供應鏈

- [ ] Base、E2E、staging、server4、monitoring Compose config 全部通過並進 CI。
- [ ] E2E 失敗會阻擋 merge；CD 只部署已通過 CI 的 commit。
- [ ] Migration 使用同一 release digest，失敗時 app 不啟動。
- [ ] Deploy `--sha`、health port 與 post-deploy smoke 正確。
- [ ] Build once / promote by digest；production environment 有 approval 與 concurrency。
- [ ] Coverage 正確包含 production API CJS，短期門檻 lines/statements/functions 50%、branches 40%。
- [ ] SBOM、依賴／容器／secret scan 與 image signing 已進 release gate。
- [ ] Sentry token 等 build secret 不寫入 image layer 或 build arg cache。

## P2：資料復原與高可用

- [ ] PostgreSQL encrypted off-site backup + WAL/PITR。
- [ ] Backup checksum、成功告警、每日 age 檢查與自動 restore 驗證。
- [ ] Beta RPO 24h / RTO 4h；production RPO 15m / RTO 30m 有實測報告。
- [ ] Expand/contract migration 與 schema checksum gate。
- [ ] 至少兩個 app replica、graceful drain 與連線恢復。
- [ ] Canary 10% → 50% → 100%，能在 5 分鐘內切回已驗證 digest。
- [ ] 2x 預估峰值、2 小時 soak 達到 SLO。

## P3：可觀測性與營運流程

- [ ] Platform 暴露實際 `/metrics`；Prometheus scrape 全服務成功。
- [ ] Alertmanager 或 Grafana-managed notification 能在 5 分鐘內送達／恢復通知。
- [ ] Dashboard 與 alert query 全部對應實際 metric，rules 有 CI unit test。
- [ ] API/game/platform 的 request ID、logs、trace、Sentry 可串聯。
- [ ] Synthetic probe 每分鐘驗證首頁、登入、建房、加入對局、health/readiness。
- [x] SLO、error budget 與資料復原目標文件化：[`SLO.md`](./SLO.md)。
- [x] 事故、DB restore、部署／回滾 runbook 已建立：[`runbooks/`](./runbooks/)。
- [ ] 每季 game day 與 MTTA/MTTR 記錄流程實際演練。

## P4：玩家品質、E2E 與無障礙

- [ ] 兩個獨立 browser context 完成登入、配對、完整對局與結算。
- [ ] E2E 覆蓋 refresh、斷網重連、觀戰、聊天、服務重啟與隱藏資訊。
- [ ] 登入玩家的 server match history 為 source of truth，跨裝置同步並去重。
- [ ] Replay 使用伺服器 authoritative action log 並綁定 rules version。
- [ ] axe 對 Login/Profile/Feedback/Deck/Lobby/Battle/Result 無 serious/critical。
- [ ] 欄位 label、錯誤描述、card accessible name、dialog focus trap 與鍵盤完整對局通過。
- [ ] Chromium PR gate；WebKit iPhone、Android viewport、Firefox、PWA standalone nightly 通過。
- [ ] 明確定義離線支援，卡牌／ruleset 資料與 engine 版本一致。

## P5：帳號、社交、LiveOps 與合規

- [x] 一次性 email verification / password reset token service 與 migration。
- [x] 郵件 webhook delivery fail closed，不向 public response 洩漏 token。
- [x] 帳號資料匯出與匿名化刪除 service。
- [ ] 帳號 lifecycle routes/UI、session 全撤銷與實際郵件流程整合。
- [x] Friend request 與 block service / migration；不再直接雙向加好友。
- [ ] Direct chat、presence、matchmaking 全部尊重 block/mute。
- [x] Season / placement / idempotent season rating service 與 migration。
- [ ] Season admin、player API/UI、關季與衰減流程。
- [ ] 投降、棄賽、reconnect deadline、rematch 與處罰政策落地。
- [ ] Admin 個人帳號、RBAC、MFA、jti revocation 與操作者 audit。
- [x] Security、Privacy、Terms、Retention policy 基線已建立。
- [ ] 公開營運者資訊、法務覆核與第三方 IP 書面授權。

## 最終驗收

- [ ] `npm run verify`
- [ ] `npm run test:coverage`
- [ ] `npm run e2e`
- [ ] `npm run rule:audit` 並在 unsupported effect 時失敗
- [ ] 五套 Compose config gate
- [ ] Migration up / app start / rollback compatibility rehearsal
- [ ] Staging 連續三次 deploy + post-deploy smoke
- [ ] Backup restore、alert delivery、2x soak 與 reconnect chaos drill
- [ ] 原始 worktree 未被修改；只有隔離 worktree 包含本任務變更
