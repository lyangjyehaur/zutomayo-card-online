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
const pool = new Pool({
  host: process.env.PG_HOST || 'postgres',
  port: Number(process.env.PG_PORT) || 5432,
  user: process.env.PG_API_USER,
  password: process.env.PG_API_PASSWORD,
  database: process.env.PG_DATABASE,
  max: 4,
});
const redisUrl = process.env.REDIS_URL;
const publisher = new Redis(redisUrl, { maxRetriesPerRequest: 1 });

const config = {
  batchSize: 1,
  leaseMs: 5_000,
  maxAttempts: 3,
  baseRetryMs: 100,
  maxRetryMs: 1_000,
  jitterRatio: 0,
};

async function enqueue(id) {
  return enqueueRelationshipChange(pool, 'friendship_removed', [`${id}_a`, `${id}_b`], {
    idempotencyKey: `${prefix}:${id}`,
  });
}

async function createSubscriber() {
  const client = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
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

    await pool.query('DELETE FROM relationship_change_outbox WHERE idempotency_key LIKE $1', [`${prefix}:%`]);

    const subscriberCount = await publisher.pubsub('NUMSUB', RELATIONSHIP_CHANGE_CHANNEL);
    assert.equal(Number(subscriberCount[1]), 0);
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
    } finally {
      await worker.stop();
      await activeSubscriber.client.quit();
    }

    process.stdout.write('Relationship outbox PostgreSQL/Redis smoke passed\n');
  } finally {
    await pool.query('DELETE FROM relationship_change_outbox WHERE idempotency_key LIKE $1', [`${prefix}:%`]);
    await publisher.quit();
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
