# 服務水準目標

## 正式環境目標

| SLI                              |         SLO（每 30 天） |
| -------------------------------- | ----------------------: |
| API 可用率                       |                   99.9% |
| Game / platform 可用率           |                   99.9% |
| 配對成功後加入對局成功率         |                     99% |
| 對局完成或在斷線期限內恢復的比例 |                     99% |
| HTTP 5xx 比例                    |                    < 1% |
| HTTP latency                     | p95 < 500 ms，p99 < 1 s |
| WebSocket 建連 latency           |               p95 < 2 s |
| Prometheus scrape 成功率         |                   99.9% |

## 資料復原目標

- 帳號、牌組、完成對局與排名：RPO 15 分鐘，RTO 30 分鐘。
- 全資料庫復原：60 分鐘內完成並通過 schema、row count 與核心 smoke 驗證。
- Beta 階段暫時門檻可放寬為 RPO 24 小時、RTO 4 小時，但必須在 UI 與發布說明明確標示。

## Error budget

每月計算 availability、match success 與 reconnect success 的 error budget。任何核心 SLO 用盡時停止非可靠性功能發布，優先處理失敗來源、補回歸測試並完成事故檢討。

Critical alert 必須在 5 分鐘內送達值班者；每季至少演練一次 service down、migration failure、Redis cold start 與 PostgreSQL restore。
