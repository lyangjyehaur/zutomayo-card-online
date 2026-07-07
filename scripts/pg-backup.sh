#!/usr/bin/env bash
# PostgreSQL automated backup script for ZUTOMAYO CARD Online.
#
# Usage:
#   ./scripts/pg-backup.sh
#
# Environment variables:
#   PG_HOST                 PostgreSQL host (default: localhost)
#   PG_PORT                 PostgreSQL port (default: 5432)
#   PG_USER                 PostgreSQL user (default: zutomayo)
#   PG_PASSWORD             PostgreSQL password (required)
#   PG_DATABASE             PostgreSQL database (default: zutomayo)
#   PG_BACKUP_DIR           Backup output directory (default: /var/backups/zutomayo)
#   PG_BACKUP_RETENTION_DAYS  Delete backups older than N days (default: 7)
#
# Cron example (daily at 03:00):
#   0 3 * * * PG_PASSWORD=secret /path/to/scripts/pg-backup.sh >> /var/log/zutomayo-backup.log 2>&1
set -euo pipefail;

PG_HOST="${PG_HOST:-localhost}";
PG_PORT="${PG_PORT:-5432}";
PG_USER="${PG_USER:-zutomayo}";
PG_DATABASE="${PG_DATABASE:-zutomayo}";
BACKUP_DIR="${PG_BACKUP_DIR:-/var/backups/zutomayo}";
RETENTION_DAYS="${PG_BACKUP_RETENTION_DAYS:-7}";

if [ -z "${PG_PASSWORD:-}" ]; then
  echo "[$(date)] ERROR: PG_PASSWORD is required" >&2;
  exit 1;
fi

mkdir -p "$BACKUP_DIR";

TIMESTAMP=$(date +%Y%m%d_%H%M%S);
BACKUP_FILE="$BACKUP_DIR/zutomayo_${TIMESTAMP}.sql.gz";

echo "[$(date)] Starting backup to $BACKUP_FILE";
PGPASSWORD="$PG_PASSWORD" pg_dump \
  -h "$PG_HOST" \
  -p "$PG_PORT" \
  -U "$PG_USER" \
  -d "$PG_DATABASE" \
  --no-owner --no-privileges \
  | gzip > "$BACKUP_FILE";

echo "[$(date)] Backup completed: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))";

# Clean up backups older than retention period
find "$BACKUP_DIR" -name 'zutomayo_*.sql.gz' -mtime "+$RETENTION_DAYS" -delete;
echo "[$(date)] Cleaned up backups older than $RETENTION_DAYS days";
