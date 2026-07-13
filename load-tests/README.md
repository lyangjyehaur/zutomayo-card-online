# k6 負載測試

本目錄使用 [k6](https://k6.io) 對 zutomayo-card-online 的關鍵服務進行壓力測試。k6 是獨立的 Go 工具，腳本以 k6 自帶的 JavaScript runtime 撰寫，**不需要 npm 安裝**，也不依賴專案的 `node_modules`。

## 安裝 k6

macOS（Homebrew）：

```bash
brew install k6
```

其他平台請參考 [k6 官方安裝指南](https://k6.io/docs/get-started/installation/)。

或透過 Docker（免本機安裝）：

```bash
docker run --rm -i grafana/k6 run - < load-tests/api-load.js
```

## 測試腳本

| 腳本                  | 對象                                   | 說明                                                             |
| --------------------- | -------------------------------------- | ---------------------------------------------------------------- |
| `api-load.js`         | API server                             | 對公開 API endpoint 施壓，記錄延遲與錯誤率。                     |
| `websocket-load.js`   | game server                            | 對 socket.io WebSocket 連線進行並發壓力測試。                    |
| `auth-load.js`        | API server                             | 模擬登入 / token refresh，記錄成功率與延遲。                     |
| `matchmaking-load.js` | API server                             | 模擬多玩家加入配對佇列，記錄配對成功率與配對時間。               |
| `operational-soak.js` | 全服務 readiness / representative URLs | 以觀測到的 peak 計算 2x constant-arrival-rate，預設執行 2 小時。 |

## 執行方式

### 本機直接執行

先啟動目標服務（例如 `npm run server` + `npm run api`，或 `docker compose up`），再執行：

```bash
# API 負載測試（預設 BASE_URL=http://localhost:3001）
k6 run load-tests/api-load.js

# WebSocket 負載測試（預設指向 localhost:3000 的 socket.io endpoint）
k6 run load-tests/websocket-load.js

# 認證負載測試（指定預先建立的測試帳號）
BASE_URL=http://localhost:3001 LOGIN_EMAIL=test@example.com LOGIN_PASSWORD=secret \
  k6 run load-tests/auth-load.js

# 配對負載測試
BASE_URL=http://localhost:3001 k6 run load-tests/matchmaking-load.js
```

或使用 package.json 的 script：

```bash
npm run load:api
npm run load:ws
npm run load:auth
npm run load:matchmaking
npm run load:operational-soak
```

> `npm run load:*` 預設不帶環境變數；如需指定 `BASE_URL` 等參數，請在指令前加上環境變數，或直接用 `k6 run`。

### 2x peak 與 2 小時 soak

`operational-soak.js` 刻意不提供假的預設 peak。先從 production/staging telemetry 取得最近 30 天實際 peak operations/s，再執行：

```bash
OBSERVED_PEAK_RPS=40 \
PEAK_MULTIPLIER=2 \
SOAK_DURATION=2h \
TARGET_URLS='https://game.example/api/version,https://api.example/api/cards,https://platform.example/health' \
K6_SUMMARY_EXPORT=artifacts/k6-operational-soak-summary.json \
k6 run load-tests/operational-soak.js
```

測試 runner 要先建立 summary 目錄。`OBSERVED_PEAK_RPS`、環境規格、release/image digest、Prometheus snapshot 與 summary JSON 必須一起保留；單機結果不能當 production 容量證據。

WebSocket soak 可用相同實測 baseline 調整：

```bash
WS_TARGET_CONNECTIONS=400 \
WS_RAMP_DURATION=5m \
WS_SOAK_DURATION=2h \
WS_HOLD_MS=7500000 \
k6 run load-tests/websocket-load.js
```

`WS_HOLD_MS` 應長於 ramp + soak，避免測試期間因 iteration 結束而主動重連。

### Cold restart / recovery probe

`scripts/chaos-recovery-probe.ts` 會逐秒記錄 `/ready` JSONL。預設只有「先觀察到 outage，之後連續三次全健康」才 exit 0。由 provider console/CLI 注入 managed Redis/PostgreSQL failover時，另開一個 runner 執行：

```bash
CHAOS_PROBE_URLS='https://game.example/ready,https://api.example/ready,https://platform.example/ready' \
CHAOS_PROBE_TIMEOUT_MS=300000 \
npm run chaos:probe
```

本機 Compose 可執行 cold restart smoke：

```bash
CHAOS_CONFIRM=local-compose-only npm run chaos:compose -- redis-restart
CHAOS_CONFIRM=local-compose-only npm run chaos:compose -- postgres-restart
CHAOS_CONFIRM=local-compose-only npm run chaos:compose -- game-restart
```

這只證明 container cold restart 與 readiness recovery，不能代替 managed multi-AZ failover、replication lag、RTO/RPO 或 WebSocket reconnect 演練。完整驗收矩陣見 [`docs/runbooks/ha-capacity.md`](../docs/runbooks/ha-capacity.md)。

### 透過 docker compose 一鍵啟動服務棧 + k6

`docker-compose.load-test.yml` 是覆蓋檔，需疊加在基礎 `docker-compose.yml` 之上：

```bash
docker compose -f docker-compose.yml -f docker-compose.load-test.yml up \
  --abort-on-container-exit --exit-code-from k6
```

此指令會啟動完整的 postgres / redis / migrate / api / game 服務棧，並以 `grafana/k6` 容器執行 `api-load.js`。需先設定 `PG_PASSWORD` / `JWT_SECRET` 等環境變數（或透過 `.env`），與基礎 compose 相同。要更換執行的腳本或參數，請修改 `docker-compose.load-test.yml` 中 `k6` 服務的 `command` 與環境變數。

## 環境變數

| 變數                    | 預設值                                                     | 說明                                                                                                       |
| ----------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `BASE_URL`              | `http://localhost:3001`                                    | API server 位址（`api-load`、`auth`、`matchmaking` 使用）。                                                |
| `WS_URL`                | `ws://localhost:3000/socket.io/?EIO=4&transport=websocket` | game server WebSocket 位址（`websocket-load` 使用）。                                                      |
| `WS_HOLD_MS`            | `90000`                                                    | 每條 WebSocket 連線持有的毫秒數。                                                                          |
| `LOGIN_EMAIL`           | _(空)_                                                     | 認證 / 配對測試共用的登入 email；未設則每個 VU 註冊臨時帳號。                                              |
| `LOGIN_PASSWORD`        | `loadtest123`                                              | 登入密碼。                                                                                                 |
| `MM_POLL_TIMES`         | `5`                                                        | 配對測試輪詢狀態的次數。                                                                                   |
| `MM_POLL_INTERVAL`      | `1`                                                        | 配對測試每次輪詢間隔（秒）。                                                                               |
| `DEBUG`                 | _(空)_                                                     | 設為任意值時印出 WebSocket 除錯訊息。                                                                      |
| `OBSERVED_PEAK_RPS`     | _(required)_                                               | 從 telemetry 取得的實測 peak；`operational-soak` 用它乘上 `PEAK_MULTIPLIER`。                              |
| `PEAK_MULTIPLIER`       | `2`                                                        | 容量 gate 倍率。                                                                                           |
| `SOAK_DURATION`         | `2h`                                                       | Operational soak 持續時間。                                                                                |
| `TARGET_URLS`           | _(required)_                                               | 逗號分隔的 representative workload URLs；沒有設定時只可用 `ALLOW_READINESS_ONLY=true` 做 readiness smoke。 |
| `WS_TARGET_CONNECTIONS` | `200`                                                      | WebSocket 目標並發。                                                                                       |
| `WS_RAMP_DURATION`      | `30s`                                                      | WebSocket ramp up/down 時間。                                                                              |
| `WS_SOAK_DURATION`      | `60s`                                                      | WebSocket 穩定持有階段；production gate 設 `2h`。                                                          |

## 閾值（thresholds）解讀

k6 的 `thresholds` 定義測試通過條件；若任一閾值未達標，k6 會以非零退出碼結束（適合 CI 判定）。

- `http_req_duration: ['p(95)<500', 'p(99)<1000']` — 95% 請求在 500ms 內完成、99% 在 1s 內完成。
- `http_req_failed: ['rate<0.05']` — 錯誤率（非 2xx）低於 5%。
- `ws_connecting: ['p(95)<2000']` — 95% WebSocket 連線在 2s 內建立。
- `ws_connect_success: ['rate>0.99']` — 至少 99% 的連線嘗試必須成功，不能只看成功連線的 latency。
- `ws_msgs_received: ['count>0']` — 至少收到一則訊息（確認連線雙向可用）。
- `auth_success: ['rate>0.95']` — 認證成功率 > 95%。
- `auth_refresh_success: ['rate>0.95']` — refresh token 成功率 > 95%。
- `mm_join_success: ['rate>0.9']` — 加入佇列成功率 > 90%。
- `mm_matched: ['rate>0.9']` — 配對成功率 > 90%。

未通過時請檢視 k6 摘要中標示 `✗` 的指標，並對照下方「已知限制」判斷是系統瓶頸還是測試環境限制。

## 已知限制

- **API 速率限制**：API server 對每個 IP 限制 120 req/min（一般 endpoint）、10 req/min（`/api/login`、`/api/register`）。從單一來源 IP 高並發施壓會觸發 `429 Too Many Requests`，導致錯誤率上升。這代表瓶頸在限流；要測得真實服務容量，請在測試環境調高限流（`RATE_LIMIT_DEFAULT` / `RATE_LIMIT_AUTH` 於 `api/server.cjs`）或從多個來源 IP 分散請求。
- **WebSocket 連線數限制**：game server 預設 `MAX_CONN_PER_IP=10`，單一 IP 超過即被 disconnect。進行 200/500 並發連線測試前請提高該值。
- **配對需成對玩家**：matchmaking 需兩兩配對才能成立；奇數玩家會停留在佇列直到 timeout，`mm_matched` 比例會偏低。
- **認證測試的資料庫污染**：未指定 `LOGIN_EMAIL` 時，每個 VU 會註冊臨時帳號，建議僅在可拋棄的測試環境使用。
