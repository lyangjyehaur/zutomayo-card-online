# PostgreSQL Restore Runbook

## 前置條件

- 使用與目標版本相符的 migration image digest。
- 確認 backup checksum、加密金鑰、WAL 範圍與 restore 目標時間。
- 隔離寫入流量；保留故障資料庫快照供調查。

## 恢復步驟

1. 在新資料庫 instance 還原 base backup，套用 WAL 到指定時間點。
2. 以唯讀帳號檢查 schema migration version、核心表 row count、最新 match 時間與外鍵完整性。
3. 執行 migration dry-run，再執行必要的 forward migration；禁止以破壞性 down migration 修復。
4. 啟動單一 staging replica，執行登入、牌組讀取、歷史查詢、建房與完整對局 smoke。
5. 執行 retention job，避免已刪除或過期資料因 restore 復活。
6. 切換連線前建立最終 checkpoint；先 canary 讀流量，再恢復寫入與全部 replica。

## 驗收

- RPO/RTO 實測值、backup ID、WAL target、schema version 與驗證結果寫入演練報告。
- 帳號、牌組、完成對局與 ELO 筆數符合預期；同一 `source_match_id` 不得重複。
- 所有 health/readiness 正常，5xx 與 DB pool waiting 在 30 分鐘觀察期內未超過 SLO。
