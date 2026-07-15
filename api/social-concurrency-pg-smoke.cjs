#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { deleteAccount } = require('./accountLifecycleService.cjs');
const { blockUser, respondToFriendRequest } = require('./socialSafetyService.cjs');

const prefix = `social-race:${process.pid}:${Date.now()}`;
const pool = new Pool({
  host: process.env.PG_HOST || 'postgres',
  port: Number(process.env.PG_PORT) || 5432,
  user: process.env.PG_USER || process.env.PG_API_USER,
  password: process.env.PG_PASSWORD || process.env.PG_API_PASSWORD,
  database: process.env.PG_DATABASE,
  max: 8,
});

const ACCOUNT_LOCK_PREFIX = 'legal-hold:account:';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createScenario(label) {
  const requester = `${prefix}:${label}:requester`;
  const recipient = `${prefix}:${label}:recipient`;
  await pool.query(
    `INSERT INTO users (id, email, password_hash, salt, nickname)
     VALUES ($1, $2, 'smoke', 'smoke', $3), ($4, $5, 'smoke', 'smoke', $6)`,
    [requester, `${requester}@invalid.local`, requester, recipient, `${recipient}@invalid.local`, recipient],
  );
  const request = (
    await pool.query(
      `INSERT INTO friend_requests (requester_user_id, recipient_user_id, status, updated_at)
       VALUES ($1, $2, 'pending', NOW())
       RETURNING id`,
      [requester, recipient],
    )
  ).rows[0];
  return { requester, recipient, requestId: request.id };
}

async function holdAccountLocks(client, userIds) {
  await client.query('BEGIN');
  for (const userId of [...userIds].sort()) {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${ACCOUNT_LOCK_PREFIX}${userId}`]);
  }
}

async function waitForAdvisoryWaiter() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::integer AS waiting
         FROM pg_locks
        WHERE locktype = 'advisory' AND granted = FALSE`,
    );
    if (Number(rows[0]?.waiting) > 0) return;
    await sleep(20);
  }
  throw new Error('Timed out waiting for a social mutation to queue on the account lock');
}

async function removeScenarioRows(scenario) {
  await pool.query('DELETE FROM relationship_change_outbox WHERE idempotency_key LIKE $1', [`%${scenario.requester}%`]);
  await pool.query(
    `DELETE FROM friend_requests
      WHERE requester_user_id = $1 OR recipient_user_id = $1`,
    [scenario.requester],
  );
  await pool.query(
    `DELETE FROM user_blocks
      WHERE blocker_user_id = $1 OR blocked_user_id = $1`,
    [scenario.requester],
  );
  await pool.query(
    `DELETE FROM user_friends
      WHERE user_id = $1 OR friend_user_id = $1`,
    [scenario.requester],
  );
}

async function blockBeforeAcceptRace() {
  const scenario = await createScenario('block');
  const holder = await pool.connect();
  try {
    await holdAccountLocks(holder, [scenario.requester, scenario.recipient]);
    const blocking = blockUser({ pool, userId: scenario.recipient, targetUserId: scenario.requester });
    await waitForAdvisoryWaiter();
    const accepting = respondToFriendRequest({
      pool,
      userId: scenario.recipient,
      requestId: scenario.requestId,
      accept: true,
    });
    await sleep(50);
    await holder.query('COMMIT');
    const [blockResult, acceptResult] = await Promise.all([blocking, accepting]);
    assert.equal(blockResult.ok, true);
    assert.equal(acceptResult.status, 404);

    const state = (
      await pool.query(
        `SELECT
           (SELECT COUNT(*) FROM user_blocks WHERE blocker_user_id = $1 AND blocked_user_id = $2)::integer AS blocks,
           (SELECT COUNT(*) FROM user_friends WHERE user_id = $1 OR user_id = $2)::integer AS friends,
           (SELECT COUNT(*) FROM friend_requests WHERE id = $3)::integer AS requests`,
        [scenario.recipient, scenario.requester, scenario.requestId],
      )
    ).rows[0];
    assert.deepEqual(state, { blocks: 1, friends: 0, requests: 0 });
  } finally {
    await holder.query('ROLLBACK').catch(() => undefined);
    holder.release();
    await removeScenarioRows(scenario);
  }
}

async function deleteBeforeAcceptRace() {
  const scenario = await createScenario('delete');
  const holder = await pool.connect();
  try {
    await holdAccountLocks(holder, [scenario.requester, scenario.recipient]);
    const deleting = deleteAccount({ pool, userId: scenario.recipient });
    await waitForAdvisoryWaiter();
    const accepting = respondToFriendRequest({
      pool,
      userId: scenario.recipient,
      requestId: scenario.requestId,
      accept: true,
    });
    await sleep(50);
    await holder.query('COMMIT');
    const [deleteResult, acceptResult] = await Promise.all([deleting, accepting]);
    assert.equal(deleteResult.ok, true);
    assert.equal(acceptResult.status, 404);

    const state = (
      await pool.query(
        `SELECT
           (SELECT deleted_at IS NOT NULL FROM users WHERE id = $1) AS deleted,
           (SELECT COUNT(*) FROM user_friends WHERE user_id = $1 OR friend_user_id = $1)::integer AS friends,
           (SELECT COUNT(*) FROM friend_requests WHERE requester_user_id = $1 OR recipient_user_id = $1)::integer AS requests,
           (SELECT COUNT(*) FROM user_blocks WHERE blocker_user_id = $1 OR blocked_user_id = $1)::integer AS blocks,
           (SELECT COUNT(*) FROM relationship_change_outbox WHERE idempotency_key = $2 AND kind = 'account_deleted')::integer AS deletion_events`,
        [scenario.recipient, `account_deleted:${scenario.recipient}`],
      )
    ).rows[0];
    assert.deepEqual(state, { deleted: true, friends: 0, requests: 0, blocks: 0, deletion_events: 1 });
  } finally {
    await holder.query('ROLLBACK').catch(() => undefined);
    holder.release();
    await removeScenarioRows(scenario);
  }
}

async function main() {
  try {
    await blockBeforeAcceptRace();
    await deleteBeforeAcceptRace();
    process.stdout.write('Social PostgreSQL concurrency smoke passed\n');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
