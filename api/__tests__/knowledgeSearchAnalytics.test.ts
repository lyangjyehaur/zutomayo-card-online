import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { listZeroResults, normalizeZeroResultQuery, recordZeroResult, safeZeroResultQuery, zeroResultScope } =
  require('../knowledgeSearchAnalytics.cjs') as {
    listZeroResults: (
      pool: { query: ReturnType<typeof vi.fn> },
      params?: Record<string, unknown>,
    ) => Promise<unknown[]>;
    normalizeZeroResultQuery: (value: unknown) => string;
    recordZeroResult: (
      pool: { query: ReturnType<typeof vi.fn> },
      params: { query: string; locale: string; scopes: string[] },
    ) => Promise<{ stored: boolean; id?: string; normalizedQuery?: string; scope?: string }>;
    safeZeroResultQuery: (value: unknown) => string | null;
    zeroResultScope: (scopes: string[]) => string;
  };

describe('knowledge search zero-result analytics', () => {
  it('normalizes ordinary queries and derives only supported aggregate scopes', () => {
    expect(normalizeZeroResultQuery('  Ｃhronos\n 回溯  ')).toBe('chronos 回溯');
    expect(safeZeroResultQuery('  Chronos  回溯  ')).toBe('chronos 回溯');
    expect(zeroResultScope(['qa'])).toBe('qa');
    expect(zeroResultScope(['qa', 'card'])).toBe('all');
    expect(zeroResultScope(['private'])).toBe('all');
  });

  it.each([
    'player@example.com',
    'https://example.com/private',
    'Bearer private-token',
    'password hunter2',
    'sk_abcdefghijklmnop',
    'sk-abcdefghijklmnop',
    'ghp_abcdefghijklmnopqrstuvwxyz',
    'eyJabcdefghijk.abcdefghijklmnop.abcdefghijklmnop',
    '0123456789abcdef0123456789abcdef',
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN',
    'a'.repeat(121),
  ])('does not store sensitive-looking query %s', async (query) => {
    const pool = { query: vi.fn() };
    await expect(recordZeroResult(pool, { query, locale: 'zh-TW', scopes: ['card'] })).resolves.toEqual({
      stored: false,
    });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('upserts a deterministic hash without exposing the query in its identifier', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [] })) };
    const result = await recordZeroResult(pool, {
      query: '  Chronos 回溯 ',
      locale: 'zh-TW',
      scopes: ['card'],
    });

    expect(result).toMatchObject({ stored: true, normalizedQuery: 'chronos 回溯', scope: 'card' });
    expect(result.id).toMatch(/^[a-f0-9]{64}$/);
    expect(result.id).not.toContain('chronos');
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT (id) DO UPDATE'), [
      result.id,
      'chronos 回溯',
      'zh-TW',
      'card',
    ]);
  });

  it('bounds and maps the administrator aggregate report', async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [
          {
            normalized_query: 'chronos',
            locale: 'zh-TW',
            scope: 'all',
            occurrence_count: '7',
            first_seen_at: new Date('2026-07-01T00:00:00.000Z'),
            last_seen_at: '2026-07-30T00:00:00.000Z',
          },
        ],
      })),
    };

    await expect(listZeroResults(pool, { limit: 999, days: 999 })).resolves.toEqual([
      {
        query: 'chronos',
        locale: 'zh-TW',
        scope: 'all',
        count: 7,
        firstSeenAt: '2026-07-01T00:00:00.000Z',
        lastSeenAt: '2026-07-30T00:00:00.000Z',
      },
    ]);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY occurrence_count DESC'), [90, 200]);
  });
});
