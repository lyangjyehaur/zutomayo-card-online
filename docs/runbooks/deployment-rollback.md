# Deployment / Rollback Runbook

## 發布

1. `workflow_dispatch` 的 `release_ref` 只能是完整 SHA 或 `v<semver>` tag；production 必須是已存在的 exact tag。Workflow 以 `refs/tags/<tag>` 解析，禁止同名 branch，並要求 release SHA 在 `origin/master` ancestry 內。
2. preflight 必須找到該 SHA 的成功 CI；game、API、platform、migration、retention、gateway 六個 image 必須通過 Trivy、SBOM、Cosign signature 與 GitHub provenance attestation。
3. 從 verified artifact 取得 `.release.env`，確認六個值都是 `ghcr.io/...@sha256:...`，並記錄 `EXPECTED_SCHEMA_MIGRATION` 與 `EXPECTED_SCHEMA_CHECKSUM`。
4. 建立並驗證 PostgreSQL backup。migration 以 `PG_MIGRATION_USER` 執行；API、GAME、PLATFORM、retention、monitor、logical backup、WAL 使用各自角色；role/schema gate 失敗時不啟動新 app。
5. 先以 staging smoke（health、ready、三服務 build ID、登入/建房/對局）驗證，再進 production。正式流量必須依序使用 10% → 50% → 100% canary 放量；缺少下列可驗證 evidence 時 release gate 會維持 `blocked`。

## Canary evidence

- 三階段都至少 dwell 300 秒，逐階段累積至少 1,000 個 HTTP samples 與 100 個 WebSocket samples，candidate 全程至少 2 個 replicas ready。
- stable/candidate release set 都要列出 game/api/platform immutable image digests。Candidate 必須逐項等於本次 manifest；stable 必須使用各服務相同 image repository 的不同 digest，禁止 game/api/platform 互相混槽。Stable 還要保存完整 release SHA 與原始 `.release.env` manifest artifact；Gate 會在驗 hash 後解析 `RELEASE_SHA`、`GAME_IMAGE`、`API_IMAGE`、`PLATFORM_IMAGE` 並逐項比對。
- 每一階段保存 gateway config JSON 原檔、其 SHA-256、raw metrics artifact、開始／結束 UTC；三個權重的 config hash 不可相同。JSON 必須採 `zutomayo-canary-gateway-config` schema，Gate 會解析並精確核對 90/10、50/50、0/100 weights 及兩組 release set，不只檢查檔案 hash。
- Raw metrics 必須採 `zutomayo-canary-raw-metrics` JSON schema，逐 stage 綁定 weights、HTTP/WS samples、ready replica count 與 gateway config hash；Gate 會解析內容和 evidence 交叉比對，不接受只換 hash 的任意檔案。
- 100% 階段完成後實際演練 candidate → stable rollback，量測時間必須不超過 300 秒；rollback 完成後至少 2 個 replicas ready，並保存 rollback gateway config 與 raw metrics。Rollback JSON 必須是 stable/candidate 100/0，且 `toReleaseSet` 指回原 stable set；raw metrics 另須交叉驗證 `rollbackSeconds` 及 post-rollback HTTP/WS samples。
- `staging/canary-rollback.json` 的 `thresholds` 只用來呈現 repo policy，不能自行放寬。Gate 固定要求 3 stages、10/50/100 weights、300 秒 rollback 上限及上述 dwell/sample/replica 下限。

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
# dwell/sample gate 通過後才執行 50，再執行 100
```

每次 gateway apply 都保存 config artifact、實際 HAProxy config、active-config marker、container image/restart evidence 及起始 stats CSV。觀察期結束後從 container 的 loopback `http://127.0.0.1:8405/stats;csv` 保存結束 snapshot，使用：

```bash
node scripts/collect-server4-canary-metrics.mjs \
  --gateway-artifact gateway-<sha>-<weight>.json \
  --active-marker gateway-<sha>-<weight>.active-config.txt \
  --start-stats gateway-<sha>-<weight>.stats-start.csv \
  --end-stats gateway-<sha>-<weight>.stats-end.csv \
  --output gateway-<sha>-<weight>.raw-metrics.json
```

Rollback raw metrics 必須另外提供實際回切時間：

```bash
node scripts/collect-server4-canary-metrics.mjs \
  --gateway-artifact gateway-<sha>-0.json \
  --active-marker gateway-<sha>-0.active-config.txt \
  --start-stats gateway-<sha>-0.stats-start.csv \
  --end-stats gateway-<sha>-0.stats-end.csv \
  --rollback-started-at 2026-07-14T01:00:00Z \
  --rollback-finished-at 2026-07-14T01:04:00Z \
  --output gateway-<sha>-0.raw-metrics.json
```

Collector 以 candidate（rollback 則 stable）各 backend 的 `stot` 與 `hrsp_1xx` delta 取得該 slot 的 HTTP/WebSocket samples，不再用全 gateway/stable 流量灌滿 candidate 門檻；並以 game/API/platform 三組 backend 的最小 `UP` 數作 `readyReplicaCount`。Counter 倒退（觀察中 reload）、active marker 不符或 rollback 時間缺失會 fail closed。

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
MONITOR/BACKUP/WAL 七組 `PG_*_USER`、`PG_*_PASSWORD`。bootstrap 成功後立即以
release migration image 執行 `npm run db:migrate:release`；它會在單一 transaction
內套用並驗證完整 ACL matrix。任一角色缺失、重名、屬性或 table/column ACL
不符都會 rollback 並阻擋 rollout。完成後刪除 shell 中的 bootstrap password，
不可將 DBA／migration 密碼傳入 app containers。

任何 rollout/rollback 都必須記錄操作者、原因、digest、migration version、開始／結束時間與驗證結果。
