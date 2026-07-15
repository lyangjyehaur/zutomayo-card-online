/* global module */

const RETENTION_LOCK_NAME = 'zutomayo:retention-job:v1';
const ACCOUNT_LOCK_PREFIX = 'legal-hold:account:';

class AccountMutationError extends Error {
  constructor(userIds) {
    super('Account mutation rejected because an account is missing or deleted');
    this.name = 'AccountMutationError';
    this.code = 'ACCOUNT_DELETED';
    this.status = 409;
    this.userIds = userIds;
  }
}

function normalizeUserIds(userIds) {
  return [
    ...new Set(
      (Array.isArray(userIds) ? userIds : [userIds])
        .map((id) => String(id || '').trim())
        .filter((id) => Boolean(id) && !id.startsWith('guest:') && !id.startsWith('anon:')),
    ),
  ].sort();
}

async function acquireAccountMutationLocks(
  client,
  userIds,
  { includeRetention = false, requireLiveUsers = true } = {},
) {
  const ids = normalizeUserIds(userIds);
  if (includeRetention) {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [RETENTION_LOCK_NAME]);
  }
  for (const userId of ids) {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${ACCOUNT_LOCK_PREFIX}${userId}`]);
  }
  if (!requireLiveUsers || ids.length === 0) return [];

  const rows = [];
  for (const id of ids) {
    const result = await client.query(
      'SELECT id, deleted_at, elo, match_count, wins FROM users WHERE id = $1 FOR UPDATE',
      [id],
    );
    if (result.rows[0]) rows.push(result.rows[0]);
  }
  const liveIds = new Set(rows.filter((row) => !row.deleted_at).map((row) => row.id));
  if (rows.length !== ids.length || ids.some((id) => !liveIds.has(id))) {
    throw new AccountMutationError(ids.filter((id) => !liveIds.has(id)));
  }
  return rows;
}

async function withAccountMutationTransaction(pool, userIds, operation, lockOptions = {}) {
  if (!pool || typeof pool.query !== 'function' || typeof operation !== 'function') {
    throw new TypeError('Account mutation transaction requires a PostgreSQL pool and operation');
  }
  const client = typeof pool.connect === 'function' ? await pool.connect() : pool;
  const release = typeof client.release === 'function' ? () => client.release() : () => undefined;
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;
    await acquireAccountMutationLocks(client, userIds, lockOptions);
    const result = await operation(client);
    await client.query('COMMIT');
    transactionStarted = false;
    return result;
  } catch (error) {
    if (transactionStarted) await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    release();
  }
}

module.exports = {
  ACCOUNT_LOCK_PREFIX,
  AccountMutationError,
  RETENTION_LOCK_NAME,
  acquireAccountMutationLocks,
  normalizeUserIds,
  withAccountMutationTransaction,
};
