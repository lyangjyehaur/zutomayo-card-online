# PostgreSQL Backup / PITR / Restore Runbook

## 目標與限制

- Production 目標：帳號、牌組、完成對局與排名 RPO 15 分鐘、RTO 30 分鐘；完整資料庫 60 分鐘內通過驗證。
- Repository 提供可重複的加密備份、WAL archive 與 isolated restore drill 工具，但沒有在指定 provider 實測前，不代表已達到 RPO/RTO。
- 還原一律在新 instance / 新 data directory 進行。不得直接覆寫故障 primary；先保留 snapshot 與 WAL 供調查。

## 金鑰與權限

1. age recipient 公鑰可放在 backup host；private identity 只能放在 restore runner/secret manager，不能放進 image、repository 或一般 app container。
2. 建立 least-privilege logical backup role，以及只供 `pg_basebackup`/replication protocol 使用的 replication role。
3. S3-compatible bucket 啟用 server-side encryption、versioning/object lock、跨帳號或跨 region replication；backup role 只有 put/head，restore role只有 read。
4. 所有 artifact 與 `.sha256` sidecar 必須一起保存。任何 checksum 不符都應停止，不得嘗試「修復」檔案。

## 排程基線

| 工作                           | 建議頻率                     | Script / metric                                                             |
| ------------------------------ | ---------------------------- | --------------------------------------------------------------------------- |
| Encrypted logical dump         | 每日                         | `scripts/pg-backup.sh`; `pg_backup_last_success_unixtime_seconds`           |
| Encrypted physical base backup | 每週及重大 migration 前      | `scripts/pg-base-backup.sh`; `pg_base_backup_last_success_unixtime_seconds` |
| Encrypted WAL archive          | 連續，`archive_timeout=300s` | `scripts/pg-wal-archive.sh`; `pg_wal_archive_last_success_unixtime_seconds` |
| Isolated logical restore drill | 每週                         | `scripts/pg-restore-drill.sh`; `pg_restore_drill_success`                   |
| Full PITR/failover drill       | 每季及重大 DB 變更前         | 本 runbook + 演練報告                                                       |

Prometheus 的 backup age alert 依賴 node-exporter textfile collector。Backup host 與 `docker-compose.monitoring.yml` 必須使用同一個 `PG_BACKUP_METRICS_DIR`。

Repository 提供 `ops/systemd/` 的 scheduler template。Production host 應安裝並啟用 daily logical 與 weekly physical timer（或使用等價的 managed scheduler），並把 service exit code、artifact URI、checksum 與 alert delivery 接到值班系統：

```bash
sudo install -m 0644 ops/systemd/zutomayo-pg-backup.service ops/systemd/zutomayo-pg-backup.timer /etc/systemd/system/
sudo install -m 0644 ops/systemd/zutomayo-pg-base-backup.service ops/systemd/zutomayo-pg-base-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now zutomayo-pg-backup.timer zutomayo-pg-base-backup.timer
systemctl list-timers 'zutomayo-pg-*'
```

`/etc/zutomayo/backup.env` 與 age/S3/PG secrets 必須由 host secret manager 提供；不要把它們寫入 unit 或 repository。Restore drill 應由隔離 runner 每週執行，不能直接在 production database host 內覆寫資料。

## Logical encrypted backup

必要設定：

```bash
export PG_HOST=db-writer.internal
export PG_BACKUP_USER=zutomayo_backup
export PGPASSFILE=/run/secrets/pgpass
export PG_DATABASE=zutomayo
export PG_BACKUP_AGE_RECIPIENT_FILE=/run/secrets/backup-age-recipients
export PG_BACKUP_OFFSITE_URI=s3://zutomayo-prod-backups/logical
export PG_BACKUP_METRICS_DIR=/var/lib/node_exporter/textfile_collector
./scripts/pg-backup.sh
```

腳本會使用 PostgreSQL custom format、執行 `pg_restore --list`、age encryption、SHA-256 sidecar，再上傳 artifact 與 checksum。未設定 off-site/encryption 時預設失敗；`PG_BACKUP_ALLOW_LOCAL_ONLY=true` 與 `PG_BACKUP_ALLOW_UNENCRYPTED=true` 只可用於可丟棄的本機環境。

## Self-managed WAL/PITR

Managed PostgreSQL 應優先使用 provider 的 continuous backup/PITR。自管 PostgreSQL 才使用下列基線：

```conf
wal_level = replica
archive_mode = on
archive_timeout = 300s
archive_command = '/opt/zutomayo/scripts/pg-wal-archive.sh %p %f'
```

PostgreSQL service 必須注入 `PG_WAL_OFFSITE_URI`、age recipient 與只可上傳的 object-store credential。先執行一次 physical base backup：

```bash
export PG_WAL_USER=zutomayo_wal
export PG_BASE_BACKUP_OFFSITE_URI=s3://zutomayo-prod-backups/base
./scripts/pg-base-backup.sh
```

每次修改 archive command 後，用 `SELECT pg_switch_wal();` 產生 WAL，確認 artifact/checksum、success metric 與 alert recovery。僅看到 `archive_mode=on` 不算驗收。

## Weekly isolated restore drill

`PG_RESTORE_DRILL_IMAGE` 必須是明確 digest，不能使用 `latest` 或 floating major tag：

```bash
export PG_BACKUP_AGE_IDENTITY_FILE=/run/secrets/backup-age-identity
export PG_RESTORE_DRILL_IMAGE='postgres@sha256:<approved-digest>'
export PG_BACKUP_METRICS_DIR=/var/lib/node_exporter/textfile_collector
export PG_RESTORE_DRILL_REPORT_DIR=/var/log/zutomayo/restore-drills
./scripts/pg-restore-drill.sh s3://zutomayo-prod-backups/logical/zutomayo_<timestamp>.dump.age
```

Drill 會驗證 SHA-256、解密、在不 expose port 的一次性 PostgreSQL container 還原，並檢查：

- `schema_migrations` 至少一筆。
- `cards` 不為空。
- `users` / `matches` 可查詢並記錄 row count。
- 完成後產生 timestamped report 與 `pg_restore_drill_*` metrics。

排程系統必須保留 stdout/stderr、exit code 與 report。只有 script exit 0、metric 為 1、alert 正常恢復才算一次成功 drill。

## Point-in-time recovery

1. 宣告 incident，停止寫入入口並記錄 UTC restore target。保留故障 DB snapshot、timeline 與 release digest。
2. 選擇 target 前最近一份 base backup，下載 encrypted artifact 與 checksum；先驗證 checksum，再以 age identity 解密。
3. 在全新的 PostgreSQL instance/data directory 解開 bundle；依 `pg_basebackup` tar layout 解開 `base.tar.gz` 與 `pg_wal.tar.gz`，還原 owner/permission。
4. 設定：

   ```conf
   restore_command = '/opt/zutomayo/scripts/pg-wal-restore.sh %f %p'
   recovery_target_time = '<UTC timestamp>'
   recovery_target_action = 'pause'
   ```

5. 建立 `recovery.signal`，以隔離網路啟動 PostgreSQL。檢查 recovery log 沒有 missing WAL/checksum/decryption error。
6. 到達 target 後保持 paused，以唯讀連線檢查 `schema_migrations`、核心 row counts、最新 match 時間、foreign keys 與重複 `source_match_id`。
7. 確認 target 正確才 promote。用 migration image digest 做 schema gate；只允許 forward-compatible migration，不以 destructive down migration修資料。
8. 啟動單一 staging replica，執行登入、牌組、歷史、建房、雙方加入、完整對局、聊天與 ranked outbox smoke。
9. 執行 retention/legal-hold reconciliation，避免已刪除或過期資料因 restore 復活。
10. 建立切換前 checkpoint；先 canary read，再恢復 write 與全部 replicas。觀察至少 30 分鐘。

若有 tablespace、extension 或 provider-specific encryption，先在 staging 演練相同 layout。不能在 incident 中首次猜測還原方式。

## 驗收紀錄

每份演練報告至少包含：

- Backup/base/WAL IDs、SHA-256、key version、object version、source/target region。
- Restore target、實測 RPO/RTO、開始/完成 UTC、operator、image digest。
- Schema version、users/cards/decks/matches/outbox row counts與 integrity query。
- Login/deck/history/create/join/full-match/chat smoke 結果。
- `/health`、`/ready`、5xx、DB pool waiting、outbox oldest age 與 alert delivery/recovery。

未達 [`SLO.md`](../SLO.md) 時開 release-blocking issue；不得只修改文件中的目標數字來標示完成。
