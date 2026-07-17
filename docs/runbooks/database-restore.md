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

腳本會使用 PostgreSQL custom format、執行 `pg_restore --list`、age encryption、SHA-256 sidecar，再上傳 artifact 與 checksum。Encrypted artifact 的 S3 object metadata 會寫入不可變的 `recovery-point-at`，其值在 `pg_dump` 前取得；restore evidence 以它計算真實資料落後時間，不能改用下載時間或 object `LastModified` 冒充 recovery point。Object-store 複製、replication 與 lifecycle 必須保留這個 metadata。未設定 off-site/encryption 時預設失敗；`PG_BACKUP_ALLOW_LOCAL_ONLY=true` 與 `PG_BACKUP_ALLOW_UNENCRYPTED=true` 只可用於可丟棄的本機環境。

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

Repository 以 signed `OPS_IMAGE` 執行 live gate，不依賴 server4 host 安裝 `psql`、`pg_waldump`、age 或 AWS CLI。`PG_WAL_OPERATOR_USER` 只能連 application database、不能使用 `public` schema/table，也不能直接呼叫 `pg_catalog.pg_switch_wal()`；bootstrap superuser 建立固定 body/search path 的 `zutomayo_ops.switch_wal()` SECURITY DEFINER wrapper，migration gate只驗證 owner/body/ACL。密碼只放在 PGPASS file，不能放在 argv 或環境變數：

```bash
export OPS_IMAGE='ghcr.io/.../zutomayo-card-online-ops@sha256:<verified-digest>'
export PG_WAL_OPERATOR_USER=zutomayo_wal_operator
export PG_WAL_OPERATOR_DATABASE=zutomayo_card
export PG_WAL_OPERATOR_PGPASS_FILE=/etc/zutomayo/secrets/postgres-operator.pgpass
export PG_WAL_AGE_IDENTITY_FILE=/etc/zutomayo/secrets/wal-age-identity
export PG_WAL_S3_CREDENTIALS_FILE=/etc/zutomayo/secrets/wal-s3-credentials
export POSTGRES_OPS_SECRETS_GID=<dedicated-host-group-gid>
docker compose -f docker-compose.postgres-ops.yml --profile postgres-ops run --rm postgres-wal-operational-smoke
```

Gate 會先強制要求 `verify-full` 與可讀 CA，比對 `current_user`，並從當前 backend 的 `pg_stat_ssl` 驗證 TLS version/cipher；接著驗證 `archive_mode`、`wal_level` 與 `archive_command`，記錄 `pg_stat_archiver` baseline，強制切換 WAL，要求 archived counter 前進且 failed counter 不增加，最後透過正式 off-site restore command 取回同一個 segment，驗證 segment size 與 `pg_waldump`。輸出 JSON 不含 host、user、password 或 provider 錯誤原文。這是 archive/restore 路徑的 live smoke，不能取代下方的隔離 PITR drill。

OPS image 只驗證既有 pipeline，**不會**替 PostgreSQL 開啟 continuous archive。server4 在通過 gate 前仍須安排維護窗口，設定 `wal_level=replica`、`archive_mode=on`、`archive_timeout` 與實際 `archive_command`（或完成 managed provider PITR），把 archive script、age recipient、只寫 object-store credentials 提供給 PostgreSQL archive execution environment，然後重啟並驗證。production DB container 尚未具備這些條件時，部署必須維持 blocked；不得把 OPS restore runner或 local trust當成 archive enablement。

PGPASS、age identity、S3 credentials 三檔必須是 `root:<POSTGRES_OPS_SECRETS_GID>`、mode `0440`。OPS entrypoint 驗證後會把 PGPASS 複製到 container tmpfs，改為 OPS UID 所有、mode `0600` 再交給 libpq；libpq 不會直接讀取 group-readable source。OPS Compose 使用 `create_host_path: false`、non-root UID、補充唯讀 group、read-only rootfs、無 capabilities；任一檔案、owner/group/mode、CA、URI 或 immutable digest 缺失都 fail closed。

## Weekly isolated restore drill

`PG_RESTORE_DRILL_IMAGE` 必須是明確 digest，不能使用 `latest` 或 floating major tag：

```bash
export PG_BACKUP_AGE_IDENTITY_FILE=/run/secrets/backup-age-identity
export PG_RESTORE_DRILL_IMAGE='postgres@sha256:<approved-digest>'
export PG_BACKUP_METRICS_DIR=/var/lib/node_exporter/textfile_collector
export PG_RESTORE_DRILL_REPORT_DIR=/var/log/zutomayo/restore-drills
export PG_RESTORE_DRILL_ARTIFACT_DIR=artifacts/encrypted-offsite-restore
export RELEASE_SHA='<full-40-character-release-sha>'
export EXPECTED_SCHEMA_MIGRATION=000033_admin_linked_auth_contract
export EXPECTED_SCHEMA_CHECKSUM=3e1140398d4b9de39cf3e95dfac626fc50ac587127c5c556e9e9ad3b63489c45
export MIGRATE_IMAGE='ghcr.io/.../zutomayo-card-online-migrate@sha256:<release-manifest-digest>'
export PG_RESTORE_DRILL_OBJECT_VERSION_ID='<backup-object-version-from-upload-receipt>'
export PG_RESTORE_DRILL_CHECKSUM_VERSION_ID='<checksum-object-version-from-upload-receipt>'
export PG_RESTORE_DRILL_RUN_ID="release-${RELEASE_SHA:0:12}"
./scripts/pg-restore-drill.sh s3://zutomayo-prod-backups/logical/zutomayo_<timestamp>.dump.age
```

兩個 version ID 必須來自有記錄 version 的 uploader receipt、object-store audit log 或不可變更 inventory，不得在 drill 當下改查 latest；S3 的 mutable `null` version 也不接受。腳本以兩次 `aws s3api get-object --version-id` 精確下載 encrypted artifact 與 checksum sidecar，並要求兩次 response 的 `VersionId` 精確確認 requested version；缺任一 version ID 都會在 AWS 呼叫前失敗。Artifact response 還必須包含合法 `recovery-point-at` metadata 與 `LastModified`；evidence 分別記錄 `recoveryPointAt`、`objectLastModifiedAt`，不可互換。Drill 的 `startedAt` 在下載前、`finishedAt` 在隔離 container 清理後，涵蓋 checksum、age decrypt、restore 與全部查核。

Drill 會在 `--network none` 且不注入資料庫密碼的一次性 PostgreSQL container 還原，並檢查：

- `EXPECTED_SCHEMA_MIGRATION` 必須同時存在於 `schema_migrations`，並在 `schema_migration_checksums` 精確匹配 `EXPECTED_SCHEMA_CHECKSUM`。
- `cards` 不為空。
- `users` / `matches` 可查詢並記錄 row count。
- `relationship_change_outbox` status 只允許已定義狀態，且沒有未驗證的 PostgreSQL constraint。
- 還原資料不能出現 active legal hold 已完成刪帳，或 deleted account 殘留 friend/request/block 關係。
- Evidence 的 schema block 必須精確綁定 `.release.env` 的 migration basename、checksum 與 `MIGRATE_IMAGE` digest；`observations` 會保留 schema migration、expected binding、users/cards/matches/outbox/legal-hold row counts，以及 constraint/outbox/legal-hold violation counts，pass booleans 由這些實測值重算。
- 完成後保留 timestamped 人類報告與 `pg_restore_drill_*` metrics，並原子產生 `encrypted-offsite-restore-<run-id>.json`。JSON 不含 credential，只會在 download/checksum/decrypt/restore/schema/core-data/legal-hold 全部成功後出現。

本機檔案模式仍可用於開發檢查，但不會產生正式 off-site release evidence。排程系統必須保留 stdout/stderr、exit code 與 report。只有 script exit 0、metric 為 1、evidence artifact 存在且 alert 正常恢復才算一次正式 drill。

## Disposable physical PITR release drill

重大資料庫變更或 release 前，使用 repository 的隔離 Compose stack 實際執行 `pg_basebackup`、`pg_verifybackup`、WAL archive replay 與 named restore point。腳本預設使用 pinned PostgreSQL 16 digest，不 publish port、不連線 production；`RELEASE_SHA` 未提供時會綁定目前 Git HEAD：

```bash
export RELEASE_SHA="$(git rev-parse HEAD)"
export EXPECTED_SCHEMA_MIGRATION=000033_admin_linked_auth_contract
export EXPECTED_SCHEMA_CHECKSUM=3e1140398d4b9de39cf3e95dfac626fc50ac587127c5c556e9e9ad3b63489c45
export PG_PITR_DRILL_MIGRATE_IMAGE='ghcr.io/.../zutomayo-card-online-migrate@sha256:<release-manifest-digest>'
export PG_PITR_RUN_ID="release-${RELEASE_SHA:0:12}"
export PG_PITR_DRILL_ARTIFACT_DIR="artifacts/pg-pitr-drill/$PG_PITR_RUN_ID"
./scripts/pg-pitr-drill.sh
```

`PG_PITR_DRILL_MIGRATE_IMAGE`（或同值的 `MIGRATE_IMAGE`）是必要輸入，必須直接取自同一份 verified release manifest。Host runner 只會 pull 這個 immutable digest，不會從目前 working tree build migration image。Artifact directory 必須是尚不存在且非 symlink 的 unique path；host 原子建立為 `0700`，再由一次性 init container 改成 `postgres:<PG_PITR_ARTIFACT_GID>`、`0770`，不得改成 world-writable。

成功結果 `pitr-drill-<run-id>.json` 可直接作為 release gate 的 physical PITR mechanics `rawArtifact`，不需要另行轉換。固定 envelope 為 `schemaVersion: 1`、`artifactType: "zutomayo-restore-drill-raw"`、完整 `releaseSha`、`startedAt` 與 `finishedAt`。`restore` 會記錄 PITR target、最後 replay transaction 時間、base-backup manifest SHA-256 與 PostgreSQL log 證明實際 restore 的 unique WAL segment 數；`checks` 直接提供 gate 要求的 `schemaGatePassed`、`fixtureRoundTripPassed` 與 `legalHoldInvariantPassed`，記錄 `migrateImage`，並保留 marker 與實際 schema/core/legal-hold invariant counts。這個 disposable/local/trust drill 沒有走正式 encrypted off-site object，不能單獨讓 restore gate 通過。

提交 staging evidence 時，`rawArtifact` 必須引用該 PITR JSON 並提供實際 SHA-256；另以 `scripts/pg-restore-drill.sh` 直接產生不同檔案與 hash 的 `offsiteArtifact`。它採 `artifactType: "zutomayo-encrypted-offsite-restore-raw"`，記錄同一 `releaseSha`、涵蓋整段執行的起訖時間、versioned `s3://` object URL、artifact/checksum 各自確認過的 version ID、`recoveryPointAt`、`objectLastModifiedAt`、`encryptionScheme: "age"`、artifact SHA-256，以及實際導出的 `checksumVerified`、`decryptSucceeded`、isolated restore、expected migration/checksum/migrate-image schema binding、core-data 與 legal-hold observations。Physical PITR raw 的 marker replay 負責 `fixtureRoundTripPassed`；off-site logical restore 不再冒稱完成同一項測試。兩個 reference 都必須存在於 `artifacts[]`，兩段時間都要落在外層 `staging/restore-drill.json` interval。

Release gate 分別重算 physical RPO（`targetAt - recoveredThroughAt`）與 off-site RPO（restore `startedAt - recoveryPointAt`），以及兩邊各自的 RTO（各 artifact `finishedAt - startedAt`）；外層 `rpoMinutes`、`rtoMinutes` 必須各自填兩條路徑的最差值。任一最差值超過 repository threshold、手動修改 summary、缺少 metadata 或獨立 off-site proof 時都維持 `blocked`。

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
