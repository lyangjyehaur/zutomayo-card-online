# Deployment / Rollback Runbook

## 發布

1. `workflow_dispatch` 的 `release_ref` 只能是完整 SHA 或 release tag；production 必須是 `v*`。
2. preflight 必須找到該 SHA 的成功 CI；四個 image 必須通過 Trivy、SBOM、Cosign signature 與 GitHub provenance attestation。
3. 從 verified artifact 取得 `.release.env`，確認四個值都是 `ghcr.io/...@sha256:...`，並記錄 `EXPECTED_SCHEMA_MIGRATION` 與 `EXPECTED_SCHEMA_CHECKSUM`。
4. 建立並驗證 PostgreSQL backup。migration 以 `PG_MIGRATION_USER` 執行，app 只使用 `PG_APP_USER`；schema gate 失敗時不啟動新 app。
5. 先以 staging smoke（health、ready、三服務 build ID、登入/建房/對局）驗證，再進 production。真實環境可用 10% → 50% → 100% canary 放量。

## 回滾

1. 停止放量並 drain 新版本連線；保留日誌、trace、容器 digest 與失敗 smoke 輸出。
2. 確認遠端 `.release.previous.env` 存在且自身仍是已驗證 manifest。
3. 執行 `./scripts/deploy-server4.sh --rollback --confirm`；流程只切回上一個 digest，不使用 `:rollback`/`:latest`。
4. 若 schema 不相容，依 expand/contract 發布相容修復；禁止未經驗證直接執行 destructive down migration。
5. 執行登入、建房、雙方加入、完成對局、排名寫入與三服務 build ID smoke，觀察 30 分鐘後結案。

## 外部 PostgreSQL bootstrap

server4 使用外部 PostgreSQL 時，需由 DBA 以 migration owner 執行
`scripts/postgres-init-roles.sh` 等價 SQL，建立 `PG_APP_USER` 並授予既有
資料表的 DML、sequence 使用權與 default privileges。不可把 migration 密碼
放入 app container；若 role/bootstrap 未完成，Compose 應在 schema gate 前失敗。

任何 rollout/rollback 都必須記錄操作者、原因、digest、migration version、開始／結束時間與驗證結果。
