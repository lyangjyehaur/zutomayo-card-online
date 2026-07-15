# 安全政策

## 支援版本

安全修復只套用到目前部署的正式版本與 `master` 最新版本。舊版容器、分支與自行修改的部署不提供安全更新承諾。

## 回報方式

請優先使用 GitHub repository 的 Private vulnerability reporting／Security Advisory 私下回報。若該功能不可用，請透過 repository owner 的私人聯絡方式回報，不要建立公開 issue，也不要附上真實玩家資料、token、cookie 或 production dump。

回報內容應包含：受影響版本、重現步驟、影響範圍、可觀察證據與建議緩解措施。不要在未取得明確同意前讀取、修改或下載其他玩家的資料。

## 回應目標

| 嚴重度                                                            |   首次確認 |              緩解目標 |
| ----------------------------------------------------------------- | ---------: | --------------------: |
| Critical：帳號接管、任意 ELO 操縱、遠端程式執行、敏感資料大量外洩 |    24 小時 | 72 小時內完成暫時緩解 |
| High：越權、持久 XSS、私人對話外洩、可利用的服務阻斷              | 3 個工作日 |    7 天內完成暫時緩解 |
| Medium / Low                                                      | 7 個工作日 |    排入下一個維護版本 |

修復完成後應保留回歸測試，輪換可能外洩的密鑰，稽核受影響資料，並在不增加玩家風險的前提下發布安全公告。

## 安全發布門檻

- `npm run verify`、必要 E2E、Compose config、migration dry-run 全部通過。
- Critical / High 已知漏洞為零；例外必須有 owner、補償控制與不超過 14 天的到期日。
- 正式映像必須以 immutable digest 部署，並附 SBOM、漏洞掃描結果與可驗證簽章。
- 正式環境不得使用範例密碼、fallback secret、公開 metrics 或未驗證的 WebSocket Origin。
