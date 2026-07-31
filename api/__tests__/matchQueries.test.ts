import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

type Queryable = {
  query: ReturnType<typeof vi.fn<(sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>>>;
};

const require = createRequire(import.meta.url);
const { getAdminMatches, getLeaderboard, getMatchActionLog, getMatchReplay, getUserMatches } =
  require('../matchQueries.cjs') as {
    getAdminMatches: (pool: Queryable, limitParam: unknown) => Promise<Record<string, unknown>>;
    getLeaderboard: (
      pool: Queryable,
      limitParam: unknown,
      sanitizeText: (value: unknown, maxLen?: number) => string,
    ) => Promise<Record<string, unknown>>;
    getMatchActionLog: (
      pool: Queryable,
      matchId: string,
      sanitizeActionLog: (value: unknown) => unknown[],
      userId: string,
    ) => Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; status: number; error: string }>;
    getMatchReplay: (
      pool: Queryable,
      matchId: string,
      userId: string,
    ) => Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; status: number; error: string }>;
    getUserMatches: (
      pool: Queryable,
      userId: string,
      limitParam: unknown,
      offsetParam: unknown,
    ) => Promise<Record<string, unknown>>;
  };

function poolWithRows(rows: unknown[]): Queryable {
  return {
    query: vi.fn(async () => ({ rows })),
  };
}

const matchRow = {
  id: 'm_1',
  winner_id: 'u_winner',
  loser_id: 'u_loser',
  winner_nickname: 'Winner',
  loser_nickname: 'Loser',
  winner_elo_change: 16,
  loser_elo_change: -16,
  turns: 7,
  duration_seconds: 42,
  created_at: '2026-06-30T00:00:00.000Z',
};

describe('match query services', () => {
  it('returns sanitized action logs and 403s when user is not a participant', async () => {
    const sanitizeActionLog = vi.fn(() => [{ action: 'clean' }]);
    const pool = poolWithRows([{ id: 'm_1', rules_version: 'rules-2026-07', action_log: [{ action: 'raw' }] }]);

    await expect(getMatchActionLog(pool, 'm_1', sanitizeActionLog, 'u_winner')).resolves.toEqual({
      ok: true,
      body: { matchId: 'm_1', rulesVersion: 'rules-2026-07', actionLog: [{ action: 'clean' }] },
    });
    expect(sanitizeActionLog).toHaveBeenCalledWith([{ action: 'raw' }]);
    expect(pool.query).toHaveBeenCalledWith(
      'SELECT id, rules_version, action_log FROM matches WHERE id = $1 AND (player0_id = $2 OR player1_id = $2)',
      ['m_1', 'u_winner'],
    );

    await expect(getMatchActionLog(poolWithRows([]), 'missing', sanitizeActionLog, 'u_other')).resolves.toEqual({
      ok: false,
      status: 403,
      error: 'Forbidden',
    });
  });

  it('returns completed replay summaries only to match participants', async () => {
    const replay = { schemaVersion: 1, traceComplete: true, decisions: [], timeline: [] };
    const pool = poolWithRows([{ id: 'm_1', rules_version: 'rules-2026-07', replay_summary: replay }]);

    await expect(getMatchReplay(pool, 'm_1', 'u_winner')).resolves.toEqual({
      ok: true,
      body: { matchId: 'm_1', rulesVersion: 'rules-2026-07', replay },
    });
    expect(pool.query).toHaveBeenCalledWith(
      'SELECT id, rules_version, replay_summary FROM matches WHERE id = $1 AND (player0_id = $2 OR player1_id = $2)',
      ['m_1', 'u_winner'],
    );
    await expect(getMatchReplay(poolWithRows([]), 'm_1', 'u_other')).resolves.toEqual({
      ok: false,
      status: 403,
      error: 'Forbidden',
    });
    await expect(
      getMatchReplay(poolWithRows([{ id: 'legacy', rules_version: 'legacy', replay_summary: null }]), 'legacy', 'u_1'),
    ).resolves.toMatchObject({ ok: false, status: 404 });
  });

  it('maps leaderboard rows and clamps limit to 500', async () => {
    const pool = poolWithRows([{ id: 'u_1', nickname: '<b>Alice</b>', elo: 1100, match_count: 4, wins: 3 }]);
    const sanitizeText = vi.fn((value: unknown) => String(value).replace(/[<>]/g, ''));

    await expect(getLeaderboard(pool, '999', sanitizeText)).resolves.toEqual({
      leaderboard: [{ id: 'u_1', nickname: 'bAlice/b', elo: 1100, matchCount: 4, wins: 3, winRate: 75 }],
    });
    expect(pool.query).toHaveBeenCalledWith(
      'SELECT id, nickname, elo, match_count, wins FROM users WHERE deleted_at IS NULL AND match_count > 0 ORDER BY elo DESC LIMIT $1',
      [500],
    );
    expect(sanitizeText).toHaveBeenCalledWith('<b>Alice</b>', 60);
  });

  it('maps user matches and clamps negative offsets to zero', async () => {
    const pool = poolWithRows([{ ...matchRow, rules_version: 'rules-2026-07' }]);

    await expect(getUserMatches(pool, 'u_winner', '999', '-5')).resolves.toEqual({
      matches: [
        {
          id: 'm_1',
          winnerId: 'u_winner',
          loserId: 'u_loser',
          winnerNickname: 'Winner',
          loserNickname: 'Loser',
          winnerEloChange: 16,
          loserEloChange: -16,
          turns: 7,
          duration: 42,
          rulesVersion: 'rules-2026-07',
          createdAt: '2026-06-30T00:00:00.000Z',
        },
      ],
    });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('WHERE m.player0_id = $1 OR m.player1_id = $2'), [
      'u_winner',
      'u_winner',
      200,
      0,
    ]);
  });

  it('exposes only replay availability and its bounded search index in history lists', async () => {
    const pool = poolWithRows([
      { ...matchRow, replay_summary: { schemaVersion: 1, searchText: 'clockadvance card-1', decisions: ['private'] } },
    ]);
    await expect(getUserMatches(pool, 'u_winner', '10', '0')).resolves.toEqual({
      matches: [expect.objectContaining({ replayAvailable: true, replaySearchText: 'clockadvance card-1' })],
    });
  });

  it('maps admin matches and uses the default limit', async () => {
    const pool = poolWithRows([matchRow]);

    await expect(getAdminMatches(pool, undefined)).resolves.toEqual({
      matches: [expect.objectContaining({ id: 'm_1', winnerId: 'u_winner', loserId: 'u_loser' })],
    });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY m.created_at DESC LIMIT $1'), [50]);
  });
});
