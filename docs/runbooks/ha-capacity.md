# 高可用與容量基線

## 現況與適用範圍

基礎 `docker-compose.yml` 的 PostgreSQL 與 Redis 都是單 instance。AOF、restart policy、health check 能改善單機重啟，但不構成高可用，也不能證明 [`SLO.md`](../SLO.md) 的 RPO/RTO。單機 Compose 只適合開發、CI 或明確標示風險的 beta。

本文件定義 production 驗收門檻。實際 provider、region、instance class、測試日期與證據連結必須填入演練報告後，才能宣稱完成。

## Production 拓撲門檻

### PostgreSQL

- 使用跨 availability zone 的 managed PostgreSQL，或同等的 primary + synchronous standby；應用只連 provider 提供的可 failover writer endpoint。
- 啟用 TLS、storage encryption、automatic failover、continuous WAL archive 與 immutable/encrypted off-site backup。
- `max_connections` 必須以 replica 數與 pool 上限計算，並保留至少 20% 給 migration、監控、restore 與事故操作。production 應透過 PgBouncer transaction pooling 控制連線放大。
- 監控 replication lag、WAL archive age、storage、connection saturation、deadlock、long transaction 與 checkpoint 壓力。
- Failover 驗收必須包含：進行中的 match 寫入中斷、應用 reconnect、outbox 冪等重送、沒有重複 `source_match_id`，以及實測 RTO/RPO。

目前預設每個 replica 的最壞連線預算如下，若調整 pool 必須同步更新此表：

| Service                    | 預設 pool 上限 / replica | 備註                                |
| -------------------------- | -----------------------: | ----------------------------------- |
| API                        |                       20 | `PG_POOL_MAX`                       |
| Game match state           |                       20 | `PostgresAdapter`, `PG_POOL_MAX`    |
| Game card loader           |                        5 | `GAME_CARD_PG_POOL_MAX`，預設最多 5 |
| Platform auth/schema       |                        8 | `PLATFORM_AUTH_DB_POOL_MAX`         |
| Platform friend store      |                        5 | `PLATFORM_PG_POOL_MAX`              |
| Platform block store       |                        5 | `PLATFORM_PG_POOL_MAX`              |
| Platform participant store |                        5 | `PLATFORM_PG_POOL_MAX`              |
| Platform chat preview      |                        5 | `PLATFORM_PG_POOL_MAX`              |

兩個 API、game、platform replicas 在預設值下最多需要 `2 * (20 + 25 + 28) = 146` 條應用連線，尚未包含 migration/exporter/管理保留。未部署 PgBouncer 前，不應直接用 PostgreSQL 預設 100 connections 啟動這個拓撲。

### server4 controlled-beta 例外預算

[`docker-compose.server4-slot.yml`](../../docker-compose.server4-slot.yml) 為現有 `max_connections=100` 的單機 controlled-beta 明確降低 pool，並由 container labels 宣告 reservation：

| 每個 slot 的服務   | replicas | 每 replica 上限 | slot 小計 |
| ------------------ | -------: | --------------: | --------: |
| Game web           |        2 |               3 |         6 |
| API web            |        2 |               2 |         4 |
| Platform p1/p2     |        2 |               5 |        10 |
| Stable game worker |        1 |               3 |         3 |
| Stable API worker  |        1 |               2 |         2 |

一個 web slot 是 20 connections；只有 stable slot 擁有的兩個 worker 再保留 5。Blue + green + 單一 worker owner 的宣告上限為 45。`scripts/deploy-server4-canary.sh` 在 migration 或啟 worker 前會讀取 PostgreSQL 的真實 max/reserved/current connections、既有 managed labels 與 legacy game/API 的 45-connection reservation，再額外保留 2 條 transient 連線及至少 20 條事故操作 headroom。它刻意把目前開啟的已知連線和宣告 pool 上限重複計算，寧可保守阻擋。

2026-07-14 server4 唯讀 preflight：`max_connections=100`、`superuser_reserved_connections=3`、7 條 database connections。Bootstrap blue web slot 的保守投影為 `7 current + 45 legacy + 20 blue + 2 transient + 20 headroom = 94 / 97 usable`；legacy 還在時啟 worker 或第二個 warm slot會被 gate 阻擋。OpenResty 切到 gateway、停止 legacy game/API 後，才能把 workers 交給 blue，之後才允許 stage green。這是單機 beta envelope，不等於上述 managed multi-AZ production 門檻。

### Redis

- 使用跨 zone managed Redis primary + replica 並啟用 automatic failover；應用只連 stable primary endpoint。
- 啟用 TLS、ACL/password、AOF `everysec`（若 provider 支援）、定期 snapshot 與 `noeviction`。禁止與其他產品共用相同 logical DB/cluster。
- 監控 replication lag、failover state、memory fragmentation、eviction、rejected connections、blocked clients、AOF rewrite 與 command latency。
- Redis 是 presence、matchmaking、rate limit 與 revocation 快速路徑。故障演練必須驗證安全控制的 fail-closed 行為、既有 WebSocket reconnect、queue 清理，以及 Redis 恢復後沒有重複配對。
- `ioredis`、Colyseus Redis driver/presence 與 Socket.IO adapter 必須在選定 provider 的 failover endpoint 上實測；不能只以單 container restart 代替 provider failover。

### Stateless services

- API、game、platform 各至少兩個 replicas，分散到兩個 failure domains。
- Edge/load balancer 只送流量到 `/ready` 為 200 的 instance；`/health` 用於診斷，不可代替 readiness。
- SIGTERM 後 instance 先進入 draining、停止接受新 HTTP/room，再等待 WebSocket grace period。部署層 termination grace 必須大於 `SHUTDOWN_TIMEOUT_MS`。
- Game 使用 PostgreSQL state、Redis Socket.IO adapter 與 boardgame pub/sub；platform 使用 Redis driver/presence。擴容前要驗證跨 replica 建房、加入、重連與完成對局。

## 容量驗收

先從 production telemetry 記錄最近 30 天 peak，而不是以任意 VU 數宣稱容量：

| 指標                          | 實測 baseline |             2x gate |                  Hard stop |
| ----------------------------- | ------------: | ------------------: | -------------------------: |
| HTTP requests/s               |          待填 | `2 * observed peak` | 5xx >= 1% 或 p95 >= 500 ms |
| Concurrent WebSockets         |          待填 | `2 * observed peak` |    reconnect success < 99% |
| Matchmaking joins/s           |          待填 | `2 * observed peak` |           queue age > 60 s |
| Completed matches/min         |          待填 | `2 * observed peak` |  outbox oldest age > 300 s |
| PostgreSQL active connections |          待填 |       <= 70% budget |       >= 80% max for 5 min |
| Redis memory                  |          待填 |    <= 70% maxmemory |           >= 80% maxmemory |

Release 前需要兩份不同證據：

1. 2x peak 測試至少 30 分鐘，所有 HTTP/WebSocket/match SLO threshold 通過。
2. 2 小時 soak，沒有 memory/connection/room/outbox 單調成長，結束後 error budget 未超標。

使用 [`load-tests/README.md`](../../load-tests/README.md) 的命令，保存 k6 JSON summary、Prometheus snapshot、image digest、環境規格與測試時間。測試環境必須與 production 拓撲相同；在單機 laptop 通過不能當作 production 容量證據。

## Failover / chaos 驗收矩陣

| 注入                        | 必須觀察                                               | 通過條件                                            |
| --------------------------- | ------------------------------------------------------ | --------------------------------------------------- |
| Game replica SIGTERM        | readiness、WS disconnect/reconnect、active sockets     | 新流量先停止；玩家在期限內恢復；沒有遺失完成結果    |
| Platform replica SIGTERM    | room lock/dispose、reconnect counter                   | 不建立新 room；client 可重連另一 replica            |
| Redis managed failover      | command errors、rate-limit/revocation、queue、presence | 安全控制不放行；恢復後無 duplicate match            |
| PostgreSQL managed failover | pool errors、outbox、match state                       | writer endpoint 恢復；outbox 冪等；RTO/RPO 有時間戳 |
| Restore to point in time    | checksum、WAL target、row counts                       | 達到 [`SLO.md`](../SLO.md) 且完整 smoke 通過        |

每次演練報告必須記錄 owner、UTC timeline、注入方法、版本 digest、實測 MTTA/MTTR/RPO/RTO、alert delivery，以及所有未通過項目的 issue。沒有報告即視為未驗證。
