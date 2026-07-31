# 資料保存與刪除政策

| 資料                             | 正常保存期限 | 刪除／匿名化方式                                                |
| -------------------------------- | ------------ | --------------------------------------------------------------- |
| 帳號、私人牌組、實體卡收藏與分享 | 帳號有效期間 | 刪除請求確認後 30 天內刪除；複製／檢舉紀錄移除帳號識別          |
| 可連結帳號的完成對局與排名異動   | 365 天       | 移除直接帳號資料後保留去識別統計與完整性證據                    |
| 可連結帳號的 action log / replay | 180 天       | 逾期刪除；遭舉報或爭議中的對局例外                              |
| 去識別對局分析                   | 無固定期限   | 保留終局、版本、牌組組成與 allowlisted 規則事件；必要時定向刪除 |
| 聊天訊息                         | 180 天       | 逾期刪除或匿名化；審核證據另計                                  |
| 舉報、制裁與管理稽核             | 365 天       | 逾期刪除或匿名化；法律義務例外                                  |
| 應用程式日誌與 trace             | 30 天        | 自動 lifecycle 刪除                                             |
| Metrics                          | 90 天        | 聚合後刪除原始高基數資料                                        |
| 零結果搜尋聚合                   | 90 天        | 不含帳號或 IP；疑似敏感查詢不落明文，逾期整筆刪除               |
| 加密備份                         | 35 天        | lifecycle policy 自動刪除；immutable window 內不可提前刪除      |

## 執行要求

- 每日執行 retention job，記錄刪除筆數、批次數、耗時與錯誤；失敗、重入跳過或超過 26 小時未成功必須告警。
- 帳號刪除先撤銷 session，再刪除登入身分、私人牌組、實體卡收藏、玩家擁有的分享、分享按讚、社交關係與未完成 token；分享複製與檢舉證據移除帳號識別，最後匿名化 user row。
- 使用者資料匯出不得包含 password hash、salt、OAuth token、IP、其他使用者私人資料或管理員備註。
- Backup restore 後必須重新執行 retention job，避免已過期資料永久復活。
- 法律保留必須記錄範圍、理由、owner 與到期日，不能用無期限標記取代；建立時會驗證 subject 存在並展開當下的衍生資料。上線前仍須補上持續 reconciliation，確保 hold 建立後新增的對局、訊息與舉報也被納入。
- `match_analytics*` 永久層不得保存帳號 ID、email、暱稱、IP、user agent、聊天、憑證、原始 match ID、卡牌 instance ID 或牌庫順序。來源 match ID 只以 SHA-256 digest 用於冪等與清理對帳。
- 已完成的 `bjg_matches` 只有在分析 fact、兩副 20 張牌快照與 allowlisted event 數量完成 reconciliation 後才能清理；未完成的 inactive room 也必須先形成 `abandoned` fact 並通過相同對帳。封存或對帳失敗時保留 runtime source，禁止以 TTL 繞過。

## 執行入口

`npm run retention:run -- --dry-run` 只計算候選資料，不會修改資料庫；確認報表後才執行
`npm run retention:run`。正式環境應由 `zutomayo-retention.timer` 執行
`docker compose --env-file .release.env -f docker-compose.retention.yml run --rm --no-deps retention`，不得把 retention 權限放入 API runtime。`/etc/zutomayo/retention.env` 必須是
`0640 root:zutomayo-retention`，只包含 retention DB role、TLS、metrics GID/path 等 worker 專用設定；部署腳本會把不含 secret 的 `.release.env` 設為相同 group 可讀。Worker 會持有
session-level advisory lock，逐批使用 `FOR UPDATE SKIP LOCKED` 排空資料，並透過
`RETENTION_METRICS_FILE` 輸出 `retention_last_success_unixtime_seconds` 等 Prometheus 指標。

每次執行會在 `retention_runs` 留下模式、狀態、完成時間、各類筆數與錯誤；`legal_holds` 中
未解除且未過期的項目會排除所有相應對局、訊息、檢舉與稽核資料。對局的 authoritative action log
在 180 天先清理，直接帳號識別在 365 天再匿名化；聊天會以 `[redacted]` 匿名化並保留必要的
moderation/report evidence。`legal_hold_objects` 保存 hold 的衍生 subject mapping，避免只比對單一
root id 而漏保留關聯資料。

去識別對局分析與帳號資料分層保存。`match_analytics`、`match_analytics_decks` 與
`match_analytics_events` 只接受伺服器權威終局 transaction 或 stale cleanup 產生的 typed allowlist；game role 只有
`SELECT/INSERT`，retention 與 backup role 只有 `SELECT`，一般 API role 不具存取權。未知事件、任意
巢狀欄位與自由文字不落盤。永久保存表示不因時間自動刪除；若匿名化契約失效、安全事件或法律要求
需要移除資料，仍可依 digest 定向處理。

`bjg_match_telemetry` 是短期 operational 表，以原始 match ID foreign key 關聯 `bjg_matches` 並隨其刪除。
platform role 只能寫入 server 判定的 `match_mode`、`traffic_class` 與每席 disconnect／reconnect 計數；
game、retention、backup 只讀，API role 不具權限。永久 archive 只接收固定兩席計數陣列與 seat resume
次數，不保存 join timeline、session/socket/user ID、room/invite ID 或 IP。

已結案或駁回的牌組分享檢舉通常保存 365 天後刪除；pending／reviewing 狀態不由一般 retention
自動刪除。牌組分享本身與帳號有效期間一致，取消發布只改變可見狀態，不是立即刪除資料。
