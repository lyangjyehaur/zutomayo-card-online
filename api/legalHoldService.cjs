/* global module */

const crypto = require('crypto');

const LEGAL_HOLD_SUBJECT_TYPES = Object.freeze(['account', 'match', 'conversation', 'message', 'report', 'feedback']);
const LEGAL_HOLD_LOCK_NAME = 'zutomayo:retention-job:v1';

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

function cleanText(value, maxLength) {
  return String(value || '')
    .trim()
    .slice(0, maxLength);
}

function objectKey(type, id) {
  return `${type}\u0000${id}`;
}

function addObject(objects, type, id) {
  const cleanId = cleanText(id, 340);
  if (!LEGAL_HOLD_SUBJECT_TYPES.includes(type) || !cleanId) return;
  objects.set(objectKey(type, cleanId), { type, id: cleanId });
}

async function addConversationTree(client, objects, identifiers) {
  const ids = [...new Set(identifiers.map((value) => cleanText(value, 340)).filter(Boolean))];
  if (ids.length === 0) return;
  const { rows } = await client.query(
    `SELECT c.id AS conversation_id, c.subject_id,
            m.id AS message_id, r.id AS report_id
       FROM chat_conversations c
       LEFT JOIN chat_messages m ON m.conversation_id = c.id
       LEFT JOIN chat_reports r ON r.conversation_id = c.id OR r.message_id = m.id
      WHERE c.id = ANY($1::text[]) OR c.subject_id = ANY($1::text[])`,
    [ids],
  );
  for (const row of rows) {
    addObject(objects, 'conversation', row.conversation_id);
    addObject(objects, 'conversation', row.subject_id);
    addObject(objects, 'message', row.message_id);
    addObject(objects, 'report', row.report_id);
  }
}

async function resolveAccountObjects(client, objects, subjectId) {
  const account = (await client.query('SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1', [subjectId]))
    .rows[0];
  if (!account) return false;
  addObject(objects, 'account', subjectId);

  const matches = (
    await client.query(
      `SELECT id, source_match_id
         FROM matches
        WHERE player0_id = $1 OR player1_id = $1 OR winner_id = $1 OR loser_id = $1`,
      [subjectId],
    )
  ).rows;
  const matchIds = [];
  for (const match of matches) {
    addObject(objects, 'match', match.id);
    addObject(objects, 'match', match.source_match_id);
    if (match.id) matchIds.push(match.id);
    if (match.source_match_id) matchIds.push(match.source_match_id);
  }
  await addConversationTree(client, objects, matchIds);

  const authored = (
    await client.query(
      `SELECT m.id AS message_id, c.id AS conversation_id, c.subject_id
         FROM chat_messages m
         JOIN chat_conversations c ON c.id = m.conversation_id
        WHERE m.author_user_id = $1`,
      [subjectId],
    )
  ).rows;
  for (const row of authored) {
    addObject(objects, 'message', row.message_id);
    addObject(objects, 'conversation', row.conversation_id);
    addObject(objects, 'conversation', row.subject_id);
  }

  const reports = (
    await client.query(
      `SELECT id, message_id, conversation_id
         FROM chat_reports
        WHERE reporter_user_id = $1 OR reported_message_author_user_id = $1`,
      [subjectId],
    )
  ).rows;
  for (const row of reports) {
    addObject(objects, 'report', row.id);
    addObject(objects, 'message', row.message_id);
    addObject(objects, 'conversation', row.conversation_id);
  }

  const feedback = (
    await client.query(
      `SELECT id FROM feedback_posts WHERE author_user_id = $1
       UNION
       SELECT id FROM feedback_comments WHERE author_user_id = $1`,
      [subjectId],
    )
  ).rows;
  for (const row of feedback) addObject(objects, 'feedback', row.id);
  return true;
}

async function resolveMatchObjects(client, objects, subjectId) {
  const match = (
    await client.query(
      `SELECT id, source_match_id
         FROM matches
        WHERE id = $1 OR source_match_id = $1
       UNION ALL
       SELECT NULL::text AS id, match_id AS source_match_id
         FROM bjg_matches
        WHERE match_id = $1
       LIMIT 1`,
      [subjectId],
    )
  ).rows[0];
  if (!match) return false;
  const ids = [subjectId, match.id, match.source_match_id].filter(Boolean);
  for (const id of ids) addObject(objects, 'match', id);
  await addConversationTree(client, objects, ids);
  return true;
}

async function resolveConversationObjects(client, objects, subjectId) {
  const conversation = (
    await client.query(
      `SELECT id, type, subject_id
         FROM chat_conversations
        WHERE id = $1 OR subject_id = $1
       LIMIT 1`,
      [subjectId],
    )
  ).rows[0];
  if (!conversation) return false;
  addObject(objects, 'conversation', conversation.id);
  addObject(objects, 'conversation', conversation.subject_id);
  if (conversation.type === 'match') addObject(objects, 'match', conversation.subject_id);
  await addConversationTree(client, objects, [conversation.id, conversation.subject_id]);
  return true;
}

async function resolveMessageObjects(client, objects, subjectId) {
  const message = (
    await client.query(
      `SELECT m.id, c.id AS conversation_id, c.subject_id, c.type
         FROM chat_messages m
         JOIN chat_conversations c ON c.id = m.conversation_id
        WHERE m.id = $1
       LIMIT 1`,
      [subjectId],
    )
  ).rows[0];
  if (!message) return false;
  addObject(objects, 'message', message.id);
  addObject(objects, 'conversation', message.conversation_id);
  addObject(objects, 'conversation', message.subject_id);
  if (message.type === 'match') addObject(objects, 'match', message.subject_id);
  const reports = (await client.query('SELECT id FROM chat_reports WHERE message_id = $1', [subjectId])).rows;
  for (const report of reports) addObject(objects, 'report', report.id);
  return true;
}

async function resolveReportObjects(client, objects, subjectId) {
  const report = (
    await client.query(
      `SELECT id, message_id, conversation_id
         FROM chat_reports
        WHERE id = $1
       LIMIT 1`,
      [subjectId],
    )
  ).rows[0];
  if (!report) return false;
  addObject(objects, 'report', report.id);
  addObject(objects, 'message', report.message_id);
  addObject(objects, 'conversation', report.conversation_id);
  return true;
}

async function resolveFeedbackObjects(client, objects, subjectId) {
  const feedback = (
    await client.query(
      `SELECT id, 'post' AS kind FROM feedback_posts WHERE id = $1
       UNION ALL
       SELECT id, 'comment' AS kind FROM feedback_comments WHERE id = $1
       LIMIT 1`,
      [subjectId],
    )
  ).rows[0];
  if (!feedback) return false;
  addObject(objects, 'feedback', feedback.id);
  if (feedback.kind === 'post') {
    const comments = (await client.query('SELECT id FROM feedback_comments WHERE post_id = $1', [subjectId])).rows;
    for (const comment of comments) addObject(objects, 'feedback', comment.id);
  }
  return true;
}

async function resolveLegalHoldObjects(client, { subjectType, subjectId }) {
  const objects = new Map();
  const resolvers = {
    account: resolveAccountObjects,
    match: resolveMatchObjects,
    conversation: resolveConversationObjects,
    message: resolveMessageObjects,
    report: resolveReportObjects,
    feedback: resolveFeedbackObjects,
  };
  const exists = await resolvers[subjectType](client, objects, subjectId);
  return { exists, objects: [...objects.values()] };
}

async function persistLegalHoldObjects(client, holdId, objects) {
  await client.query(
    `INSERT INTO legal_hold_objects (hold_id, object_type, object_id)
     SELECT $1, object_type, object_id
       FROM jsonb_to_recordset($2::jsonb) AS expanded(object_type text, object_id text)
     ON CONFLICT (hold_id, object_type, object_id) DO NOTHING`,
    [holdId, JSON.stringify(objects.map((object) => ({ object_type: object.type, object_id: object.id })))],
  );
}

async function writeAuditLog(client, { adminUserId, action, holdId, details }) {
  await client.query(
    `INSERT INTO admin_audit_log
       (admin_user_id, action, target_type, target_id, details)
     VALUES ($1, $2, 'legal_hold', $3, $4::jsonb)`,
    [adminUserId, action, holdId, JSON.stringify(details)],
  );
}

async function listLegalHolds({ pool, status = 'active', subjectType, subjectId, limit = 100 }) {
  const conditions = [];
  const params = [];
  if (status === 'active') {
    conditions.push('h.released_at IS NULL', '(h.expires_at IS NULL OR h.expires_at > NOW())');
  } else if (status === 'released') {
    conditions.push('h.released_at IS NOT NULL');
  } else if (status === 'expired') {
    conditions.push('h.released_at IS NULL', 'h.expires_at <= NOW()');
  }
  if (subjectType) {
    params.push(subjectType);
    conditions.push(`h.subject_type = $${params.length}`);
  }
  if (subjectId) {
    params.push(subjectId);
    conditions.push(`h.subject_id = $${params.length}`);
  }
  params.push(Math.max(1, Math.min(Number(limit) || 100, 500)));
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT h.id, h.subject_type, h.subject_id, h.reason, h.owner, h.expires_at, h.released_at,
            h.created_at, h.metadata, COUNT(ho.object_id)::int AS object_count
       FROM legal_holds h
       LEFT JOIN legal_hold_objects ho ON ho.hold_id = h.id
       ${where}
      GROUP BY h.id
      ORDER BY h.created_at DESC
      LIMIT $${params.length}`,
    params,
  );
  return { ok: true, body: { holds: rows } };
}

async function createLegalHold({
  pool,
  adminUserId,
  subjectType,
  subjectId,
  reason,
  owner,
  expiresAt,
  caseReference,
  generateId = () => `legal_hold_${crypto.randomBytes(12).toString('hex')}`,
}) {
  if (!LEGAL_HOLD_SUBJECT_TYPES.includes(subjectType)) {
    return { ok: false, status: 400, error: 'Invalid legal hold subject type' };
  }
  const cleanSubjectId = cleanText(subjectId, 340);
  const cleanReason = cleanText(reason, 1000);
  const cleanOwner = cleanText(owner, 120);
  const expiry = new Date(expiresAt);
  if (!cleanSubjectId || !cleanReason || !cleanOwner) {
    return { ok: false, status: 400, error: 'Legal hold subject, reason, and owner are required' };
  }
  if (!expiresAt || !Number.isFinite(expiry.getTime()) || expiry.getTime() <= Date.now()) {
    return { ok: false, status: 400, error: 'Legal hold expiry must be in the future' };
  }
  const holdId = generateId();
  const metadata = caseReference ? { caseReference: cleanText(caseReference, 160) } : {};
  return withTransaction(pool, async (client) => {
    // Lock order is global first, then subject. Retention and account deletion
    // use the same global key, eliminating hold/create/delete races.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [LEGAL_HOLD_LOCK_NAME]);
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`legal-hold:${subjectType}:${cleanSubjectId}`]);
    if (subjectType === 'account') {
      // Provider deletion is an external side effect. Once its durable intent
      // is committed, reject a new account hold until the provider phase has
      // settled; otherwise a hold could be inserted between the intent commit
      // and the Logto DELETE request. The shared advisory locks make the
      // opposite ordering deterministic: an already-created hold causes the
      // deletion intent check to fail.
      const deletionInFlight = (
        await client.query(
          `SELECT id FROM account_deletion_requests
             WHERE user_id = $1 AND status = 'provider_deleting'
             LIMIT 1`,
          [cleanSubjectId],
        )
      ).rows[0];
      if (deletionInFlight) {
        return {
          ok: false,
          status: 409,
          error: 'Account legal hold cannot be created while provider deletion is in flight',
        };
      }
    }
    const resolved = await resolveLegalHoldObjects(client, { subjectType, subjectId: cleanSubjectId });
    if (!resolved.exists) return { ok: false, status: 404, error: 'Legal hold subject not found' };

    const hold = (
      await client.query(
        `INSERT INTO legal_holds
           (id, subject_type, subject_id, reason, owner, expires_at, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
         RETURNING id, subject_type, subject_id, reason, owner, expires_at,
                   released_at, created_at, metadata`,
        [holdId, subjectType, cleanSubjectId, cleanReason, cleanOwner, expiry.toISOString(), JSON.stringify(metadata)],
      )
    ).rows[0];
    await persistLegalHoldObjects(client, holdId, resolved.objects);
    await writeAuditLog(client, {
      adminUserId,
      action: 'legal_hold.create',
      holdId,
      details: {
        subjectType,
        subjectId: cleanSubjectId,
        reason: cleanReason,
        owner: cleanOwner,
        expiresAt: expiry.toISOString(),
        caseReference: metadata.caseReference || '',
        objectCount: resolved.objects.length,
      },
    });
    return { ok: true, body: { hold: { ...hold, object_count: resolved.objects.length } } };
  });
}

async function releaseLegalHold({ pool, adminUserId, holdId, reason }) {
  return withTransaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [LEGAL_HOLD_LOCK_NAME]);
    const existing = (
      await client.query(
        `SELECT id, subject_type, subject_id, reason, owner, expires_at,
                released_at, created_at, metadata
           FROM legal_holds WHERE id = $1 FOR UPDATE`,
        [holdId],
      )
    ).rows[0];
    if (!existing) return { ok: false, status: 404, error: 'Legal hold not found' };
    if (existing.released_at) {
      return { ok: true, body: { released: false, reason: 'already-released', hold: existing } };
    }

    const hold = (
      await client.query(
        `UPDATE legal_holds
            SET released_at = NOW(),
                metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
          WHERE id = $1
          RETURNING id, subject_type, subject_id, reason, owner, expires_at,
                    released_at, created_at, metadata`,
        [holdId, JSON.stringify({ releaseReason: cleanText(reason, 1000), releasedBy: adminUserId })],
      )
    ).rows[0];
    await writeAuditLog(client, {
      adminUserId,
      action: 'legal_hold.release',
      holdId,
      details: {
        subjectType: existing.subject_type,
        subjectId: existing.subject_id,
        reason: cleanText(reason, 1000),
      },
    });
    return { ok: true, body: { released: true, hold } };
  });
}

module.exports = {
  LEGAL_HOLD_LOCK_NAME,
  LEGAL_HOLD_SUBJECT_TYPES,
  createLegalHold,
  listLegalHolds,
  releaseLegalHold,
  resolveLegalHoldObjects,
};
