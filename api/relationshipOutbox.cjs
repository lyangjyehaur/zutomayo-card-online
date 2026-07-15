/* global module */

const crypto = require('node:crypto');
const {
  RELATIONSHIP_CHANGE_CHANNEL,
  createRelationshipChange,
  parseRelationshipChange,
} = require('./relationshipEvents.cjs');

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 10;
const DEFAULT_BASE_RETRY_MS = 500;
const DEFAULT_MAX_RETRY_MS = 60_000;

class RelationshipOutboxPermanentError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RelationshipOutboxPermanentError';
    this.code = 'RELATIONSHIP_OUTBOX_PERMANENT';
  }
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
}

function relationshipOutboxConfig(env = process.env) {
  const configuredJitter = Number(env.RELATIONSHIP_OUTBOX_RETRY_JITTER_RATIO);
  return {
    batchSize: boundedInteger(env.RELATIONSHIP_OUTBOX_BATCH_SIZE, DEFAULT_BATCH_SIZE, 1, 500),
    leaseMs: boundedInteger(env.RELATIONSHIP_OUTBOX_LEASE_MS, DEFAULT_LEASE_MS, 1_000, 300_000),
    maxAttempts: boundedInteger(env.RELATIONSHIP_OUTBOX_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS, 1, 100),
    baseRetryMs: boundedInteger(env.RELATIONSHIP_OUTBOX_BASE_RETRY_MS, DEFAULT_BASE_RETRY_MS, 100, 60_000),
    maxRetryMs: boundedInteger(env.RELATIONSHIP_OUTBOX_MAX_RETRY_MS, DEFAULT_MAX_RETRY_MS, 1_000, 3_600_000),
    jitterRatio: Number.isFinite(configuredJitter) ? Math.max(0, Math.min(0.5, configuredJitter)) : 0.2,
  };
}

function retryDelayMs(attemptCount, config) {
  const exponent = Math.max(0, Math.min(20, Number(attemptCount) - 1));
  const baseDelay = Math.min(config.maxRetryMs, config.baseRetryMs * 2 ** exponent);
  const jitterRatio = Math.max(0, Math.min(0.5, Number(config.jitterRatio) || 0));
  const random = typeof config.random === 'function' ? config.random() : Math.random();
  return Math.max(1, Math.round(baseDelay * (1 - jitterRatio + random * jitterRatio * 2)));
}

async function enqueueRelationshipChange(client, kind, userIds, { idempotencyKey, actorUserId } = {}) {
  const event = createRelationshipChange(kind, userIds, { actorUserId });
  const result = await client.query(
    `INSERT INTO relationship_change_outbox
       (event_id, idempotency_key, version, kind, user_ids, actor_user_id, occurred_at, status, next_attempt_at)
     VALUES ($1, $2, $3, $4, $5::text[], $6, $7::timestamptz, 'pending', NOW())
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING event_id`,
    [
      event.eventId,
      idempotencyKey || null,
      event.version,
      event.kind,
      event.userIds,
      event.actorUserId || null,
      event.occurredAt,
    ],
  );
  return { ...event, enqueued: Number(result.rowCount) > 0 };
}

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

async function claimRelationshipChanges(pool, config = relationshipOutboxConfig()) {
  const lockToken = crypto.randomUUID();
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `WITH claimable AS (
         SELECT event_id
           FROM relationship_change_outbox
          WHERE (status = 'pending' AND next_attempt_at <= NOW())
             OR (status = 'processing' AND lease_expires_at <= NOW())
          ORDER BY next_attempt_at ASC, created_at ASC
          LIMIT $1
          FOR UPDATE SKIP LOCKED
       )
       UPDATE relationship_change_outbox outbox
          SET status = 'processing',
              attempt_count = outbox.attempt_count + 1,
              locked_at = NOW(),
              lock_token = $3,
              lease_expires_at = NOW() + ($2::bigint * INTERVAL '1 millisecond'),
              updated_at = NOW()
         FROM claimable
        WHERE outbox.event_id = claimable.event_id
       RETURNING outbox.*`,
      [config.batchSize, config.leaseMs, lockToken],
    );
    return rows;
  });
}

function eventFromOutboxRow(row) {
  return parseRelationshipChange({
    version: Number(row.version),
    eventId: row.event_id,
    kind: row.kind,
    userIds: row.user_ids,
    actorUserId: row.actor_user_id,
    occurredAt: new Date(row.occurred_at).toISOString(),
  });
}

async function markDelivered(pool, eventId, lockToken) {
  const result = await pool.query(
    `UPDATE relationship_change_outbox
        SET status = 'delivered', delivered_at = COALESCE(delivered_at, NOW()),
            locked_at = NULL, lock_token = NULL, lease_expires_at = NULL,
            last_error = '', updated_at = NOW()
      WHERE event_id = $1 AND status = 'processing' AND lock_token = $2`,
    [eventId, lockToken],
  );
  if (Number(result.rowCount) !== 1) throw new Error('Relationship outbox delivery lease was lost');
}

async function markFailed(pool, row, error, config) {
  const permanent = error?.code === 'RELATIONSHIP_OUTBOX_PERMANENT';
  const poisonCount = Number(row.poison_count) || 0;
  const deadLetter = permanent && poisonCount + 1 >= config.maxAttempts;
  const delayMs = retryDelayMs(row.attempt_count, config);
  const result = await pool.query(
    `UPDATE relationship_change_outbox
        SET status = $2,
            next_attempt_at = CASE
              WHEN $2 = 'pending' THEN NOW() + ($3::bigint * INTERVAL '1 millisecond')
              ELSE next_attempt_at
            END,
            locked_at = NULL,
            lock_token = NULL,
            lease_expires_at = NULL,
            poison_count = poison_count + $6,
            last_error = $4,
            updated_at = NOW()
      WHERE event_id = $1 AND status = 'processing' AND lock_token = $5`,
    [
      row.event_id,
      deadLetter ? 'dead_letter' : 'pending',
      delayMs,
      String(error instanceof Error ? error.message : error).slice(0, 1000),
      row.lock_token,
      permanent ? 1 : 0,
    ],
  );
  if (Number(result.rowCount) !== 1) throw new Error('Relationship outbox failure lease was lost');
  return deadLetter ? 'dead_letter' : 'retry';
}

async function deliverRelationshipOutboxBatch({
  pool,
  redis,
  config = relationshipOutboxConfig(),
  projectEvent,
  onResult,
}) {
  if (!redis || typeof redis.publish !== 'function')
    throw new Error('Relationship outbox Redis publisher is unavailable');
  const rows = await claimRelationshipChanges(pool, config);
  const result = { claimed: rows.length, delivered: 0, retried: 0, deadLettered: 0 };
  for (const row of rows) {
    try {
      const event = eventFromOutboxRow(row);
      if (!event) throw new RelationshipOutboxPermanentError('Relationship outbox row is malformed');
      await projectEvent?.(event);
      const subscriberCount = Number(await redis.publish(RELATIONSHIP_CHANGE_CHANNEL, JSON.stringify(event)));
      if (!Number.isFinite(subscriberCount) || subscriberCount < 1) {
        throw new Error('Relationship event has no active subscribers');
      }
      await markDelivered(pool, row.event_id, row.lock_token);
      result.delivered += 1;
      onResult?.('delivered');
    } catch (error) {
      const status = await markFailed(pool, row, error, config);
      if (status === 'dead_letter') result.deadLettered += 1;
      else result.retried += 1;
      onResult?.(status);
    }
  }
  return result;
}

async function redriveRelationshipChange(pool, eventId) {
  const result = await pool.query(
    `UPDATE relationship_change_outbox
        SET status = 'pending', attempt_count = 0, poison_count = 0, next_attempt_at = NOW(),
            locked_at = NULL, lock_token = NULL, lease_expires_at = NULL,
            last_error = '', updated_at = NOW()
      WHERE event_id = $1 AND status = 'dead_letter'
      RETURNING event_id`,
    [String(eventId || '').trim()],
  );
  return Number(result.rowCount) > 0;
}

function createRelationshipOutboxWorker({
  pool,
  redis,
  intervalMs = 500,
  config,
  projectEvent,
  onResult,
  onBatch,
  onError,
} = {}) {
  const delay = boundedInteger(intervalMs, 500, 100, 60_000);
  let timer = null;
  let running = false;
  let stopping = false;
  const runOnce = async () => {
    if (running || stopping) return { skipped: true };
    running = true;
    try {
      const result = await deliverRelationshipOutboxBatch({ pool, redis, config, projectEvent, onResult });
      await onBatch?.(result);
      return result;
    } catch (error) {
      onError?.(error);
      throw error;
    } finally {
      running = false;
    }
  };
  const tick = () => {
    void runOnce().catch(() => undefined);
  };
  return {
    runOnce,
    start() {
      if (timer || stopping) return;
      tick();
      timer = setInterval(tick, delay);
      timer.unref?.();
    },
    async stop() {
      stopping = true;
      if (timer) clearInterval(timer);
      timer = null;
      while (running) await new Promise((resolve) => setTimeout(resolve, 10));
    },
  };
}

async function relationshipOutboxStats(pool) {
  const { rows } = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE status IN ('pending', 'processing'))::integer AS pending,
            COUNT(*) FILTER (WHERE status = 'dead_letter')::integer AS dead_letter,
            COALESCE(EXTRACT(EPOCH FROM (NOW() - MIN(created_at)
              FILTER (WHERE status IN ('pending', 'processing')))), 0)::double precision AS oldest_age_seconds
       FROM relationship_change_outbox`,
  );
  return {
    pending: Math.max(0, Number(rows[0]?.pending) || 0),
    deadLetter: Math.max(0, Number(rows[0]?.dead_letter) || 0),
    oldestAgeSeconds: Math.max(0, Number(rows[0]?.oldest_age_seconds) || 0),
  };
}

module.exports = {
  DEFAULT_BASE_RETRY_MS,
  DEFAULT_BATCH_SIZE,
  DEFAULT_LEASE_MS,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_MAX_RETRY_MS,
  RelationshipOutboxPermanentError,
  claimRelationshipChanges,
  createRelationshipOutboxWorker,
  deliverRelationshipOutboxBatch,
  enqueueRelationshipChange,
  eventFromOutboxRow,
  relationshipOutboxConfig,
  relationshipOutboxStats,
  redriveRelationshipChange,
  retryDelayMs,
};
