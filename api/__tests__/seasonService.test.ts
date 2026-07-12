import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { calculateElo, getCurrentSeason, listSeasonLeaderboard, recordSeasonResult } = require('../seasonService.cjs') as {
  calculateElo: (rating: number, opponent: number, score: number, k?: number) => number;
  getCurrentSeason: (pool: unknown) => Promise<Record<string, unknown>>;
  listSeasonLeaderboard: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  recordSeasonResult: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

function createPool(handler: (sql: string, params?: unknown[]) => { rows: Record<string, unknown>[] }) {
  return { query: vi.fn(async (sql: string, params?: unknown[]) => handler(sql, params)) };
}

describe('season service', () => {
  it('calculates symmetric Elo changes for equally rated players', () => {
    expect(calculateElo(1000, 1000, 1)).toBe(1016);
    expect(calculateElo(1000, 1000, 0)).toBe(984);
  });

  it('returns null when there is no current season', async () => {
    await expect(getCurrentSeason(createPool(() => ({ rows: [] })))).resolves.toEqual({
      ok: true,
      body: { season: null },
    });
  });

  it('bounds leaderboard pagination', async () => {
    const pool = createPool(() => ({ rows: [] }));
    await expect(listSeasonLeaderboard({ pool, limit: 1000, offset: -10 })).resolves.toEqual({
      ok: true,
      body: { entries: [], limit: 100, offset: 0 },
    });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY sr.rating DESC'), [100, 0]);
  });

  it('records ratings once using the active season and row locks', async () => {
    const pool = createPool((sql) => {
      if (sql.includes('FROM seasons') && sql.includes('FOR UPDATE')) {
        return { rows: [{ id: 's1', starting_rating: 1000, placement_matches: 5 }] };
      }
      if (sql.includes('FROM season_ratings') && sql.includes('FOR UPDATE')) {
        return {
          rows: [
            { user_id: 'u_loser', rating: 1000, match_count: 0 },
            { user_id: 'u_winner', rating: 1000, match_count: 0 },
          ],
        };
      }
      return { rows: [] };
    });

    await expect(
      recordSeasonResult({ pool, sourceMatchId: 'm1', winnerId: 'u_winner', loserId: 'u_loser' }),
    ).resolves.toEqual({
      ok: true,
      body: {
        applied: true,
        seasonId: 's1',
        winnerDelta: 16,
        loserDelta: -16,
        winnerRating: 1016,
        loserRating: 984,
      },
    });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO season_match_results'), [
      's1',
      'm1',
      'u_winner',
      'u_loser',
      16,
      -16,
    ]);
    expect(pool.query).toHaveBeenCalledWith('COMMIT');
  });

  it('does not apply a duplicate source match twice', async () => {
    const pool = createPool((sql) => {
      if (sql.includes('FROM seasons')) return { rows: [{ id: 's1', starting_rating: 1000, placement_matches: 5 }] };
      if (sql.includes('FROM season_match_results')) return { rows: [{ winner_delta: 16, loser_delta: -16 }] };
      return { rows: [] };
    });
    await expect(
      recordSeasonResult({ pool, sourceMatchId: 'm1', winnerId: 'u_winner', loserId: 'u_loser' }),
    ).resolves.toMatchObject({ ok: true, body: { applied: false, reason: 'duplicate' } });
  });
});
