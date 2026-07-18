/* global module */

const { AccountMutationError, withAccountMutationTransaction } = require('./accountMutationLock.cjs');

const PERSIST_REFRESH_SESSION_SCRIPT = `
local revokedBefore = redis.call('GET', KEYS[2])
if revokedBefore and tonumber(ARGV[2]) <= tonumber(revokedBefore) then return 0 end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])
return 1
`;

class AccountSessionUnavailableError extends Error {
  constructor(userId) {
    super('Account session is no longer available');
    this.name = 'AccountSessionUnavailableError';
    this.code = 'ACCOUNT_SESSION_UNAVAILABLE';
    this.status = 401;
    this.userId = userId;
  }
}

class RefreshSessionPersistenceTimeoutError extends Error {
  constructor(timeoutMs) {
    super(`Refresh session persistence timed out after ${timeoutMs}ms`);
    this.name = 'RefreshSessionPersistenceTimeoutError';
    this.code = 'REFRESH_SESSION_PERSISTENCE_TIMEOUT';
    this.timeoutMs = timeoutMs;
  }
}

function durableAuthVersion(row) {
  if (!row || row.deleted_at) return null;
  const version = Number(row.auth_version);
  return Number.isInteger(version) && version > 0 ? version : 1;
}

async function issueAccountRefreshToken({
  pool,
  redis,
  userId,
  sessionIat,
  requestedAuthVersion,
  createRefreshToken,
  decodeTokenPayload,
  nowSeconds = () => Math.floor(Date.now() / 1000),
  redisSetTimeoutMs = 1_500,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  if (
    !pool ||
    !redis ||
    typeof redis.eval !== 'function' ||
    typeof createRefreshToken !== 'function' ||
    typeof decodeTokenPayload !== 'function'
  ) {
    throw new TypeError('Refresh session issuance requires PostgreSQL, Redis, and token helpers');
  }

  try {
    return await withAccountMutationTransaction(pool, [userId], async (client) => {
      const row = (await client.query('SELECT auth_version, deleted_at FROM users WHERE id = $1', [userId])).rows[0];
      const authVersion = durableAuthVersion(row);
      if (!authVersion || (Number.isInteger(requestedAuthVersion) && Number(requestedAuthVersion) !== authVersion)) {
        throw new AccountSessionUnavailableError(userId);
      }

      const token = createRefreshToken(userId, sessionIat, authVersion);
      const payload = decodeTokenPayload(token);
      const ttl = Number(payload?.exp) - Number(nowSeconds());
      const tokenSessionIat = Number.isFinite(payload?.sessionIat) ? Number(payload.sessionIat) : Number(payload?.iat);
      if (!payload?.jti || !Number.isFinite(ttl) || ttl <= 0 || !Number.isFinite(tokenSessionIat)) {
        throw new Error('Generated refresh token is invalid');
      }
      const boundedTimeoutMs = Math.max(1, Math.min(30_000, Number(redisSetTimeoutMs) || 1_500));
      let timeout;
      const redisPersist = redis.eval(
        PERSIST_REFRESH_SESSION_SCRIPT,
        2,
        `refresh:${payload.jti}`,
        `auth:revoked-before:${userId}`,
        String(userId),
        String(tokenSessionIat),
        String(ttl),
      );
      const timeoutReached = new Promise((_, reject) => {
        timeout = setTimer(() => reject(new RefreshSessionPersistenceTimeoutError(boundedTimeoutMs)), boundedTimeoutMs);
        timeout?.unref?.();
      });
      const stored = await Promise.race([redisPersist, timeoutReached]).finally(() => clearTimer(timeout));
      if (Number(stored) !== 1) throw new AccountSessionUnavailableError(userId);
      return token;
    });
  } catch (error) {
    if (error instanceof AccountMutationError) throw new AccountSessionUnavailableError(userId);
    throw error;
  }
}

module.exports = {
  AccountSessionUnavailableError,
  PERSIST_REFRESH_SESSION_SCRIPT,
  RefreshSessionPersistenceTimeoutError,
  issueAccountRefreshToken,
};
