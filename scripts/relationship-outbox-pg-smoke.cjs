#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { Pool } = require('pg');
const Redis = require('ioredis');
const {
  claimRelationshipChanges,
  createRelationshipOutboxWorker,
  deliverRelationshipOutboxBatch,
  enqueueRelationshipChange,
} = require('../api/relationshipOutbox.cjs');
const { RELATIONSHIP_CHANGE_CHANNEL } = require('../api/relationshipEvents.cjs');

const prefix = `role-smoke:${process.pid}:${Date.now()}`;
const redisDb = Number(process.env.REDIS_DB || 0);
if (!Number.isInteger(redisDb) || redisDb < 0 || redisDb > 15) {
  throw new Error('REDIS_DB must be an integer from 0 through 15');
}
const pool = new Pool({
  host: process.env.PG_HOST || 'postgres',
  port: Number(process.env.PG_PORT) || 5432,
  user: process.env.PG_API_USER,
  password: process.env.PG_API_PASSWORD,
  database: process.env.PG_DATABASE,
  max: 4,
});
const redisUrl = process.env.REDIS_URL;
const redisOptions = { db: redisDb, maxRetriesPerRequest: 1 };
const publisher = new Redis(redisUrl, redisOptions);
const createdEventIds = [];

const config = {
  batchSize: 1,
  leaseMs: 5_000,
  maxAttempts: 3,
  baseRetryMs: 100,
  maxRetryMs: 1_000,
  jitterRatio: 0,
};

async function enqueue(id) {
  const event = await enqueueRelationshipChange(pool, 'friendship_removed', [`${id}_a`, `${id}_b`], {
    idempotencyKey: `${prefix}:${id}`,
  });
  createdEventIds.push(event.eventId);
  return event;
}

async function removeCreatedEvents() {
  if (createdEventIds.length === 0) return;
  await pool.query('DELETE FROM relationship_change_outbox WHERE event_id = ANY($1::text[])', [createdEventIds]);
}

async function verifyRedisAclContract() {
  const stringKey = `refresh:${prefix}:acl:string`;
  const counterKey = `ratelimit:${prefix}:acl:counter`;
  const hashKey = `relationship:${prefix}:acl:hash`;
  const setKey = `relationship:blocked:${prefix}:acl:set`;
  const sortedSetKey = `presence:${prefix}:acl:zset`;
  const keys = [stringKey, counterKey, hashKey, setKey, sortedSetKey];
  try {
    assert.equal(publisher.options.db, redisDb);
    assert.equal(await publisher.ping(), 'PONG');
    assert.equal(await publisher.set(stringKey, 'owner', 'EX', 60, 'NX'), 'OK');
    assert.equal(await publisher.get(stringKey), 'owner');
    assert.deepEqual(await publisher.mget(stringKey, `${prefix}:acl:missing`), ['owner', null]);
    assert.equal(await publisher.expire(stringKey, 60), 1);
    assert.equal(await publisher.incr(counterKey), 1);

    assert.equal(await publisher.hset(hashKey, 'field', 'value', 'remove', 'me'), 2);
    assert.equal(await publisher.hget(hashKey, 'field'), 'value');
    assert.deepEqual(await publisher.hgetall(hashKey), { field: 'value', remove: 'me' });
    assert.equal(await publisher.hdel(hashKey, 'remove'), 1);

    assert.equal(await publisher.sadd(setKey, 'member'), 1);
    assert.equal(await publisher.sismember(setKey, 'member'), 1);
    assert.equal(await publisher.srem(setKey, 'member'), 1);

    assert.equal(await publisher.zadd(sortedSetKey, 1, 'first'), 1);
    assert.equal(await publisher.zcard(sortedSetKey), 1);
    assert.equal(await publisher.zcount(sortedSetKey, 0, 2), 1);
    assert.equal(await publisher.zremrangebyscore(sortedSetKey, 0, 1), 1);
    assert.equal(await publisher.zadd(sortedSetKey, 2, 'second'), 1);
    assert.equal(await publisher.zrem(sortedSetKey, 'second'), 1);

    assert.equal(await publisher.eval(`return redis.call('GET', KEYS[1])`, 1, stringKey), 'owner');
    let cursor = '0';
    let foundStringKey = false;
    do {
      const [nextCursor, found] = await publisher.scan(cursor, 'MATCH', `refresh:${prefix}:acl:*`, 'COUNT', 20);
      foundStringKey ||= found.includes(stringKey);
      cursor = String(nextCursor);
    } while (cursor !== '0');
    assert.equal(foundStringKey, true);
    assert.equal(await publisher.getdel(stringKey), 'owner');
    assert.equal(
      Number.isFinite(Number(await publisher.publish(`${RELATIONSHIP_CHANGE_CHANNEL}:acl-smoke`, 'probe'))),
      true,
    );
  } finally {
    await publisher.del(...keys);
  }
}

async function createSubscriber() {
  const client = new Redis(redisUrl, redisOptions);
  let resolveReceived;
  let rejectReceived;
  const received = new Promise((resolve, reject) => {
    resolveReceived = resolve;
    rejectReceived = reject;
  });
  const timeout = setTimeout(() => rejectReceived(new Error('Timed out waiting for relationship event')), 5_000);
  client.on('message', (channel, payload) => {
    if (channel !== RELATIONSHIP_CHANGE_CHANNEL) return;
    clearTimeout(timeout);
    try {
      resolveReceived(JSON.parse(payload));
    } catch (error) {
      rejectReceived(error);
    }
  });
  await client.subscribe(RELATIONSHIP_CHANGE_CHANNEL);
  return { client, received };
}

async function forceRetryNow(eventId) {
  await pool.query(
    `UPDATE relationship_change_outbox
        SET next_attempt_at = NOW()
      WHERE event_id = $1 AND status = 'pending'`,
    [eventId],
  );
}

async function waitForDelivered(eventId, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await pool.query('SELECT status FROM relationship_change_outbox WHERE event_id = $1', [eventId]);
    if (rows[0]?.status === 'delivered') return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${eventId} to be delivered`);
}

async function main() {
  try {
    await verifyRedisAclContract();

    await enqueue('concurrent-1');
    await enqueue('concurrent-2');
    const [first, second] = await Promise.all([
      claimRelationshipChanges(pool, config),
      claimRelationshipChanges(pool, config),
    ]);
    assert.equal(first.length, 1);
    assert.equal(second.length, 1);
    assert.notEqual(first[0].event_id, second[0].event_id);
    assert.notEqual(first[0].lock_token, second[0].lock_token);

    const stale = await enqueue('stale-lease');
    await pool.query(
      `UPDATE relationship_change_outbox
          SET status = 'processing', lease_expires_at = NOW() - INTERVAL '1 second', lock_token = 'stale-lock'
        WHERE event_id = $1`,
      [stale.eventId],
    );
    const reclaimed = await claimRelationshipChanges(pool, config);
    assert.equal(reclaimed[0]?.event_id, stale.eventId);
    assert.notEqual(reclaimed[0]?.lock_token, 'stale-lock');
    const staleLeaseUpdate = await pool.query(
      `UPDATE relationship_change_outbox
          SET status = 'delivered'
        WHERE event_id = $1 AND status = 'processing' AND lock_token = 'stale-lock'`,
      [stale.eventId],
    );
    assert.equal(staleLeaseUpdate.rowCount, 0);

    await removeCreatedEvents();

    const offline = await enqueue('offline');
    for (let attempt = 0; attempt < config.maxAttempts + 1; attempt += 1) {
      if (attempt > 0) await forceRetryNow(offline.eventId);
      const noSubscriber = await deliverRelationshipOutboxBatch({ pool, redis: publisher, config });
      assert.equal(noSubscriber.retried, 1);
    }
    const pending = (
      await pool.query(
        'SELECT status, attempt_count, poison_count FROM relationship_change_outbox WHERE event_id = $1',
        [offline.eventId],
      )
    ).rows[0];
    assert.deepEqual(pending, { status: 'pending', attempt_count: config.maxAttempts + 1, poison_count: 0 });

    await forceRetryNow(offline.eventId);
    const activeSubscriber = await createSubscriber();
    const worker = createRelationshipOutboxWorker({ pool, redis: publisher, config, intervalMs: 100 });
    try {
      worker.start();
      const [received] = await Promise.all([activeSubscriber.received, waitForDelivered(offline.eventId)]);
      assert.equal(received.eventId, offline.eventId);
      assert.equal(received.kind, 'friendship_removed');
      const deliveredEvidence = (
        await pool.query(
          `SELECT user_ids, identities_redacted_at
             FROM relationship_change_outbox
            WHERE event_id = $1`,
          [offline.eventId],
        )
      ).rows[0];
      assert.deepEqual(deliveredEvidence.user_ids, ['offline_a', 'offline_b']);
      assert.equal(deliveredEvidence.identities_redacted_at, null);
    } finally {
      await worker.stop();
      await activeSubscriber.client.quit();
    }

    process.stdout.write('Relationship outbox PostgreSQL/Redis smoke passed\n');
  } finally {
    await removeCreatedEvents();
    await publisher.quit();
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
