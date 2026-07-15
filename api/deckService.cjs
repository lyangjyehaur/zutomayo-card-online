 
/* global module, require */

const crypto = require('crypto');

const DEFAULT_RESERVATION_TTL_SECONDS = 10 * 60;

function mapDeckRow(deck) {
  return {
    ...deck,
    cardIds: Array.isArray(deck.card_ids) ? deck.card_ids : [],
  };
}

async function validateDeckInput(pool, name, cardIds) {
  if (!name || !Array.isArray(cardIds) || cardIds.length !== 20) {
    return 'Name and 20 card IDs required';
  }

  const counts = {};
  for (const id of cardIds) {
    if (typeof id !== 'string') return 'Deck card IDs must be strings';
    counts[id] = (counts[id] || 0) + 1;
    if (counts[id] > 2) return `Card ${id} appears more than twice`;
  }
  const uniqueIds = Object.keys(counts);
  const existing = new Set(
    (await pool.query('SELECT id FROM cards WHERE id = ANY($1::text[])', [uniqueIds])).rows.map((row) => row.id),
  );
  const missing = uniqueIds.find((id) => !existing.has(id));
  if (missing) return `Unknown card in deck: ${missing}`;
  return null;
}

async function listUserDecks(pool, userId) {
  const decks = (await pool.query('SELECT * FROM decks WHERE user_id = $1 ORDER BY updated_at DESC', [userId])).rows;
  return { decks: decks.map(mapDeckRow) };
}

async function createUserDeck(pool, userId, body, generateDeckId = () => 'd_' + crypto.randomBytes(8).toString('hex')) {
  const { name, cardIds } = body;
  const validationError = await validateDeckInput(pool, name, cardIds);
  if (validationError) return { ok: false, status: 400, error: validationError };

  const id = generateDeckId();
  await pool.query('INSERT INTO decks (id, user_id, name, card_ids) VALUES ($1, $2, $3, $4::jsonb)', [
    id,
    userId,
    name,
    JSON.stringify(cardIds),
  ]);
  return { ok: true, body: { id, name, cardIds } };
}

async function updateUserDeck(pool, userId, deckId, body) {
  const { name, cardIds } = body;
  const validationError = await validateDeckInput(pool, name, cardIds);
  if (validationError) return { ok: false, status: 400, error: validationError };

  const result = await pool.query(
    'UPDATE decks SET name = $3, card_ids = $4::jsonb, updated_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING *',
    [deckId, userId, name, JSON.stringify(cardIds)],
  );
  if (result.rowCount === 0) return { ok: false, status: 404, error: 'Deck not found' };
  return { ok: true, body: mapDeckRow(result.rows[0]) };
}

async function deleteUserDeck(pool, userId, deckId) {
  const result = await pool.query('DELETE FROM decks WHERE id = $1 AND user_id = $2', [deckId, userId]);
  if (result.rowCount === 0) return { ok: false, status: 404, error: 'Deck not found' };
  return { ok: true, body: { deleted: true } };
}

function deckVersion(cardIds, updatedAt) {
  return crypto
    .createHash('sha256')
    .update(`${JSON.stringify(cardIds)}:${updatedAt ? new Date(updatedAt).toISOString() : ''}`)
    .digest('hex');
}

async function reserveUserDeck(
  pool,
  userId,
  deckId,
  rulesVersion,
  generateReservationId = () => 'dr_' + crypto.randomBytes(24).toString('base64url'),
  ttlSeconds = DEFAULT_RESERVATION_TTL_SECONDS,
) {
  if (typeof deckId !== 'string' || !deckId.startsWith('d_')) {
    return { ok: false, status: 400, error: 'A saved server deck is required' };
  }
  const deck = (
    await pool.query(
      `SELECT id, card_ids, updated_at
       FROM decks
       WHERE id = $1 AND user_id = $2`,
      [deckId, userId],
    )
  ).rows[0];
  if (!deck) return { ok: false, status: 404, error: 'Deck not found' };
  const cardIds = Array.isArray(deck.card_ids) ? deck.card_ids : [];
  const reservationId = generateReservationId();
  const safeRulesVersion = String(rulesVersion || 'default').slice(0, 120);
  const lifetime = Math.max(60, Math.min(Number(ttlSeconds) || DEFAULT_RESERVATION_TTL_SECONDS, 30 * 60));
  const expiresAt = new Date(Date.now() + lifetime * 1000);
  await pool.query(
    `INSERT INTO deck_reservations
       (id, user_id, deck_id, deck_version, rules_version, card_ids, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [
      reservationId,
      userId,
      deck.id,
      deckVersion(cardIds, deck.updated_at),
      safeRulesVersion,
      JSON.stringify(cardIds),
      expiresAt,
    ],
  );
  return {
    ok: true,
    body: {
      reservationId,
      deckId: deck.id,
      deckVersion: deckVersion(cardIds, deck.updated_at),
      rulesVersion: safeRulesVersion,
      expiresAt: expiresAt.toISOString(),
    },
  };
}

/**
 * Consume/bind a reservation exactly once for a boardgame seat. Replays by
 * the same owner and seat are idempotent; a different user/match/seat is
 * rejected even if the opaque reservation id leaked.
 */
async function consumeDeckReservation(pool, { reservationId, userId, matchId, playerId }) {
  if (typeof reservationId !== 'string' || !reservationId.startsWith('dr_')) {
    return { ok: false, status: 400, error: 'Invalid deck reservation' };
  }
  if (playerId !== '0' && playerId !== '1') {
    return { ok: false, status: 400, error: 'Invalid deck seat' };
  }
  const client = typeof pool.connect === 'function' ? await pool.connect() : pool;
  const release = typeof client.release === 'function' ? () => client.release() : () => undefined;
  try {
    await client.query('BEGIN');
    const row = (
      await client.query(
        `SELECT id, user_id, deck_id, deck_version, rules_version, card_ids, expires_at, match_id, player_id
         FROM deck_reservations
         WHERE id = $1
         FOR UPDATE`,
        [reservationId],
      )
    ).rows[0];
    if (!row || new Date(row.expires_at).getTime() <= Date.now()) {
      await client.query('ROLLBACK');
      return { ok: false, status: 409, error: 'Deck reservation expired' };
    }
    if (row.user_id !== userId) {
      await client.query('ROLLBACK');
      return { ok: false, status: 403, error: 'Deck reservation does not belong to authenticated user' };
    }
    if (row.match_id && (row.match_id !== matchId || row.player_id !== playerId)) {
      await client.query('ROLLBACK');
      return { ok: false, status: 409, error: 'Deck reservation already bound' };
    }
    if (!row.match_id) {
      await client.query(
        `UPDATE deck_reservations
         SET match_id = $2, player_id = $3, consumed_at = NOW()
         WHERE id = $1`,
        [reservationId, matchId, playerId],
      );
    }
    await client.query('COMMIT');
    return {
      ok: true,
      body: {
        reservationId: row.id,
        userId: row.user_id,
        deckId: row.deck_id,
        deckVersion: row.deck_version,
        rulesVersion: row.rules_version,
        cardIds: Array.isArray(row.card_ids) ? row.card_ids : [],
      },
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    release();
  }
}

async function peekDeckReservation(pool, { reservationId, userId }) {
  if (typeof reservationId !== 'string' || !reservationId.startsWith('dr_')) {
    return { ok: false, status: 400, error: 'Invalid deck reservation' };
  }
  const row = (
    await pool.query(
      `SELECT id, user_id, deck_id, deck_version, rules_version, card_ids, expires_at, match_id, player_id
       FROM deck_reservations
       WHERE id = $1`,
      [reservationId],
    )
  ).rows[0];
  if (!row || new Date(row.expires_at).getTime() <= Date.now()) {
    return { ok: false, status: 409, error: 'Deck reservation expired' };
  }
  if (row.user_id !== userId)
    return { ok: false, status: 403, error: 'Deck reservation does not belong to authenticated user' };
  return {
    ok: true,
    body: {
      reservationId: row.id,
      userId: row.user_id,
      deckId: row.deck_id,
      deckVersion: row.deck_version,
      rulesVersion: row.rules_version,
      cardIds: Array.isArray(row.card_ids) ? row.card_ids : [],
      matchId: row.match_id || null,
      playerId: row.player_id || null,
    },
  };
}

module.exports = {
  createUserDeck,
  consumeDeckReservation,
  DEFAULT_RESERVATION_TTL_SECONDS,
  deleteUserDeck,
  listUserDecks,
  mapDeckRow,
  peekDeckReservation,
  reserveUserDeck,
  updateUserDeck,
  validateDeckInput,
};
