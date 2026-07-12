/* global module, require */

const crypto = require('crypto');

const RETENTION_LOCK_NAME = 'zutomayo:retention-job:v1';
const RECOVERABLE_DELETION_STATUSES = ['provider_deleting', 'provider_deleted'];
const TOMBSTONE_DELETION_STATUSES = ['provider_deleting', 'provider_deleted', 'completed'];
const ACTIVE_DELETION_STATUSES = ['prepared', 'provider_deleting', 'provider_deleted', 'provider_failed'];

async function withTransaction(pool, operation) {
  const client = typeof pool.connect === 'function' ? await pool.connect() : pool;
  const release = typeof client.release === 'function' ? () => client.release() : () => undefined;
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    release();
  }
}

function mapDeletionRequest(row) {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    providerUserId: row.provider_user_id,
    status: row.status,
    attemptCount: Number(row.attempt_count) || 0,
    lastError: row.last_error || '',
    updatedAt: row.updated_at,
  };
}

async function lockAccountMutation(client, userId) {
  // Every irreversible account/retention/legal-hold operation takes these
  // locks in the same order. This serializes a provider deletion with a
  // legal-hold decision and the local anonymization transaction.
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [RETENTION_LOCK_NAME]);
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`legal-hold:account:${userId}`]);
}

async function activeAccountLegalHold(client, userId) {
  return (
    await client.query(
      `SELECT id FROM legal_holds
       WHERE subject_type = 'account' AND subject_id = $1
         AND released_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())
       LIMIT 1`,
      [userId],
    )
  ).rows[0];
}

async function prepareLogtoAccountDeletion({
  pool,
  userId,
  generateId = () => `account_delete_${crypto.randomBytes(12).toString('hex')}`,
}) {
  return withTransaction(pool, async (client) => {
    const user = (await client.query('SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [userId]))
      .rows[0];
    if (!user) return { ok: false, status: 404, error: 'User not found' };

    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [RETENTION_LOCK_NAME]);
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`legal-hold:account:${userId}`]);
    const activeLegalHold = (
      await client.query(
        `SELECT id FROM legal_holds
         WHERE subject_type = 'account' AND subject_id = $1
           AND released_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())
         LIMIT 1`,
        [userId],
      )
    ).rows[0];
    if (activeLegalHold) {
      return { ok: false, status: 409, error: 'Account deletion is suspended by an active legal hold' };
    }

    const existing = (
      await client.query(
        `SELECT * FROM account_deletion_requests
         WHERE user_id = $1 AND status <> 'completed'
         ORDER BY created_at DESC
         LIMIT 1
         FOR UPDATE`,
        [userId],
      )
    ).rows[0];
    if (existing) {
      if (existing.status === 'provider_failed') {
        const retried = (
          await client.query(
            `UPDATE account_deletion_requests
             SET status = 'prepared', last_error = '', updated_at = NOW()
             WHERE id = $1
             RETURNING *`,
            [existing.id],
          )
        ).rows[0];
        return { ok: true, body: { request: mapDeletionRequest(retried) } };
      }
      return { ok: true, body: { request: mapDeletionRequest(existing) } };
    }

    const identity = (
      await client.query(
        `SELECT provider_user_id FROM user_identities
         WHERE user_id = $1 AND provider = 'logto'
         FOR UPDATE`,
        [userId],
      )
    ).rows[0];
    if (!identity?.provider_user_id) {
      return { ok: false, status: 409, error: 'Logto account identity is unavailable' };
    }

    const request = (
      await client.query(
        `INSERT INTO account_deletion_requests
           (id, user_id, provider, provider_user_id, status)
         VALUES ($1, $2, 'logto', $3, 'prepared')
         RETURNING *`,
        [generateId(), userId, identity.provider_user_id],
      )
    ).rows[0];
    return { ok: true, body: { request: mapDeletionRequest(request) } };
  });
}

async function markProviderDeletionStarted({ pool, requestId }) {
  return withTransaction(pool, async (client) => {
    const pending = (await client.query('SELECT id, user_id FROM account_deletion_requests WHERE id = $1', [requestId]))
      .rows[0];
    if (!pending) return { ok: false, status: 409, error: 'Account deletion request is not retryable' };

    await lockAccountMutation(client, pending.user_id);
    const activeHold = await activeAccountLegalHold(client, pending.user_id);
    if (activeHold) {
      return { ok: false, status: 409, error: 'Account deletion is suspended by an active legal hold' };
    }

    const row = (
      await client.query(
        `UPDATE account_deletion_requests
         SET status = 'provider_deleting', attempt_count = attempt_count + 1,
             last_error = '', updated_at = NOW()
         WHERE id = $1 AND status IN ('prepared', 'provider_failed', 'provider_deleting')
         RETURNING *`,
        [requestId],
      )
    ).rows[0];
    if (!row) return { ok: false, status: 409, error: 'Account deletion request is not retryable' };
    return { ok: true, body: { request: mapDeletionRequest(row) } };
  });
}

async function markProviderDeleted({ pool, requestId }) {
  return withTransaction(pool, async (client) => {
    const pending = (await client.query('SELECT id, user_id FROM account_deletion_requests WHERE id = $1', [requestId]))
      .rows[0];
    if (!pending) return { ok: false, status: 409, error: 'Account deletion provider state is invalid' };

    await lockAccountMutation(client, pending.user_id);
    // This transition records an already-completed external provider call. A
    // legal hold cannot undo that call; the local delete gate below still
    // prevents anonymization until the hold is released.
    const row = (
      await client.query(
        `UPDATE account_deletion_requests
         SET status = 'provider_deleted', provider_deleted_at = COALESCE(provider_deleted_at, NOW()),
             last_error = '', updated_at = NOW()
         WHERE id = $1 AND status IN ('provider_deleting', 'provider_deleted')
         RETURNING *`,
        [requestId],
      )
    ).rows[0];
    if (!row) return { ok: false, status: 409, error: 'Account deletion provider state is invalid' };
    return { ok: true, body: { request: mapDeletionRequest(row) } };
  });
}

async function markProviderDeletionFailure({ pool, requestId, error, retryable = true }) {
  const status = retryable ? 'provider_deleting' : 'provider_failed';
  await withTransaction(pool, async (client) => {
    const pending = (await client.query('SELECT id, user_id FROM account_deletion_requests WHERE id = $1', [requestId]))
      .rows[0];
    if (!pending) return;
    await lockAccountMutation(client, pending.user_id);
    await client.query(
      `UPDATE account_deletion_requests
       SET status = $2, last_error = $3, updated_at = NOW()
       WHERE id = $1 AND status IN ('prepared', 'provider_deleting', 'provider_failed')`,
      [requestId, status, String(error || 'Provider deletion failed').slice(0, 1000)],
    );
  });
}

async function listRecoverableAccountDeletions({ pool, limit = 20 }) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 100));
  const { rows } = await pool.query(
    `SELECT * FROM account_deletion_requests
     WHERE status = ANY($1::text[])
     ORDER BY updated_at ASC
     LIMIT $2`,
    [RECOVERABLE_DELETION_STATUSES, safeLimit],
  );
  return rows.map(mapDeletionRequest);
}

async function isPrincipalDeletionTombstoned({ pool, provider, providerUserId }) {
  if (!provider || !providerUserId) return false;
  const row = (
    await pool.query(
      `SELECT 1 FROM account_deletion_requests
       WHERE provider = $1 AND provider_user_id = $2
         AND status = ANY($3::text[])
       LIMIT 1`,
      [provider, providerUserId, TOMBSTONE_DELETION_STATUSES],
    )
  ).rows[0];
  return Boolean(row);
}

module.exports = {
  ACTIVE_DELETION_STATUSES,
  RECOVERABLE_DELETION_STATUSES,
  TOMBSTONE_DELETION_STATUSES,
  activeAccountLegalHold,
  isPrincipalDeletionTombstoned,
  listRecoverableAccountDeletions,
  lockAccountMutation,
  markProviderDeleted,
  markProviderDeletionFailure,
  markProviderDeletionStarted,
  prepareLogtoAccountDeletion,
};
