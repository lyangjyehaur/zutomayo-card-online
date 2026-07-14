# Deployment / Rollback Runbook

## 發布

1. `workflow_dispatch` 的 `release_ref` 只能是完整 SHA 或 release tag；production 必須是 `v*`。
2. preflight 必須找到該 SHA 的成功 CI；五個 image 必須通過 Trivy、SBOM、Cosign signature 與 GitHub provenance attestation。
3. 從 verified artifact 取得 `.release.env`，確認五個值都是 `ghcr.io/...@sha256:...`，並記錄 `EXPECTED_SCHEMA_MIGRATION` 與 `EXPECTED_SCHEMA_CHECKSUM`。
4. 建立並驗證 PostgreSQL backup。migration 以 `PG_MIGRATION_USER` 執行；API、GAME、PLATFORM、retention、monitor、logical backup、WAL 使用各自角色；role/schema gate 失敗時不啟動新 app。
5. 先以 staging smoke（health、ready、三服務 build ID、登入/建房/對局）驗證，再進 production。正式流量必須依序使用 10% → 50% → 100% canary 放量；缺少下列可驗證 evidence 時 release gate 會維持 `blocked`。

## Canary evidence

- 三階段都至少 dwell 300 秒，逐階段累積至少 1,000 個 HTTP samples 與 100 個 WebSocket samples，candidate 全程至少 2 個 replicas ready。
- stable/candidate release set 都要列出 game/api/platform immutable image digests。Candidate 必須逐項等於本次 manifest；stable 必須使用各服務相同 image repository 的不同 digest，禁止 game/api/platform 互相混槽。Stable 還要保存完整 release SHA 與原始 `.release.env` manifest artifact；Gate 會在驗 hash 後解析 `RELEASE_SHA`、`GAME_IMAGE`、`API_IMAGE`、`PLATFORM_IMAGE` 並逐項比對。
- 每一階段保存 gateway config JSON 原檔、其 SHA-256、raw metrics artifact、開始／結束 UTC；三個權重的 config hash 不可相同。JSON 必須採 `zutomayo-canary-gateway-config` schema，Gate 會解析並精確核對 90/10、50/50、0/100 weights 及兩組 release set，不只檢查檔案 hash。
- Raw metrics 必須採 `zutomayo-canary-raw-metrics` JSON schema，逐 stage 綁定 weights、HTTP/WS samples、ready replica count 與 gateway config hash；Gate 會解析內容和 evidence 交叉比對，不接受只換 hash 的任意檔案。
- 100% 階段完成後實際演練 candidate → stable rollback，量測時間必須不超過 300 秒；rollback 完成後至少 2 個 replicas ready，並保存 rollback gateway config 與 raw metrics。Rollback JSON 必須是 stable/candidate 100/0，且 `toReleaseSet` 指回原 stable set；raw metrics 另須交叉驗證 `rollbackSeconds` 及 post-rollback HTTP/WS samples。
- `staging/canary-rollback.json` 的 `thresholds` 只用來呈現 repo policy，不能自行放寬。Gate 固定要求 3 stages、10/50/100 weights、300 秒 rollback 上限及上述 dwell/sample/replica 下限。

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
