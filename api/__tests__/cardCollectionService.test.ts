import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { listOwnedCardIds, mergeCardOwnership, setCardOwnership } = require('../cardCollectionService.cjs') as {
  listOwnedCardIds: (pool: Queryable, userId: string) => Promise<{ cardIds: string[] }>;
  mergeCardOwnership: (
    pool: Queryable,
    userId: string,
    cardIds: string[],
  ) => Promise<{ ok: boolean; status?: number; error?: string; body?: { cardIds: string[] } }>;
  setCardOwnership: (
    pool: Queryable,
    userId: string,
    cardId: string,
    owned: boolean,
  ) => Promise<{ ok: boolean; status?: number; error?: string; body?: { cardId: string; owned: boolean } }>;
};

type Queryable = {
  query: ReturnType<typeof vi.fn<(sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>>>;
};

describe('card collection service', () => {
  it('lists owned card ids in database order', async () => {
    const pool: Queryable = { query: vi.fn(async () => ({ rows: [{ card_id: '1st_1' }, { card_id: '2nd_2' }] })) };
    await expect(listOwnedCardIds(pool, 'u_1')).resolves.toEqual({ cardIds: ['1st_1', '2nd_2'] });
  });

  it('adds and removes a published catalog card', async () => {
    const pool: Queryable = {
      query: vi.fn(async (sql: string) => ({ rows: sql.includes('SELECT id FROM cards') ? [{ id: '1st_1' }] : [] })),
    };
    await expect(setCardOwnership(pool, 'u_1', '1st_1', true)).resolves.toEqual({
      ok: true,
      body: { cardId: '1st_1', owned: true },
    });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO user_card_collection'), [
      'u_1',
      '1st_1',
    ]);

    await expect(setCardOwnership(pool, 'u_1', '1st_1', false)).resolves.toEqual({
      ok: true,
      body: { cardId: '1st_1', owned: false },
    });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM user_card_collection'), [
      'u_1',
      '1st_1',
    ]);
  });

  it('rejects cards outside the published catalog', async () => {
    const pool: Queryable = { query: vi.fn(async () => ({ rows: [] })) };
    await expect(setCardOwnership(pool, 'u_1', 'missing', true)).resolves.toMatchObject({
      ok: false,
      status: 404,
    });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('deduplicates local cards while merging and returns the complete account collection', async () => {
    const pool: Queryable = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('SELECT id FROM cards')) return { rows: [{ id: '1st_1' }, { id: '2nd_2' }] };
        if (sql.startsWith('SELECT card_id')) return { rows: [{ card_id: '1st_1' }, { card_id: '2nd_2' }] };
        return { rows: [] };
      }),
    };

    await expect(mergeCardOwnership(pool, 'u_1', ['2nd_2', '1st_1', '2nd_2'])).resolves.toEqual({
      ok: true,
      body: { cardIds: ['1st_1', '2nd_2'] },
    });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('unnest($2::text[])'), ['u_1', ['2nd_2', '1st_1']]);
  });
});
