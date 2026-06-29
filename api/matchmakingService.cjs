/* global module */

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
}) {
  const { deckName, deckIds } = body;
  const existing = await redis.hgetall(`mm:${userId}`);
  if (existing && existing.status === 'matched') {
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

  await redis.mmTryMatch('mm:queue', userId, String(now), generateMatchId(), String(timeoutMs));

  const current = await redis.hgetall(`mm:${userId}`);
  if (!current || !current.status) return { status: 'timeout' };
  return { queueId: current.queueId, status: current.status };
}

async function getMatchmakingStatus(redis, userId, now = Date.now(), timeoutMs) {
  await redis.mmCleanExpired('mm:queue', String(now), String(timeoutMs));
  const entry = await redis.hgetall(`mm:${userId}`);
  if (!entry || !entry.status) return { status: 'timeout' };
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
  return { deleted: true };
}

async function reportRealMatch(redis, userId, matchId) {
  if (typeof matchId !== 'string' || !matchId) {
    return { ok: false, status: 400, error: 'matchId required' };
  }
  const entry = await redis.hgetall(`mm:${userId}`);
  if (!entry || entry.status !== 'matched') {
    return { ok: false, status: 400, error: 'Not in a matched queue' };
  }
  await redis.hset(`mm:${userId}`, 'realMatchId', matchId);
  return { ok: true, body: { ok: true } };
}

module.exports = {
  getMatchmakingStatus,
  joinMatchmakingQueue,
  leaveMatchmakingQueue,
  reportRealMatch,
};
