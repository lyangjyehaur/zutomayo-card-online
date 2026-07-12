/* global module */

const crypto = require('node:crypto');

const RELATIONSHIP_CHANGE_CHANNEL = 'zutomayo:relationship-change:v1';
const RELATIONSHIP_CHANGE_KINDS = new Set([
  'friendship_added',
  'friendship_removed',
  'block_created',
  'block_removed',
  'account_deleted',
]);

function normalizeUserIds(values) {
  if (!Array.isArray(values)) return [];
  return [
    ...new Set(
      values.map((value) => String(value || '').trim()).filter((value) => /^[A-Za-z0-9:_-]{3,128}$/.test(value)),
    ),
  ]
    .sort()
    .slice(0, 2);
}

function createRelationshipChange(kind, userIds) {
  if (!RELATIONSHIP_CHANGE_KINDS.has(kind)) throw new Error('Invalid relationship change kind');
  const normalizedUserIds = normalizeUserIds(userIds);
  const requiredUsers = kind === 'account_deleted' ? 1 : 2;
  if (normalizedUserIds.length !== requiredUsers) throw new Error('Invalid relationship change users');
  return {
    version: 1,
    eventId: crypto.randomUUID(),
    kind,
    userIds: normalizedUserIds,
    occurredAt: new Date().toISOString(),
  };
}

function parseRelationshipChange(value) {
  let parsed;
  try {
    parsed = typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return null;
  }
  if (!parsed || parsed.version !== 1 || typeof parsed.eventId !== 'string') return null;
  if (!RELATIONSHIP_CHANGE_KINDS.has(parsed.kind)) return null;
  const userIds = normalizeUserIds(parsed.userIds);
  const requiredUsers = parsed.kind === 'account_deleted' ? 1 : 2;
  if (userIds.length !== requiredUsers) return null;
  if (!Number.isFinite(Date.parse(parsed.occurredAt))) return null;
  return {
    version: 1,
    eventId: parsed.eventId.slice(0, 128),
    kind: parsed.kind,
    userIds,
    occurredAt: parsed.occurredAt,
  };
}

async function publishRelationshipChange(redis, kind, userIds) {
  if (!redis || typeof redis.publish !== 'function') throw new Error('Relationship event publisher is unavailable');
  const event = createRelationshipChange(kind, userIds);
  await redis.publish(RELATIONSHIP_CHANGE_CHANNEL, JSON.stringify(event));
  return event;
}

module.exports = {
  RELATIONSHIP_CHANGE_CHANNEL,
  createRelationshipChange,
  parseRelationshipChange,
  publishRelationshipChange,
};
