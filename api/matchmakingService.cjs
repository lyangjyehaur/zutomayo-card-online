/* global module, require */

const { refreshMatchmakingQueueDepth } = require('./observability.cjs');

async function refreshQueueMetric(redis) {
  try {
    await refreshMatchmakingQueueDepth(redis);
  } catch {
    // Matchmaking remains available when an auxiliary metrics read fails.
  }
}

async function listMatchmakingBlockedUserIds({ pool, userId, limit = 5000 }) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 5000, 10_000));
  const { rows } = await pool.query(
    `SELECT CASE
       WHEN blocker_user_id = $1 THEN blocked_user_id
       ELSE blocker_user_id
     END AS blocked_user_id
     FROM user_blocks
     WHERE blocker_user_id = $1 OR blocked_user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, safeLimit],
  );
  return [...new Set(rows.map((row) => row.blocked_user_id).filter((id) => typeof id === 'string' && id !== userId))];
}

async function cancelMatchmakingPair(redis, userId, opponentId) {
  if (!userId || !opponentId) return false;
  if (typeof redis.mmCancelPair === 'function') {
    return Boolean(await redis.mmCancelPair('mm:queue', userId, opponentId));
  }
  const [userEntry, opponentEntry] = await Promise.all([
    redis.hgetall(`mm:${userId}`),
    redis.hgetall(`mm:${opponentId}`),
  ]);
  if (userEntry?.status !== 'matched' || userEntry.opponentId !== opponentId) return false;
  await redis.hset(`mm:${userId}`, 'status', 'timeout');
  if (opponentEntry?.status === 'matched' && opponentEntry.opponentId === userId) {
    await redis.hset(`mm:${opponentId}`, 'status', 'timeout');
  }
  return true;
}

async function applyMatchmakingBlock(redis, blockerUserId, blockedUserId) {
  if (typeof redis.mmApplyBlock === 'function') {
    await redis.mmApplyBlock('mm:queue', blockerUserId, blockedUserId);
  } else {
    await redis.sadd(`mm:blocked:${blockerUserId}`, blockedUserId);
    await cancelMatchmakingPair(redis, blockerUserId, blockedUserId);
  }
}

async function removeMatchmakingBlock(redis, blockerUserId, blockedUserId) {
  await redis.srem(`mm:blocked:${blockerUserId}`, blockedUserId);
}

async function joinMatchmakingQueue({
  redis,
  userId,
  body,
  sanitizeText,
  generateQueueId,
  generateMatchId,
  now = Date.now(),
  ttlSeconds,
  timeoutMs,
  blockedUserIds = [],
}) {
  const { deckName, deckIds } = body;
  const blocked = new Set(blockedUserIds.filter((id) => typeof id === 'string' && id && id !== userId));
  const existing = await redis.hgetall(`mm:${userId}`);
  if (existing && existing.status === 'matched') {
    if (existing.opponentId && blocked.has(existing.opponentId)) {
      await cancelMatchmakingPair(redis, userId, existing.opponentId);
      return { queueId: existing.queueId, status: 'timeout' };
    }
    return { queueId: existing.queueId, status: 'matched' };
  }

  const queueId = (existing && existing.queueId) || generateQueueId();
  const cleanDeckName = typeof deckName === 'string' ? sanitizeText(deckName, 60) : '';
  const cleanDeckIds = Array.isArray(deckIds) ? deckIds.filter((id) => typeof id === 'string').slice(0, 20) : [];

  await redis.hset(`mm:${userId}`, {
    queueId,
    joinedAt: String(now),
    deckName: cleanDeckName,
    deckIds: JSON.stringify(cleanDeckIds),
    status: 'queued',
  });
  await redis.zadd('mm:queue', now, userId);
  await redis.expire(`mm:${userId}`, ttlSeconds);

  await redis.mmTryMatch('mm:queue', userId, String(now), generateMatchId(), String(timeoutMs), ...blocked);
  await refreshQueueMetric(redis);

  const current = await redis.hgetall(`mm:${userId}`);
  if (!current || !current.status) return { status: 'timeout' };
  return { queueId: current.queueId, status: current.status };
}

async function getMatchmakingStatus(redis, userId, now = Date.now(), timeoutMs, blockedUserIds = []) {
  await redis.mmCleanExpired('mm:queue', String(now), String(timeoutMs));
  await refreshQueueMetric(redis);
  const entry = await redis.hgetall(`mm:${userId}`);
  if (!entry || !entry.status) return { status: 'timeout' };
  if (
    entry.status === 'matched' &&
    entry.opponentId &&
    blockedUserIds.some((blockedUserId) => blockedUserId === entry.opponentId)
  ) {
    await cancelMatchmakingPair(redis, userId, entry.opponentId);
    return { status: 'timeout' };
  }
  return {
    status: entry.status,
    matchId: entry.matchId || undefined,
    opponentId: entry.opponentId || undefined,
    role: entry.role || undefined,
    realMatchId: entry.realMatchId || undefined,
  };
}

async function leaveMatchmakingQueue(redis, userId) {
  const entry = await redis.hgetall(`mm:${userId}`);
  if (entry && entry.opponentId) {
    const opponent = await redis.hgetall(`mm:${entry.opponentId}`);
    if (opponent && opponent.status) {
      await redis.hset(`mm:${entry.opponentId}`, 'status', 'timeout');
    }
  }
  await redis.zrem('mm:queue', userId);
  await redis.del(`mm:${userId}`);
  await refreshQueueMetric(redis);
  return { deleted: true };
}

async function reportRealMatch(redis, userId, matchId, blockedUserIds = []) {
  if (typeof matchId !== 'string' || !matchId) {
    return { ok: false, status: 400, error: 'matchId required' };
  }
  const entry = await redis.hgetall(`mm:${userId}`);
  if (!entry || entry.status !== 'matched') {
    return { ok: false, status: 400, error: 'Not in a matched queue' };
  }
  if (!entry.opponentId) {
    return { ok: false, status: 409, error: 'Matched queue is missing opponent' };
  }
  if (blockedUserIds.some((blockedUserId) => blockedUserId === entry.opponentId)) {
    await cancelMatchmakingPair(redis, userId, entry.opponentId);
    return { ok: false, status: 409, error: 'Matchmaking pair is blocked' };
  }
  await redis.hset(`mm:${userId}`, 'realMatchId', matchId);
  await redis.hset(`mm:${entry.opponentId}`, 'realMatchId', matchId);
  return { ok: true, body: { ok: true } };
}

module.exports = {
  applyMatchmakingBlock,
  cancelMatchmakingPair,
  getMatchmakingStatus,
  joinMatchmakingQueue,
  leaveMatchmakingQueue,
  listMatchmakingBlockedUserIds,
  removeMatchmakingBlock,
  reportRealMatch,
};
