/* global module */

const CONVERSATION_TYPES = ['match', 'room', 'direct', 'global'];
const PARTICIPANT_ROLES = ['player', 'spectator', 'moderator'];
const PUBLIC_AUTHOR_ROLES = ['player', 'spectator'];
const MESSAGE_STATUSES = ['visible', 'pending_review', 'blocked', 'deleted'];
const REVIEWABLE_MESSAGE_STATUSES = ['visible', 'blocked', 'deleted'];
const REPORT_STATUSES = ['open', 'reviewing', 'resolved', 'dismissed'];
const SANCTION_TYPES = ['chat_mute'];
const GLOBAL_LOBBY_SUBJECT_ID = 'online-lobby';

function normalizeKeywordList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim().toLowerCase()).filter(Boolean);
  if (typeof value !== 'string') return [];
  return value
    .split(/[\n,]/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function defaultChatModerationRules(env = {}) {
  return {
    blockedWords: normalizeKeywordList(env.CHAT_BLOCKED_WORDS),
    reviewWords: normalizeKeywordList(env.CHAT_REVIEW_WORDS),
  };
}

function evaluateChatModeration(content, rules = defaultChatModerationRules()) {
  const normalized = String(content || '').toLowerCase();
  const blockedWord = normalizeKeywordList(rules.blockedWords).find((word) => normalized.includes(word));
  if (blockedWord) {
    return {
      status: 'blocked',
      action: 'block',
      reason: 'blocked_keyword',
      matchedWords: [blockedWord],
    };
  }
  const reviewWord = normalizeKeywordList(rules.reviewWords).find((word) => normalized.includes(word));
  if (reviewWord) {
    return {
      status: 'pending_review',
      action: 'review',
      reason: 'review_keyword',
      matchedWords: [reviewWord],
    };
  }
  return {
    status: 'visible',
    action: 'allow',
    reason: '',
    matchedWords: [],
  };
}

function clampLimit(value, fallback, max) {
  const limit = Number(value) || fallback;
  return Math.min(Math.max(1, Math.trunc(limit)), max);
}

function normalizeConversationType(value) {
  return CONVERSATION_TYPES.includes(value) ? value : null;
}

function normalizeParticipantRole(value) {
  return PARTICIPANT_ROLES.includes(value) ? value : 'spectator';
}

function normalizeMessageStatus(value) {
  return MESSAGE_STATUSES.includes(value) ? value : 'visible';
}

function normalizeSanctionType(value) {
  return SANCTION_TYPES.includes(value) ? value : 'chat_mute';
}

function normalizeSubjectId(value) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 300);
}

function canonicalConversationSubjectId(type, subjectId) {
  const cleanSubjectId = normalizeSubjectId(subjectId);
  if (type !== 'direct' || !cleanSubjectId) return cleanSubjectId;
  const participants = directConversationParticipants(cleanSubjectId);
  if (participants.length !== 2 || new Set(participants).size !== 2) return '';
  return cleanSubjectId.startsWith('v1:')
    ? `v1:${participants.sort().map(encodeURIComponent).join(':')}`
    : participants.sort().join(':');
}

function conversationKey(type, subjectId) {
  const cleanType = normalizeConversationType(type);
  const cleanSubjectId = canonicalConversationSubjectId(cleanType, subjectId);
  if (!cleanType || !cleanSubjectId) return null;
  if (cleanType === 'global' && cleanSubjectId !== GLOBAL_LOBBY_SUBJECT_ID) return null;
  return `${cleanType}:${cleanSubjectId}`;
}

function canAccessConversation(userId, type, subjectId) {
  if (!userId) return false;
  if (type === 'global') return canonicalConversationSubjectId(type, subjectId) === GLOBAL_LOBBY_SUBJECT_ID;
  if (type !== 'direct') return true;
  const canonicalSubjectId = canonicalConversationSubjectId(type, subjectId);
  if (!canonicalSubjectId) return false;
  return directConversationParticipants(canonicalSubjectId).includes(userId);
}

function directConversationPeerId(subjectId, userId) {
  const cleanUserId = normalizeSubjectId(userId);
  if (!cleanUserId) return '';
  const participants = directConversationParticipants(canonicalConversationSubjectId('direct', subjectId));
  if (participants.length !== 2 || !participants.includes(cleanUserId)) return '';
  return participants.find((participant) => participant !== cleanUserId) || '';
}

function directConversationSubjectForUsers(userId, peerUserId) {
  const cleanUserId = normalizeSubjectId(userId);
  const cleanPeerUserId = normalizeSubjectId(peerUserId);
  if (!cleanUserId || !cleanPeerUserId || cleanUserId === cleanPeerUserId) return '';
  return `v1:${[cleanUserId, cleanPeerUserId].sort().map(encodeURIComponent).join(':')}`;
}

async function directFriendConversationSubjects({ pool, userId }) {
  const { rows } = await pool.query(
    `SELECT friend_user_id
     FROM user_friends
     WHERE user_id = $1`,
    [userId],
  );
  return rows.map((row) => directConversationSubjectForUsers(userId, row.friend_user_id)).filter(Boolean);
}

async function hasDirectFriendship({ pool, userId, subjectId }) {
  const peerUserId = directConversationPeerId(subjectId, userId);
  if (!peerUserId) return false;
  const { rows } = await pool.query(
    `SELECT 1
     FROM user_friends
     WHERE user_id = $1 AND friend_user_id = $2
     LIMIT 1`,
    [userId, peerUserId],
  );
  return rows.length > 0;
}

async function hasMatchChatAccess({ pool, userId, subjectId }) {
  const matchId = canonicalConversationSubjectId('match', subjectId);
  if (!matchId) return false;
  const { rows } = await pool.query(
    `SELECT 1
     FROM platform_match_participants
     WHERE boardgame_match_id = $1 AND user_id = $2
     UNION
     SELECT 1
     FROM matches
     WHERE source_match_id = $1
       AND (player0_id = $2 OR player1_id = $2)
     LIMIT 1`,
    [matchId, userId],
  );
  return rows.length > 0;
}

async function hasRoomChatAccess({ pool, userId, subjectId }) {
  const roomCode = canonicalConversationSubjectId('room', subjectId);
  if (!roomCode) return false;
  const { rows } = await pool.query(
    `SELECT 1
     FROM platform_room_participants
     WHERE room_code = $1 AND user_id = $2
     LIMIT 1`,
    [roomCode, userId],
  );
  return rows.length > 0;
}

async function canAccessConversationWithPolicy({
  pool,
  userId,
  type,
  subjectId,
  enforceDirectFriendship = false,
  enforceMatchParticipation = false,
  enforceRoomParticipation = false,
}) {
  if (!canAccessConversation(userId, type, subjectId)) return false;
  if (enforceMatchParticipation && type === 'match') return hasMatchChatAccess({ pool, userId, subjectId });
  if (enforceRoomParticipation && type === 'room') return hasRoomChatAccess({ pool, userId, subjectId });
  if (!enforceDirectFriendship || type !== 'direct') return true;
  return hasDirectFriendship({ pool, userId, subjectId });
}

function directConversationParticipants(subjectId) {
  const cleanSubjectId = normalizeSubjectId(subjectId);
  if (cleanSubjectId.startsWith('v1:')) {
    return cleanSubjectId
      .slice(3)
      .split(':')
      .map((value) => {
        try {
          return decodeURIComponent(value);
        } catch {
          return '';
        }
      })
      .filter(Boolean);
  }
  return cleanSubjectId.split(':').filter(Boolean);
}

function normalizeContent(value, sanitizeText) {
  const text = sanitizeText(value, 1000).trim();
  return text;
}

function normalizeLanguage(value) {
  if (typeof value !== 'string') return '';
  const lang = value.trim().toLowerCase();
  return /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/.test(lang) ? lang.slice(0, 16) : '';
}

function mapConversation(row) {
  return {
    id: row.id,
    type: row.type,
    subjectId: row.subject_id,
    title: row.title || '',
    status: row.status || 'active',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMessage(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    authorUserId: row.author_user_id || null,
    authorDisplayName: row.author_display_name || '',
    authorRole: row.author_role || 'spectator',
    content: row.content,
    sourceLanguage: row.source_language || '',
    moderationStatus: row.moderation_status || 'visible',
    moderationReason: row.moderation_reason || '',
    metadata: row.metadata || {},
    createdAt: row.created_at,
    editedAt: row.edited_at || null,
    deletedAt: row.deleted_at || null,
  };
}

function mapTranslation(row) {
  return {
    messageId: row.message_id,
    targetLanguage: row.target_language,
    translatedContent: row.translated_content || '',
    provider: row.provider || '',
    model: row.model || '',
    status: row.status || 'pending',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapReport(row) {
  const messageContent =
    row.reported_message_content !== undefined && row.reported_message_content !== ''
      ? row.reported_message_content
      : row.message_content;
  const messageAuthorUserId =
    row.reported_message_author_user_id !== undefined
      ? row.reported_message_author_user_id
      : row.message_author_user_id;
  const messageAuthorDisplayName =
    row.reported_message_author_display_name !== undefined && row.reported_message_author_display_name !== ''
      ? row.reported_message_author_display_name
      : row.message_author_display_name;
  const messageAuthorRole =
    row.reported_message_author_role !== undefined && row.reported_message_author_role !== ''
      ? row.reported_message_author_role
      : row.message_author_role;
  const messageModerationStatus =
    row.reported_message_moderation_status !== undefined && row.reported_message_moderation_status !== ''
      ? row.reported_message_moderation_status
      : row.message_moderation_status;
  const messageCreatedAt =
    row.reported_message_created_at !== undefined ? row.reported_message_created_at : row.message_created_at;
  const report = {
    id: row.id,
    messageId: row.message_id,
    conversationId: row.conversation_id,
    reporterUserId: row.reporter_user_id || null,
    reason: row.reason,
    note: row.note || '',
    status: row.status || 'open',
    reviewerUserId: row.reviewer_user_id || null,
    resolutionNote: row.resolution_note || '',
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at || null,
  };
  if (messageContent !== undefined) {
    report.message = {
      content: messageContent || '',
      authorUserId: messageAuthorUserId || null,
      authorDisplayName: messageAuthorDisplayName || '',
      authorRole: messageAuthorRole || 'spectator',
      moderationStatus: messageModerationStatus || 'visible',
      createdAt: messageCreatedAt || null,
    };
    if (row.sanction_id) {
      report.message.activeSanction = mapSanction({
        id: row.sanction_id,
        target_user_id: row.sanction_target_user_id,
        type: row.sanction_type,
        status: row.sanction_status,
        reason: row.sanction_reason,
        source_report_id: row.sanction_source_report_id,
        source_message_id: row.sanction_source_message_id,
        conversation_id: row.sanction_conversation_id,
        created_by_user_id: row.sanction_created_by_user_id,
        created_at: row.sanction_created_at,
        expires_at: row.sanction_expires_at,
        revoked_at: row.sanction_revoked_at,
        revoked_by_user_id: row.sanction_revoked_by_user_id,
        revocation_reason: row.sanction_revocation_reason,
      });
    }
  }
  return report;
}

function mapSanction(row) {
  return {
    id: row.id,
    targetUserId: row.target_user_id,
    type: row.type || 'chat_mute',
    status: row.status || 'active',
    reason: row.reason || '',
    sourceReportId: row.source_report_id || null,
    sourceMessageId: row.source_message_id || null,
    conversationId: row.conversation_id || null,
    createdByUserId: row.created_by_user_id || null,
    createdAt: row.created_at,
    expiresAt: row.expires_at || null,
    revokedAt: row.revoked_at || null,
    revokedByUserId: row.revoked_by_user_id || null,
    revocationReason: row.revocation_reason || '',
  };
}

async function getActiveChatSanction({ pool, userId }) {
  if (!userId) return null;
  const { rows } = await pool.query(
    `SELECT *
     FROM chat_user_sanctions
     WHERE target_user_id = $1
       AND type = 'chat_mute'
       AND status = 'active'
       AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId],
  );
  return rows[0] ? mapSanction(rows[0]) : null;
}

async function getOrCreateConversation({ pool, type, subjectId, title = '' }) {
  const canonicalSubjectId = canonicalConversationSubjectId(type, subjectId);
  const key = conversationKey(type, subjectId);
  if (!key) return { ok: false, status: 400, error: 'Invalid conversation' };

  const { rows } = await pool.query(
    `INSERT INTO chat_conversations (id, type, subject_id, title)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET updated_at = NOW()
     RETURNING *`,
    [key, type, canonicalSubjectId, String(title || '').slice(0, 120)],
  );
  return { ok: true, body: mapConversation(rows[0]) };
}

async function writeModerationEvent({
  pool,
  generateModerationEventId,
  messageId,
  conversationId,
  actorUserId,
  moderation,
}) {
  if (!generateModerationEventId || moderation.status === 'visible') return;
  await pool.query(
    `INSERT INTO chat_moderation_events (
       id, message_id, conversation_id, actor_user_id, source, action, reason, details
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      generateModerationEventId(),
      messageId,
      conversationId,
      actorUserId,
      'keyword',
      moderation.action,
      moderation.reason,
      { matchedWords: moderation.matchedWords },
    ],
  );
}

async function sendChatMessage({
  pool,
  authorUserId,
  body,
  sanitizeText,
  generateMessageId,
  generateModerationEventId,
  moderationRules,
  enforceDirectFriendship = false,
  enforceMatchParticipation = false,
  enforceRoomParticipation = false,
  allowedAuthorRoles = PUBLIC_AUTHOR_ROLES,
}) {
  if (!authorUserId) return { ok: false, status: 401, error: 'Unauthorized' };
  const type = normalizeConversationType(body.conversationType);
  const subjectId = normalizeSubjectId(body.subjectId);
  const content = normalizeContent(body.content, sanitizeText);
  const role = normalizeParticipantRole(body.authorRole);
  if (!type || !subjectId) return { ok: false, status: 400, error: 'Invalid conversation' };
  if (!conversationKey(type, subjectId)) return { ok: false, status: 400, error: 'Invalid conversation' };
  if (!allowedAuthorRoles.includes(role)) return { ok: false, status: 403, error: 'Forbidden' };
  if (
    !(await canAccessConversationWithPolicy({
      pool,
      userId: authorUserId,
      type,
      subjectId,
      enforceDirectFriendship,
      enforceMatchParticipation,
      enforceRoomParticipation,
    }))
  ) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }
  if (!content) return { ok: false, status: 400, error: 'Message content is required' };
  const activeSanction = await getActiveChatSanction({ pool, userId: authorUserId });
  if (activeSanction) {
    return {
      ok: false,
      status: 403,
      error: activeSanction.expiresAt ? `Chat muted until ${activeSanction.expiresAt}` : 'Chat muted',
      body: { sanction: activeSanction },
    };
  }

  const conversation = await getOrCreateConversation({
    pool,
    type,
    subjectId,
    title: sanitizeText(body.title || '', 120),
  });
  if (!conversation.ok) return conversation;

  const id = generateMessageId();
  const displayName = sanitizeText(body.authorDisplayName || '', 60);
  const moderation = evaluateChatModeration(content, moderationRules);
  const status = normalizeMessageStatus(moderation.status);
  const metadata = body.clientMessageId
    ? { clientMessageId: sanitizeText(body.clientMessageId, 120), transport: body.transport || 'api' }
    : { transport: body.transport || 'api' };

  const { rows } = await pool.query(
    `INSERT INTO chat_messages (
       id, conversation_id, author_user_id, author_display_name, author_role,
       content, source_language, moderation_status, moderation_reason, metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      id,
      conversation.body.id,
      authorUserId,
      displayName,
      role,
      content,
      normalizeLanguage(body.sourceLanguage),
      status,
      sanitizeText(moderation.reason || body.moderationReason || '', 240),
      metadata,
    ],
  );

  await writeModerationEvent({
    pool,
    generateModerationEventId,
    messageId: id,
    conversationId: conversation.body.id,
    actorUserId: authorUserId,
    moderation,
  });
  await pool.query('UPDATE chat_conversations SET updated_at = NOW() WHERE id = $1', [conversation.body.id]);
  return { ok: true, body: { message: mapMessage(rows[0]), conversation: conversation.body } };
}

async function listChatMessages({
  pool,
  userId,
  conversationType,
  subjectId,
  limit,
  before,
  enforceDirectFriendship = false,
  enforceMatchParticipation = false,
  enforceRoomParticipation = false,
}) {
  if (!userId) return { ok: false, status: 401, error: 'Unauthorized' };
  const key = conversationKey(conversationType, subjectId);
  if (!key) return { ok: false, status: 400, error: 'Invalid conversation' };
  if (
    !(await canAccessConversationWithPolicy({
      pool,
      userId,
      type: conversationType,
      subjectId,
      enforceDirectFriendship,
      enforceMatchParticipation,
      enforceRoomParticipation,
    }))
  ) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }
  const lim = clampLimit(limit, 50, 200);
  const params = [key, lim];
  let beforeClause = '';
  if (before) {
    params.push(String(before));
    beforeClause =
      "AND created_at < COALESCE((SELECT created_at FROM chat_messages WHERE id = $3), NOW() + INTERVAL '1 second')";
  }
  const { rows } = await pool.query(
    `SELECT *
     FROM chat_messages
     WHERE conversation_id = $1
       AND deleted_at IS NULL
       AND moderation_status IN ('visible', 'pending_review')
       ${beforeClause}
     ORDER BY created_at DESC
     LIMIT $2`,
    params,
  );
  return { ok: true, body: { messages: rows.map(mapMessage).reverse() } };
}

async function listChatEvidenceMessages({ pool, conversationId, limit, before }) {
  const cleanConversationId = typeof conversationId === 'string' ? conversationId.slice(0, 340) : '';
  if (!cleanConversationId) return { ok: false, status: 400, error: 'Invalid conversation' };
  const conversation = (await pool.query('SELECT * FROM chat_conversations WHERE id = $1', [cleanConversationId]))
    .rows[0];
  if (!conversation) return { ok: false, status: 404, error: 'Conversation not found' };

  const lim = clampLimit(limit, 100, 500);
  const params = [cleanConversationId, lim];
  let beforeClause = '';
  if (before) {
    params.push(String(before));
    beforeClause =
      "AND created_at < COALESCE((SELECT created_at FROM chat_messages WHERE id = $3), NOW() + INTERVAL '1 second')";
  }
  const { rows } = await pool.query(
    `SELECT *
     FROM chat_messages
     WHERE conversation_id = $1
       ${beforeClause}
     ORDER BY created_at DESC
     LIMIT $2`,
    params,
  );
  return { ok: true, body: { conversation: mapConversation(conversation), messages: rows.map(mapMessage).reverse() } };
}

async function markConversationRead({
  pool,
  userId,
  body,
  enforceDirectFriendship = false,
  enforceMatchParticipation = false,
  enforceRoomParticipation = false,
}) {
  if (!userId) return { ok: false, status: 401, error: 'Unauthorized' };
  const key = conversationKey(body.conversationType, body.subjectId);
  if (!key) return { ok: false, status: 400, error: 'Invalid conversation' };
  if (
    !(await canAccessConversationWithPolicy({
      pool,
      userId,
      type: body.conversationType,
      subjectId: body.subjectId,
      enforceDirectFriendship,
      enforceMatchParticipation,
      enforceRoomParticipation,
    }))
  ) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }
  const lastReadMessageId = typeof body.lastReadMessageId === 'string' ? body.lastReadMessageId.slice(0, 80) : null;
  await pool.query(
    `INSERT INTO chat_read_states (conversation_id, user_id, last_read_message_id, read_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (conversation_id, user_id)
     DO UPDATE SET last_read_message_id = EXCLUDED.last_read_message_id, read_at = NOW()`,
    [key, userId, lastReadMessageId],
  );
  return { ok: true, body: { ok: true } };
}

async function listUnreadChat({
  pool,
  userId,
  limit,
  enforceDirectFriendship = false,
  enforceMatchParticipation = false,
  enforceRoomParticipation = false,
}) {
  if (!userId) return { ok: false, status: 401, error: 'Unauthorized' };
  const lim = clampLimit(limit, 50, 200);
  const encodedUserId = encodeURIComponent(userId);
  const directSubjectIds = enforceDirectFriendship ? await directFriendConversationSubjects({ pool, userId }) : [];
  const { rows } = await pool.query(
    `SELECT c.id, c.type, c.subject_id, c.title, c.status, c.created_at, c.updated_at,
            COUNT(m.id) AS unread_count,
            MAX(m.created_at) AS latest_message_at,
            (ARRAY_AGG(m.id ORDER BY m.created_at DESC, m.id DESC))[1] AS latest_message_id
     FROM chat_conversations c
     JOIN chat_messages m ON m.conversation_id = c.id
     LEFT JOIN chat_read_states r ON r.conversation_id = c.id AND r.user_id = $1
     WHERE m.author_user_id IS DISTINCT FROM $1
       AND m.deleted_at IS NULL
       AND m.moderation_status IN ('visible', 'pending_review')
       AND (r.read_at IS NULL OR m.created_at > r.read_at)
       AND (c.type <> 'global' OR c.subject_id = 'online-lobby')
       AND (
         c.type <> 'direct'
         OR (
           $4 = TRUE
           AND c.subject_id = ANY($5::text[])
         )
         OR (
           $4 = FALSE
           AND (
             (
               c.subject_id LIKE 'v1:%'
               AND $3 = ANY(string_to_array(SUBSTRING(c.subject_id FROM 4), ':'))
             )
             OR (
               c.subject_id NOT LIKE 'v1:%'
               AND $1 = ANY(string_to_array(c.subject_id, ':'))
             )
           )
         )
       )
       AND (
         $6 = FALSE
         OR c.type <> 'match'
         OR EXISTS (
           SELECT 1
           FROM platform_match_participants pmp
           WHERE pmp.boardgame_match_id = c.subject_id
             AND pmp.user_id = $1
         )
         OR EXISTS (
           SELECT 1
           FROM matches played_match
           WHERE played_match.source_match_id = c.subject_id
             AND (played_match.player0_id = $1 OR played_match.player1_id = $1)
         )
       )
       AND (
         $7 = FALSE
         OR c.type <> 'room'
         OR EXISTS (
           SELECT 1
           FROM platform_room_participants prp
           WHERE prp.room_code = c.subject_id
             AND prp.user_id = $1
         )
       )
     GROUP BY c.id
     ORDER BY latest_message_at DESC
     LIMIT $2`,
    [
      userId,
      lim,
      encodedUserId,
      Boolean(enforceDirectFriendship),
      directSubjectIds,
      Boolean(enforceMatchParticipation),
      Boolean(enforceRoomParticipation),
    ],
  );
  return {
    ok: true,
    body: {
      conversations: rows.map((row) => ({
        ...mapConversation(row),
        unreadCount: Number(row.unread_count) || 0,
        latestMessageAt: row.latest_message_at || null,
        latestMessageId: row.latest_message_id || null,
      })),
    },
  };
}

async function upsertChatTranslation({ pool, messageId, targetLanguage, translatedContent, provider, model, status }) {
  const { rows } = await pool.query(
    `INSERT INTO chat_message_translations (
       message_id, target_language, translated_content, provider, model, status, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (message_id, target_language)
     DO UPDATE SET
       translated_content = EXCLUDED.translated_content,
       provider = EXCLUDED.provider,
       model = EXCLUDED.model,
       status = EXCLUDED.status,
       updated_at = NOW()
     RETURNING *`,
    [messageId, targetLanguage, translatedContent, provider, model, status],
  );
  return mapTranslation(rows[0]);
}

async function requestChatTranslation({
  pool,
  userId,
  messageId,
  body,
  sanitizeText,
  translateText,
  providerName = '',
  modelName = '',
  enforceDirectFriendship = false,
  enforceMatchParticipation = false,
  enforceRoomParticipation = false,
}) {
  if (!userId) return { ok: false, status: 401, error: 'Unauthorized' };
  const cleanMessageId = typeof messageId === 'string' ? messageId.slice(0, 80) : '';
  const targetLanguage = normalizeLanguage(body.targetLanguage);
  if (!cleanMessageId || !targetLanguage) return { ok: false, status: 400, error: 'Invalid translation request' };

  const message = (
    await pool.query(
      `SELECT m.id, m.conversation_id, m.content, m.source_language, c.type, c.subject_id
       FROM chat_messages m
       JOIN chat_conversations c ON c.id = m.conversation_id
       WHERE m.id = $1
         AND m.deleted_at IS NULL
         AND m.moderation_status IN ('visible', 'pending_review')`,
      [cleanMessageId],
    )
  ).rows[0];
  if (!message) return { ok: false, status: 404, error: 'Message not found' };
  if (
    !(await canAccessConversationWithPolicy({
      pool,
      userId,
      type: message.type,
      subjectId: message.subject_id,
      enforceDirectFriendship,
      enforceMatchParticipation,
      enforceRoomParticipation,
    }))
  ) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  const existing = (
    await pool.query(
      `SELECT *
       FROM chat_message_translations
       WHERE message_id = $1 AND target_language = $2`,
      [cleanMessageId, targetLanguage],
    )
  ).rows[0];
  if (existing && existing.status === 'ready') {
    return { ok: true, body: { translation: mapTranslation(existing), cached: true } };
  }

  const sourceLanguage = normalizeLanguage(message.source_language);
  if (sourceLanguage && sourceLanguage === targetLanguage) {
    const translation = await upsertChatTranslation({
      pool,
      messageId: cleanMessageId,
      targetLanguage,
      translatedContent: message.content,
      provider: 'source',
      model: '',
      status: 'ready',
    });
    return { ok: true, body: { translation, cached: Boolean(existing) } };
  }

  if (typeof translateText !== 'function') {
    const translation =
      existing && existing.status === 'pending'
        ? mapTranslation(existing)
        : await upsertChatTranslation({
            pool,
            messageId: cleanMessageId,
            targetLanguage,
            translatedContent: '',
            provider: providerName || 'unconfigured',
            model: modelName || '',
            status: 'pending',
          });
    return { ok: true, body: { translation, cached: Boolean(existing) } };
  }

  try {
    const result = await translateText({
      text: message.content,
      sourceLanguage,
      targetLanguage,
      messageId: cleanMessageId,
      conversationId: message.conversation_id,
    });
    const translatedContent = sanitizeText(result?.translatedContent || '', 4000).trim();
    if (!translatedContent) throw new Error('Empty translation result');
    const translation = await upsertChatTranslation({
      pool,
      messageId: cleanMessageId,
      targetLanguage,
      translatedContent,
      provider: sanitizeText(result?.provider || providerName || 'llm', 60),
      model: sanitizeText(result?.model || modelName || '', 120),
      status: 'ready',
    });
    return { ok: true, body: { translation, cached: false } };
  } catch {
    const translation = await upsertChatTranslation({
      pool,
      messageId: cleanMessageId,
      targetLanguage,
      translatedContent: existing?.translated_content || '',
      provider: providerName || 'llm',
      model: modelName || '',
      status: 'pending',
    });
    return { ok: true, body: { translation, cached: Boolean(existing) } };
  }
}

async function reportChatMessage({
  pool,
  reporterUserId,
  messageId,
  body,
  sanitizeText,
  generateReportId,
  enforceDirectFriendship = false,
  enforceMatchParticipation = false,
  enforceRoomParticipation = false,
}) {
  if (!reporterUserId) return { ok: false, status: 401, error: 'Unauthorized' };
  const cleanMessageId = typeof messageId === 'string' ? messageId.slice(0, 80) : '';
  const reason = sanitizeText(body.reason || '', 60);
  if (!cleanMessageId || !reason) return { ok: false, status: 400, error: 'Report reason is required' };

  const message = (
    await pool.query(
      `SELECT m.id, m.conversation_id, m.author_user_id, m.author_display_name, m.author_role,
              m.content, m.moderation_status, m.created_at,
              c.type AS conversation_type, c.subject_id AS conversation_subject_id
       FROM chat_messages m
       JOIN chat_conversations c ON c.id = m.conversation_id
       WHERE m.id = $1`,
      [cleanMessageId],
    )
  ).rows[0];
  if (!message) return { ok: false, status: 404, error: 'Message not found' };
  if (
    !(await canAccessConversationWithPolicy({
      pool,
      userId: reporterUserId,
      type: message.conversation_type,
      subjectId: message.conversation_subject_id,
      enforceDirectFriendship,
      enforceMatchParticipation,
      enforceRoomParticipation,
    }))
  ) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  const id = generateReportId();
  const { rows } = await pool.query(
    `INSERT INTO chat_reports (
       id, message_id, conversation_id, reporter_user_id, reason, note,
       reported_message_content, reported_message_author_user_id, reported_message_author_display_name,
       reported_message_author_role, reported_message_moderation_status, reported_message_created_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      id,
      cleanMessageId,
      message.conversation_id,
      reporterUserId,
      reason,
      sanitizeText(body.note || '', 1000),
      message.content || '',
      message.author_user_id || null,
      message.author_display_name || '',
      message.author_role || 'spectator',
      message.moderation_status || 'visible',
      message.created_at || null,
    ],
  );
  return { ok: true, body: { report: mapReport(rows[0]) } };
}

async function listChatReports({ pool, status, limit }) {
  const cleanStatus = REPORT_STATUSES.includes(status) ? status : 'open';
  const lim = clampLimit(limit, 50, 200);
  const { rows } = await pool.query(
    `SELECT r.*,
            m.content AS message_content,
            m.author_user_id AS message_author_user_id,
            m.author_display_name AS message_author_display_name,
            m.author_role AS message_author_role,
            m.moderation_status AS message_moderation_status,
            m.created_at AS message_created_at,
            s.id AS sanction_id,
            s.target_user_id AS sanction_target_user_id,
            s.type AS sanction_type,
            s.status AS sanction_status,
            s.reason AS sanction_reason,
            s.source_report_id AS sanction_source_report_id,
            s.source_message_id AS sanction_source_message_id,
            s.conversation_id AS sanction_conversation_id,
            s.created_by_user_id AS sanction_created_by_user_id,
            s.created_at AS sanction_created_at,
            s.expires_at AS sanction_expires_at,
            s.revoked_at AS sanction_revoked_at,
            s.revoked_by_user_id AS sanction_revoked_by_user_id,
            s.revocation_reason AS sanction_revocation_reason
     FROM chat_reports r
     LEFT JOIN chat_messages m ON m.id = r.message_id
     LEFT JOIN LATERAL (
       SELECT *
       FROM chat_user_sanctions
       WHERE target_user_id = COALESCE(r.reported_message_author_user_id, m.author_user_id)
         AND type = 'chat_mute'
         AND status = 'active'
         AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY created_at DESC
       LIMIT 1
     ) s ON true
     WHERE r.status = $1
     ORDER BY r.created_at DESC
     LIMIT $2`,
    [cleanStatus, lim],
  );
  return { ok: true, body: { reports: rows.map(mapReport) } };
}

async function createChatUserSanction({ pool, targetUserId, body, reviewerUserId, sanitizeText, generateSanctionId }) {
  const cleanTargetUserId = typeof targetUserId === 'string' ? targetUserId.slice(0, 128) : '';
  if (!cleanTargetUserId) return { ok: false, status: 400, error: 'Invalid target user' };
  const type = normalizeSanctionType(body.type);
  const durationMinutes = clampLimit(body.durationMinutes, 1440, 43200);
  const expiresAt = new Date(Date.now() + durationMinutes * 60_000).toISOString();
  const reason = sanitizeText(body.reason || '', 1000);
  const sourceReportId = typeof body.sourceReportId === 'string' ? body.sourceReportId.slice(0, 80) : '';
  const sourceMessageId = typeof body.sourceMessageId === 'string' ? body.sourceMessageId.slice(0, 80) : '';
  const sourceConversationId = typeof body.conversationId === 'string' ? body.conversationId.slice(0, 340) : '';
  if (sourceReportId || sourceMessageId) {
    const source = (
      await pool.query(
        `SELECT r.id AS report_id,
                r.message_id AS report_message_id,
                r.conversation_id AS report_conversation_id,
                r.reported_message_author_user_id,
                m.id AS message_id,
                m.conversation_id AS message_conversation_id,
                m.author_user_id AS message_author_user_id
         FROM chat_reports r
         LEFT JOIN chat_messages m ON m.id = r.message_id
         WHERE ($1::text = '' OR r.id = $1)
           AND ($2::text = '' OR r.message_id = $2)
         LIMIT 1`,
        [sourceReportId, sourceMessageId],
      )
    ).rows[0];
    if (!source) return { ok: false, status: 404, error: 'Report evidence not found' };
    if (sourceReportId && source.report_id !== sourceReportId) {
      return { ok: false, status: 400, error: 'Report evidence mismatch' };
    }
    if (sourceMessageId && source.report_message_id !== sourceMessageId) {
      return { ok: false, status: 400, error: 'Report evidence mismatch' };
    }
    const evidenceConversationId = source.report_conversation_id || source.message_conversation_id || '';
    if (sourceConversationId && evidenceConversationId !== sourceConversationId) {
      return { ok: false, status: 400, error: 'Report evidence mismatch' };
    }
    const evidenceAuthorUserId = source.reported_message_author_user_id || source.message_author_user_id || '';
    if (!evidenceAuthorUserId || evidenceAuthorUserId !== cleanTargetUserId) {
      return { ok: false, status: 400, error: 'Report target mismatch' };
    }
  }
  const id = generateSanctionId();

  await pool.query(
    `UPDATE chat_user_sanctions
     SET status = 'revoked',
         revoked_at = NOW(),
         revoked_by_user_id = $2,
         revocation_reason = 'superseded'
     WHERE target_user_id = $1
       AND type = $3
       AND status = 'active'
       AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [cleanTargetUserId, reviewerUserId || null, type],
  );

  const { rows } = await pool.query(
    `INSERT INTO chat_user_sanctions (
       id, target_user_id, type, status, reason, source_report_id, source_message_id,
       conversation_id, created_by_user_id, expires_at
     )
     VALUES ($1, $2, $3, 'active', $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      id,
      cleanTargetUserId,
      type,
      reason,
      sourceReportId || null,
      sourceMessageId || null,
      sourceConversationId || null,
      reviewerUserId || null,
      expiresAt,
    ],
  );
  return { ok: true, body: { sanction: mapSanction(rows[0]) } };
}

async function revokeChatUserSanction({ pool, sanctionId, reviewerUserId, body, sanitizeText }) {
  const cleanSanctionId = typeof sanctionId === 'string' ? sanctionId.slice(0, 80) : '';
  if (!cleanSanctionId) return { ok: false, status: 400, error: 'Invalid sanction' };
  const { rows } = await pool.query(
    `UPDATE chat_user_sanctions
     SET status = 'revoked',
         revoked_at = NOW(),
         revoked_by_user_id = $2,
         revocation_reason = $3
     WHERE id = $1
       AND status = 'active'
     RETURNING *`,
    [cleanSanctionId, reviewerUserId || null, sanitizeText(body?.reason || 'manual_revoke', 1000)],
  );
  if (rows.length === 0) return { ok: false, status: 404, error: 'Sanction not found' };
  return { ok: true, body: { sanction: mapSanction(rows[0]) } };
}

async function reviewChatReport({ pool, reportId, body, reviewerUserId, sanitizeText }) {
  const cleanStatus = REPORT_STATUSES.includes(body.status) ? body.status : null;
  if (!cleanStatus || cleanStatus === 'open') return { ok: false, status: 400, error: 'Invalid report status' };
  const { rows } = await pool.query(
    `UPDATE chat_reports
     SET status = $2, reviewer_user_id = $3, resolution_note = $4, reviewed_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [reportId, cleanStatus, reviewerUserId || null, sanitizeText(body.resolutionNote || '', 1000)],
  );
  if (rows.length === 0) return { ok: false, status: 404, error: 'Report not found' };
  return { ok: true, body: { report: mapReport(rows[0]) } };
}

async function reviewChatMessageModeration({
  pool,
  messageId,
  body,
  reviewerUserId,
  sanitizeText,
  generateModerationEventId,
}) {
  const cleanMessageId = typeof messageId === 'string' ? messageId.slice(0, 80) : '';
  const cleanStatus = REVIEWABLE_MESSAGE_STATUSES.includes(body.status) ? body.status : null;
  if (!cleanMessageId || !cleanStatus) {
    return { ok: false, status: 400, error: 'Invalid moderation status' };
  }
  const fallbackReason = cleanStatus === 'visible' ? '' : `manual_${cleanStatus}`;
  const reason = sanitizeText(body.reason || fallbackReason, 240);
  const { rows } = await pool.query(
    `UPDATE chat_messages
     SET moderation_status = $2,
         moderation_reason = $3,
         deleted_at = CASE
           WHEN $2 = 'deleted' THEN COALESCE(deleted_at, NOW())
           ELSE NULL
         END
     WHERE id = $1
     RETURNING *`,
    [cleanMessageId, cleanStatus, reason],
  );
  if (rows.length === 0) return { ok: false, status: 404, error: 'Message not found' };
  const message = mapMessage(rows[0]);
  if (generateModerationEventId) {
    await pool.query(
      `INSERT INTO chat_moderation_events (
         id, message_id, conversation_id, actor_user_id, source, action, reason, details
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        generateModerationEventId(),
        cleanMessageId,
        message.conversationId,
        reviewerUserId || null,
        'admin',
        cleanStatus,
        reason,
        { status: cleanStatus },
      ],
    );
  }
  return { ok: true, body: { message } };
}

module.exports = {
  CONVERSATION_TYPES,
  PARTICIPANT_ROLES,
  MESSAGE_STATUSES,
  REVIEWABLE_MESSAGE_STATUSES,
  REPORT_STATUSES,
  SANCTION_TYPES,
  canAccessConversation,
  canAccessConversationWithPolicy,
  conversationKey,
  createChatUserSanction,
  defaultChatModerationRules,
  evaluateChatModeration,
  getActiveChatSanction,
  getOrCreateConversation,
  hasMatchChatAccess,
  hasRoomChatAccess,
  listChatEvidenceMessages,
  listChatMessages,
  listChatReports,
  requestChatTranslation,
  listUnreadChat,
  markConversationRead,
  reportChatMessage,
  reviewChatMessageModeration,
  reviewChatReport,
  revokeChatUserSanction,
  sendChatMessage,
};
