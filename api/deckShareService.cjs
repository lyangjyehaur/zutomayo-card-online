/* global module, require */

const crypto = require('crypto');
const { createUserDeck, validateDeckInput } = require('./deckService.cjs');

const DEFAULT_PAGE_LIMIT = 24;
const MAX_PAGE_LIMIT = 48;
const DECK_SHARE_SORTS = new Set(['newest', 'popular', 'most-copied']);
const DECK_SHARE_VISIBILITIES = new Set(['public', 'unlisted']);

function isoDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function cardIdsFromRow(row) {
  return Array.isArray(row?.card_ids) ? row.card_ids.filter((id) => typeof id === 'string') : [];
}

function mapDeckShareRow(row, { includeCards = false, owned = false } = {}) {
  const mapped = {
    id: row.id,
    name: row.name,
    visibility: row.visibility,
    publicationStatus: row.publication_status,
    moderationStatus: row.moderation_status,
    publishedRulesVersion: row.published_rules_version,
    publishedAt: isoDate(row.published_at),
    updatedAt: isoDate(row.updated_at),
    owner: {
      userId: row.owner_user_id,
      nickname: row.owner_nickname || '',
    },
    elements: Array.isArray(row.elements) ? row.elements.filter(Boolean) : [],
    characterCount: Number(row.character_count) || 0,
    representativeCardIds: Array.isArray(row.representative_card_ids)
      ? row.representative_card_ids.filter((id) => typeof id === 'string')
      : [],
    likeCount: Number(row.like_count) || 0,
    copyCount: Number(row.copy_count) || 0,
    viewerHasLiked: Boolean(row.viewer_has_liked),
  };
  if (includeCards) mapped.cardIds = cardIdsFromRow(row);
  if (owned) {
    mapped.sourceDeckId = row.source_deck_id || null;
    mapped.sourceDeckExists = Boolean(row.source_deck_exists);
    mapped.sourceChanged = Boolean(row.source_changed);
    mapped.unpublishedAt = isoDate(row.unpublished_at);
    mapped.moderationReason = row.moderation_reason || '';
  }
  return mapped;
}

function normalizeVisibility(value) {
  return DECK_SHARE_VISIBILITIES.has(value) ? value : null;
}

function normalizeSort(value) {
  return DECK_SHARE_SORTS.has(value) ? value : 'newest';
}

function normalizeLimit(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_PAGE_LIMIT;
  return Math.min(parsed, MAX_PAGE_LIMIT);
}

function encodeCursor(sort, row) {
  const payload = {
    v: 1,
    sort,
    id: row.id,
    updatedAt: isoDate(row.updated_at),
  };
  if (sort === 'popular') payload.count = Number(row.like_count) || 0;
  if (sort === 'most-copied') payload.count = Number(row.copy_count) || 0;
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function decodeCursor(value, expectedSort) {
  if (!value) return null;
  try {
    const payload = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    if (payload?.v !== 1 || payload.sort !== expectedSort) return null;
    if (typeof payload.id !== 'string' || !payload.id.startsWith('ds_')) return null;
    if (typeof payload.updatedAt !== 'string' || !Number.isFinite(new Date(payload.updatedAt).getTime())) return null;
    if (expectedSort !== 'newest' && (!Number.isInteger(payload.count) || payload.count < 0)) return null;
    return payload;
  } catch {
    return null;
  }
}

async function readOwnedSourceDeck(pool, userId, deckId) {
  return (
    await pool.query(
      `SELECT id, user_id, name, card_ids, updated_at
         FROM decks
        WHERE id = $1 AND user_id = $2`,
      [deckId, userId],
    )
  ).rows[0];
}

async function validateSourceDeck(pool, deck) {
  if (!deck) return 'Deck not found';
  return validateDeckInput(pool, deck.name, cardIdsFromRow(deck));
}

async function publishDeckShare(
  pool,
  userId,
  deckId,
  visibility,
  rulesVersion,
  generateShareId = () => `ds_${crypto.randomBytes(12).toString('base64url')}`,
) {
  const safeVisibility = normalizeVisibility(visibility);
  if (!safeVisibility) return { ok: false, status: 400, error: 'Invalid deck share visibility' };
  if (typeof deckId !== 'string' || !deckId.startsWith('d_')) {
    return { ok: false, status: 400, error: 'A saved server deck is required' };
  }
  const deck = await readOwnedSourceDeck(pool, userId, deckId);
  if (!deck) return { ok: false, status: 404, error: 'Deck not found' };
  const validationError = await validateSourceDeck(pool, deck);
  if (validationError) return { ok: false, status: 400, error: validationError };

  const safeRulesVersion = String(rulesVersion || 'default').slice(0, 120);
  const shareId = generateShareId();
  const row = (
    await pool.query(
      `INSERT INTO deck_shares
         (id, owner_user_id, source_deck_id, name, card_ids, visibility,
          publication_status, published_rules_version, unpublished_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, 'published', $7, NULL)
       ON CONFLICT (source_deck_id) WHERE source_deck_id IS NOT NULL
       DO UPDATE SET
         name = EXCLUDED.name,
         card_ids = EXCLUDED.card_ids,
         visibility = EXCLUDED.visibility,
         publication_status = 'published',
         published_rules_version = EXCLUDED.published_rules_version,
         unpublished_at = NULL,
         updated_at = NOW()
       RETURNING *`,
      [shareId, userId, deck.id, deck.name, JSON.stringify(cardIdsFromRow(deck)), safeVisibility, safeRulesVersion],
    )
  ).rows[0];
  return {
    ok: true,
    body: mapDeckShareRow(
      {
        ...row,
        owner_nickname: '',
        source_deck_exists: true,
        source_changed: false,
        elements: [],
        representative_card_ids: [],
      },
      { includeCards: true, owned: true },
    ),
  };
}

async function getOwnedDeckShare(pool, userId, deckId) {
  if (typeof deckId !== 'string' || !deckId.startsWith('d_')) {
    return { ok: false, status: 400, error: 'Invalid deck id' };
  }
  const row = (
    await pool.query(
      `SELECT ds.*, owner.nickname AS owner_nickname,
              d.id IS NOT NULL AS source_deck_exists,
              CASE WHEN d.id IS NULL THEN FALSE
                   ELSE d.name IS DISTINCT FROM ds.name OR d.card_ids IS DISTINCT FROM ds.card_ids
              END AS source_changed,
              ARRAY[]::text[] AS elements,
              ARRAY[]::text[] AS representative_card_ids,
              0::integer AS character_count,
              (SELECT COUNT(*) FROM deck_share_likes likes WHERE likes.share_id = ds.id) AS like_count,
              (SELECT COUNT(*) FROM deck_share_copy_events copies WHERE copies.share_id = ds.id) AS copy_count,
              FALSE AS viewer_has_liked
         FROM deck_shares ds
         JOIN users owner ON owner.id = ds.owner_user_id
         LEFT JOIN decks d ON d.id = ds.source_deck_id
        WHERE ds.source_deck_id = $1 AND ds.owner_user_id = $2`,
      [deckId, userId],
    )
  ).rows[0];
  if (!row) return { ok: false, status: 404, error: 'Deck share not found' };
  return { ok: true, body: mapDeckShareRow(row, { includeCards: true, owned: true }) };
}

async function updateDeckShare(pool, userId, shareId, input, rulesVersion) {
  const visibility = input.visibility === undefined ? undefined : normalizeVisibility(input.visibility);
  if (input.visibility !== undefined && !visibility) {
    return { ok: false, status: 400, error: 'Invalid deck share visibility' };
  }
  if (input.published === undefined && input.publishLatest !== true && visibility === undefined) {
    return { ok: false, status: 400, error: 'No deck share changes requested' };
  }

  const current = (
    await pool.query(
      `SELECT ds.*, d.name AS source_name, d.card_ids AS source_card_ids, d.id AS current_source_deck_id
         FROM deck_shares ds
         LEFT JOIN decks d ON d.id = ds.source_deck_id AND d.user_id = $2
        WHERE ds.id = $1 AND ds.owner_user_id = $2`,
      [shareId, userId],
    )
  ).rows[0];
  if (!current) return { ok: false, status: 404, error: 'Deck share not found' };

  let name = current.name;
  let cardIds = cardIdsFromRow(current);
  let publishedRulesVersion = current.published_rules_version;
  if (input.publishLatest === true) {
    if (!current.current_source_deck_id) {
      return { ok: false, status: 409, error: 'The source deck no longer exists' };
    }
    const sourceDeck = { name: current.source_name, card_ids: current.source_card_ids };
    const validationError = await validateSourceDeck(pool, sourceDeck);
    if (validationError) return { ok: false, status: 400, error: validationError };
    name = sourceDeck.name;
    cardIds = cardIdsFromRow(sourceDeck);
    publishedRulesVersion = String(rulesVersion || 'default').slice(0, 120);
  }

  const nextPublished = input.published === undefined ? current.publication_status === 'published' : input.published;
  const row = (
    await pool.query(
      `UPDATE deck_shares
          SET name = $3,
              card_ids = $4::jsonb,
              visibility = COALESCE($5, visibility),
              publication_status = $6,
              published_rules_version = $7,
              unpublished_at = CASE WHEN $6 = 'unpublished' THEN COALESCE(unpublished_at, NOW()) ELSE NULL END,
              updated_at = NOW()
        WHERE id = $1 AND owner_user_id = $2
        RETURNING *`,
      [
        shareId,
        userId,
        name,
        JSON.stringify(cardIds),
        visibility ?? null,
        nextPublished ? 'published' : 'unpublished',
        publishedRulesVersion,
      ],
    )
  ).rows[0];
  return {
    ok: true,
    body: mapDeckShareRow(
      {
        ...row,
        owner_nickname: '',
        source_deck_exists: Boolean(current.current_source_deck_id),
        source_changed: false,
        elements: [],
        representative_card_ids: [],
      },
      { includeCards: true, owned: true },
    ),
  };
}

async function unpublishDeckShare(pool, userId, shareId) {
  const row = (
    await pool.query(
      `UPDATE deck_shares
          SET publication_status = 'unpublished',
              unpublished_at = COALESCE(unpublished_at, NOW()),
              updated_at = NOW()
        WHERE id = $1 AND owner_user_id = $2
        RETURNING id`,
      [shareId, userId],
    )
  ).rows[0];
  if (!row) return { ok: false, status: 404, error: 'Deck share not found' };
  return { ok: true, body: { unpublished: true, shareId: row.id } };
}

async function withTransaction(pool, operation) {
  const client = typeof pool.connect === 'function' ? await pool.connect() : pool;
  const release = typeof client.release === 'function' ? () => client.release() : () => undefined;
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    if (result?.ok === false) {
      await client.query('ROLLBACK');
      return result;
    }
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    release();
  }
}

async function readInteractableShare(pool, userId, shareId) {
  return (
    await pool.query(
      `SELECT ds.id, ds.owner_user_id, ds.name, ds.card_ids
         FROM deck_shares ds
        WHERE ds.id = $1
          AND ds.publication_status = 'published'
          AND ds.moderation_status = 'visible'
          AND NOT EXISTS (
            SELECT 1 FROM user_blocks block
             WHERE (block.blocker_user_id = $2 AND block.blocked_user_id = ds.owner_user_id)
                OR (block.blocker_user_id = ds.owner_user_id AND block.blocked_user_id = $2)
          )`,
      [shareId, userId],
    )
  ).rows[0];
}

async function copyDeckShare(
  pool,
  userId,
  shareId,
  input = {},
  generateDeckId = () => `d_${crypto.randomBytes(8).toString('hex')}`,
) {
  return withTransaction(pool, async (client) => {
    const share = await readInteractableShare(client, userId, shareId);
    if (!share) return { ok: false, status: 404, error: 'Deck share not found' };

    const idempotencyKey = typeof input.idempotencyKey === 'string' ? input.idempotencyKey : '';
    if (idempotencyKey) {
      const existing = (
        await client.query(
          `SELECT deck.id, deck.name, deck.card_ids
             FROM deck_share_copy_events event
             JOIN decks deck ON deck.id = event.copied_deck_id
            WHERE event.share_id = $1 AND event.user_id = $2 AND event.idempotency_key = $3`,
          [shareId, userId, idempotencyKey],
        )
      ).rows[0];
      if (existing) {
        const count = (
          await client.query('SELECT COUNT(*) AS count FROM deck_share_copy_events WHERE share_id = $1', [shareId])
        ).rows[0];
        return {
          ok: true,
          body: {
            deck: { id: existing.id, name: existing.name, cardIds: cardIdsFromRow(existing) },
            copyCount: Number(count?.count) || 0,
          },
        };
      }
    }

    const requestedName = typeof input.name === 'string' ? input.name.trim() : '';
    const copyName = (requestedName || `${share.name} Copy`).slice(0, 60);
    const created = await createUserDeck(
      client,
      userId,
      { name: copyName, cardIds: cardIdsFromRow(share) },
      generateDeckId,
    );
    if (!created.ok) return created;
    await client.query(
      `INSERT INTO deck_share_copy_events (share_id, user_id, copied_deck_id, idempotency_key)
       VALUES ($1, $2, $3, $4)`,
      [shareId, userId, created.body.id, idempotencyKey || null],
    );
    const count = (
      await client.query('SELECT COUNT(*) AS count FROM deck_share_copy_events WHERE share_id = $1', [shareId])
    ).rows[0];
    return { ok: true, body: { deck: created.body, copyCount: Number(count?.count) || 0 } };
  });
}

async function likeDeckShare(pool, userId, shareId) {
  const share = await readInteractableShare(pool, userId, shareId);
  if (!share) return { ok: false, status: 404, error: 'Deck share not found' };
  if (share.owner_user_id === userId) return { ok: false, status: 400, error: 'You cannot like your own deck share' };
  await pool.query(
    `INSERT INTO deck_share_likes (share_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (share_id, user_id) DO NOTHING`,
    [shareId, userId],
  );
  const count = (await pool.query('SELECT COUNT(*) AS count FROM deck_share_likes WHERE share_id = $1', [shareId]))
    .rows[0];
  return { ok: true, body: { liked: true, likeCount: Number(count?.count) || 0 } };
}

async function unlikeDeckShare(pool, userId, shareId) {
  const share = await readInteractableShare(pool, userId, shareId);
  if (!share) return { ok: false, status: 404, error: 'Deck share not found' };
  await pool.query('DELETE FROM deck_share_likes WHERE share_id = $1 AND user_id = $2', [shareId, userId]);
  const count = (await pool.query('SELECT COUNT(*) AS count FROM deck_share_likes WHERE share_id = $1', [shareId]))
    .rows[0];
  return { ok: true, body: { liked: false, likeCount: Number(count?.count) || 0 } };
}

async function reportDeckShare(
  pool,
  userId,
  shareId,
  input,
  generateReportId = () => `dsr_${crypto.randomBytes(12).toString('base64url')}`,
) {
  const share = await readInteractableShare(pool, userId, shareId);
  if (!share) return { ok: false, status: 404, error: 'Deck share not found' };
  if (share.owner_user_id === userId) return { ok: false, status: 400, error: 'You cannot report your own deck share' };
  const row = (
    await pool.query(
      `INSERT INTO deck_share_reports (id, share_id, reporter_user_id, reason, note)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (share_id, reporter_user_id)
         WHERE reporter_user_id IS NOT NULL AND status IN ('pending', 'reviewing')
       DO UPDATE SET reason = EXCLUDED.reason, note = EXCLUDED.note, updated_at = NOW()
       RETURNING id, share_id, reason, note, status, created_at, updated_at`,
      [generateReportId(), shareId, userId, input.reason, input.note || ''],
    )
  ).rows[0];
  return {
    ok: true,
    body: {
      report: {
        id: row.id,
        shareId: row.share_id,
        reason: row.reason,
        note: row.note,
        status: row.status,
        createdAt: isoDate(row.created_at),
        updatedAt: isoDate(row.updated_at),
      },
    },
  };
}

function mapDeckShareReportRow(row) {
  return {
    id: row.id,
    shareId: row.share_id,
    reporterUserId: row.reporter_user_id || null,
    reporterNickname: row.reporter_nickname || '',
    reason: row.reason,
    note: row.note || '',
    status: row.status,
    resolutionNote: row.resolution_note || '',
    createdAt: isoDate(row.created_at),
    updatedAt: isoDate(row.updated_at),
    resolvedAt: isoDate(row.resolved_at),
    share: {
      name: row.share_name || '',
      ownerUserId: row.owner_user_id || '',
      ownerNickname: row.owner_nickname || '',
      publicationStatus: row.publication_status || '',
      moderationStatus: row.moderation_status || '',
      moderationReason: row.moderation_reason || '',
      cardIds: cardIdsFromRow(row),
    },
  };
}

async function listAdminDeckShareReports(pool, { status = 'pending', limit = 50 } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
  const rows = (
    await pool.query(
      `SELECT report.*, share.name AS share_name, share.card_ids,
              share.owner_user_id, share.publication_status, share.moderation_status, share.moderation_reason,
              owner.nickname AS owner_nickname, reporter.nickname AS reporter_nickname
         FROM deck_share_reports report
         JOIN deck_shares share ON share.id = report.share_id
         JOIN users owner ON owner.id = share.owner_user_id
         LEFT JOIN users reporter ON reporter.id = report.reporter_user_id
        WHERE report.status = $1
        ORDER BY report.created_at DESC, report.id DESC
        LIMIT $2`,
      [status, safeLimit],
    )
  ).rows;
  return { ok: true, body: { reports: rows.map(mapDeckShareReportRow) } };
}

async function moderateDeckShare(pool, adminUserId, shareId, input) {
  return withTransaction(pool, async (client) => {
    const share = (
      await client.query(
        `UPDATE deck_shares
            SET moderation_status = $2,
                moderation_reason = $3,
                moderated_at = NOW(),
                moderated_by_admin_user_id = $4,
                updated_at = NOW()
          WHERE id = $1
          RETURNING id, moderation_status, moderation_reason`,
        [shareId, input.moderationStatus, input.reason || '', adminUserId],
      )
    ).rows[0];
    if (!share) return { ok: false, status: 404, error: 'Deck share not found' };

    await client.query(
      `UPDATE deck_share_reports
          SET status = $2,
              resolution_note = $3,
              reviewed_by_admin_user_id = $4,
              resolved_at = NOW(),
              updated_at = NOW()
        WHERE share_id = $1 AND status IN ('pending', 'reviewing')`,
      [shareId, input.reportStatus, input.resolutionNote || '', adminUserId],
    );
    await client.query(
      `INSERT INTO admin_audit_log (admin_user_id, action, target_type, target_id, details)
       VALUES ($1, 'deck_share_moderation', 'deck_share', $2, $3::jsonb)`,
      [
        adminUserId,
        shareId,
        JSON.stringify({
          moderationStatus: input.moderationStatus,
          reason: input.reason || '',
          reportStatus: input.reportStatus,
        }),
      ],
    );
    return {
      ok: true,
      body: {
        shareId: share.id,
        moderationStatus: share.moderation_status,
        moderationReason: share.moderation_reason,
      },
    };
  });
}

function sharedSelect(viewerParameter = null) {
  const viewerLiked = viewerParameter
    ? `EXISTS (
         SELECT 1 FROM deck_share_likes viewer_like
          WHERE viewer_like.share_id = ds.id AND viewer_like.user_id = ${viewerParameter}
       )`
    : 'FALSE';
  return `SELECT ds.*, owner.nickname AS owner_nickname,
                 (SELECT COUNT(*) FROM deck_share_likes likes WHERE likes.share_id = ds.id) AS like_count,
                 (SELECT COUNT(*) FROM deck_share_copy_events copies WHERE copies.share_id = ds.id) AS copy_count,
                 ${viewerLiked} AS viewer_has_liked,
                 ARRAY(
                   SELECT DISTINCT card.element
                     FROM jsonb_array_elements_text(ds.card_ids) AS deck_card(card_id)
                     JOIN cards card ON card.id = deck_card.card_id
                    ORDER BY card.element
                 ) AS elements,
                 (SELECT COUNT(*)
                    FROM jsonb_array_elements_text(ds.card_ids) AS deck_card(card_id)
                    JOIN cards card ON card.id = deck_card.card_id
                   WHERE card.type = 'Character') AS character_count,
                 ARRAY(
                   SELECT representative.card_id
                     FROM (
                       SELECT deck_card.card_id
                         FROM jsonb_array_elements_text(ds.card_ids) AS deck_card(card_id)
                        GROUP BY deck_card.card_id
                        ORDER BY deck_card.card_id
                        LIMIT 3
                     ) AS representative
                 ) AS representative_card_ids
            FROM deck_shares ds
            JOIN users owner ON owner.id = ds.owner_user_id`;
}

async function getDeckShare(pool, viewerUserId, shareId) {
  const values = [shareId];
  let viewerParameter = null;
  let blockClause = '';
  if (viewerUserId) {
    values.push(viewerUserId);
    viewerParameter = '$2';
    blockClause = `AND NOT EXISTS (
      SELECT 1 FROM user_blocks block
       WHERE (block.blocker_user_id = $2 AND block.blocked_user_id = ds.owner_user_id)
          OR (block.blocker_user_id = ds.owner_user_id AND block.blocked_user_id = $2)
    )`;
  }
  const row = (
    await pool.query(
      `${sharedSelect(viewerParameter)}
        WHERE ds.id = $1
          AND ds.publication_status = 'published'
          AND ds.moderation_status = 'visible'
          ${blockClause}`,
      values,
    )
  ).rows[0];
  if (!row) return { ok: false, status: 404, error: 'Deck share not found' };
  return { ok: true, body: mapDeckShareRow(row, { includeCards: true }) };
}

async function listDeckShares(pool, viewerUserId, query = {}) {
  const sort = normalizeSort(query.sort);
  const limit = normalizeLimit(query.limit);
  const values = [];
  const conditions = [
    "ds.publication_status = 'published'",
    "ds.moderation_status = 'visible'",
    "ds.visibility = 'public'",
  ];
  let viewerParameter = null;
  if (viewerUserId) {
    values.push(viewerUserId);
    viewerParameter = `$${values.length}`;
    conditions.push(`NOT EXISTS (
      SELECT 1 FROM user_blocks block
       WHERE (block.blocker_user_id = ${viewerParameter} AND block.blocked_user_id = ds.owner_user_id)
          OR (block.blocker_user_id = ds.owner_user_id AND block.blocked_user_id = ${viewerParameter})
    )`);
  }
  const search = typeof query.q === 'string' ? query.q.trim().slice(0, 120) : '';
  if (search) {
    values.push(`%${search}%`);
    conditions.push(`(ds.name ILIKE $${values.length} OR owner.nickname ILIKE $${values.length})`);
  }
  const element = typeof query.element === 'string' ? query.element.trim() : '';
  if (element) {
    values.push(element);
    conditions.push(`EXISTS (
      SELECT 1
        FROM jsonb_array_elements_text(ds.card_ids) AS filtered_card(card_id)
        JOIN cards card ON card.id = filtered_card.card_id
       WHERE card.element = $${values.length}
    )`);
  }

  const cursor = query.cursor ? decodeCursor(query.cursor, sort) : null;
  if (query.cursor && !cursor) return { ok: false, status: 400, error: 'Invalid deck share cursor' };

  const orderBy =
    sort === 'popular'
      ? 'like_count DESC, updated_at DESC, id DESC'
      : sort === 'most-copied'
        ? 'copy_count DESC, updated_at DESC, id DESC'
        : 'updated_at DESC, id DESC';
  let cursorClause = '';
  if (cursor) {
    if (sort === 'newest') {
      values.push(cursor.updatedAt, cursor.id);
      cursorClause = `WHERE (updated_at, id) < ($${values.length - 1}::timestamptz, $${values.length})`;
    } else {
      values.push(cursor.count, cursor.updatedAt, cursor.id);
      const countColumn = sort === 'popular' ? 'like_count' : 'copy_count';
      cursorClause = `WHERE (${countColumn}, updated_at, id) < ($${values.length - 2}::bigint, $${values.length - 1}::timestamptz, $${values.length})`;
    }
  }
  values.push(limit);
  const rows = (
    await pool.query(
      `WITH share_rows AS (
         ${sharedSelect(viewerParameter)}
          WHERE ${conditions.join('\n            AND ')}
       )
       SELECT * FROM share_rows
       ${cursorClause}
       ORDER BY ${orderBy}
       LIMIT $${values.length}`,
      values,
    )
  ).rows;
  return {
    ok: true,
    body: {
      shares: rows.map((row) => mapDeckShareRow(row)),
      nextCursor: rows.length === limit ? encodeCursor(sort, rows.at(-1)) : null,
    },
  };
}

module.exports = {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  copyDeckShare,
  decodeCursor,
  encodeCursor,
  getDeckShare,
  getOwnedDeckShare,
  likeDeckShare,
  listAdminDeckShareReports,
  listDeckShares,
  mapDeckShareRow,
  publishDeckShare,
  reportDeckShare,
  moderateDeckShare,
  unlikeDeckShare,
  unpublishDeckShare,
  updateDeckShare,
};
