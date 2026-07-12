# 事故處理 Runbook

## 1. 宣告與止血

1. 指定 incident commander、紀錄者與技術負責人，建立只限相關人員的事故頻道。
2. 記錄開始時間、受影響版本、服務與玩家範圍；保存日誌、trace、DB audit 與部署 digest。
3. 依情況停用 ranked、match submission、聊天上傳或整個入口。不要先刪除可疑資料。
4. 若涉及憑證，輪換密鑰、撤銷 session，並確認舊密鑰已從所有 replica 與 CI cache 移除。

## 2. 調查

- 以 request ID、user ID、match ID、room ID 與 image digest 建立時間線。
- 區分資料完整性、機密性、可用性與遊戲公平性影響。
- 對 ELO／對局問題產生受影響 match 清單，先標記隔離，再以伺服器資料重算。
- 不得把 production dump、token 或玩家私人內容貼入公開 issue。

## 3. 恢復

1. 在 staging 重現並加入失敗測試。
2. 以 immutable digest 部署修復，先 canary，再逐步恢復流量。
3. 驗證 health/readiness、登入、建房、雙方加入、完成對局、聊天與告警。
4. 只有在資料校驗與關鍵 SLI 穩定 30 分鐘後才重新啟用 ranked。

## 4. 後續

72 小時內完成事故檢討，內容包含根因、偵測缺口、影響、恢復時間、資料修正與有 owner／期限的行動項。對玩家的通知應說明實際影響與需要採取的動作，不推測未證實的外洩。
