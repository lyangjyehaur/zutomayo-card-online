/* global module, require */

const crypto = require('crypto');
const { findActiveLegalHoldForAccount } = require('./legalHoldService.cjs');
const { AccountMutationError, acquireAccountMutationLocks } = require('./accountMutationLock.cjs');

const ACCOUNT_ACTIONS = new Set(['verify_email', 'reset_password']);
const DEFAULT_TOKEN_TTL_SECONDS = 30 * 60;
const DEFAULT_ACCOUNT_EXPORT_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_ACCOUNT_EXPORT_MAX_ROWS_PER_COLLECTION = 2_000;
const MIN_PASSWORD_LENGTH = 12;

function normalizeEmail(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .slice(0, 120);
}

function hashAccountToken(token) {
  return crypto
    .createHash('sha256')
    .update(String(token || ''))
    .digest('hex');
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

async function withReadOnlySnapshot(pool, operation) {
  const client = typeof pool.connect === 'function' ? await pool.connect() : pool;
  const release = typeof client.release === 'function' ? () => client.release() : () => undefined;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
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

async function issueAccountToken({
  pool,
  userId,
  actionType,
  ttlSeconds = DEFAULT_TOKEN_TTL_SECONDS,
  generateToken = () => crypto.randomBytes(32).toString('base64url'),
}) {
  if (!ACCOUNT_ACTIONS.has(actionType)) throw new Error('Unsupported account action');
  const token = generateToken();
  const tokenHash = hashAccountToken(token);
  const lifetime = Math.max(60, Math.min(Number(ttlSeconds) || DEFAULT_TOKEN_TTL_SECONDS, 24 * 60 * 60));

  await withTransaction(pool, async (client) => {
    // Serialize issuance per account so concurrent requests cannot leave two
    // valid reset/verification tokens after each has deleted the old row.
    const user = (await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId])).rows[0];
    if (!user) throw new Error('User not found');
    await client.query(
      `DELETE FROM account_action_tokens
       WHERE user_id = $1 AND action_type = $2 AND consumed_at IS NULL`,
      [userId, actionType],
    );
    await client.query(
      `INSERT INTO account_action_tokens
         (user_id, action_type, token_hash, expires_at)
       VALUES ($1, $2, $3, NOW() + ($4 * INTERVAL '1 second'))`,
      [userId, actionType, tokenHash, lifetime],
    );
  });

  return { token, expiresIn: lifetime };
}

async function requestEmailVerification({ pool, userId, generateToken, ttlSeconds }) {
  const user = (await pool.query('SELECT id, email, email_verified, deleted_at FROM users WHERE id = $1', [userId]))
    .rows[0];
  if (!user || user.deleted_at) return { ok: false, status: 404, error: 'User not found' };
  if (user.email_verified) return { ok: true, body: { alreadyVerified: true } };

  const issued = await issueAccountToken({
    pool,
    userId,
    actionType: 'verify_email',
    generateToken,
    ttlSeconds,
  });
  return { ok: true, body: { email: user.email, ...issued } };
}

async function verifyEmailToken({ pool, token }) {
  const tokenHash = hashAccountToken(token);
  if (!tokenHash || !token) return { ok: false, status: 400, error: 'Invalid verification token' };

  return withTransaction(pool, async (client) => {
    const consumed = (
      await client.query(
        `UPDATE account_action_tokens
         SET consumed_at = NOW()
         WHERE token_hash = $1
           AND action_type = 'verify_email'
           AND consumed_at IS NULL
           AND expires_at > NOW()
         RETURNING user_id`,
        [tokenHash],
      )
    ).rows[0];
    if (!consumed) return { ok: false, status: 400, error: 'Invalid or expired verification token' };
    await client.query('UPDATE users SET email_verified = TRUE WHERE id = $1 AND deleted_at IS NULL', [
      consumed.user_id,
    ]);
    return { ok: true, body: { verified: true } };
  });
}

async function requestPasswordReset({ pool, email, generateToken, ttlSeconds }) {
  const cleanEmail = normalizeEmail(email);
  const user = (await pool.query('SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL', [cleanEmail])).rows[0];
  if (!user) return { ok: true, body: { accepted: true } };

  const issued = await issueAccountToken({
    pool,
    userId: user.id,
    actionType: 'reset_password',
    generateToken,
    ttlSeconds,
  });
  return { ok: true, body: { accepted: true, ...issued } };
}

async function resetPassword({ pool, token, newPassword, hashPassword, generateSalt }) {
  if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      status: 400,
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    };
  }
  const tokenHash = hashAccountToken(token);
  if (!tokenHash || !token) return { ok: false, status: 400, error: 'Invalid reset token' };

  return withTransaction(pool, async (client) => {
    const consumed = (
      await client.query(
        `UPDATE account_action_tokens
         SET consumed_at = NOW()
         WHERE token_hash = $1
           AND action_type = 'reset_password'
           AND consumed_at IS NULL
           AND expires_at > NOW()
         RETURNING user_id`,
        [tokenHash],
      )
    ).rows[0];
    if (!consumed) return { ok: false, status: 400, error: 'Invalid or expired reset token' };

    const salt = generateSalt();
    const passwordHash = await hashPassword(newPassword, salt);
    await client.query(
      `UPDATE users
       SET password_hash = $1, salt = $2, auth_version = auth_version + 1
       WHERE id = $3 AND deleted_at IS NULL`,
      [passwordHash, salt, consumed.user_id],
    );
    return { ok: true, body: { reset: true, revokeSessions: true, userId: consumed.user_id } };
  });
}

/**
 * Verify a password immediately before a destructive account action. Keep the
 * check in the service layer so non-HTTP callers cannot accidentally bypass
 * the step-up requirement when they opt into `requireStepUp`.
 */
async function verifyRecentPassword({
  pool,
  userId,
  currentPassword,
  hashPassword,
  currentIterations = 100000,
  legacyIterations = 10000,
}) {
  if (typeof currentPassword !== 'string' || !currentPassword) {
    return { ok: false, status: 401, error: 'Recent password verification required' };
  }
  const user = (
    await pool.query('SELECT password_hash, salt FROM users WHERE id = $1 AND deleted_at IS NULL', [userId])
  ).rows[0];
  if (!user || typeof user.password_hash !== 'string' || String(user.password_hash).startsWith('oauth:')) {
    return { ok: false, status: 401, error: 'Recent password verification required' };
  }
  const currentHash = await hashPassword(currentPassword, user.salt, currentIterations);
  const legacyHash = await hashPassword(currentPassword, user.salt, legacyIterations);
  if (currentHash !== user.password_hash && legacyHash !== user.password_hash) {
    return { ok: false, status: 401, error: 'Invalid current password' };
  }
  return { ok: true };
}

async function exportAccountData({
  pool,
  userId,
  maxBytes = DEFAULT_ACCOUNT_EXPORT_MAX_BYTES,
  maxRowsPerCollection = DEFAULT_ACCOUNT_EXPORT_MAX_ROWS_PER_COLLECTION,
}) {
  const byteLimit = Math.max(
    64 * 1024,
    Math.min(Number(maxBytes) || DEFAULT_ACCOUNT_EXPORT_MAX_BYTES, 25 * 1024 * 1024),
  );
  const rowLimit = Math.max(
    1,
    Math.min(Number(maxRowsPerCollection) || DEFAULT_ACCOUNT_EXPORT_MAX_ROWS_PER_COLLECTION, 10_000),
  );
  return withReadOnlySnapshot(pool, async (client) => {
    const user = (
      await client.query(
        `SELECT id, email, email_verified, nickname, elo, match_count, wins, created_at
       FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [userId],
      )
    ).rows[0];
    if (!user) return { ok: false, status: 404, error: 'User not found' };

    const queryCollection = (sql) => client.query(sql, [userId, rowLimit + 1]);
    const [
      identities,
      decks,
      matches,
      friends,
      friendRequests,
      blocks,
      chatMessages,
      chatReports,
      feedbackPosts,
      feedbackComments,
      feedbackVotes,
      feedbackReactions,
      sanctions,
      seasonRatings,
      seasonRewards,
      seasonRewardEntitlements,
    ] = await Promise.all([
      client.query(
        `SELECT provider, email, email_verified, display_name, created_at, updated_at
       FROM user_identities WHERE user_id = $1 ORDER BY created_at LIMIT $2`,
        [userId, rowLimit + 1],
      ),
      queryCollection(
        'SELECT id, name, card_ids, created_at, updated_at FROM decks WHERE user_id = $1 ORDER BY created_at LIMIT $2',
      ),
      client.query(
        `SELECT id, source_match_id, player0_id, player1_id, winner_id, loser_id,
              winner_elo_change, loser_elo_change, turns, duration_seconds, rules_version, created_at
       FROM matches WHERE player0_id = $1 OR player1_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [userId, rowLimit + 1],
      ),
      queryCollection(
        'SELECT friend_user_id, created_at FROM user_friends WHERE user_id = $1 ORDER BY created_at LIMIT $2',
      ),
      client.query(
        `SELECT id, requester_user_id, recipient_user_id, status, created_at, updated_at, responded_at
       FROM friend_requests
       WHERE requester_user_id = $1 OR recipient_user_id = $1 ORDER BY created_at LIMIT $2`,
        [userId, rowLimit + 1],
      ),
      queryCollection(
        'SELECT blocked_user_id, created_at FROM user_blocks WHERE blocker_user_id = $1 ORDER BY created_at LIMIT $2',
      ),
      client.query(
        `SELECT m.id, c.type AS conversation_type, m.author_display_name, m.author_role,
              m.content, m.source_language, m.moderation_status, m.created_at, m.edited_at, m.deleted_at
       FROM chat_messages m JOIN chat_conversations c ON c.id = m.conversation_id
       WHERE m.author_user_id = $1 ORDER BY m.created_at DESC LIMIT $2`,
        [userId, rowLimit + 1],
      ),
      client.query(
        `SELECT id, message_id, conversation_id, reason, note, status, created_at, reviewed_at
       FROM chat_reports WHERE reporter_user_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [userId, rowLimit + 1],
      ),
      client.query(
        `SELECT id, title, description, status, tag, created_at, updated_at, edited_at
       FROM feedback_posts WHERE author_user_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [userId, rowLimit + 1],
      ),
      client.query(
        `SELECT id, post_id, content, is_official, created_at, edited_at
       FROM feedback_comments WHERE author_user_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [userId, rowLimit + 1],
      ),
      queryCollection(
        'SELECT post_id, created_at FROM feedback_votes WHERE voter_user_id = $1 ORDER BY created_at DESC LIMIT $2',
      ),
      client.query(
        `SELECT comment_id, emoji, created_at
       FROM feedback_comment_reactions WHERE voter_user_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [userId, rowLimit + 1],
      ),
      client.query(
        `SELECT id, type, status, reason, source_report_id, source_message_id, conversation_id,
              created_at, expires_at, revoked_at, revocation_reason
       FROM chat_user_sanctions WHERE target_user_id = $1 OR created_by_user_id = $1
       ORDER BY created_at DESC LIMIT $2`,
        [userId, rowLimit + 1],
      ),
      queryCollection(
        `SELECT sr.season_id, s.name AS season_name, s.status AS season_status,
                s.starts_at, s.ends_at, sr.rating, sr.match_count, sr.wins,
                sr.placement_complete, sr.updated_at
           FROM season_ratings sr
           JOIN seasons s ON s.id = sr.season_id
          WHERE sr.user_id = $1
          ORDER BY sr.updated_at DESC
          LIMIT $2`,
      ),
      queryCollection(
        `SELECT season_id, final_rank, final_rating, reward_tier, reward_payload,
                granted_at, claimed_at
           FROM season_rewards
          WHERE user_id = $1
          ORDER BY granted_at DESC
          LIMIT $2`,
      ),
      queryCollection(
        `SELECT id, season_id, reward_tier, reward_payload, granted_at
           FROM season_reward_entitlements
          WHERE user_id = $1
          ORDER BY granted_at DESC
          LIMIT $2`,
      ),
    ]);

    const collections = {
      identities,
      decks,
      matches,
      friends,
      friendRequests,
      blocks,
      chatMessages,
      chatReports,
      feedbackPosts,
      feedbackComments,
      feedbackVotes,
      feedbackReactions,
      sanctions,
      seasonRatings,
      seasonRewards,
      seasonRewardEntitlements,
    };
    const oversized = Object.entries(collections).find(([, result]) => result.rows.length > rowLimit);
    if (oversized) {
      return {
        ok: false,
        status: 413,
        error: `Account export exceeds the synchronous row limit for ${oversized[0]}`,
      };
    }

    const body = {
      exportedAt: new Date().toISOString(),
      account: user,
      identities: identities.rows,
      decks: decks.rows,
      matches: matches.rows,
      friends: friends.rows,
      friendRequests: friendRequests.rows,
      blocks: blocks.rows,
      chatMessages: chatMessages.rows,
      chatReports: chatReports.rows,
      feedbackPosts: feedbackPosts.rows,
      feedbackComments: feedbackComments.rows,
      feedbackVotes: feedbackVotes.rows,
      feedbackReactions: feedbackReactions.rows,
      sanctions: sanctions.rows,
      seasonRatings: seasonRatings.rows,
      seasonRewards: seasonRewards.rows,
      seasonRewardEntitlements: seasonRewardEntitlements.rows,
    };
    if (Buffer.byteLength(JSON.stringify(body), 'utf8') > byteLimit) {
      return { ok: false, status: 413, error: 'Account export exceeds the synchronous size limit' };
    }
    return { ok: true, body };
  });
}

async function deleteAccount({
  pool,
  userId,
  requireStepUp = false,
  stepUpVerified = false,
  beforeDelete,
  deletionRequestId,
}) {
  if (requireStepUp && stepUpVerified !== true) {
    return { ok: false, status: 401, error: 'Recent password verification required' };
  }
  return withTransaction(pool, async (client) => {
    // Retention holds a session-level lock for the whole pruning run. Taking
    // the same lock here prevents a delete from racing a retention batch that
    // could otherwise remove or inspect the account's evidence concurrently.
    try {
      await acquireAccountMutationLocks(client, [userId], { includeRetention: true });
    } catch (error) {
      if (error instanceof AccountMutationError) return { ok: false, status: 404, error: 'User not found' };
      throw error;
    }
    const activeLegalHold = await findActiveLegalHoldForAccount(client, userId);
    if (activeLegalHold) {
      return { ok: false, status: 409, error: 'Account deletion is suspended by an active legal hold' };
    }

    // A Logto deletion saga and this legacy local-delete path must not both
    // mutate the same account. When the saga id is supplied, require that the
    // provider phase has completed and finish the local phase in this very
    // transaction. Without an id, reject any in-flight saga so callers cannot
    // bypass the provider tombstone protocol.
    let deletionRequest = null;
    if (deletionRequestId) {
      deletionRequest = (
        await client.query(
          `SELECT id, user_id, provider, status
             FROM account_deletion_requests
            WHERE id = $1 AND user_id = $2
            FOR UPDATE`,
          [deletionRequestId, userId],
        )
      ).rows[0];
      if (!deletionRequest || deletionRequest.provider !== 'logto') {
        return { ok: false, status: 409, error: 'Account deletion request is not owned by this account' };
      }
      if (deletionRequest.status !== 'provider_deleted') {
        return { ok: false, status: 409, error: 'Account provider deletion has not completed' };
      }
    } else {
      const activeRequest = (
        await client.query(
          `SELECT id, status
             FROM account_deletion_requests
            WHERE user_id = $1
              AND status IN ('prepared', 'provider_deleting', 'provider_deleted', 'provider_failed')
            ORDER BY created_at DESC
            LIMIT 1
            FOR UPDATE`,
          [userId],
        )
      ).rows[0];
      if (activeRequest) {
        return {
          ok: false,
          status: 409,
          error: 'Account deletion is already in progress; complete the provider deletion first',
        };
      }
    }

    // Revoke sessions only after the legal-hold decision is serialized, but
    // before mutating the account. This keeps legacy JWTs safe if the durable
    // delete later commits, and avoids logging a held account out needlessly.
    if (typeof beforeDelete === 'function') await beforeDelete();

    await client.query('DELETE FROM user_identities WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM deck_reservations WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM decks WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM user_friends WHERE user_id = $1 OR friend_user_id = $1', [userId]);
    await client.query('DELETE FROM friend_requests WHERE requester_user_id = $1 OR recipient_user_id = $1', [userId]);
    await client.query('DELETE FROM user_blocks WHERE blocker_user_id = $1 OR blocked_user_id = $1', [userId]);
    await client.query('DELETE FROM account_action_tokens WHERE user_id = $1', [userId]);
    // These rows are live access/session evidence, not immutable match
    // history. Remove them so a tombstoned account cannot remain discoverable
    // through platform presence, room membership, or a reconnect credential.
    await client.query('DELETE FROM platform_match_participants WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM platform_room_participants WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM bjg_match_seats WHERE user_id = $1', [userId]);
    // A result outbox row may still be pending when the provider deletion
    // finishes. Preserve the delivery audit row, but make it explicitly
    // unrated and remove all account identities so a retry cannot recreate a
    // personal result after deletion.
    await client.query(
      `UPDATE bjg_match_result_outbox
          SET player0_user_id = CASE WHEN player0_user_id = $1 THEN NULL ELSE player0_user_id END,
              player1_user_id = CASE WHEN player1_user_id = $1 THEN NULL ELSE player1_user_id END,
              winner_user_id = CASE WHEN winner_user_id = $1 THEN NULL ELSE winner_user_id END,
              loser_user_id = CASE WHEN loser_user_id = $1 THEN NULL ELSE loser_user_id END,
              ranked_eligible = FALSE,
              status = CASE WHEN status IN ('pending', 'processing') THEN 'unrated' ELSE status END,
              action_log = '[]'::jsonb,
              last_error = CASE
                WHEN status IN ('pending', 'processing') THEN 'account deleted before result delivery'
                ELSE last_error
              END,
              updated_at = NOW()
        WHERE player0_user_id = $1 OR player1_user_id = $1
           OR winner_user_id = $1 OR loser_user_id = $1`,
      [userId],
    );
    // Canonical matches retain the opponent's history, but no longer retain
    // this account's identity. Mark the row fully anonymized only when every
    // participant identity has been removed; retention can then safely skip it.
    await client.query(
      `WITH touched AS (
             SELECT id
               FROM matches
              WHERE player0_id = $1 OR player1_id = $1 OR winner_id = $1 OR loser_id = $1
           ), cleared AS (
             UPDATE matches m
                SET player0_id = CASE WHEN m.player0_id = $1 THEN NULL ELSE m.player0_id END,
                    player1_id = CASE WHEN m.player1_id = $1 THEN NULL ELSE m.player1_id END,
                    winner_id = CASE WHEN m.winner_id = $1 THEN NULL ELSE m.winner_id END,
                    loser_id = CASE WHEN m.loser_id = $1 THEN NULL ELSE m.loser_id END
               FROM touched
              WHERE m.id = touched.id
           RETURNING m.id
           )
       UPDATE matches m
          SET anonymized_at = COALESCE(m.anonymized_at, NOW())
         FROM cleared
        WHERE m.id = cleared.id
          AND m.anonymized_at IS NULL
          AND m.player0_id IS NULL AND m.player1_id IS NULL
          AND m.winner_id IS NULL AND m.loser_id IS NULL`,
      [userId],
    );
    // Ratings/rewards are account-derived profile data. Immutable
    // season_match_results remain as audit evidence and are filtered from
    // public views through the users.deleted_at contract.
    await client.query('DELETE FROM season_reward_entitlements WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM season_rewards WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM season_ratings WHERE user_id = $1', [userId]);
    // This value is also used by legacy feedback ownership checks. Make it
    // unpredictable even though deleted authors no longer receive it.
    const tombstoneRef = crypto.randomBytes(16).toString('hex');
    const anonymousRef = `deleted-${tombstoneRef}`;
    await client.query(
      `UPDATE chat_messages
       SET author_user_id = NULL, author_display_name = 'Deleted Player', content = '[redacted]',
           source_language = '', metadata = '{}'::jsonb, deleted_at = COALESCE(deleted_at, NOW())
       WHERE author_user_id = $1`,
      [userId],
    );
    await client.query(
      `UPDATE chat_reports
       SET reporter_user_id = CASE WHEN reporter_user_id = $1 THEN NULL ELSE reporter_user_id END,
           reviewer_user_id = CASE WHEN reviewer_user_id = $1 THEN NULL ELSE reviewer_user_id END,
           reported_message_author_user_id = CASE
             WHEN reported_message_author_user_id = $1 THEN NULL
             ELSE reported_message_author_user_id
           END,
           reported_message_author_display_name = CASE
             WHEN reported_message_author_user_id = $1 THEN 'Deleted Player'
             ELSE reported_message_author_display_name
           END
       WHERE reporter_user_id = $1
          OR reviewer_user_id = $1
          OR reported_message_author_user_id = $1`,
      [userId],
    );
    await client.query('UPDATE chat_moderation_events SET actor_user_id = NULL WHERE actor_user_id = $1', [userId]);
    await client.query(`UPDATE feedback_posts SET author_user_id = NULL, anonymous_id = $2 WHERE author_user_id = $1`, [
      userId,
      anonymousRef,
    ]);
    await client.query(
      `UPDATE feedback_comments SET author_user_id = NULL, anonymous_id = $2 WHERE author_user_id = $1`,
      [userId, anonymousRef],
    );
    await client.query('DELETE FROM feedback_votes WHERE voter_user_id = $1', [userId]);
    await client.query('DELETE FROM feedback_comment_votes WHERE voter_user_id = $1', [userId]);
    await client.query('DELETE FROM feedback_comment_reactions WHERE voter_user_id = $1', [userId]);
    await client.query('DELETE FROM chat_read_states WHERE user_id = $1', [userId]);
    await client.query(
      `UPDATE chat_user_sanctions
       SET created_by_user_id = NULL, revoked_by_user_id = NULL
       WHERE created_by_user_id = $1 OR revoked_by_user_id = $1`,
      [userId],
    );
    await client.query(
      `UPDATE users
       SET email = $2,
           nickname = 'Deleted Player',
           password_hash = $3,
           salt = '',
           email_verified = FALSE,
           auth_version = auth_version + 1,
           elo = 1000,
           match_count = 0,
           wins = 0,
           deleted_at = NOW()
       WHERE id = $1`,
      [userId, `deleted+${tombstoneRef}@invalid.local`, `deleted:${crypto.randomBytes(24).toString('hex')}`],
    );
    if (deletionRequest) {
      await client.query(
        `UPDATE account_deletion_requests
            SET status = 'completed', completed_at = COALESCE(completed_at, NOW()), updated_at = NOW(),
                last_error = ''
          WHERE id = $1 AND user_id = $2 AND status = 'provider_deleted'`,
        [deletionRequest.id, userId],
      );
    }
    return { ok: true, body: { deleted: true } };
  });
}

module.exports = {
  DEFAULT_ACCOUNT_EXPORT_MAX_BYTES,
  DEFAULT_ACCOUNT_EXPORT_MAX_ROWS_PER_COLLECTION,
  DEFAULT_TOKEN_TTL_SECONDS,
  MIN_PASSWORD_LENGTH,
  deleteAccount,
  exportAccountData,
  hashAccountToken,
  issueAccountToken,
  requestEmailVerification,
  requestPasswordReset,
  resetPassword,
  verifyRecentPassword,
  verifyEmailToken,
};
