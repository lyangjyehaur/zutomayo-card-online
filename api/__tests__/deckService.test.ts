import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

type Queryable = {
  query: ReturnType<typeof vi.fn<(sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number }>>>;
};

const require = createRequire(import.meta.url);
const { createUserDeck, deleteUserDeck, listUserDecks, mapDeckRow, updateUserDeck, validateDeckInput } =
  require('../deckService.cjs') as {
    createUserDeck: (
      pool: Queryable,
      userId: string,
      body: Record<string, unknown>,
      generateDeckId?: () => string,
    ) => Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; status: number; error: string }>;
    deleteUserDeck: (
      pool: Queryable,
      userId: string,
      deckId: string,
    ) => Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; status: number; error: string }>;
    listUserDecks: (pool: Queryable, userId: string) => Promise<Record<string, unknown>>;
    mapDeckRow: (deck: Record<string, unknown>) => Record<string, unknown>;
    updateUserDeck: (
      pool: Queryable,
      userId: string,
      deckId: string,
      body: Record<string, unknown>,
    ) => Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; status: number; error: string }>;
    validateDeckInput: (pool: Queryable, name: unknown, cardIds: unknown) => Promise<string | null>;
  };

function makeCardIds(): string[] {
  return Array.from({ length: 20 }, (_, i) => `card-${Math.floor(i / 2)}`);
}

function poolResult(rows: unknown[] = [], rowCount = 1): Queryable {
  return {
    query: vi.fn(async () => ({ rows, rowCount })),
  };
}

function poolWithKnownCards(cardIds: string[]): Queryable {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.startsWith('SELECT id FROM cards')) {
        return { rows: [...new Set(cardIds)].map((id) => ({ id })), rowCount: cardIds.length };
      }
      return { rows: [], rowCount: 1 };
    }),
  };
}

describe('deck service', () => {
  it('maps database card_ids to API cardIds while preserving existing row fields', () => {
    expect(mapDeckRow({ id: 'd_1', card_ids: ['a', 'b'], name: 'Deck' })).toEqual({
      id: 'd_1',
      card_ids: ['a', 'b'],
      name: 'Deck',
      cardIds: ['a', 'b'],
    });
    expect(mapDeckRow({ id: 'd_2', card_ids: null })).toMatchObject({ cardIds: [] });
  });

  it('validates deck name, size, max two copies, and known card ids', async () => {
    const cardIds = makeCardIds();
    const pool = poolWithKnownCards(cardIds);
    await expect(validateDeckInput(pool, '', cardIds)).resolves.toBe('Name and 20 card IDs required');
    await expect(validateDeckInput(pool, 'Deck', ['one'])).resolves.toBe('Name and 20 card IDs required');
    await expect(
      validateDeckInput(pool, 'Deck', [
        'triple',
        'triple',
        'triple',
        ...Array.from({ length: 17 }, (_, i) => `c-${i}`),
      ]),
    ).resolves.toBe('Card triple appears more than twice');
    await expect(validateDeckInput(pool, 'Deck', [...cardIds.slice(0, 19), 1])).resolves.toBe(
      'Deck card IDs must be strings',
    );
    await expect(
      validateDeckInput(poolWithKnownCards(cardIds.filter((id) => id !== cardIds[0])), 'Deck', cardIds),
    ).resolves.toBe(`Unknown card in deck: ${cardIds[0]}`);
    await expect(validateDeckInput(pool, 'Deck', cardIds)).resolves.toBeNull();
  });

  it('lists user decks ordered by updated_at descending', async () => {
    const pool = poolResult([{ id: 'd_1', card_ids: ['a'] }]);

    await expect(listUserDecks(pool, 'u_1')).resolves.toEqual({
      decks: [{ id: 'd_1', card_ids: ['a'], cardIds: ['a'] }],
    });
    expect(pool.query).toHaveBeenCalledWith('SELECT * FROM decks WHERE user_id = $1 ORDER BY updated_at DESC', ['u_1']);
  });

  it('creates valid decks with generated ids and JSON card ids', async () => {
    const cardIds = makeCardIds();
    const pool = poolWithKnownCards(cardIds);

    await expect(createUserDeck(pool, 'u_1', { name: 'Deck', cardIds }, () => 'd_fixed')).resolves.toEqual({
      ok: true,
      body: { id: 'd_fixed', name: 'Deck', cardIds },
    });
    expect(pool.query).toHaveBeenCalledWith(
      'INSERT INTO decks (id, user_id, name, card_ids) VALUES ($1, $2, $3, $4::jsonb)',
      ['d_fixed', 'u_1', 'Deck', JSON.stringify(cardIds)],
    );
  });

  it('returns 400 for invalid create payloads before writing', async () => {
    const pool = poolResult();

    await expect(createUserDeck(pool, 'u_1', { name: 'Deck', cardIds: ['one'] })).resolves.toMatchObject({
      ok: false,
      status: 400,
    });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('updates decks owned by the user and returns the mapped deck row', async () => {
    const cardIds = makeCardIds();
    const pool: Queryable = {
      query: vi.fn(async (sql: string) => {
        if (sql.startsWith('SELECT id FROM cards')) {
          return { rows: [...new Set(cardIds)].map((id) => ({ id })), rowCount: cardIds.length };
        }
        return { rows: [{ id: 'd_1', name: 'Updated', card_ids: cardIds }], rowCount: 1 };
      }),
    };

    await expect(updateUserDeck(pool, 'u_1', 'd_1', { name: 'Updated', cardIds })).resolves.toEqual({
      ok: true,
      body: { id: 'd_1', name: 'Updated', card_ids: cardIds, cardIds },
    });
    expect(pool.query).toHaveBeenLastCalledWith(
      'UPDATE decks SET name = $3, card_ids = $4::jsonb, updated_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING *',
      ['d_1', 'u_1', 'Updated', JSON.stringify(cardIds)],
    );
  });

  it('reports missing decks during update', async () => {
    const cardIds = makeCardIds();
    const pool: Queryable = {
      query: vi.fn(async (sql: string) => {
        if (sql.startsWith('SELECT id FROM cards')) {
          return { rows: [...new Set(cardIds)].map((id) => ({ id })), rowCount: cardIds.length };
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    await expect(updateUserDeck(pool, 'u_1', 'd_missing', { name: 'Updated', cardIds })).resolves.toEqual({
      ok: false,
      status: 404,
      error: 'Deck not found',
    });
  });

  it('deletes only decks owned by the user and reports missing decks', async () => {
    const deletedPool = poolResult([], 1);
    await expect(deleteUserDeck(deletedPool, 'u_1', 'd_1')).resolves.toEqual({ ok: true, body: { deleted: true } });
    expect(deletedPool.query).toHaveBeenCalledWith('DELETE FROM decks WHERE id = $1 AND user_id = $2', ['d_1', 'u_1']);

    await expect(deleteUserDeck(poolResult([], 0), 'u_1', 'd_missing')).resolves.toEqual({
      ok: false,
      status: 404,
      error: 'Deck not found',
    });
  });
});
