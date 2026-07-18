/* global module */

const crypto = require('node:crypto');
const DEFAULT_EXPORT_EXPIRY_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_EXPORT_MAX_ATTEMPTS = 5;
const DEFAULT_EXPORT_LEASE_MS = 5 * 60 * 1000;
const DEFAULT_EXPORT_INTERVAL_MS = 1_000;
const DEFAULT_EXPORT_BATCH_SIZE = 2;
const ACCOUNT_EXPORT_ERROR_CODES = new Set(['too_large', 'user_missing', 'schema_error', 'storage_error', 'unknown']);

class AccountExportPermanentError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AccountExportPermanentError';
    this.code = code;
    this.permanent = true;
  }
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(number)));
}

function safeError(error) {
  const message = error instanceof Error ? error.message : String(error || 'Unknown account export failure');
  return message.replace(/[\r\n\t]+/g, ' ').slice(0, 1_000);
}

function normalizeAccountExportErrorCode(value, fallback = 'unknown') {
  const code = String(value || '').trim();
  return ACCOUNT_EXPORT_ERROR_CODES.has(code) ? code : fallback;
}

function normalizeJob(row) {
  if (!row) return null;
  const effectiveStatus =
    row.status === 'ready' && row.expires_at && new Date(row.expires_at).getTime() <= Date.now()
      ? 'expired'
      : row.status;
  return {
    id: row.id,
    status: effectiveStatus,
    formatVersion: Number(row.format_version) || 1,
    sizeBytes: row.size_bytes === null || row.size_bytes === undefined ? null : Number(row.size_bytes),
    uncompressedSizeBytes:
      row.uncompressed_size_bytes === null || row.uncompressed_size_bytes === undefined
        ? null
        : Number(row.uncompressed_size_bytes),
    contentSha256: row.content_sha256 || null,
    attemptCount: Number(row.attempt_count) || 0,
    maxAttempts: Number(row.max_attempts) || 0,
    requestedAt: row.requested_at,
    snapshotAt: row.snapshot_at || null,
    startedAt: row.started_at || null,
    completedAt: row.completed_at || null,
    expiresAt: row.expires_at || null,
    downloadedAt: row.downloaded_at || null,
    downloadCount: Number(row.download_count) || 0,
    errorCode: effectiveStatus === 'failed' ? row.error_code || 'unknown' : '',
  };
}

async function withClient(pool, operation) {
  const client = typeof pool.connect === 'function' ? await pool.connect() : pool;
  const release = typeof client.release === 'function' ? () => client.release() : () => undefined;
  try {
    return await operation(client);
  } finally {
    release();
  }
}

async function withTransaction(pool, operation) {
  return withClient(pool, async (client) => {
    await client.query('BEGIN');
    try {
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  });
}

async function insertAudit(client, { jobId, userId, eventType, details = {} }) {
  await client.query(
    `INSERT INTO account_export_audit (job_id, user_id, event_type, request_id, details)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT DO NOTHING`,
    [jobId, userId, eventType, details.requestId || null, JSON.stringify({ ...details, requestId: undefined })],
  );
}

async function createAccountExportJob({
  pool,
  userId,
  generateId = () => crypto.randomUUID(),
  maxAttempts = DEFAULT_EXPORT_MAX_ATTEMPTS,
  requestId,
}) {
  const attempts = boundedInteger(maxAttempts, DEFAULT_EXPORT_MAX_ATTEMPTS, 1, 20);
  return withTransaction(pool, async (client) => {
    const user = await client.query('SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL FOR SHARE', [userId]);
    if (!user.rows[0]) return { ok: false, status: 404, error: 'User not found' };

    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`zutomayo:account-export:${userId}`]);
    const existing = await client.query(
      `SELECT *
         FROM account_export_jobs
        WHERE user_id = $1
          AND (
            status IN ('queued', 'processing')
            OR (status = 'ready' AND expires_at > NOW())
          )
        ORDER BY requested_at DESC
        LIMIT 1`,
      [userId],
    );
    if (existing.rows[0]) return { ok: true, reused: true, body: { job: normalizeJob(existing.rows[0]) } };

    const id = generateId();
    const inserted = await client.query(
      `INSERT INTO account_export_jobs (id, user_id, max_attempts)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [id, userId, attempts],
    );
    await insertAudit(client, { jobId: id, userId, eventType: 'requested', details: { requestId } });
    return { ok: true, reused: false, body: { job: normalizeJob(inserted.rows[0]) } };
  });
}

async function listAccountExportJobs({ pool, userId, limit = 10 }) {
  const boundedLimit = boundedInteger(limit, 10, 1, 25);
  const result = await pool.query(
    `SELECT *
       FROM account_export_jobs
      WHERE user_id = $1
      ORDER BY requested_at DESC
      LIMIT $2`,
    [userId, boundedLimit],
  );
  return { ok: true, body: { jobs: result.rows.map(normalizeJob) } };
}

async function getAccountExportJob({ pool, userId, jobId, includeObjectKey = false }) {
  const result = await pool.query('SELECT * FROM account_export_jobs WHERE id = $1 AND user_id = $2 LIMIT 1', [
    jobId,
    userId,
  ]);
  if (!result.rows[0]) return { ok: false, status: 404, error: 'Account export not found' };
  const row = result.rows[0];
  return {
    ok: true,
    body: {
      job: normalizeJob(row),
      ...(includeObjectKey
        ? { objectKey: row.object_key || null, objectVersionId: row.object_version_id || null }
        : {}),
    },
  };
}

async function claimAccountExportJob({
  pool,
  leaseMs = DEFAULT_EXPORT_LEASE_MS,
  generateLeaseToken = () => crypto.randomBytes(24).toString('base64url'),
}) {
  const lease = boundedInteger(leaseMs, DEFAULT_EXPORT_LEASE_MS, 10_000, 30 * 60 * 1000);
  const leaseToken = generateLeaseToken();
  if (typeof leaseToken !== 'string' || leaseToken.length < 24)
    throw new Error('Account export lease token is invalid');
  return withTransaction(pool, async (client) => {
    const result = await client.query(
      `WITH candidate AS (
         SELECT id
           FROM account_export_jobs
          WHERE attempt_count < max_attempts
            AND (
              (status = 'queued' AND available_at <= NOW())
              OR (status = 'processing' AND lease_expires_at < NOW())
            )
          ORDER BY available_at ASC, requested_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
       )
       UPDATE account_export_jobs jobs
          SET status = 'processing',
              attempt_count = jobs.attempt_count + 1,
              started_at = COALESCE(jobs.started_at, NOW()),
              locked_at = NOW(),
              lease_token = $2,
              lease_expires_at = NOW() + ($1::bigint * INTERVAL '1 millisecond'),
              last_error = '',
              updated_at = NOW()
         FROM candidate
        WHERE jobs.id = candidate.id
       RETURNING jobs.*`,
      [lease, leaseToken],
    );
    const job = result.rows[0];
    if (!job) return null;
    await insertAudit(client, {
      jobId: job.id,
      userId: job.user_id,
      eventType: 'processing',
      details: { attempt: Number(job.attempt_count) },
    });
    return job;
  });
}

async function completeAccountExportJob({
  pool,
  jobId,
  leaseToken,
  objectKey,
  objectVersionId,
  contentSha256,
  sizeBytes,
  uncompressedSizeBytes,
  snapshotAt,
  expiresAt,
}) {
  return withTransaction(pool, async (client) => {
    const result = await client.query(
      `UPDATE account_export_jobs
          SET status = 'ready',
              object_key = $2,
              object_version_id = $3,
              content_sha256 = $4,
              size_bytes = $5,
              uncompressed_size_bytes = $6,
              snapshot_at = $7,
              completed_at = NOW(),
              expires_at = $8,
              locked_at = NULL,
              lease_token = NULL,
              lease_expires_at = NULL,
              last_error = '',
              error_code = '',
              purge_attempt_count = 0,
              purge_available_at = $8,
              updated_at = NOW()
        WHERE id = $1 AND status = 'processing' AND lease_token = $9
       RETURNING *`,
      [
        jobId,
        objectKey,
        objectVersionId || null,
        contentSha256,
        sizeBytes,
        uncompressedSizeBytes,
        snapshotAt,
        expiresAt,
        leaseToken,
      ],
    );
    const job = result.rows[0];
    if (!job) return null;
    await insertAudit(client, {
      jobId,
      userId: job.user_id,
      eventType: 'ready',
      details: { sizeBytes: Number(sizeBytes), contentSha256, expiresAt },
    });
    return job;
  });
}

function retryDelayMs(attemptCount, baseRetryMs, maxRetryMs, random = Math.random) {
  const base = boundedInteger(baseRetryMs, 5_000, 100, 60_000);
  const maximum = boundedInteger(maxRetryMs, 5 * 60 * 1000, base, 60 * 60 * 1000);
  const exponential = Math.min(maximum, base * 2 ** Math.max(0, Number(attemptCount) - 1));
  const jitter = 0.8 + Math.max(0, Math.min(1, Number(random()) || 0)) * 0.4;
  return Math.round(exponential * jitter);
}

async function failAccountExportJob({
  pool,
  jobId,
  leaseToken,
  error,
  errorCode = 'unknown',
  permanent = false,
  baseRetryMs = 5_000,
  maxRetryMs = 5 * 60 * 1000,
  random,
}) {
  return withTransaction(pool, async (client) => {
    const locked = await client.query(
      'SELECT * FROM account_export_jobs WHERE id = $1 AND lease_token = $2 FOR UPDATE',
      [jobId, leaseToken],
    );
    const job = locked.rows[0];
    if (!job || job.status !== 'processing') return null;
    const terminal = permanent === true || Number(job.attempt_count) >= Number(job.max_attempts);
    const delayMs = terminal ? 0 : retryDelayMs(job.attempt_count, baseRetryMs, maxRetryMs, random);
    const message = safeError(error);
    const normalizedErrorCode = normalizeAccountExportErrorCode(errorCode);
    const result = await client.query(
      `UPDATE account_export_jobs
          SET status = $2,
              available_at = CASE WHEN $2 = 'queued' THEN NOW() + ($3::bigint * INTERVAL '1 millisecond') ELSE available_at END,
              locked_at = NULL,
              lease_token = NULL,
              lease_expires_at = NULL,
              error_code = $5,
              last_error = $4,
              updated_at = NOW()
        WHERE id = $1
       RETURNING *`,
      [jobId, terminal ? 'failed' : 'queued', delayMs, message, terminal ? normalizedErrorCode : ''],
    );
    await insertAudit(client, {
      jobId,
      userId: job.user_id,
      eventType: terminal ? 'failed' : 'retry_scheduled',
      details: { attempt: Number(job.attempt_count), delayMs, errorCode: normalizedErrorCode },
    });
    return result.rows[0];
  });
}

async function reapExhaustedAccountExportLeases({ pool }) {
  return withTransaction(pool, async (client) => {
    const result = await client.query(
      `UPDATE account_export_jobs
          SET status = 'failed',
              locked_at = NULL,
              lease_token = NULL,
              lease_expires_at = NULL,
              error_code = 'unknown',
              last_error = 'processing lease expired after retry budget was exhausted',
              updated_at = NOW()
        WHERE status = 'processing'
          AND lease_expires_at < NOW()
          AND attempt_count >= max_attempts
       RETURNING id, user_id, attempt_count`,
    );
    for (const job of result.rows || []) {
      await insertAudit(client, {
        jobId: job.id,
        userId: job.user_id,
        eventType: 'failed',
        details: { attempt: Number(job.attempt_count), errorCode: 'unknown', reason: 'lease_exhausted' },
      });
    }
    return result.rows || [];
  });
}

async function renewAccountExportLease({ pool, jobId, leaseToken, leaseMs = DEFAULT_EXPORT_LEASE_MS }) {
  const lease = boundedInteger(leaseMs, DEFAULT_EXPORT_LEASE_MS, 10_000, 30 * 60 * 1000);
  const result = await pool.query(
    `UPDATE account_export_jobs
        SET lease_expires_at = NOW() + ($3::bigint * INTERVAL '1 millisecond'),
            updated_at = NOW()
      WHERE id = $1 AND status = 'processing' AND lease_token = $2
     RETURNING id`,
    [jobId, leaseToken, lease],
  );
  return Boolean(result.rows?.[0]);
}

async function listExpiredAccountExportObjects({ pool, limit = 20 }) {
  const boundedLimit = boundedInteger(limit, 20, 1, 100);
  const result = await pool.query(
    `SELECT id, user_id, object_key, object_version_id, status, purge_attempt_count
       FROM account_export_jobs
      WHERE object_key IS NOT NULL
        AND purge_available_at <= NOW()
        AND status = 'expired'
      ORDER BY expires_at ASC NULLS FIRST, updated_at ASC
      LIMIT $1`,
    [boundedLimit],
  );
  return result.rows;
}

async function expireDueAccountExportJobs({ pool, limit = 100 }) {
  const boundedLimit = boundedInteger(limit, 100, 1, 500);
  return withTransaction(pool, async (client) => {
    const result = await client.query(
      `WITH candidates AS (
         SELECT id
           FROM account_export_jobs
          WHERE status = 'ready' AND expires_at <= NOW()
          ORDER BY expires_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT $1
       )
       UPDATE account_export_jobs jobs
          SET status = 'expired', purge_available_at = NOW(), updated_at = NOW()
         FROM candidates
        WHERE jobs.id = candidates.id
       RETURNING jobs.id, jobs.user_id`,
      [boundedLimit],
    );
    for (const job of result.rows || []) {
      await insertAudit(client, {
        jobId: job.id,
        userId: job.user_id,
        eventType: 'expired',
        details: { reason: 'ttl_elapsed' },
      });
    }
    return result.rows || [];
  });
}

async function markAccountExportPurged({ pool, jobId }) {
  return withTransaction(pool, async (client) => {
    const result = await client.query(
      `UPDATE account_export_jobs
          SET object_key = NULL,
              object_version_id = NULL,
              locked_at = NULL,
              lease_token = NULL,
              lease_expires_at = NULL,
              error_code = '',
              last_error = '',
              purged_at = NOW(),
              updated_at = NOW()
        WHERE id = $1 AND status = 'expired' AND object_key IS NOT NULL
       RETURNING *`,
      [jobId],
    );
    const job = result.rows[0];
    if (!job) return null;
    await insertAudit(client, {
      jobId,
      userId: job.user_id,
      eventType: 'purged',
      details: { artifactPurged: true },
    });
    return job;
  });
}

async function scheduleAccountExportPurgeRetry({ pool, job, error }) {
  const attempt = Math.max(1, Number(job.purge_attempt_count || 0) + 1);
  const delayMs = Math.min(60 * 60 * 1000, 5_000 * 2 ** Math.min(10, attempt - 1));
  const message = safeError(error);
  return withTransaction(pool, async (client) => {
    const result = await client.query(
      `UPDATE account_export_jobs
          SET purge_attempt_count = purge_attempt_count + 1,
              purge_available_at = NOW() + ($2::bigint * INTERVAL '1 millisecond'),
              last_error = $3,
              updated_at = NOW()
        WHERE id = $1 AND object_key IS NOT NULL
       RETURNING user_id, purge_attempt_count`,
      [job.id, delayMs, message],
    );
    const updated = result.rows[0];
    if (!updated) return null;
    await insertAudit(client, {
      jobId: job.id,
      userId: updated.user_id,
      eventType: 'purge_retry',
      details: { attempt: Number(updated.purge_attempt_count), delayMs, errorCode: 'storage_error' },
    });
    return updated;
  });
}

async function recordAccountExportDownloadEvent({ pool, userId, jobId, eventType, requestId, details = {} }) {
  if (!['download_started', 'download_completed', 'download_interrupted', 'integrity_failed'].includes(eventType)) {
    throw new Error('Unsupported account export download audit event');
  }
  if (typeof requestId !== 'string' || requestId.length < 8 || requestId.length > 200) {
    throw new Error('Account export download audit requires a request id');
  }
  return withTransaction(pool, async (client) => {
    if (eventType === 'download_started') {
      const job = (
        await client.query(
          `SELECT * FROM account_export_jobs
            WHERE id = $1 AND user_id = $2 AND status = 'ready' AND expires_at > NOW()
            LIMIT 1
            FOR UPDATE`,
          [jobId, userId],
        )
      ).rows[0];
      if (!job) return { ok: false, status: 410, error: 'Account export is unavailable or expired' };
      const existingRequest = await client.query(
        'SELECT 1 FROM account_export_audit WHERE job_id = $1 AND request_id = $2 LIMIT 1',
        [jobId, requestId],
      );
      if (existingRequest.rows[0]) {
        return { ok: false, status: 409, error: 'Account export download request id was already used' };
      }
      await insertAudit(client, { jobId, userId, eventType, details: { ...details, requestId } });
      return { ok: true, body: { job: normalizeJob(job) } };
    }

    const job = (
      await client.query('SELECT * FROM account_export_jobs WHERE id = $1 AND user_id = $2 FOR UPDATE', [jobId, userId])
    ).rows[0];
    if (!job) return { ok: false, status: 410, error: 'Account export is unavailable' };
    const auditState = await client.query(
      `SELECT
         BOOL_OR(event_type = 'download_started') AS started,
         BOOL_OR(event_type IN ('download_completed', 'download_interrupted', 'integrity_failed')) AS terminal
       FROM account_export_audit
       WHERE job_id = $1 AND request_id = $2`,
      [jobId, requestId],
    );
    if (!auditState.rows[0]?.started) {
      return { ok: false, status: 409, error: 'Account export download was not started' };
    }
    if (auditState.rows[0]?.terminal) {
      return { ok: false, status: 409, error: 'Account export download was already finalized' };
    }

    let updatedJob = job;
    if (eventType === 'download_completed') {
      updatedJob = (
        await client.query(
          `UPDATE account_export_jobs
              SET downloaded_at = NOW(), download_count = download_count + 1, updated_at = NOW()
            WHERE id = $1 AND user_id = $2
           RETURNING *`,
          [jobId, userId],
        )
      ).rows[0];
    }
    await insertAudit(client, {
      jobId,
      userId,
      eventType,
      details: {
        ...details,
        requestId,
        ...(eventType === 'download_completed' ? { downloadCount: Number(updatedJob.download_count) } : {}),
      },
    });
    return { ok: true, body: { job: normalizeJob(updatedJob) } };
  });
}

async function expireAccountExportJobsForUser({ client, userId }) {
  const result = await client.query(
    `UPDATE account_export_jobs
        SET status = 'expired',
            expires_at = CASE
              WHEN completed_at IS NULL THEN NOW()
              ELSE GREATEST(NOW(), completed_at + INTERVAL '1 microsecond')
            END,
            purge_available_at = NOW(),
            locked_at = NULL,
            lease_token = NULL,
            lease_expires_at = NULL,
            updated_at = NOW()
      WHERE user_id = $1
        AND status IN ('queued', 'processing', 'ready')
     RETURNING id`,
    [userId],
  );
  for (const row of result.rows || []) {
    await insertAudit(client, { jobId: row.id, userId, eventType: 'expired', details: { reason: 'account_deleted' } });
  }
  return result.rowCount || result.rows?.length || 0;
}

function objectKeyForJob(prefix, job) {
  const requestedAt = new Date(job.requested_at || Date.now());
  const year = String(requestedAt.getUTCFullYear()).padStart(4, '0');
  const month = String(requestedAt.getUTCMonth() + 1).padStart(2, '0');
  const userHash = crypto.createHash('sha256').update(String(job.user_id)).digest('hex').slice(0, 24);
  const leaseHash = crypto
    .createHash('sha256')
    .update(String(job.lease_token || ''))
    .digest('hex')
    .slice(0, 24);
  return `${prefix}/${year}/${month}/${userHash}/${job.id}/${leaseHash}.json.gz`;
}

function createAccountExportWorker({
  pool,
  storage,
  buildArtifact,
  logger = console,
  intervalMs = DEFAULT_EXPORT_INTERVAL_MS,
  leaseMs = DEFAULT_EXPORT_LEASE_MS,
  batchSize = DEFAULT_EXPORT_BATCH_SIZE,
  expirySeconds = DEFAULT_EXPORT_EXPIRY_SECONDS,
  baseRetryMs = 5_000,
  maxRetryMs = 5 * 60 * 1000,
  random = Math.random,
  onResult,
  onBatch,
  onError,
}) {
  if (!pool || typeof pool.query !== 'function') throw new Error('Account export worker requires a PostgreSQL pool');
  if (!storage || storage.configured !== true)
    throw new Error('Account export worker requires configured object storage');
  if (typeof buildArtifact !== 'function') throw new Error('Account export worker requires an artifact builder');
  const delay = boundedInteger(intervalMs, DEFAULT_EXPORT_INTERVAL_MS, 250, 60_000);
  const lease = boundedInteger(leaseMs, DEFAULT_EXPORT_LEASE_MS, 10_000, 30 * 60 * 1000);
  const batch = boundedInteger(batchSize, DEFAULT_EXPORT_BATCH_SIZE, 1, 20);
  const ttl = boundedInteger(expirySeconds, DEFAULT_EXPORT_EXPIRY_SECONDS, 60 * 60, 30 * 24 * 60 * 60);
  let running = false;
  let timer = null;

  async function deleteUploadedObject({ key, versionId, jobId, reason }) {
    if (!key) return true;
    try {
      await storage.deleteObject({ key, versionId });
      return true;
    } catch (error) {
      onResult?.('orphan_cleanup_failed');
      logger.error?.(
        { err: error, jobId, objectKey: key, objectVersionId: versionId || null, reason },
        'account export uploaded object cleanup failed; bucket lifecycle must remove the orphan',
      );
      return false;
    }
  }

  async function processJob(job) {
    let artifact;
    let objectKey;
    let objectVersionId;
    let uploaded = false;
    let stage = 'artifact';
    const abortController = new AbortController();
    const heartbeat = setInterval(
      () => {
        void renewAccountExportLease({ pool, jobId: job.id, leaseToken: job.lease_token, leaseMs: lease })
          .then(async (renewed) => {
            if (!renewed) abortController.abort(new Error('Account export processing lease was lost'));
            else await artifact?.touch?.();
          })
          .catch((error) => abortController.abort(error));
      },
      Math.max(5_000, Math.floor(lease / 3)),
    );
    heartbeat.unref?.();
    try {
      artifact = await buildArtifact({
        pool,
        userId: job.user_id,
        jobId: job.id,
        leaseToken: job.lease_token,
        signal: abortController.signal,
      });
      if (!artifact?.ok) throw new Error(artifact?.error || 'Account export artifact failed');
      objectKey = objectKeyForJob(storage.prefix, job);
      stage = 'storage';
      const stored = await storage.putObject({
        key: objectKey,
        filePath: artifact.filePath,
        sizeBytes: artifact.sizeBytes,
        contentSha256: artifact.contentSha256,
        signal: abortController.signal,
      });
      objectVersionId = stored.versionId;
      uploaded = true;
      stage = 'database';
      const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
      const completed = await completeAccountExportJob({
        pool,
        jobId: job.id,
        leaseToken: job.lease_token,
        objectKey,
        objectVersionId,
        contentSha256: artifact.contentSha256,
        sizeBytes: artifact.sizeBytes,
        uncompressedSizeBytes: artifact.uncompressedBytes,
        snapshotAt: artifact.snapshotAt,
        expiresAt,
      });
      if (!completed) {
        await deleteUploadedObject({
          key: objectKey,
          versionId: objectVersionId,
          jobId: job.id,
          reason: 'lease_fence_lost',
        });
        onResult?.('stale');
        return false;
      }
      onResult?.('ready');
      return true;
    } catch (error) {
      if (objectKey) {
        await deleteUploadedObject({
          key: objectKey,
          versionId: objectVersionId,
          jobId: job.id,
          reason: uploaded ? 'post_upload_failure' : 'uncertain_upload_failure',
        });
      }
      const errorCode = normalizeAccountExportErrorCode(error?.code, stage === 'storage' ? 'storage_error' : 'unknown');
      const failed = await failAccountExportJob({
        pool,
        jobId: job.id,
        leaseToken: job.lease_token,
        error,
        errorCode,
        permanent: error?.permanent === true,
        baseRetryMs,
        maxRetryMs,
        random,
      });
      const result = !failed ? 'stale' : failed.status === 'failed' ? 'failed' : 'retry';
      onResult?.(result);
      logger.error?.({ err: error, jobId: job.id, result }, 'account export job failed');
      return false;
    } finally {
      clearInterval(heartbeat);
      await artifact?.cleanup?.().catch(() => undefined);
    }
  }

  async function cleanupExpired() {
    await expireDueAccountExportJobs({ pool, limit: batch * 5 });
    const expired = await listExpiredAccountExportObjects({ pool, limit: batch * 5 });
    for (const job of expired) {
      try {
        await storage.deleteObject({ key: job.object_key, versionId: job.object_version_id });
        await markAccountExportPurged({ pool, jobId: job.id });
        onResult?.('expired');
      } catch (error) {
        await scheduleAccountExportPurgeRetry({ pool, job, error }).catch(() => undefined);
        onResult?.('purge_retry');
        logger.error?.({ err: error, jobId: job.id }, 'account export object cleanup failed');
      }
    }
  }

  async function tick() {
    if (running) return;
    running = true;
    try {
      const exhausted = await reapExhaustedAccountExportLeases({ pool });
      exhausted.forEach(() => onResult?.('failed'));
      for (let index = 0; index < batch; index += 1) {
        const job = await claimAccountExportJob({ pool, leaseMs: lease });
        if (!job) break;
        await processJob(job);
      }
      await cleanupExpired();
      await onBatch?.();
    } catch (error) {
      onError?.(error);
      logger.error?.({ err: error }, 'account export worker tick failed');
    } finally {
      running = false;
    }
  }

  return {
    tick,
    start() {
      if (timer) return;
      void tick();
      timer = setInterval(() => void tick(), delay);
      timer.unref?.();
    },
    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
      while (running) await new Promise((resolve) => setTimeout(resolve, 10));
      storage.destroy?.();
    },
  };
}

async function accountExportStats(pool) {
  const result = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE status IN ('queued', 'processing'))::int AS pending,
            COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
            COUNT(*) FILTER (
              WHERE object_key IS NOT NULL
                AND purge_available_at <= NOW()
                AND ((status = 'ready' AND expires_at <= NOW()) OR status = 'expired')
            )::int AS purge_pending,
            COUNT(*) FILTER (WHERE object_key IS NOT NULL AND purge_attempt_count > 0)::int AS purge_retrying,
            COALESCE(EXTRACT(EPOCH FROM (NOW() - MIN(requested_at) FILTER (WHERE status IN ('queued', 'processing')))), 0)::float AS oldest_age_seconds
       FROM account_export_jobs`,
  );
  return {
    pending: Number(result.rows[0]?.pending) || 0,
    failed: Number(result.rows[0]?.failed) || 0,
    purgePending: Number(result.rows[0]?.purge_pending) || 0,
    purgeRetrying: Number(result.rows[0]?.purge_retrying) || 0,
    oldestAgeSeconds: Math.max(0, Number(result.rows[0]?.oldest_age_seconds) || 0),
  };
}

module.exports = {
  AccountExportPermanentError,
  DEFAULT_EXPORT_BATCH_SIZE,
  DEFAULT_EXPORT_EXPIRY_SECONDS,
  DEFAULT_EXPORT_INTERVAL_MS,
  DEFAULT_EXPORT_LEASE_MS,
  DEFAULT_EXPORT_MAX_ATTEMPTS,
  accountExportStats,
  claimAccountExportJob,
  completeAccountExportJob,
  createAccountExportJob,
  createAccountExportWorker,
  expireAccountExportJobsForUser,
  expireDueAccountExportJobs,
  failAccountExportJob,
  getAccountExportJob,
  listAccountExportJobs,
  listExpiredAccountExportObjects,
  markAccountExportPurged,
  normalizeJob,
  normalizeAccountExportErrorCode,
  objectKeyForJob,
  reapExhaustedAccountExportLeases,
  recordAccountExportDownloadEvent,
  renewAccountExportLease,
  retryDelayMs,
  scheduleAccountExportPurgeRetry,
};
