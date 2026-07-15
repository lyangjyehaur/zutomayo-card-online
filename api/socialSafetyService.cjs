/* global module */

const { normalizeUserId } = require('./friendService.cjs');
const { AccountMutationError, acquireAccountMutationLocks } = require('./accountMutationLock.cjs');
const { enqueueRelationshipChange } = require('./relationshipOutbox.cjs');

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

async function withRelationshipTransaction(pool, userIds, operation) {
  try {
    return await withTransaction(pool, async (client) => {
      await acquireAccountMutationLocks(client, userIds);
      return operation(client);
    });
  } catch (error) {
    if (error instanceof AccountMutationError) return { ok: false, status: 404, error: 'User not found' };
    throw error;
  }
}

async function createFriendRequest({ pool, userId, targetUserId }) {
  const requester = normalizeUserId(userId);
  const recipient = normalizeUserId(targetUserId);
  if (!requester) return { ok: false, status: 401, error: 'Unauthorized' };
  if (!recipient || requester === recipient) return { ok: false, status: 400, error: 'Invalid friend user' };

  return withRelationshipTransaction(pool, [requester, recipient], async (client) => {
    const blocked = (
      await client.query(
        `SELECT 1 FROM user_blocks
       WHERE (blocker_user_id = $1 AND blocked_user_id = $2)
          OR (blocker_user_id = $2 AND blocked_user_id = $1)
       LIMIT 1`,
        [requester, recipient],
      )
    ).rows[0];
    if (blocked) return { ok: false, status: 403, error: 'Friend request is not allowed' };

    const existingFriend = (
      await client.query('SELECT created_at FROM user_friends WHERE user_id = $1 AND friend_user_id = $2', [
        requester,
        recipient,
      ])
    ).rows[0];
    if (existingFriend) {
      await enqueueRelationshipChange(client, 'friendship_added', [requester, recipient], {
        idempotencyKey: `friendship_added:${requester}:${recipient}:${new Date(existingFriend.created_at).toISOString()}`,
      });
      return { ok: true, body: { accepted: true, friendUserId: recipient } };
    }

    const request = (
      await client.query(
        `INSERT INTO friend_requests (requester_user_id, recipient_user_id, status, updated_at)
       VALUES ($1, $2, 'pending', NOW())
       ON CONFLICT (requester_user_id, recipient_user_id)
       DO UPDATE SET status = 'pending', updated_at = NOW()
       RETURNING id, status, created_at, updated_at`,
        [requester, recipient],
      )
    ).rows[0];
    return { ok: true, body: { request, friendUserId: recipient } };
  });
}

async function listFriendRequests({ pool, userId }) {
  const cleanUserId = normalizeUserId(userId);
  if (!cleanUserId) return { ok: false, status: 401, error: 'Unauthorized' };
  const { rows } = await pool.query(
    `SELECT fr.id, fr.requester_user_id, fr.recipient_user_id, fr.status,
            fr.created_at, fr.updated_at, u.nickname
     FROM friend_requests fr
     JOIN users u ON u.id = CASE
       WHEN fr.requester_user_id = $1 THEN fr.recipient_user_id
       ELSE fr.requester_user_id
     END
     WHERE (fr.requester_user_id = $1 OR fr.recipient_user_id = $1)
       AND fr.status = 'pending'
       AND NOT EXISTS (
         SELECT 1
         FROM user_blocks b
         WHERE (b.blocker_user_id = fr.requester_user_id AND b.blocked_user_id = fr.recipient_user_id)
            OR (b.blocker_user_id = fr.recipient_user_id AND b.blocked_user_id = fr.requester_user_id)
       )
     ORDER BY fr.created_at DESC`,
    [cleanUserId],
  );
  return { ok: true, body: { requests: rows } };
}

async function respondToFriendRequest({ pool, userId, requestId, accept }) {
  const recipient = normalizeUserId(userId);
  const cleanRequestId = Number(requestId);
  if (!recipient) return { ok: false, status: 401, error: 'Unauthorized' };
  if (!Number.isSafeInteger(cleanRequestId) || cleanRequestId <= 0) {
    return { ok: false, status: 400, error: 'Invalid friend request' };
  }

  return withTransaction(pool, async (client) => {
    const candidate = (
      await client.query(
        `SELECT requester_user_id, recipient_user_id
         FROM friend_requests
         WHERE id = $1 AND recipient_user_id = $2`,
        [cleanRequestId, recipient],
      )
    ).rows[0];
    if (!candidate) return { ok: false, status: 404, error: 'Friend request not found' };
    try {
      await acquireAccountMutationLocks(client, [candidate.requester_user_id, candidate.recipient_user_id]);
    } catch (error) {
      if (error instanceof AccountMutationError) return { ok: false, status: 404, error: 'User not found' };
      throw error;
    }
    const request = (
      await client.query(
        `SELECT requester_user_id, recipient_user_id
         FROM friend_requests
         WHERE id = $1 AND recipient_user_id = $2 AND status = 'pending'
         FOR UPDATE`,
        [cleanRequestId, recipient],
      )
    ).rows[0];
    if (!request) return { ok: false, status: 404, error: 'Friend request not found' };

    if (accept) {
      const blocked = (
        await client.query(
          `SELECT 1 FROM user_blocks
           WHERE (blocker_user_id = $1 AND blocked_user_id = $2)
              OR (blocker_user_id = $2 AND blocked_user_id = $1)
           LIMIT 1`,
          [request.requester_user_id, request.recipient_user_id],
        )
      ).rows[0];
      if (blocked) return { ok: false, status: 403, error: 'Friend request is not allowed' };
    }

    await client.query(
      `UPDATE friend_requests
       SET status = $1, updated_at = NOW(), responded_at = NOW()
       WHERE id = $2 AND recipient_user_id = $3 AND status = 'pending'`,
      [accept ? 'accepted' : 'rejected', cleanRequestId, recipient],
    );

    if (accept) {
      await client.query(
        `INSERT INTO user_friends (user_id, friend_user_id)
         VALUES ($1, $2), ($2, $1)
         ON CONFLICT (user_id, friend_user_id) DO NOTHING`,
        [request.requester_user_id, request.recipient_user_id],
      );
      await enqueueRelationshipChange(
        client,
        'friendship_added',
        [request.requester_user_id, request.recipient_user_id],
        {
          idempotencyKey: `friend_request:${cleanRequestId}:accepted`,
        },
      );
    }
    return {
      ok: true,
      body: {
        accepted: Boolean(accept),
        friendUserId: request.requester_user_id,
      },
    };
  });
}

async function listBlocks({ pool, userId }) {
  const blocker = normalizeUserId(userId);
  if (!blocker) return { ok: false, status: 401, error: 'Unauthorized' };
  const { rows } = await pool.query(
    `SELECT b.blocked_user_id, b.created_at, u.nickname
     FROM user_blocks b
     JOIN users u ON u.id = b.blocked_user_id
     WHERE b.blocker_user_id = $1
     ORDER BY b.created_at DESC`,
    [blocker],
  );
  return { ok: true, body: { blocks: rows } };
}

async function blockUser({ pool, userId, targetUserId }) {
  const blocker = normalizeUserId(userId);
  const blocked = normalizeUserId(targetUserId);
  if (!blocker) return { ok: false, status: 401, error: 'Unauthorized' };
  if (!blocked || blocker === blocked) return { ok: false, status: 400, error: 'Invalid blocked user' };

  return withRelationshipTransaction(pool, [blocker, blocked], async (client) => {
    const insertedBlock = (
      await client.query(
        `INSERT INTO user_blocks (blocker_user_id, blocked_user_id)
       VALUES ($1, $2)
       ON CONFLICT (blocker_user_id, blocked_user_id) DO NOTHING
       RETURNING created_at`,
        [blocker, blocked],
      )
    ).rows[0];
    await client.query(
      `DELETE FROM user_friends
       WHERE (user_id = $1 AND friend_user_id = $2)
          OR (user_id = $2 AND friend_user_id = $1)`,
      [blocker, blocked],
    );
    await client.query(
      `DELETE FROM friend_requests
       WHERE (requester_user_id = $1 AND recipient_user_id = $2)
          OR (requester_user_id = $2 AND recipient_user_id = $1)`,
      [blocker, blocked],
    );
    if (insertedBlock) {
      await enqueueRelationshipChange(client, 'block_created', [blocker, blocked], {
        actorUserId: blocker,
        idempotencyKey: `block_created:${blocker}:${blocked}:${new Date(insertedBlock.created_at).toISOString()}`,
      });
    }
    return { ok: true, body: { blocked: true, userId: blocked } };
  });
}

async function unblockUser({ pool, userId, targetUserId }) {
  const blocker = normalizeUserId(userId);
  const blocked = normalizeUserId(targetUserId);
  if (!blocker) return { ok: false, status: 401, error: 'Unauthorized' };
  if (!blocked || blocker === blocked) return { ok: false, status: 400, error: 'Invalid blocked user' };
  return withRelationshipTransaction(pool, [blocker, blocked], async (client) => {
    const removedBlock = (
      await client.query(
        `DELETE FROM user_blocks
         WHERE blocker_user_id = $1 AND blocked_user_id = $2
         RETURNING created_at`,
        [blocker, blocked],
      )
    ).rows[0];
    if (removedBlock) {
      await enqueueRelationshipChange(client, 'block_removed', [blocker, blocked], {
        actorUserId: blocker,
        idempotencyKey: `block_removed:${blocker}:${blocked}:${new Date(removedBlock.created_at).toISOString()}`,
      });
    }
    return { ok: true, body: { blocked: false, userId: blocked } };
  });
}

module.exports = {
  blockUser,
  createFriendRequest,
  listBlocks,
  listFriendRequests,
  respondToFriendRequest,
  unblockUser,
};
