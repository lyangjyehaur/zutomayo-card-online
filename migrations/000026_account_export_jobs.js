/** Durable asynchronous DSAR export jobs and their compliance audit trail. */
export const shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const up = (pgm) => {
  pgm.createTable(
    'account_export_jobs',
    {
      id: { type: 'text', primaryKey: true },
      user_id: { type: 'text', notNull: true, references: 'users(id)', onDelete: 'RESTRICT' },
      status: { type: 'text', notNull: true, default: 'queued' },
      format_version: { type: 'smallint', notNull: true, default: 1 },
      object_key: { type: 'text', unique: true },
      object_version_id: { type: 'text' },
      content_sha256: { type: 'text' },
      size_bytes: { type: 'bigint' },
      uncompressed_size_bytes: { type: 'bigint' },
      attempt_count: { type: 'integer', notNull: true, default: 0 },
      max_attempts: { type: 'integer', notNull: true, default: 5 },
      available_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      locked_at: { type: 'timestamptz' },
      lease_token: { type: 'text' },
      lease_expires_at: { type: 'timestamptz' },
      error_code: { type: 'text', notNull: true, default: '' },
      last_error: { type: 'text', notNull: true, default: '' },
      purge_attempt_count: { type: 'integer', notNull: true, default: 0 },
      purge_available_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      requested_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      snapshot_at: { type: 'timestamptz' },
      started_at: { type: 'timestamptz' },
      completed_at: { type: 'timestamptz' },
      expires_at: { type: 'timestamptz' },
      downloaded_at: { type: 'timestamptz' },
      download_count: { type: 'integer', notNull: true, default: 0 },
      purged_at: { type: 'timestamptz' },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
    {
      ifNotExists: true,
      constraints: {
        check: [
          "status IN ('queued', 'processing', 'ready', 'failed', 'expired')",
          'format_version = 1',
          'attempt_count >= 0',
          'max_attempts BETWEEN 1 AND 20',
          'attempt_count <= max_attempts',
          "error_code IN ('', 'too_large', 'user_missing', 'schema_error', 'storage_error', 'unknown')",
          'size_bytes IS NULL OR size_bytes >= 0',
          'uncompressed_size_bytes IS NULL OR uncompressed_size_bytes >= 0',
          'download_count >= 0',
          'purge_attempt_count >= 0',
          "content_sha256 IS NULL OR content_sha256 ~ '^[a-f0-9]{64}$'",
          "status <> 'processing' OR (lease_token IS NOT NULL AND locked_at IS NOT NULL AND lease_expires_at IS NOT NULL)",
          "status <> 'ready' OR (object_key IS NOT NULL AND content_sha256 IS NOT NULL AND size_bytes IS NOT NULL AND completed_at IS NOT NULL AND expires_at IS NOT NULL)",
          'expires_at IS NULL OR completed_at IS NULL OR expires_at > completed_at',
        ],
      },
    },
  );
  pgm.createIndex('account_export_jobs', ['user_id'], {
    ifNotExists: true,
    unique: true,
    name: 'uq_account_export_jobs_active_user',
    where: "status IN ('queued', 'processing')",
  });
  pgm.createIndex('account_export_jobs', ['status', 'available_at', 'lease_expires_at'], {
    ifNotExists: true,
    name: 'idx_account_export_jobs_delivery',
  });
  pgm.createIndex('account_export_jobs', ['user_id', { name: 'requested_at', sort: 'DESC' }], {
    ifNotExists: true,
    name: 'idx_account_export_jobs_user_requested',
  });
  pgm.createIndex('account_export_jobs', ['expires_at'], {
    ifNotExists: true,
    name: 'idx_account_export_jobs_expiry',
    where: "status = 'ready'",
  });
  pgm.createIndex('account_export_jobs', ['purge_available_at', 'expires_at'], {
    ifNotExists: true,
    name: 'idx_account_export_jobs_purge',
    where: 'object_key IS NOT NULL',
  });
  pgm.createIndex('account_export_jobs', ['updated_at'], {
    ifNotExists: true,
    name: 'idx_account_export_jobs_retention',
    where: "status IN ('failed', 'expired') AND object_key IS NULL AND object_version_id IS NULL",
  });

  pgm.createTable(
    'account_export_audit',
    {
      id: { type: 'bigserial', primaryKey: true },
      job_id: { type: 'text', references: 'account_export_jobs(id)', onDelete: 'SET NULL' },
      // Keep the pseudonymous subject identifier even if a future hard-delete
      // removes the users row. Compliance audit evidence must not cascade away.
      user_id: { type: 'text', notNull: true },
      event_type: { type: 'text', notNull: true },
      request_id: { type: 'text' },
      details: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
    {
      ifNotExists: true,
      constraints: {
        check:
          "event_type IN ('requested', 'processing', 'ready', 'retry_scheduled', 'failed', 'download_started', 'download_completed', 'download_interrupted', 'integrity_failed', 'expired', 'purged', 'purge_retry')",
      },
    },
  );
  pgm.createIndex('account_export_audit', ['job_id', 'created_at'], {
    ifNotExists: true,
    name: 'idx_account_export_audit_job_created',
  });
  pgm.createIndex('account_export_audit', ['user_id', 'created_at'], {
    ifNotExists: true,
    name: 'idx_account_export_audit_user_created',
  });
  pgm.createIndex('account_export_audit', ['created_at'], {
    ifNotExists: true,
    name: 'idx_account_export_audit_retention',
  });
  pgm.createIndex('account_export_audit', ['job_id', 'request_id', 'event_type'], {
    ifNotExists: true,
    unique: true,
    name: 'uq_account_export_audit_request_event',
    where: 'request_id IS NOT NULL',
  });
  pgm.createIndex('account_export_audit', ['job_id', 'request_id'], {
    ifNotExists: true,
    unique: true,
    name: 'uq_account_export_audit_request_terminal',
    where:
      "request_id IS NOT NULL AND event_type IN ('download_completed', 'download_interrupted', 'integrity_failed')",
  });
};

// The audit trail is compliance evidence. Rollback must preserve it and use a
// forward-compatible fix instead of dropping export jobs or download history.
export const down = false;
