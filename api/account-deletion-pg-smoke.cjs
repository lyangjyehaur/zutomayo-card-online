/* global require */

const crypto = require('node:crypto');
const { Pool } = require('pg');
const { deleteAccount } = require('./accountLifecycleService.cjs');
const { acquireAccountMutationLocks } = require('./accountMutationLock.cjs');
const { createAccountExportWorker } = require('./accountExportService.cjs');
const { createUserDeck, validateDeckInput } = require('./deckService.cjs');
const { deliverRelationshipOutboxBatch } = require('./relationshipOutbox.cjs');
const { postgresConnectionString, postgresSslConfig } = require('./runtimeSecurityConfig.cjs');

function createPool() {
  const connectionString = postgresConnectionString(process.env);
  return new Pool({
    ...(connectionString
      ? { connectionString }
      : {
          host: process.env.PG_HOST,
          port: Number(process.env.PG_PORT) || 5432,
          user: process.env.PG_USER,
          password: process.env.PG_PASSWORD,
          database: process.env.PG_DATABASE,
        }),
    ssl: postgresSslConfig(process.env),
    max: 4,
  });
}

async function seed(pool, fixture) {
  const {
    userId,
    peerId,
    matchId,
    sourceMatchId,
    seasonId,
    conversationId,
    conversationSubjectId,
    deletedMessageId,
    exportJobId,
    retryExportJobId,
    deletionRequestId,
  } = fixture;
  await pool.query(
    `INSERT INTO users (id, email, password_hash, salt, nickname)
     VALUES ($1, $2, 'hash', 'salt', 'Deletion Target'),
            ($3, $4, 'hash', 'salt', 'Deletion Peer')`,
    [userId, `${userId}@example.invalid`, peerId, `${peerId}@example.invalid`],
  );
  await pool.query(
    `INSERT INTO matches
       (id, source_match_id, player0_id, player1_id, winner_id, loser_id, turns, duration_seconds, action_log)
     VALUES ($1, $2, $3, $4, $3, $4, 4, 30, $5::jsonb)`,
    [matchId, sourceMatchId, userId, peerId, JSON.stringify([{ actorUserId: userId }])],
  );
  await pool.query(
    `INSERT INTO seasons (id, name, status, starts_at, ends_at, rules_version)
     VALUES ($1, 'Deletion Smoke', 'active', NOW() - INTERVAL '1 hour', NOW() + INTERVAL '1 hour', 'smoke')`,
    [seasonId],
  );
  await pool.query(
    `INSERT INTO season_match_results
       (season_id, source_match_id, canonical_match_id, winner_user_id, loser_user_id,
        winner_delta, loser_delta, completed_at, rules_version, applied_at)
     VALUES ($1, $2, $3, $4, $5, 16, -16, NOW(), 'smoke', NOW())`,
    [seasonId, sourceMatchId, matchId, userId, peerId],
  );
  await pool.query(
    `INSERT INTO account_export_jobs
       (id, user_id, status, object_key, content_sha256, size_bytes, completed_at, expires_at)
     VALUES ($1, $2, 'ready', $3, $4, 128, NOW() - INTERVAL '1 minute', NOW() + INTERVAL '1 hour'),
            ($5, $2, 'ready', $6, $7, 256, NOW() - INTERVAL '1 minute', NOW() + INTERVAL '1 hour')`,
    [
      exportJobId,
      userId,
      `account-exports/${exportJobId}.json.gz`,
      'a'.repeat(64),
      retryExportJobId,
      `account-exports/${retryExportJobId}.json.gz`,
      'b'.repeat(64),
    ],
  );
  await pool.query(
    `UPDATE account_export_jobs
        SET object_version_id = CASE WHEN id = $1 THEN 'version-success' ELSE 'version-retry' END
      WHERE id IN ($1, $2)`,
    [exportJobId, retryExportJobId],
  );
  await pool.query(
    `INSERT INTO account_export_audit (job_id, user_id, event_type, request_id, details)
     VALUES ($1, $2, 'requested', $3, $4::jsonb)`,
    [exportJobId, userId, `client-request:${userId}`, JSON.stringify({ nested: { userId } })],
  );
  await pool.query(
    `INSERT INTO account_deletion_requests
       (id, user_id, provider, provider_user_id, status, provider_deleted_at)
     VALUES ($1, $2, 'logto', $3, 'provider_deleted', NOW())`,
    [deletionRequestId, userId, `provider:${userId}`],
  );
  await pool.query(
    `INSERT INTO chat_conversations (id, type, subject_id)
     VALUES ($1, 'direct', $2)`,
    [conversationId, conversationSubjectId],
  );
  await pool.query(
    `INSERT INTO chat_messages (id, conversation_id, author_user_id, author_display_name, content)
     VALUES ($1, $2, $3, 'Peer', 'retained peer message'),
            ($4, $2, $5, 'Deletion Target', $6)`,
    [`message:${fixture.prefix}`, conversationId, peerId, deletedMessageId, userId, `deleted source ${userId}`],
  );
  await pool.query(
    `INSERT INTO chat_message_translations
       (message_id, target_language, translated_content, provider, model)
     VALUES ($1, 'en', $2, 'smoke', 'smoke')`,
    [deletedMessageId, `translated copy ${userId}`],
  );
  await pool.query(
    `INSERT INTO chat_read_states (conversation_id, user_id)
     VALUES ($1, $2)`,
    [conversationId, peerId],
  );
  await pool.query(
    `INSERT INTO chat_reports (id, message_id, conversation_id, reason)
     VALUES ($1, $2, $3, 'deletion smoke')`,
    [`report:${fixture.prefix}`, `message:${fixture.prefix}`, conversationId],
  );
  await pool.query(
    `INSERT INTO chat_moderation_events (id, message_id, conversation_id, source, action)
     VALUES ($1, $2, $3, 'smoke', 'reviewed')`,
    [`moderation:${fixture.prefix}`, `message:${fixture.prefix}`, conversationId],
  );
  await pool.query(
    `INSERT INTO legal_holds (id, subject_type, subject_id, reason, owner, released_at)
     VALUES ($1, 'account', $2, 'released deletion smoke', 'test', NOW())`,
    [`hold:${fixture.prefix}`, userId],
  );
  await pool.query(
    `INSERT INTO legal_hold_objects (hold_id, object_type, object_id)
     VALUES ($1, 'account', $2), ($1, 'conversation', $3)`,
    [`hold:${fixture.prefix}`, userId, conversationId],
  );
  await pool.query(
    `INSERT INTO relationship_change_outbox
       (event_id, idempotency_key, kind, user_ids, actor_user_id, occurred_at)
     VALUES ($1, $2, 'block_created', $3::text[], $4, NOW())`,
    [`relationship:${fixture.prefix}`, `block:${userId}:${peerId}`, [userId, peerId], userId],
  );
  const state = {
    _stateID: 7,
    G: {
      step: 'turnSet',
      [`owner:${userId}`]: { userId },
      composite: `actor:${userId}:turn`,
      peer: peerId,
    },
    ctx: { turn: 3, currentPlayer: '0' },
    plugins: {},
  };
  const initialState = {
    _stateID: 0,
    G: { step: 'janken', owner: userId, [`initial:${userId}`]: true },
    ctx: { turn: 0, currentPlayer: '0' },
    plugins: {},
  };
  await pool.query(
    `INSERT INTO bjg_matches (match_id, state, initial_state, metadata, log)
     VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb)`,
    [
      `bgio:${fixture.prefix}`,
      JSON.stringify(state),
      JSON.stringify(initialState),
      JSON.stringify({
        gameName: 'zutomayo',
        players: {
          0: {
            id: 0,
            name: `Deletion Target ${userId}`,
            credentials: `credential:${userId}`,
            data: { userId, composite: `seat:${userId}` },
            isConnected: true,
          },
          1: { id: 1, name: 'Peer Player', data: { userId: peerId } },
        },
        setupData: { [`deck:${userId}`]: `reservation:${userId}` },
      }),
      JSON.stringify([{ action: { payload: { actorUserId: userId } } }]),
    ],
  );
  await pool.query(
    `INSERT INTO bjg_match_seats (match_id, player_id, user_id, credential_hash)
     VALUES ($1, '0', $2, 'credential-user'), ($1, '1', $3, 'credential-peer')`,
    [`bgio:${fixture.prefix}`, userId, peerId],
  );
  await pool.query(
    `INSERT INTO chat_user_sanctions (id, target_user_id, reason, conversation_id)
     VALUES ($1, $2, 'deletion target', $3), ($4, $5, 'peer evidence', $3)`,
    [`sanction:${fixture.prefix}`, userId, conversationId, `sanction-peer:${fixture.prefix}`, peerId],
  );
  await pool.query(
    `INSERT INTO admin_audit_log (action, target_type, target_id, details)
     VALUES ('reset_elo', 'user', $1, $2::jsonb),
            ('legal_hold.create', 'legal_hold', $3, $4::jsonb)`,
    [
      userId,
      JSON.stringify({ actor: `account:${userId}` }),
      `hold:${fixture.prefix}`,
      JSON.stringify({ subjectId: userId }),
    ],
  );
}

async function assertAnonymized(pool, fixture) {
  const { userId, deletionRequestId, exportJobId, retryExportJobId, matchId, conversationId, deletedMessageId } =
    fixture;
  const user = (
    await pool.query(
      `SELECT deleted_at IS NOT NULL AS deleted,
              email LIKE 'deleted+%@invalid.local' AS email_anonymized,
              nickname = 'Deleted Player' AS nickname_anonymized
         FROM users WHERE id = $1`,
      [userId],
    )
  ).rows[0];
  if (!user?.deleted || !user.email_anonymized || !user.nickname_anonymized) {
    throw new Error('users tombstone was not anonymized');
  }

  const invariant = (
    await pool.query(
      `SELECT
         NOT EXISTS (
           SELECT 1 FROM season_match_results
            WHERE winner_user_id = $1 OR loser_user_id = $1
         ) AS season_clean,
         NOT EXISTS (
           SELECT 1 FROM account_export_jobs WHERE user_id = $1
         ) AS export_jobs_clean,
         NOT EXISTS (
           SELECT 1 FROM account_export_audit
            WHERE user_id = $1
               OR COALESCE(request_id, '') LIKE '%' || $1 || '%'
               OR details::text LIKE '%' || $1 || '%'
         ) AS export_audit_clean,
         NOT EXISTS (
           SELECT 1 FROM admin_audit_log
            WHERE COALESCE(target_id, '') LIKE '%' || $1 || '%'
               OR details::text LIKE '%' || $1 || '%'
         ) AS admin_audit_clean,
         NOT EXISTS (
           SELECT 1 FROM account_deletion_requests
            WHERE user_id = $1 OR provider_user_id LIKE '%' || $1 || '%'
         ) AS deletion_audit_clean,
         NOT EXISTS (
           SELECT 1 FROM chat_user_sanctions WHERE target_user_id = $1
         ) AS sanctions_clean,
         NOT EXISTS (
           SELECT 1 FROM chat_conversations
            WHERE id LIKE '%' || $1 || '%' OR subject_id LIKE '%' || $1 || '%'
         ) AS conversations_clean,
         NOT EXISTS (
           SELECT 1 FROM legal_holds WHERE subject_id LIKE '%' || $1 || '%'
         ) AND NOT EXISTS (
           SELECT 1 FROM legal_hold_objects WHERE object_id LIKE '%' || $1 || '%'
         ) AS holds_clean,
         NOT EXISTS (
           SELECT 1 FROM matches
            WHERE action_log::text LIKE '%' || $1 || '%'
         ) AS match_action_log_clean,
         NOT EXISTS (
           SELECT 1 FROM relationship_change_outbox
            WHERE $1 = ANY(user_ids) OR actor_user_id = $1 OR idempotency_key LIKE '%' || $1 || '%'
         ) AS relationship_outbox_clean,
         NOT EXISTS (
           SELECT 1 FROM bjg_matches
            WHERE state::text LIKE '%' || $1 || '%'
               OR initial_state::text LIKE '%' || $1 || '%'
               OR metadata::text LIKE '%' || $1 || '%'
               OR log::text LIKE '%' || $1 || '%'
         ) AS boardgame_clean,
         EXISTS (
           SELECT 1 FROM bjg_matches
            WHERE match_id = $6
              AND state IS NOT NULL
              AND initial_state IS NOT NULL
              AND state->>'_stateID' = '7'
              AND state#>>'{G,step}' = 'turnSet'
              AND initial_state->>'_stateID' = '0'
              AND initial_state#>>'{G,step}' = 'janken'
              AND state::text LIKE '%deleted-boardgame-%'
              AND initial_state::text LIKE '%deleted-boardgame-%'
              AND metadata::text LIKE '%deleted-boardgame-%'
              AND log::text LIKE '%deleted-boardgame-%'
              AND NOT ((metadata #> '{players,0}') ?| ARRAY['name', 'credentials', 'data'])
              AND metadata#>>'{players,0,id}' = '0'
              AND metadata#>>'{players,0,isConnected}' = 'true'
              AND metadata#>>'{players,1,name}' = 'Peer Player'
              AND metadata->>'accountDeletionLocked' = 'true'
              AND jsonb_typeof(log) = 'array'
              AND jsonb_array_length(log) = 1
         ) AS boardgame_payload_retained,
         EXISTS (
           SELECT 1 FROM account_export_jobs
            WHERE id = $2 AND user_id IS NULL AND identity_anonymized_at IS NOT NULL
         ) AS export_job_marked,
         EXISTS (
           SELECT 1 FROM account_export_audit
            WHERE job_id = $2
              AND event_type = 'requested'
              AND user_id IS NULL
              AND request_id IS NULL
              AND details = '{}'::jsonb
              AND identity_anonymized_at IS NOT NULL
         ) AS export_audit_marked,
         EXISTS (
           SELECT 1 FROM account_export_audit
            WHERE job_id = $2 AND event_type = 'purged' AND user_id IS NULL
         ) AS export_purge_audit_anonymous,
         EXISTS (
           SELECT 1 FROM account_export_jobs
            WHERE id = $7
              AND user_id IS NULL
              AND purge_attempt_count = 1
              AND purge_available_at > NOW()
              AND object_key IS NOT NULL
         ) AS export_purge_retry_delayed,
         EXISTS (
           SELECT 1 FROM account_export_audit
            WHERE job_id = $7 AND event_type = 'purge_retry' AND user_id IS NULL
         ) AS export_purge_retry_audit_anonymous,
         EXISTS (
           SELECT 1 FROM account_deletion_requests
            WHERE id = $3 AND status = 'completed' AND identity_anonymized_at IS NOT NULL
         ) AS deletion_marked,
         EXISTS (
           SELECT 1 FROM season_match_results
            WHERE canonical_match_id = $4 AND identity_anonymized_at IS NOT NULL
         ) AS season_marked,
         EXISTS (
           SELECT 1 FROM chat_conversations
            WHERE id LIKE 'direct:v1:%deleted-conversation-%'
              AND subject_id LIKE '%deleted-conversation-%'
         ) AS conversation_marked,
         NOT EXISTS (
           SELECT 1
             FROM (
               SELECT conversation_id FROM chat_messages
               UNION ALL SELECT conversation_id FROM chat_read_states
               UNION ALL SELECT conversation_id FROM chat_reports
               UNION ALL SELECT conversation_id FROM chat_moderation_events
               UNION ALL SELECT conversation_id FROM chat_user_sanctions WHERE conversation_id IS NOT NULL
             ) AS relationship_references
            WHERE conversation_id = $5 OR conversation_id LIKE '%' || $1 || '%'
         ) AS conversation_references_clean,
         EXISTS (
           SELECT 1 FROM chat_user_sanctions AS sanction
           JOIN chat_conversations AS conversation ON conversation.id = sanction.conversation_id
            WHERE sanction.id = $8 AND conversation.subject_id LIKE '%deleted-conversation-%'
         ) AS peer_sanction_rekeyed,
         EXISTS (
           SELECT 1 FROM chat_messages
            WHERE id = $9
              AND author_user_id IS NULL
              AND author_display_name = 'Deleted Player'
              AND content = '[redacted]'
         ) AS deleted_message_redacted,
         NOT EXISTS (
           SELECT 1 FROM chat_message_translations WHERE message_id = $9
         ) AS chat_translations_purged`,
      [
        userId,
        exportJobId,
        deletionRequestId,
        matchId,
        conversationId,
        `bgio:${fixture.prefix}`,
        retryExportJobId,
        `sanction-peer:${fixture.prefix}`,
        deletedMessageId,
      ],
    )
  ).rows[0];
  const failed = Object.entries(invariant || {})
    .filter(([, passed]) => passed !== true)
    .map(([name]) => name);
  if (failed.length > 0) throw new Error(`account deletion invariants failed: ${failed.join(', ')}`);
}

async function expectDatabaseError(operation, fragment) {
  try {
    await operation();
  } catch (error) {
    if (String(error?.message || error).includes(fragment)) return;
    throw error;
  }
  throw new Error(`expected database error containing: ${fragment}`);
}

async function assertAuditAnonymizersRejectActiveAccount(pool, userId) {
  await expectDatabaseError(
    () => pool.query('SELECT public.zutomayo_anonymize_account_export_audit($1)', [userId]),
    'requires a deleted account',
  );
  await expectDatabaseError(
    () => pool.query('SELECT public.zutomayo_anonymize_admin_audit_identity($1, $2)', [userId, null]),
    'input is invalid',
  );
  await expectDatabaseError(
    () =>
      pool.query('SELECT public.zutomayo_anonymize_admin_audit_identity($1, $2)', [
        userId,
        `deleted-admin-audit-${'a'.repeat(32)}`,
      ]),
    'requires a deleted account',
  );
}

async function waitForBlockedAccountDeletion(pool, isSettled, writerLabel = 'terminal writer') {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (isSettled()) throw new Error(`account deletion settled before the ${writerLabel} released its locks`);
    const blocked = (
      await pool.query(
        `SELECT EXISTS (
           SELECT 1
             FROM pg_locks AS lock
             JOIN pg_stat_activity AS activity ON activity.pid = lock.pid
            WHERE lock.locktype = 'advisory'
              AND lock.granted = FALSE
              AND activity.usename = CURRENT_USER
              AND activity.datname = CURRENT_DATABASE()
         ) AS blocked`,
      )
    ).rows[0]?.blocked;
    if (blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`account deletion did not wait on the ${writerLabel} account lock`);
}

async function withTimeout(promise, message, timeoutMs = 10_000) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function createProxyPool(pool, { beforeConnect, afterQuery } = {}) {
  return {
    query(sql, params) {
      return pool.query(sql, params);
    },
    async connect() {
      if (beforeConnect) await beforeConnect();
      const client = await pool.connect();
      return {
        async query(sql, params) {
          const result = await client.query(sql, params);
          if (afterQuery) await afterQuery({ sql, params, result });
          return result;
        },
        release() {
          client.release();
        },
      };
    },
  };
}

async function seedDeckWriterFixture(pool, fixture) {
  await pool.query(
    `INSERT INTO users (id, email, password_hash, salt, nickname)
     VALUES ($1, $2, 'hash', 'salt', 'Delete First Deck Writer'),
            ($3, $4, 'hash', 'salt', 'Writer First Deck Writer')`,
    [
      fixture.deleteFirstUserId,
      `${fixture.deleteFirstUserId}@example.invalid`,
      fixture.writerFirstUserId,
      `${fixture.writerFirstUserId}@example.invalid`,
    ],
  );
  await pool.query(
    `INSERT INTO cards (id, name, pack, element, type)
     SELECT id, 'Deletion Race Card', 'smoke', 'none', 'character'
       FROM unnest($1::text[]) AS id`,
    [fixture.cardIds],
  );
}

async function cleanupDeckWriterFixture(pool, fixture) {
  const userIds = [fixture.deleteFirstUserId, fixture.writerFirstUserId];
  await pool.query(
    `DELETE FROM relationship_change_outbox
      WHERE user_ids && $1::text[] OR actor_user_id = ANY($1::text[])`,
    [userIds],
  );
  await pool.query('DELETE FROM deck_reservations WHERE user_id = ANY($1::text[])', [userIds]);
  await pool.query('DELETE FROM decks WHERE user_id = ANY($1::text[])', [userIds]);
  await pool.query('DELETE FROM users WHERE id = ANY($1::text[])', [userIds]);
  await pool.query('DELETE FROM cards WHERE id = ANY($1::text[])', [fixture.cardIds]);
}

async function assertDeckDelayedWriterFences(pool) {
  const prefix = crypto.randomUUID();
  const fixture = {
    deleteFirstUserId: `deck-delete-first-user:${prefix}`,
    deleteFirstDeckId: `d_delete_first_${prefix}`,
    writerFirstUserId: `deck-writer-first-user:${prefix}`,
    writerFirstDeckId: `d_writer_first_${prefix}`,
    cardIds: Array.from({ length: 10 }, (_, index) => `deck-race-card:${prefix}:${index}`),
  };
  const deckCardIds = fixture.cardIds.flatMap((id) => [id, id]);
  const deleteFirstConnectReached = deferred();
  const allowDeleteFirstConnect = deferred();
  const writerFirstLockReached = deferred();
  const allowWriterFirstWrite = deferred();
  let deleteFirstWriting;
  let writerFirstWriting;
  let writerFirstDeleting;

  try {
    await seedDeckWriterFixture(pool, fixture);

    const validationError = await validateDeckInput(pool, 'Delete First Deck', deckCardIds);
    if (validationError) throw new Error(`delete-first deck fixture failed validation: ${validationError}`);
    const deleteFirstProxy = createProxyPool(pool, {
      beforeConnect: async () => {
        deleteFirstConnectReached.resolve();
        await allowDeleteFirstConnect.promise;
      },
    });
    deleteFirstWriting = createUserDeck(
      deleteFirstProxy,
      fixture.deleteFirstUserId,
      { name: 'Delete First Deck', cardIds: deckCardIds },
      () => fixture.deleteFirstDeckId,
    );
    await withTimeout(
      deleteFirstConnectReached.promise,
      'delete-first deck writer did not reach the transaction boundary',
    );

    const deleteFirstDeletion = await withTimeout(
      deleteAccount({ pool, userId: fixture.deleteFirstUserId }),
      'delete-first account deletion did not commit',
    );
    if (!deleteFirstDeletion?.ok) {
      throw new Error(`delete-first account deletion failed: ${JSON.stringify(deleteFirstDeletion)}`);
    }
    allowDeleteFirstConnect.resolve();
    const deleteFirstResult = await withTimeout(
      deleteFirstWriting,
      'delete-first deck writer did not settle after deletion',
    );
    if (deleteFirstResult?.ok || deleteFirstResult?.status !== 409) {
      throw new Error(`delete-first deck writer was not rejected: ${JSON.stringify(deleteFirstResult)}`);
    }
    const deleteFirstDeckCount = (
      await pool.query('SELECT COUNT(*)::int AS count FROM decks WHERE id = $1 OR user_id = $2', [
        fixture.deleteFirstDeckId,
        fixture.deleteFirstUserId,
      ])
    ).rows[0]?.count;
    if (deleteFirstDeckCount !== 0) throw new Error('delete-first deck writer recreated a deleted account deck');

    const writerFirstProxy = createProxyPool(pool, {
      afterQuery: async ({ sql, params }) => {
        if (
          sql === 'SELECT id, deleted_at, elo, match_count, wins FROM users WHERE id = $1 FOR UPDATE' &&
          params?.[0] === fixture.writerFirstUserId
        ) {
          writerFirstLockReached.resolve();
          await allowWriterFirstWrite.promise;
        }
      },
    });
    writerFirstWriting = createUserDeck(
      writerFirstProxy,
      fixture.writerFirstUserId,
      { name: 'Writer First Deck', cardIds: deckCardIds },
      () => fixture.writerFirstDeckId,
    );
    await withTimeout(writerFirstLockReached.promise, 'writer-first deck service did not acquire its account lock');

    let deletionSettled = false;
    writerFirstDeleting = deleteAccount({ pool, userId: fixture.writerFirstUserId }).finally(() => {
      deletionSettled = true;
    });
    await waitForBlockedAccountDeletion(pool, () => deletionSettled, 'deck writer');
    allowWriterFirstWrite.resolve();

    const writerFirstResult = await withTimeout(
      writerFirstWriting,
      'writer-first deck service deadlocked before commit',
    );
    if (!writerFirstResult?.ok) {
      throw new Error(`writer-first deck creation failed: ${JSON.stringify(writerFirstResult)}`);
    }
    const writerFirstDeletion = await withTimeout(
      writerFirstDeleting,
      'account deletion deadlocked behind the deck writer',
    );
    if (!writerFirstDeletion?.ok) {
      throw new Error(`writer-first account deletion failed: ${JSON.stringify(writerFirstDeletion)}`);
    }
    const writerFirstDeckCount = (
      await pool.query('SELECT COUNT(*)::int AS count FROM decks WHERE id = $1 OR user_id = $2', [
        fixture.writerFirstDeckId,
        fixture.writerFirstUserId,
      ])
    ).rows[0]?.count;
    if (writerFirstDeckCount !== 0) throw new Error('writer-first deck survived the serialized account deletion');
  } finally {
    allowDeleteFirstConnect.resolve();
    allowWriterFirstWrite.resolve();
    await Promise.allSettled([deleteFirstWriting, writerFirstWriting, writerFirstDeleting].filter(Boolean));
    await cleanupDeckWriterFixture(pool, fixture);
  }
}

async function assertAccountFirstTerminalWriterFence(pool) {
  const prefix = crypto.randomUUID();
  const userId = `terminal-delete-user:${prefix}`;
  const peerId = `terminal-delete-peer:${prefix}`;
  const matchId = `terminal-delete-match:${prefix}`;
  const initialState = {
    _stateID: 0,
    G: { step: 'janken', owner: userId },
    ctx: { turn: 0, currentPlayer: '0' },
    plugins: {},
  };
  const pendingState = {
    _stateID: 10,
    G: { step: 'turnSet', owner: userId },
    ctx: { turn: 5, currentPlayer: '0' },
    plugins: {},
  };
  const terminalState = {
    _stateID: 11,
    G: {
      step: 'gameOver',
      winner: 0,
      [`terminal:${userId}`]: { actorUserId: userId },
    },
    ctx: { turn: 6, currentPlayer: '0', gameover: { winner: '0' } },
    plugins: {},
  };

  await pool.query(
    `INSERT INTO users (id, email, password_hash, salt, nickname)
     VALUES ($1, $2, 'hash', 'salt', 'Terminal Target'),
            ($3, $4, 'hash', 'salt', 'Terminal Peer')`,
    [userId, `${userId}@example.invalid`, peerId, `${peerId}@example.invalid`],
  );
  await pool.query(
    `INSERT INTO bjg_matches (match_id, state, initial_state, metadata, log)
     VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb)`,
    [
      matchId,
      JSON.stringify(pendingState),
      JSON.stringify(initialState),
      JSON.stringify({
        gameName: 'zutomayo',
        players: {
          0: { id: 0, name: userId, credentials: `credential:${userId}`, data: { userId } },
          1: { id: 1, name: 'Terminal Peer', data: { userId: peerId } },
        },
      }),
      JSON.stringify([{ action: { payload: { actorUserId: userId } } }]),
    ],
  );
  await pool.query(
    `INSERT INTO bjg_match_seats (match_id, player_id, user_id, credential_hash)
     VALUES ($1, '0', $2, 'terminal-user-credential'), ($1, '1', $3, 'terminal-peer-credential')`,
    [matchId, userId, peerId],
  );

  const writer = await pool.connect();
  let writerTransactionOpen = false;
  let deleting;
  try {
    await writer.query('BEGIN');
    writerTransactionOpen = true;
    // A terminal writer fences accounts before taking the match row lock. The
    // deletion path follows the same order, so it waits instead of deadlocking
    // or anonymizing a state that the writer can later overwrite.
    await acquireAccountMutationLocks(writer, [userId, peerId]);
    await writer.query('SELECT state FROM bjg_matches WHERE match_id = $1 FOR UPDATE', [matchId]);
    await writer.query('UPDATE bjg_matches SET state = $2::jsonb, updated_at = NOW() WHERE match_id = $1', [
      matchId,
      JSON.stringify(terminalState),
    ]);

    let deletionSettled = false;
    deleting = deleteAccount({ pool, userId }).finally(() => {
      deletionSettled = true;
    });
    await waitForBlockedAccountDeletion(pool, () => deletionSettled);

    await writer.query('COMMIT');
    writerTransactionOpen = false;
    const result = await withTimeout(deleting, 'account deletion deadlocked behind the terminal writer');
    if (!result?.ok) throw new Error(`terminal-writer account deletion failed: ${JSON.stringify(result)}`);

    const row = (
      await pool.query(
        `SELECT state, initial_state, metadata, log,
                EXISTS (
                  SELECT 1 FROM bjg_match_seats
                   WHERE match_id = $1 AND user_id = $2
                ) AS raw_seat_exists
           FROM bjg_matches
          WHERE match_id = $1`,
        [matchId, userId],
      )
    ).rows[0];
    if (!row?.state || !row.initial_state || !row.metadata || !row.log) {
      throw new Error('terminal-writer boardgame payload became unfetchable after deletion');
    }
    if (row.state._stateID !== 11 || row.state.G?.step !== 'gameOver') {
      throw new Error('terminal-writer committed state was not retained through deletion');
    }
    if (row.initial_state._stateID !== 0 || row.initial_state.G?.step !== 'janken') {
      throw new Error('terminal-writer initial state structure was not retained through deletion');
    }
    if (row.raw_seat_exists) throw new Error('deleted terminal-writer seat was retained');
    const deletedPlayer = row.metadata.players?.['0'];
    if (!deletedPlayer || ['name', 'credentials', 'data'].some((key) => key in deletedPlayer)) {
      throw new Error('deleted terminal-writer seat metadata retained identity fields');
    }
    const serialized = JSON.stringify([row.state, row.initial_state, row.metadata, row.log]);
    if (serialized.includes(userId) || !/deleted-boardgame-[a-f0-9]{32}/.test(serialized)) {
      throw new Error('terminal-writer boardgame payload was not structurally anonymized');
    }
  } finally {
    if (writerTransactionOpen) await writer.query('ROLLBACK').catch(() => undefined);
    writer.release();
    if (deleting) await deleting.catch(() => undefined);
  }
}

async function main() {
  const pool = createPool();
  const prefix = crypto.randomUUID();
  const userId = `delete-user:${prefix}`;
  const peerId = `delete-peer:${prefix}`;
  const conversationSubjectId = `v1:${[userId, peerId].sort().map(encodeURIComponent).join(':')}`;
  const fixture = {
    prefix,
    userId,
    peerId,
    matchId: `delete-match:${prefix}`,
    sourceMatchId: `delete-source:${prefix}`,
    seasonId: `delete-season:${prefix}`,
    conversationSubjectId,
    conversationId: `direct:${conversationSubjectId}`,
    deletedMessageId: `message-deleted:${prefix}`,
    exportJobId: `delete-export:${prefix}`,
    retryExportJobId: `delete-export-retry:${prefix}`,
    deletionRequestId: `delete-request:${prefix}`,
  };
  try {
    await seed(pool, fixture);
    await assertAuditAnonymizersRejectActiveAccount(pool, fixture.userId);
    let releaseRelationshipPublish;
    let signalRelationshipPublish;
    const relationshipPublishStarted = new Promise((resolve) => {
      signalRelationshipPublish = resolve;
    });
    const relationshipPublishPaused = new Promise((resolve) => {
      releaseRelationshipPublish = resolve;
    });
    const priorRelationshipDelivery = deliverRelationshipOutboxBatch({
      pool,
      redis: {
        publish: async () => {
          signalRelationshipPublish();
          await relationshipPublishPaused;
          return 1;
        },
      },
      config: {
        batchSize: 1,
        leaseMs: 30_000,
        maxAttempts: 3,
        baseRetryMs: 100,
        maxRetryMs: 1_000,
        jitterRatio: 0,
      },
    });
    let publishStartTimeout;
    try {
      await Promise.race([
        relationshipPublishStarted,
        new Promise((_, reject) => {
          publishStartTimeout = setTimeout(() => reject(new Error('relationship publish fence did not start')), 5_000);
        }),
      ]);
    } finally {
      clearTimeout(publishStartTimeout);
    }

    let deletionSettled = false;
    const deleting = deleteAccount({
      pool,
      userId: fixture.userId,
      deletionRequestId: fixture.deletionRequestId,
    }).finally(() => {
      deletionSettled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const deletionBypassedFence = deletionSettled;
    releaseRelationshipPublish();
    const [priorDelivery, result] = await Promise.all([priorRelationshipDelivery, deleting]);
    if (deletionBypassedFence) throw new Error('account deletion bypassed the in-flight relationship publish fence');
    if (priorDelivery.delivered !== 1) throw new Error('pre-deletion relationship event was not delivered');
    if (!result?.ok) throw new Error(`account deletion failed: ${JSON.stringify(result)}`);
    const delivery = await deliverRelationshipOutboxBatch({
      pool,
      redis: { publish: async () => 1 },
      config: {
        batchSize: 50,
        leaseMs: 30_000,
        maxAttempts: 3,
        baseRetryMs: 100,
        maxRetryMs: 1_000,
        jitterRatio: 0,
      },
    });
    if (delivery.delivered < 1) throw new Error('account deletion relationship event was not delivered');
    const deleteCalls = [];
    const exportWorker = createAccountExportWorker({
      pool,
      storage: {
        configured: true,
        prefix: 'account-exports',
        async deleteObject(input) {
          deleteCalls.push(input);
          if (input.key.includes(fixture.retryExportJobId)) throw new Error('forced purge retry');
        },
      },
      buildArtifact: async () => {
        throw new Error('expired deletion jobs must never be rebuilt');
      },
      intervalMs: 60_000,
      batchSize: 2,
      onError(error) {
        throw error;
      },
      logger: { error() {} },
    });
    await exportWorker.tick();
    await exportWorker.stop();
    const successfulDelete = deleteCalls.find(({ key }) => key.includes(fixture.exportJobId));
    const retriedDelete = deleteCalls.find(({ key }) => key.includes(fixture.retryExportJobId));
    if (successfulDelete?.versionId !== 'version-success') {
      throw new Error('anonymized account export did not delete the exact stored object version');
    }
    if (retriedDelete?.versionId !== 'version-retry') {
      throw new Error('failed account export purge did not target the exact stored object version');
    }
    await assertAnonymized(pool, fixture);
    await assertDeckDelayedWriterFences(pool);
    await assertAccountFirstTerminalWriterFence(pool);
    process.stdout.write('Account deletion PostgreSQL anonymization smoke passed\n');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
