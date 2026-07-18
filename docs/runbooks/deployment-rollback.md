# Deployment / Rollback Runbook

## 發布

1. `workflow_dispatch` 的 `release_ref` 只能是完整 SHA 或 `v<semver>` tag；production 必須是已存在的 exact tag。Workflow 以 `refs/tags/<tag>` 解析，禁止同名 branch，並要求 release SHA 在 `origin/master` ancestry 內。
2. preflight 必須找到該 SHA 的成功 CI；game、API、platform、migration、retention、gateway、ops 七個 image 必須通過 Trivy、SBOM、Cosign signature 與 GitHub provenance attestation。
3. 從 verified artifact 取得 `.release.env`，確認七個 image 值都是 `ghcr.io/...@sha256:...`，並記錄 `EXPECTED_SCHEMA_MIGRATION` 與 `EXPECTED_SCHEMA_CHECKSUM`。
4. 建立並驗證 PostgreSQL backup。migration 以 `PG_MIGRATION_USER` 執行；API、GAME、PLATFORM、retention、monitor、logical backup、WAL 使用各自角色；role/schema gate 失敗時不啟動新 app。
5. 先以 staging smoke（health、ready、三服務 build ID、登入/建房/對局）驗證，再進 production。正式流量必須依序使用 10% → 50% → 100% canary 放量；缺少下列可驗證 evidence 時 release gate 會維持 `blocked`。

第一次加入 OPS image 時，部署器只允許現有 active/stable rollback target 使用舊六映像格式，並逐一驗證該 SHA 原有的六份 signature/attestation；新 deployment、bootstrap 與 candidate 一律要求七映像。Slot state 會把新 release 記為 `current-seven`，舊 stable 必須完全沒有 `OPS_IMAGE`／`.images.ops`，不得為舊 SHA 補掛未受其 provenance 約束的 OPS image。

## Canary evidence

- 三階段都至少 dwell 300 秒，逐階段累積至少 1,000 個 HTTP samples 與 100 個 WebSocket samples，candidate 全程至少 2 個 replicas ready。
- stable/candidate release set 都要列出 game/api/platform immutable image digests。Candidate 必須逐項等於本次 manifest；stable 必須使用各服務相同 image repository 的不同 digest，禁止 game/api/platform 互相混槽。Stable 還要保存完整 release SHA 與原始 `.release.env` manifest artifact；Gate 會在驗 hash 後解析 `RELEASE_SHA`、`GAME_IMAGE`、`API_IMAGE`、`PLATFORM_IMAGE` 並逐項比對。
- 每一階段保存 gateway config JSON 原檔、其 SHA-256、raw metrics artifact、開始／結束 UTC；三個權重的 config hash 不可相同。JSON 必須採 `zutomayo-canary-gateway-config` schema，Gate 會解析並精確核對 90/10、50/50、0/100 weights 及兩組 release set，不只檢查檔案 hash。
- Raw metrics 必須採 `zutomayo-canary-raw-metrics` JSON schema，逐 stage 綁定 weights、HTTP/WS samples、ready replica count 與 gateway config hash；Gate 會解析內容和 evidence 交叉比對，不接受只換 hash 的任意檔案。
- 100% 階段完成後實際演練 candidate → stable rollback，量測時間必須不超過 300 秒；rollback 完成後至少 2 個 replicas ready，並保存 rollback gateway config 與 raw metrics。Rollback JSON 必須是 stable/candidate 100/0，且 `toReleaseSet` 指回原 stable set；raw metrics 另須交叉驗證 `rollbackSeconds` 及 post-rollback HTTP/WS samples。
- 回切後觀察必須在 gateway ready 後 60 秒內開始，並在 600 秒內完成；緊急回切本身不因 evidence 收集失敗而中止，但該 release 在補齊合規 post-rollback evidence 前維持 blocked。
- `staging/canary-rollback.json` 的 `thresholds` 只用來呈現 repo policy，不能自行放寬。Gate 固定要求 3 stages、10/50/100 weights、300 秒 rollback 上限、60/600 秒 rollback observation 上限及上述 dwell/sample/replica 下限。

## server4 parallel runtime

新控制面固定放在 `/opt/zutomayo-card-runtime`，不得清理、checkout 或覆寫 legacy `/opt/zutomayo-card-online`。既有 `zutomayo_card` PostgreSQL 直接沿用，沒有資料搬遷；每次 stage 前由 `zutomayo-server4-pg-connection-budget` evidence gate 驗證可用連線。第一次安裝會從 legacy `.env` 複製現有 DB/Redis roles，從已執行的 Redis image 解析 immutable digest，建立獨立 Colyseus password、security keys、`zutomayo-feedback-uploads` external volume 與 `zutomayo-release-edge` network。它不會自行捏造外部 object-storage：`ACCOUNT_EXPORT_S3_*` bucket/region/credential/lifecycle 設定仍須在 stage 前指向已驗證的 private S3-compatible bucket。

GitHub Actions production dispatch 的 `production_slot` 必須指向已安裝控制面上的 inactive `blue` 或 `green` slot。Workflow 只執行 `stage-slot --confirm`；成功只代表 candidate containers 已就緒，不代表已放量。`switch`、worker transfer 與 OpenResty cutover 仍是獨立、受 evidence gate 保護的操作。

```bash
./scripts/deploy-server4-canary.sh preflight
./scripts/deploy-server4-canary.sh install --copy-legacy-env --confirm
./scripts/deploy-server4-canary.sh stage-slot --slot blue --manifest stable.env --confirm
./scripts/deploy-server4-canary.sh bootstrap-gateway --stable-slot blue --manifest stable.env --confirm
./scripts/deploy-server4-canary.sh activate-retention --slot blue --confirm
```

Bootstrap gateway 只有 stable slot readiness，不得當成 canary evidence。確認 `curl http://127.0.0.1:3080/ready` 為 200 後，第一次 OpenResty cutover 只改：

`/opt/1panel/www/sites/battle.zutomayocard.online/proxy/root.conf`

中的 `proxy_pass http://127.0.0.1:3000;` 為 `proxy_pass http://127.0.0.1:3080;`。先保存 root-owned timestamped backup，再執行 `docker exec openresty openresty -t`；只有 syntax pass 才 reload。`activate-retention` 會以 systemd drop-in 將每日 timer 的工作目錄、release manifest 與 retention compose 固定到 parallel runtime，並保留既有 unit backup；沒有這一步時 legacy retention 仍會繼續執行。公開 smoke 通過後停止 legacy game/API，才執行 `start-workers`（或後續 promotion 的 `transfer-workers`）。若切換失敗，還原該單一 proxy include、再次 `openresty -t` 並 reload；gateway/slot 保持 warm 供調查。不要修改 1Panel 產生的主 site/TLS config。

下一個不同 SHA 才 stage green，依序套用 10/50/100：

```bash
./scripts/deploy-server4-canary.sh stage-slot --slot green --manifest candidate.env --confirm
./scripts/deploy-server4-canary.sh switch --stable-slot blue --candidate-slot green \
  --stable-manifest stable.env --candidate-manifest candidate.env --weight 10 --confirm
# controller 會在 10→50、50→100 前自動完成上一階段的 dwell/sample gate
```

每次 gateway apply 都保存 config artifact、實際 HAProxy config、active-config marker、container image/restart evidence、起始 stats CSV 與 canonical observation state。`10→50`、`50→100` 以及 100% stage 的 `transfer-workers` 前，controller 會在同一把 deployment lock 內從 container loopback `http://127.0.0.1:8405/stats;csv` 取得結束 snapshot，固定驗證 dwell 300 秒、1,000 個 HTTP samples、100 個 WebSocket samples與 2 個 ready replicas；任何一項不足都會在 gateway reload／worker stop 前 fail closed。

`weight=0` 是緊急 rollback 路徑，不得因 observation 缺失或門檻不足而被阻擋。Controller 會 best-effort 以 `.pre-rollback.*` 獨立檔名保存回切前的 end stats/raw metrics，不會覆寫已通過 policy 的 stage artifact；失敗只記 warning。Post-rollback raw metrics 與實際 rollback duration 仍須另行收集。需要獨立重算或修復 evidence 時可使用：

若 100% stage 已執行 worker transfer，weight=0 套用後還要用同一命令反向轉移；controller 只會在 canonical rollback state 與 gateway runtime marker 都證明 stable/candidate 方向正確時允許 candidate → stable，完成後才可 bootstrap 舊 stable slot：

```bash
./scripts/deploy-server4-canary.sh transfer-workers --from-slot green --to-slot blue --confirm
./scripts/deploy-server4-canary.sh bootstrap-gateway --stable-slot blue --manifest stable.env --confirm
```

```bash
node scripts/collect-server4-canary-metrics.mjs \
  --gateway-artifact gateway-<sha>-<weight>.json \
  --active-marker gateway-<sha>-<weight>.active-config.txt \
  --start-stats gateway-<sha>-<weight>.stats-start.csv \
  --end-stats gateway-<sha>-<weight>.stats-end.csv \
  --enforce-rollout-policy \
  --observation-started-at-file gateway-<sha>-<weight>.applied-at \
  --observation-finished-at-file gateway-<sha>-<weight>.finished-at \
  --output gateway-<sha>-<weight>.raw-metrics.json
```

Rollback raw metrics 必須另外提供實際回切時間：

```bash
node scripts/collect-server4-canary-metrics.mjs \
  --gateway-artifact gateway-<sha>-0.json \
  --active-marker gateway-<sha>-0.active-config.txt \
  --start-stats gateway-<sha>-0.stats-start.csv \
  --end-stats gateway-<sha>-0.stats-end.csv \
  --rollback-started-at "$(cat gateway-<sha>-0.rollback-started-at)" \
  --rollback-finished-at "$(cat gateway-<sha>-0.rollback-finished-at)" \
  --observation-started-at-file gateway-<sha>-0.applied-at \
  --observation-finished-at-file gateway-<sha>-0.finished-at \
  --output gateway-<sha>-0.raw-metrics.json
```

Rollback 的 `.rollback-started-at`／`.rollback-finished-at` 只量切流耗時；`.applied-at`／`.finished-at` 是 gateway ready 後的觀察窗口，兩組時間不得混用。Collector 以 candidate（rollback 則 stable）各 backend 的 `stot` 與 `hrsp_1xx` delta 取得該 slot 的 HTTP/WebSocket samples，不再用全 gateway/stable 流量灌滿 candidate 門檻；並以 game/API/platform 三組 backend 的最小 `UP` 數作 `readyReplicaCount`。Controller 不依賴 server4 host 安裝 Node；它先把 active candidate manifest 綁回 verified slot state，再使用該 manifest 的 immutable `MIGRATE_IMAGE@sha256`，在 read-only、無網路、無 capabilities 且不傳 `.env` 的容器內執行 collector。Rollout raw artifact 必須由 `--enforce-rollout-policy` 產生，保留和 stage summary 相同的 observation 起訖、repository policy snapshot 與 `policyPassed: true`；release gate 會逐項交叉核對。Assembler 與 release gate 會重算 rollback observation delay/window，拒絕超過 60/600 秒的證據。Counter 倒退（觀察中 reload）、active marker 不符或 rollback 時間缺失會 fail closed。

把 `/opt/zutomayo-card-runtime/evidence` 下載到本機後，不得手工拼裝通過用 JSON。使用 repository-owned assembler 指定四個 controller prefix；它會嚴格解析 stable/candidate manifests、重新計算每份 copied artifact 的 SHA-256，並交叉驗證 10/50/100/rollback 的順序、時間、release set、raw metrics 與固定 policy。同一 output directory 由 `.canary-evidence.lock` 排他保護；所有輸入先在臨時 evidence tree 內通過 `inspectStagingGates`，才會以 summary-last 順序發布到 output directory。並行 assembler、缺檔、重複 prefix、path traversal、symlink、hash 或內容不一致都不會留下可用的半套 summary。

```bash
node scripts/assemble-server4-canary-evidence.mjs \
  --evidence-dir server4-evidence \
  --stable-manifest stable.env \
  --candidate-manifest candidate.env \
  --stage-10-prefix gateway-<candidate-sha12>-10-<timestamp>-<pid>-<random> \
  --stage-50-prefix gateway-<candidate-sha12>-50-<timestamp>-<pid>-<random> \
  --stage-100-prefix gateway-<candidate-sha12>-100-<timestamp>-<pid>-<random> \
  --rollback-prefix gateway-<candidate-sha12>-0-<timestamp>-<pid>-<random> \
  --output-dir artifacts/release \
  --run-id "$GITHUB_RUN_ID" \
  --repository "$GITHUB_REPOSITORY" \
  --run-url "https://github.com/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"

npm run release:gate -- \
  --staging-evidence-dir artifacts/release \
  --release-sha "$(sed -n 's/^RELEASE_SHA=//p' candidate.env)" \
  --release-manifest candidate.env \
  --evidence-run-id "$GITHUB_RUN_ID"
```

## 回滾

1. 停止放量並 drain 新版本連線；保留日誌、trace、容器 digest 與失敗 smoke 輸出。
2. 確認遠端 `.release.previous.env`、兩份 `.previous` Compose 與 `scripts/postgres-init-roles.sh.previous` 齊全；manifest 自身仍須通過簽章、provenance 與 migration checksum 驗證。
3. 執行 `./scripts/deploy-server4.sh --rollback --confirm`；流程只切回上一個 app digest，不使用 `:rollback`/`:latest`，也不重跑舊 migration image。資料庫 schema 維持向前相容的 N+1 版本，由舊 app 的 runtime schema gate 驗證可讀。
4. 若 schema 不相容，依 expand/contract 發布相容修復；禁止未經驗證直接執行 destructive down migration。
5. 執行登入、建房、雙方加入、完成對局、排名寫入與三服務 build ID smoke，觀察 30 分鐘後結案。

## 外部 PostgreSQL bootstrap / 七角色升級

`/docker-entrypoint-initdb.d` 只會在空白 volume 執行。既有 server4／managed
PostgreSQL 從舊 `PG_APP_USER` 升級時，必須在 release migration 前的維護窗口，
由有 `CREATEROLE`、database ACL 與 `pg_monitor` grant 權限的 DBA 執行可重跑
bootstrap。`PG_MIGRATION_USER` 必須擁有 database、`public` schema 與 migration
建立的 objects；bootstrap administrator 不應成為任何 runtime login：

```bash
set -a
source /etc/zutomayo/postgres-role-bootstrap.env
set +a

export PGHOST=db-writer.internal
export PGPORT=5432
export POSTGRES_USER="$PG_BOOTSTRAP_USER"
export POSTGRES_DB="$PG_DATABASE"
export PGPASSWORD="$PG_BOOTSTRAP_PASSWORD"
export REQUIRE_DISTINCT_DB_ROLES=true

./scripts/postgres-init-roles.sh
```

secret file 必須包含 `PG_MIGRATION_USER`，以及 API/GAME/PLATFORM/RETENTION/
MONITOR/BACKUP/WAL replication/WAL operator 八組 `PG_*_USER`、`PG_*_PASSWORD`。bootstrap 成功後立即以
release migration image 執行 `npm run db:migrate:release`；它會在單一 transaction
內套用並驗證完整 ACL matrix。任一角色缺失、重名、屬性或 table/column ACL
不符都會 rollback 並阻擋 rollout。完成後刪除 shell 中的 bootstrap password，
不可將 DBA／migration 密碼傳入 app containers。

任何 rollout/rollback 都必須記錄操作者、原因、digest、migration version、開始／結束時間與驗證結果。
