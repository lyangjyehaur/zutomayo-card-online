/* global module */

async function listOwnedCardIds(pool, userId) {
  const result = await pool.query('SELECT card_id FROM user_card_collection WHERE user_id = $1 ORDER BY card_id', [
    userId,
  ]);
  return { cardIds: result.rows.map((row) => row.card_id) };
}

async function validateCatalogCardIds(pool, cardIds) {
  if (cardIds.length === 0) return null;
  const result = await pool.query(
    `SELECT id FROM cards
     WHERE id = ANY($1::text[])
       AND publication_status = 'published'
       AND play_status IN ('playable', 'display_only')`,
    [cardIds],
  );
  const validIds = new Set(result.rows.map((row) => row.id));
  return cardIds.find((cardId) => !validIds.has(cardId)) || null;
}

async function setCardOwnership(pool, userId, cardId, owned) {
  const unknownCardId = await validateCatalogCardIds(pool, [cardId]);
  if (unknownCardId) return { ok: false, status: 404, error: 'Catalog card not found' };

  if (owned) {
    await pool.query(
      `INSERT INTO user_card_collection (user_id, card_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, card_id) DO UPDATE SET updated_at = NOW()`,
      [userId, cardId],
    );
  } else {
    await pool.query('DELETE FROM user_card_collection WHERE user_id = $1 AND card_id = $2', [userId, cardId]);
  }
  return { ok: true, body: { cardId, owned } };
}

async function mergeCardOwnership(pool, userId, cardIds) {
  const uniqueCardIds = [...new Set(cardIds)];
  const unknownCardId = await validateCatalogCardIds(pool, uniqueCardIds);
  if (unknownCardId) return { ok: false, status: 400, error: `Unknown catalog card: ${unknownCardId}` };

  if (uniqueCardIds.length > 0) {
    await pool.query(
      `INSERT INTO user_card_collection (user_id, card_id)
       SELECT $1, card_id FROM unnest($2::text[]) AS card_id
       ON CONFLICT (user_id, card_id) DO NOTHING`,
      [userId, uniqueCardIds],
    );
  }
  return { ok: true, body: await listOwnedCardIds(pool, userId) };
}

module.exports = { listOwnedCardIds, mergeCardOwnership, setCardOwnership, validateCatalogCardIds };
