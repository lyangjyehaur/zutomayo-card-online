/* eslint-disable @typescript-eslint/no-require-imports */
/* global module, require */

const crypto = require('crypto');

function mapDeckRow(deck) {
  return {
    ...deck,
    cardIds: Array.isArray(deck.card_ids) ? deck.card_ids : [],
  };
}

function validateDeckInput(name, cardIds) {
  if (!name || !Array.isArray(cardIds) || cardIds.length !== 20) {
    return 'Name and 20 card IDs required';
  }

  const counts = {};
  for (const id of cardIds) {
    counts[id] = (counts[id] || 0) + 1;
    if (counts[id] > 2) return `Card ${id} appears more than twice`;
  }
  return null;
}

async function listUserDecks(pool, userId) {
  const decks = (await pool.query('SELECT * FROM decks WHERE user_id = $1 ORDER BY updated_at DESC', [userId])).rows;
  return { decks: decks.map(mapDeckRow) };
}

async function createUserDeck(pool, userId, body, generateDeckId = () => 'd_' + crypto.randomBytes(8).toString('hex')) {
  const { name, cardIds } = body;
  const validationError = validateDeckInput(name, cardIds);
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

async function deleteUserDeck(pool, userId, deckId) {
  const result = await pool.query('DELETE FROM decks WHERE id = $1 AND user_id = $2', [deckId, userId]);
  if (result.rowCount === 0) return { ok: false, status: 404, error: 'Deck not found' };
  return { ok: true, body: { deleted: true } };
}

module.exports = {
  createUserDeck,
  deleteUserDeck,
  listUserDecks,
  mapDeckRow,
  validateDeckInput,
};
