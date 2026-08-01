import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

type Queryable = {
  query: ReturnType<typeof vi.fn<(sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number }>>>;
};

const ACCOUNT_ROW_LOCK_SQL = 'SELECT id, deleted_at, elo, match_count, wins FROM users WHERE id = $1 FOR UPDATE';

const require = createRequire(import.meta.url);
const {
  consumeDeckReservation,
  createUserDeck,
  deleteUserDeck,
  listUserDecks,
  mapDeckRow,
  reserveUserDeck,
  updateUserDeck,
  validateDeckInput,
} = require('../deckService.cjs') as {
  consumeDeckReservation: (
    pool: Queryable & { connect: () => Promise<Queryable & { release: () => void }> },
    input: { reservationId: string; userId: string; matchId: string; playerId: '0' | '1' },
  ) => Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; status: number; error: string }>;
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
  reserveUserDeck: (
    pool: Queryable,
    userId: string,
    deckId: string,
    rulesVersion: string,
    generateReservationId?: () => string,
    ttlSeconds?: number,
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
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql === ACCOUNT_ROW_LOCK_SQL) {
        return { rows: [{ id: params?.[0], deleted_at: null }], rowCount: 1 };
      }
      if (sql.startsWith('SELECT id FROM cards')) {
        return { rows: [...new Set(cardIds)].map((id) => ({ id })), rowCount: cardIds.length };
      }
      return { rows: [], rowCount: 1 };
    }),
  };
}

function connectedPool(handler: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number }>): {
  pool: Queryable & { connect: ReturnType<typeof vi.fn> };
  client: Queryable & { release: ReturnType<typeof vi.fn> };
} {
  const client = { query: vi.fn(handler), release: vi.fn() };
  return {
    client,
    pool: { query: vi.fn(), connect: vi.fn(async () => client) },
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
    const { pool, client } = connectedPool(async (sql, params) => {
      if (sql === ACCOUNT_ROW_LOCK_SQL) return { rows: [{ id: params?.[0], deleted_at: null }], rowCount: 1 };
      if (sql.startsWith('SELECT id FROM cards')) {
        return { rows: [...new Set(cardIds)].map((id) => ({ id })), rowCount: cardIds.length };
      }
      return { rows: [], rowCount: 1 };
    });

    await expect(createUserDeck(pool, 'u_1', { name: 'Deck', cardIds }, () => 'd_fixed')).resolves.toEqual({
      ok: true,
      body: { id: 'd_fixed', name: 'Deck', cardIds },
    });
    expect(pool.query).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenCalledWith(
      'INSERT INTO decks (id, user_id, name, card_ids) VALUES ($1, $2, $3, $4::jsonb)',
      ['d_fixed', 'u_1', 'Deck', JSON.stringify(cardIds)],
    );
    expect(client.query).toHaveBeenLastCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('rejects deck creation after the account tombstone is observed under lock', async () => {
    const cardIds = makeCardIds();
    const { pool, client } = connectedPool(async (sql, params) => {
      if (sql === ACCOUNT_ROW_LOCK_SQL) {
        return { rows: [{ id: params?.[0], deleted_at: '2026-07-15T00:00:00.000Z' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });

    await expect(createUserDeck(pool, 'u_deleted', { name: 'Deck', cardIds })).resolves.toEqual({
      ok: false,
      status: 409,
      error: 'Account is deleted or unavailable',
    });
    expect(client.query.mock.calls.some(([sql]) => String(sql).startsWith('INSERT INTO decks'))).toBe(false);
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledOnce();
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

  it('creates a short-lived reservation from a deck owned by the caller', async () => {
    const cardIds = makeCardIds();
    const { pool, client } = connectedPool(async (sql, params) => {
      if (sql === ACCOUNT_ROW_LOCK_SQL) {
        return { rows: [{ id: params?.[0], deleted_at: null }], rowCount: 1 };
      }
      if (sql.includes('FROM decks')) {
        return { rows: [{ id: 'd_1', card_ids: cardIds, updated_at: '2026-07-12T00:00:00.000Z' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });

    await expect(reserveUserDeck(pool, 'u_1', 'd_1', 'rules-v1', () => 'dr_fixed', 60)).resolves.toMatchObject({
      ok: true,
      body: {
        reservationId: 'dr_fixed',
        deckId: 'd_1',
        rulesVersion: 'rules-v1',
        deckVersion: expect.any(String),
        expiresAt: expect.any(String),
      },
    });
    expect(pool.query).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO deck_reservations'), [
      'dr_fixed',
      'u_1',
      'd_1',
      expect.any(String),
      'rules-v1',
      JSON.stringify(cardIds),
      expect.any(Date),
    ]);
    expect(client.query).toHaveBeenLastCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('rejects deck reservations for a tombstoned account before reading the deck', async () => {
    const { pool, client } = connectedPool(async (sql, params) => {
      if (sql === ACCOUNT_ROW_LOCK_SQL) {
        return { rows: [{ id: params?.[0], deleted_at: '2026-07-15T00:00:00.000Z' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });

    await expect(reserveUserDeck(pool, 'u_deleted', 'd_1', 'rules-v1')).resolves.toEqual({
      ok: false,
      status: 409,
      error: 'Account is deleted or unavailable',
    });
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('FROM decks'))).toBe(false);
    expect(client.query.mock.calls.some(([sql]) => String(sql).startsWith('INSERT INTO deck_reservations'))).toBe(
      false,
    );
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('binds a reservation once and rejects ownership or seat replays', async () => {
    const row = {
      id: 'dr_fixed',
      user_id: 'u_1',
      deck_id: 'd_1',
      deck_version: 'deck-v1',
      rules_version: 'rules-v1',
      card_ids: makeCardIds(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      match_id: null,
      player_id: null,
    };
    const client: Queryable & { release: () => void } = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 1 };
        if (sql.includes('FROM deck_reservations')) return { rows: [row], rowCount: 1 };
        return { rows: [], rowCount: 1 };
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(),
      connect: vi.fn(async () => client),
    } as Queryable & { connect: () => Promise<typeof client> };

    await expect(
      consumeDeckReservation(pool, {
        reservationId: 'dr_fixed',
        userId: 'u_1',
        matchId: 'match_1',
        playerId: '1',
      }),
    ).resolves.toMatchObject({ ok: true, body: { userId: 'u_1', deckId: 'd_1' } });
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('SET match_id = $2'), [
      'dr_fixed',
      'match_1',
      '1',
    ]);

    const boundRow = { ...row, match_id: 'match_1', player_id: '1' };
    client.query.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 1 };
      if (sql.includes('FROM deck_reservations')) return { rows: [boundRow], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    await expect(
      consumeDeckReservation(pool, {
        reservationId: 'dr_fixed',
        userId: 'u_1',
        matchId: 'match_1',
        playerId: '1',
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(client.query.mock.calls.filter(([sql]) => String(sql).includes('SET match_id = $2'))).toHaveLength(1);

    client.query.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 1 };
      if (sql.includes('FROM deck_reservations')) return { rows: [boundRow], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    await expect(
      consumeDeckReservation(pool, {
        reservationId: 'dr_fixed',
        userId: 'u_attacker',
        matchId: 'match_2',
        playerId: '0',
      }),
    ).resolves.toMatchObject({ ok: false, status: 403 });
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
  });
});
