/* global module */

const DEFAULT_PRESENCE_KEY = 'presence:online';

function normalizePresenceId(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^[a-zA-Z0-9:_-]{8,96}$/.test(trimmed)) return null;
  return trimmed;
}

async function cleanupPresence(redis, key, now, ttlMs) {
  await redis.zremrangebyscore(key, 0, now - ttlMs);
}

async function countOnlinePresence(redis, { key = DEFAULT_PRESENCE_KEY, now = Date.now(), ttlMs }) {
  await cleanupPresence(redis, key, now, ttlMs);
  const onlineCount = await redis.zcount(key, now - ttlMs + 1, '+inf');
  return {
    onlineCount: Number(onlineCount) || 0,
    activeWindowSeconds: Math.ceil(ttlMs / 1000),
  };
}

async function heartbeatOnlinePresence(redis, { key = DEFAULT_PRESENCE_KEY, visitorId, now = Date.now(), ttlMs }) {
  const memberId = normalizePresenceId(visitorId);
  if (!memberId) return { ok: false, status: 400, error: 'visitorId required' };

  await cleanupPresence(redis, key, now, ttlMs);
  await redis.zadd(key, now, memberId);
  await redis.expire(key, Math.max(60, Math.ceil((ttlMs * 2) / 1000)));
  return {
    ok: true,
    body: await countOnlinePresence(redis, { key, now, ttlMs }),
  };
}

module.exports = {
  countOnlinePresence,
  heartbeatOnlinePresence,
  normalizePresenceId,
};
