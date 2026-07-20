/* global module */

const crypto = require('crypto');
const { reconcileActiveLegalHolds } = require('./legalHoldService.cjs');

const RETENTION_DAYS = Object.freeze({
  matches: 365,
  actionLogs: 180,
  chat: 180,
  reports: 365,
  deckShareReports: 365,
  adminAudit: 365,
  accountTokens: 2,
  relationshipOutboxDelivered: 30,
  relationshipOutboxDeadLetter: 365,
});

const RETENTION_LOCK_NAME = 'zutomayo:retention-job:v1';
const LEGAL_HOLD_LOCK_NAME = RETENTION_LOCK_NAME;
const DEFAULT_MAX_RUNTIME_MS = 10 * 60 * 1000;

function retentionCutoff(now, days) {
  const timestamp = new Date(now).getTime();
  if (!Number.isFinite(timestamp)) throw new Error('Invalid retention clock');
  return new Date(timestamp - Math.max(0, Number(days) || 0) * 24 * 60 * 60 * 1000).toISOString();
}

async function withClient(pool, operation) {
  const client = typeof pool.connect === 'function' ? await pool.connect() : pool;
  const release = typeof client.release === 'function' ? () => client.release() : () => undefined;
  try {
    return await operation(client);
  } finally {
    release();
  }
}

async function withTransaction(client, operation) {
  await client.query('BEGIN');
  try {
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

function countFromResult(result) {
  const row = result?.rows?.[0] || {};
  return Math.max(0, Number(row.count ?? result?.rowCount ?? 0) || 0);
}

function activeHoldPredicate(objectType, objectIdExpression, accountExpressions = []) {
  // Keep the direct subject fallback for holds created before the expanded
  // mapping table was introduced. New holds are expanded by legalHoldService.
  const type = String(objectType).replace(/[^a-z_]/g, '');
  const accountScope = accountExpressions.length
    ? `OR EXISTS (
           SELECT 1
             FROM legal_holds account_hold
            WHERE account_hold.released_at IS NULL
              AND (account_hold.expires_at IS NULL OR account_hold.expires_at > NOW())
              AND account_hold.subject_type = 'account'
              AND account_hold.subject_id IN (${accountExpressions.join(', ')})
         )`
    : '';
  return `NOT EXISTS (
    SELECT 1
      FROM legal_holds h
     WHERE h.released_at IS NULL
       AND (h.expires_at IS NULL OR h.expires_at > NOW())
       AND (
         (h.subject_type = '${type}' AND h.subject_id = ${objectIdExpression})
         OR EXISTS (
           SELECT 1
             FROM legal_hold_objects ho
           WHERE ho.hold_id = h.id
              AND ho.object_type = '${type}'
              AND ho.object_id = ${objectIdExpression}
         )
         ${accountScope}
      )
  )`;
}

function activeHoldForAny(objectType, expressions, accountExpressions = []) {
  return expressions.map((expression) => activeHoldPredicate(objectType, expression, accountExpressions)).join(' AND ');
}

function operationDefinitions(cutoffs) {
  const matchAccountScope = ['m.player0_id', 'm.player1_id', 'm.winner_id', 'm.loser_id'];
  const messageAccountScope = ['m.author_user_id'];
  const reportAccountScope = ['r.reporter_user_id', 'r.reported_message_author_user_id'];
  const matchHold = activeHoldForAny('match', ['m.id', 'm.source_match_id'], matchAccountScope);
  const messageHold = activeHoldForAny('message', ['m.id'], messageAccountScope);
  const conversationHold = activeHoldForAny('conversation', ['c.id', 'c.subject_id'], messageAccountScope);
  const reportHold = activeHoldForAny('report', ['r.id'], reportAccountScope);
  const reportMessageHold = activeHoldForAny('message', ['r.message_id'], reportAccountScope);
  const deckShareReportHold = activeHoldForAny('report', ['r.id'], ['r.reporter_user_id', 's.owner_user_id']);

  return [
    {
      name: 'actionLogs',
      countSql: `SELECT COUNT(*)::int AS count
        FROM matches m
       WHERE m.completed_at < $1
         AND m.action_log IS NOT NULL
         AND m.action_log_purged_at IS NULL
         AND ${matchHold}`,
      mutateSql: `WITH candidates AS (
        SELECT m.id
          FROM matches m
         WHERE m.completed_at < $1
           AND m.action_log IS NOT NULL
           AND m.action_log_purged_at IS NULL
           AND ${matchHold}
         ORDER BY m.completed_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $2
      )
      UPDATE matches m
         SET action_log = NULL,
             action_log_purged_at = COALESCE(m.action_log_purged_at, NOW())
        FROM candidates c
       WHERE m.id = c.id`,
      countParams: [cutoffs.actionLogs],
      mutateParams: [cutoffs.actionLogs],
    },
    {
      name: 'matches',
      countSql: `SELECT COUNT(*)::int AS count
        FROM matches m
       WHERE m.completed_at < $1
         AND m.anonymized_at IS NULL
         AND ${matchHold}`,
      mutateSql: `WITH candidates AS (
        SELECT m.id
          FROM matches m
         WHERE m.completed_at < $1
           AND m.anonymized_at IS NULL
           AND ${matchHold}
         ORDER BY m.completed_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $2
      )
      UPDATE matches m
         SET player0_id = NULL,
             player1_id = NULL,
             winner_id = NULL,
             loser_id = NULL,
             anonymized_at = COALESCE(m.anonymized_at, NOW())
        FROM candidates c
       WHERE m.id = c.id`,
      countParams: [cutoffs.matches],
      mutateParams: [cutoffs.matches],
    },
    {
      name: 'chat',
      countSql: `SELECT COUNT(*)::int AS count
        FROM chat_messages m
        JOIN chat_conversations c ON c.id = m.conversation_id
       WHERE m.created_at < $1
         AND m.retention_anonymized_at IS NULL
         AND (${messageHold})
         AND (${conversationHold})`,
      mutateSql: `WITH candidates AS (
        SELECT m.id
          FROM chat_messages m
          JOIN chat_conversations c ON c.id = m.conversation_id
         WHERE m.created_at < $1
           AND m.retention_anonymized_at IS NULL
           AND (${messageHold})
           AND (${conversationHold})
         ORDER BY m.created_at ASC
         FOR UPDATE OF m SKIP LOCKED
         LIMIT $2
      )
      UPDATE chat_messages m
         SET author_user_id = NULL,
             author_display_name = 'Deleted Player',
             content = '[redacted]',
             source_language = '',
             metadata = '{}'::jsonb,
             deleted_at = COALESCE(m.deleted_at, NOW()),
             retention_anonymized_at = COALESCE(m.retention_anonymized_at, NOW())
        FROM candidates c
       WHERE m.id = c.id`,
      countParams: [cutoffs.chat],
      mutateParams: [cutoffs.chat],
    },
    {
      name: 'translations',
      countSql: `SELECT COUNT(*)::int AS count
        FROM chat_message_translations t
        JOIN chat_messages m ON m.id = t.message_id
        JOIN chat_conversations c ON c.id = m.conversation_id
       WHERE m.created_at < $1
         AND m.retention_anonymized_at IS NOT NULL
         AND ${activeHoldPredicate('message', 'm.id', messageAccountScope)}
         AND ${activeHoldPredicate('conversation', 'c.id', messageAccountScope)}`,
      mutateSql: `WITH candidates AS (
        SELECT t.message_id, t.target_language
          FROM chat_message_translations t
          JOIN chat_messages m ON m.id = t.message_id
          JOIN chat_conversations c ON c.id = m.conversation_id
         WHERE m.created_at < $1
           AND m.retention_anonymized_at IS NOT NULL
           AND ${activeHoldPredicate('message', 'm.id', messageAccountScope)}
           AND ${activeHoldPredicate('conversation', 'c.id', messageAccountScope)}
         ORDER BY m.created_at ASC
         FOR UPDATE OF t SKIP LOCKED
         LIMIT $2
      )
      DELETE FROM chat_message_translations t
       USING candidates c
       WHERE t.message_id = c.message_id
         AND t.target_language = c.target_language`,
      countParams: [cutoffs.chat],
      mutateParams: [cutoffs.chat],
    },
    {
      name: 'reports',
      countSql: `SELECT COUNT(*)::int AS count
        FROM chat_reports r
       WHERE r.created_at < $1
         AND r.status <> 'open'
         AND ${reportHold}
         AND ${reportMessageHold}`,
      mutateSql: `WITH candidates AS (
        SELECT r.id
          FROM chat_reports r
         WHERE r.created_at < $1
           AND r.status <> 'open'
           AND ${reportHold}
           AND ${reportMessageHold}
         ORDER BY r.created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $2
      )
      DELETE FROM chat_reports r
       USING candidates c
       WHERE r.id = c.id`,
      countParams: [cutoffs.reports],
      mutateParams: [cutoffs.reports],
    },
    {
      name: 'deckShareReports',
      countSql: `SELECT COUNT(*)::int AS count
        FROM deck_share_reports r
        JOIN deck_shares s ON s.id = r.share_id
       WHERE r.created_at < $1
         AND r.status IN ('resolved', 'dismissed')
         AND ${deckShareReportHold}`,
      mutateSql: `WITH candidates AS (
        SELECT r.id
          FROM deck_share_reports r
          JOIN deck_shares s ON s.id = r.share_id
         WHERE r.created_at < $1
           AND r.status IN ('resolved', 'dismissed')
           AND ${deckShareReportHold}
         ORDER BY r.created_at ASC
         FOR UPDATE OF r SKIP LOCKED
         LIMIT $2
      )
      DELETE FROM deck_share_reports r
       USING candidates c
       WHERE r.id = c.id`,
      countParams: [cutoffs.deckShareReports],
      mutateParams: [cutoffs.deckShareReports],
    },
    {
      name: 'adminAudit',
      countSql: `SELECT COUNT(*)::int AS count
        FROM admin_audit_log a
       WHERE a.created_at < $1
         AND NOT EXISTS (
           SELECT 1
             FROM legal_holds h
            WHERE h.released_at IS NULL
              AND (h.expires_at IS NULL OR h.expires_at > NOW())
              AND (
                (h.subject_type = a.target_type AND h.subject_id = COALESCE(a.target_id, ''))
                OR EXISTS (
                  SELECT 1 FROM legal_hold_objects ho
                   WHERE ho.hold_id = h.id
                     AND ho.object_type = a.target_type
                     AND ho.object_id = COALESCE(a.target_id, '')
                )
                OR (
                  a.target_type = 'legal_hold'
                  AND h.id = a.target_id
                )
              )
         )`,
      mutateSql: `WITH candidates AS (
        SELECT a.id
          FROM admin_audit_log a
         WHERE a.created_at < $1
           AND NOT EXISTS (
             SELECT 1
               FROM legal_holds h
              WHERE h.released_at IS NULL
                AND (h.expires_at IS NULL OR h.expires_at > NOW())
                AND (
                  (h.subject_type = a.target_type AND h.subject_id = COALESCE(a.target_id, ''))
                  OR EXISTS (
                    SELECT 1 FROM legal_hold_objects ho
                     WHERE ho.hold_id = h.id
                       AND ho.object_type = a.target_type
                       AND ho.object_id = COALESCE(a.target_id, '')
                  )
                  OR (
                    a.target_type = 'legal_hold'
                    AND h.id = a.target_id
                  )
                )
           )
         ORDER BY a.created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $2
      )
      DELETE FROM admin_audit_log a
       USING candidates c
       WHERE a.id = c.id`,
      countParams: [cutoffs.adminAudit],
      mutateParams: [cutoffs.adminAudit],
    },
    {
      name: 'accountTokens',
      countSql: `SELECT COUNT(*)::int AS count
        FROM account_action_tokens
       WHERE expires_at < $1 OR consumed_at < $1`,
      mutateSql: `WITH candidates AS (
        SELECT id
          FROM account_action_tokens
         WHERE expires_at < $1 OR consumed_at < $1
         ORDER BY id ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $2
      )
      DELETE FROM account_action_tokens t
       USING candidates c
       WHERE t.id = c.id`,
      countParams: [cutoffs.accountTokens],
      mutateParams: [cutoffs.accountTokens],
    },
    {
      name: 'relationshipOutbox',
      countSql: `SELECT COUNT(*)::int AS count
        FROM relationship_change_outbox o
       WHERE ((o.status = 'delivered' AND o.delivered_at < $1)
          OR (o.status = 'dead_letter' AND o.updated_at < $2))
         AND NOT EXISTS (
           SELECT 1
             FROM legal_holds h
            WHERE h.released_at IS NULL
              AND (h.expires_at IS NULL OR h.expires_at > NOW())
              AND h.subject_type = 'account'
              AND h.subject_id = ANY(o.user_ids)
         )`,
      mutateSql: `WITH candidates AS (
        SELECT o.event_id
          FROM relationship_change_outbox o
         WHERE ((o.status = 'delivered' AND o.delivered_at < $1)
            OR (o.status = 'dead_letter' AND o.updated_at < $2))
           AND NOT EXISTS (
             SELECT 1
               FROM legal_holds h
              WHERE h.released_at IS NULL
                AND (h.expires_at IS NULL OR h.expires_at > NOW())
                AND h.subject_type = 'account'
                AND h.subject_id = ANY(o.user_ids)
           )
         ORDER BY COALESCE(o.delivered_at, o.updated_at) ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $3
      )
      DELETE FROM relationship_change_outbox o
       USING candidates c
       WHERE o.event_id = c.event_id`,
      countParams: [cutoffs.relationshipOutboxDelivered, cutoffs.relationshipOutboxDeadLetter],
      mutateParams: [cutoffs.relationshipOutboxDelivered, cutoffs.relationshipOutboxDeadLetter],
    },
  ];
}

async function acquireRetentionLock(client) {
  const result = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS acquired', [RETENTION_LOCK_NAME]);
  // Unit-test doubles do not return a row. A real PostgreSQL response always
  // does, so missing data is treated as acquired for backwards-compatible
  // service tests while an explicit false remains fail-safe.
  return result?.rows?.[0]?.acquired !== false;
}

async function releaseRetentionLock(client) {
  await client.query('SELECT pg_advisory_unlock(hashtext($1))', [RETENTION_LOCK_NAME]).catch(() => undefined);
}

async function executeOperation(client, operation, { dryRun, batchSize, startedAt, maxRuntimeMs, onBatch }) {
  if (dryRun) {
    const result = await client.query(operation.countSql, operation.countParams);
    return { count: countFromResult(result), batches: 0 };
  }

  let total = 0;
  let batches = 0;
  while (true) {
    if (Date.now() - startedAt > maxRuntimeMs) throw new Error('Retention max runtime exceeded');
    const result = await withTransaction(client, () =>
      client.query(operation.mutateSql, [...operation.mutateParams, batchSize]),
    );
    const count = countFromResult(result);
    total += count;
    batches += 1;
    if (onBatch) await onBatch();
    if (count < batchSize) break;
  }
  return { count: total, batches };
}

async function runRetention({
  pool,
  now = new Date(),
  dryRun = false,
  batchSize = 5000,
  maxRuntimeMs = DEFAULT_MAX_RUNTIME_MS,
  runId = `retention_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
} = {}) {
  if (!pool || (typeof pool.query !== 'function' && typeof pool.connect !== 'function')) {
    throw new Error('Retention requires a PostgreSQL pool');
  }
  const safeBatch = Math.max(1, Math.min(Number(batchSize) || 5000, 50_000));
  const safeMaxRuntime = Math.max(1_000, Math.min(Number(maxRuntimeMs) || DEFAULT_MAX_RUNTIME_MS, 60 * 60 * 1000));
  const startedAtMs = Date.now();
  const cutoffs = Object.fromEntries(
    Object.entries(RETENTION_DAYS).map(([name, days]) => [name, retentionCutoff(now, days)]),
  );

  return withClient(pool, async (client) => {
    const locked = await acquireRetentionLock(client);
    if (!locked) return { ok: false, skipped: true, reason: 'already-running', runId };

    let runStarted = false;
    let totalBatches = 0;
    try {
      // Refresh the relational object snapshot while the global retention
      // lock is held.  Destructive predicates still use live hold checks, but
      // this makes future runs auditable and protects newly-arrived evidence.
      await withTransaction(client, (tx) => reconcileActiveLegalHolds(tx));
      await withTransaction(client, async (tx) => {
        await tx.query(
          `INSERT INTO retention_runs (id, mode, status, started_at, heartbeat_at, batch_count, deleted_counts)
           VALUES ($1, $2, 'running', NOW(), NOW(), 0, '{}'::jsonb)`,
          [runId, dryRun ? 'dry_run' : 'live'],
        );
      });
      runStarted = true;

      const counts = {};
      for (const operation of operationDefinitions(cutoffs)) {
        const result = await executeOperation(client, operation, {
          dryRun,
          batchSize: safeBatch,
          startedAt: startedAtMs,
          maxRuntimeMs: safeMaxRuntime,
          onBatch: async () => {
            totalBatches += 1;
            await client.query(
              `UPDATE retention_runs
                  SET heartbeat_at = NOW(), batch_count = $2
                WHERE id = $1`,
              [runId, totalBatches],
            );
          },
        });
        counts[operation.name] = result.count;
      }

      const durationMs = Date.now() - startedAtMs;
      await withTransaction(client, async (tx) => {
        await tx.query(
          `UPDATE retention_runs
              SET status = 'succeeded', finished_at = NOW(), heartbeat_at = NOW(),
                  batch_count = $2, duration_ms = $3, deleted_counts = $4::jsonb
            WHERE id = $1`,
          [runId, totalBatches, durationMs, JSON.stringify(counts)],
        );
      });
      return {
        ok: true,
        runId,
        dryRun,
        cutoffs,
        counts,
        batchCount: totalBatches,
        durationMs,
        startedAt: new Date(startedAtMs).toISOString(),
      };
    } catch (error) {
      if (runStarted) {
        await withTransaction(client, async (tx) => {
          await tx.query(
            `UPDATE retention_runs
                SET status = 'failed', finished_at = NOW(), heartbeat_at = NOW(),
                    batch_count = $2, duration_ms = $3, error = $4
              WHERE id = $1`,
            [runId, totalBatches, Date.now() - startedAtMs, String(error?.message || error).slice(0, 1000)],
          );
        }).catch(() => undefined);
      }
      throw error;
    } finally {
      await releaseRetentionLock(client);
    }
  });
}

module.exports = {
  DEFAULT_MAX_RUNTIME_MS,
  LEGAL_HOLD_LOCK_NAME,
  RETENTION_DAYS,
  RETENTION_LOCK_NAME,
  activeHoldPredicate,
  retentionCutoff,
  runRetention,
};
