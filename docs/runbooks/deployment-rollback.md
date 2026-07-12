# Deployment / Rollback Runbook

## 發布

1. `workflow_dispatch` 的 `release_ref` 只能是完整 SHA 或 release tag；production 必須是 `v*`。
2. preflight 必須找到該 SHA 的成功 CI；四個 image 必須通過 Trivy、SBOM、Cosign signature 與 GitHub provenance attestation。
3. 從 verified artifact 取得 `.release.env`，確認四個值都是 `ghcr.io/...@sha256:...`，並記錄 `EXPECTED_SCHEMA_MIGRATION` 與 `EXPECTED_SCHEMA_CHECKSUM`。
4. 建立並驗證 PostgreSQL backup。migration 以 `PG_MIGRATION_USER` 執行；API、GAME、PLATFORM、retention、monitor、logical backup、WAL 使用各自角色；role/schema gate 失敗時不啟動新 app。
5. 先以 staging smoke（health、ready、三服務 build ID、登入/建房/對局）驗證，再進 production。真實環境可用 10% → 50% → 100% canary 放量。

## 回滾

1. 停止放量並 drain 新版本連線；保留日誌、trace、容器 digest 與失敗 smoke 輸出。
2. 確認遠端 `.release.previous.env` 存在且自身仍是已驗證 manifest。
3. 執行 `./scripts/deploy-server4.sh --rollback --confirm`；流程只切回上一個 digest，不使用 `:rollback`/`:latest`。
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
