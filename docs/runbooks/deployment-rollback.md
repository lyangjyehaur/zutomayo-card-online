# Deployment / Rollback Runbook

## 發布

1. 確認目標 commit 的 required CI、image scan、SBOM 與簽章全部通過。
2. 記錄 game/api/platform 的 immutable digest；migration 必須使用相同 release digest。
3. 建立可驗證的 DB backup，先執行 migration gate；失敗立即停止，不啟動新 app。
4. 依 10% → 50% → 100% canary 放量，每階段檢查 health、5xx、latency、WS reconnect 與 match completion。

## 回滾

1. 停止放量並 drain 新版本連線；保留日誌、trace 與容器 digest。
2. 若 schema 向後相容，切回上一個已簽章的 app digest。
3. 若 schema 不相容，依 expand/contract 設計部署相容修復；禁止未經驗證直接執行破壞性 down migration。
4. 執行登入、建房、雙方加入、完成對局與排名寫入 smoke，觀察 30 分鐘後結案。

任何 rollout/rollback 都必須記錄操作者、原因、digest、migration version、開始／結束時間與驗證結果。
