# 隱私政策

生效與更新日期：2026-07-19

營運者：ZUTOMAYO CARD ONLINE Community

聯絡信箱：contact@mail.zutomayocard.online

本文件記錄 Public Beta 實際採用的資料處理政策，並與公開的 `/legal/privacy` 頁面保持一致。

## 蒐集資料

- 帳號資料：email、暱稱、登入供應商識別碼、驗證狀態。
- 遊戲資料：牌組、配對、對局結果、ELO、伺服器產生的 action log、棄賽與制裁紀錄。
- 社交資料：好友邀請、封鎖、聊天訊息、舉報與審核證據。
- 技術資料：IP、user agent、request ID、錯誤、效能指標與安全稽核日誌。

## 使用目的

資料只用於提供帳號與遊戲服務、維持對局公平、處理客服與舉報、防止濫用、維護安全可靠性，以及產生不識別個人的統計。專案不得出售個人資料，也不得把私人聊天或帳號資料用於廣告画像。

## 第三方服務與分析

正式環境可能依實際啟用功能使用主機與 CDN、Postgres/Redis、OAuth 或 Logto、郵件服務、Umami，以及 Sentry 相容錯誤追蹤。只有玩家選擇或正式環境實際啟用的服務會接收提供功能所需的最少資料。

分析事件採明確 allowlist，不得包含聊天內容、卡牌內容或不必要的原始玩家識別碼。事件契約與查詢方式見 [funnel-analytics.md](./funnel-analytics.md)。

## 玩家權利

登入玩家可在個人頁匯出帳號、牌組、對局與社交資料，並可直接刪除帳號。無法登入時，可由註冊 email 寄信至 `contact@mail.zutomayocard.online` 申請協助。

刪除時，email、登入身分、牌組與社交關係會刪除或匿名化；維持排名、反作弊與爭議處理所必需的比賽資料，可在移除直接識別資訊後保留。法律、安全事件或爭議保存義務優先於一般刪除時程。

## 保存期限

詳細期限與執行方式見 [DATA_RETENTION.md](./DATA_RETENTION.md)：

- 帳號與牌組：帳號有效期間；刪除請求確認後 30 天內刪除或匿名化。
- 完成對局與排名異動：365 天。
- Action log、replay 與聊天：通常 180 天。
- 舉報、制裁與管理稽核：通常 365 天。
- 應用程式日誌 30 天、metrics 90 天、加密備份 35 天。

## 安全與跨境

傳輸使用 TLS；權限、runtime 與 retention worker 分離；密鑰不得寫入映像或 repository；備份須加密並限制存取。資料可能在服務供應者所在地處理。網路服務無法保證絕對安全，安全問題請依 [SECURITY.md](../SECURITY.md) 私下回報。

## 政策變更與聯絡

重大變更會更新本文件日期並透過服務公告。隱私、匯出、刪除或安全相關問題請寄至 `contact@mail.zutomayocard.online`，主旨建議使用 `[PRIVACY]` 或 `[SECURITY]`。
