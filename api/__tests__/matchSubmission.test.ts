import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

type QueryResult = { rows: unknown[] };
type QueryFn = (sql: string, params?: unknown[]) => Promise<QueryResult>;
type Client = {
  query: ReturnType<typeof vi.fn<QueryFn>>;
  release: ReturnType<typeof vi.fn<() => void>>;
};
type Pool = {
  query: ReturnType<typeof vi.fn<QueryFn>>;
  connect: ReturnType<typeof vi.fn<() => Promise<Client>>>;
};
type SubmitResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; status: number; error: string };

const require = createRequire(import.meta.url);
const { calculateElo, submitMatchResult } = require('../matchSubmission.cjs') as {
  calculateElo: (ratingA: number, ratingB: number, scoreA: number) => number;
  submitMatchResult: (input: {
    pool: Pool;
    authUserId: string;
    body: Record<string, unknown>;
    sanitizeActionLog: (value: unknown) => unknown[];
    generateMatchId?: () => string;
  }) => Promise<SubmitResult>;
};

function makePool(options: {
  winner?: Record<string, unknown>;
  loser?: Record<string, unknown>;
  sourceRows?: unknown[];
  throwOnInsert?: boolean;
}): { pool: Pool; client: Client } {
  const client: Client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql === 'SELECT * FROM users WHERE id = $1') {
        if (params?.[0] === options.winner?.id) return { rows: [options.winner] };
        if (params?.[0] === options.loser?.id) return { rows: [options.loser] };
        return { rows: [] };
      }
      if (sql.startsWith('INSERT INTO matches') && options.throwOnInsert) {
        throw new Error('insert failed');
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  const pool: Pool = {
    query: vi.fn(async () => ({ rows: options.sourceRows ?? [] })),
    connect: vi.fn(async () => client),
  };
  return { pool, client };
}

describe('calculateElo', () => {
  it('uses the expected K=32 Elo delta', () => {
    expect(calculateElo(1000, 1000, 1)).toBe(1016);
    expect(calculateElo(1000, 1000, 0)).toBe(984);
  });
});

describe('submitMatchResult', () => {
  it('rejects missing players and auth mismatches before opening a transaction', async () => {
    const { pool } = makePool({});
    const sanitizeActionLog = vi.fn(() => []);

    await expect(
      submitMatchResult({ pool, authUserId: 'u_winner', body: { winnerId: 'u_winner' }, sanitizeActionLog }),
    ).resolves.toMatchObject({ ok: false, status: 400 });
    await expect(
      submitMatchResult({
        pool,
        authUserId: 'u_other',
        body: { winnerId: 'u_winner', loserId: 'u_loser' },
        sanitizeActionLog,
      }),
    ).resolves.toMatchObject({ ok: false, status: 403 });

    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('rejects source match verification failures before opening a transaction', async () => {
    const { pool } = makePool({
      sourceRows: [
        {
          state: { ctx: { gameover: { winner: 1 } }, G: { step: 'gameOver', winner: 1 } },
          metadata: { players: { '1': { data: { userId: 'u_loser' } } } },
        },
      ],
    });

    await expect(
      submitMatchResult({
        pool,
        authUserId: 'u_winner',
        body: { winnerId: 'u_winner', loserId: 'u_loser', sourceMatchId: 'match_1', winnerPlayer: 0 },
        sanitizeActionLog: () => [],
      }),
    ).resolves.toMatchObject({ ok: false, status: 403 });

    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('updates both users and stores a sanitized match record in one transaction', async () => {
    const winner = { id: 'u_winner', elo: 1000 };
    const loser = { id: 'u_loser', elo: 1000 };
    const { pool, client } = makePool({ winner, loser });
    const sanitizeActionLog = vi.fn(() => [{ action: 'clean' }]);

    await expect(
      submitMatchResult({
        pool,
        authUserId: 'u_winner',
        body: { winnerId: 'u_winner', loserId: 'u_loser', turns: 7, duration: 42, actionLog: [{ action: 'raw' }] },
        sanitizeActionLog,
        generateMatchId: () => 'm_fixed',
      }),
    ).resolves.toEqual({
      ok: true,
      body: {
        matchId: 'm_fixed',
        winnerEloChange: 16,
        loserEloChange: -16,
        winnerNewElo: 1016,
        loserNewElo: 984,
      },
    });

    expect(sanitizeActionLog).toHaveBeenCalledWith([{ action: 'raw' }]);
    expect(client.query).toHaveBeenCalledWith('BEGIN');
    expect(client.query).toHaveBeenCalledWith(
      'UPDATE users SET elo = $1, match_count = match_count + 1, wins = wins + 1 WHERE id = $2',
      [1016, 'u_winner'],
    );
    expect(client.query).toHaveBeenCalledWith(
      'UPDATE users SET elo = $1, match_count = match_count + 1 WHERE id = $2',
      [984, 'u_loser'],
    );
    expect(client.query).toHaveBeenCalledWith(
      'INSERT INTO matches (id, player0_id, player1_id, winner_id, loser_id, winner_elo_change, loser_elo_change, turns, duration_seconds, action_log) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)',
      [
        'm_fixed',
        'u_winner',
        'u_loser',
        'u_winner',
        'u_loser',
        16,
        -16,
        7,
        42,
        JSON.stringify([{ action: 'clean' }]),
      ],
    );
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('rolls back and releases the transaction client when inserting the match fails', async () => {
    const { pool, client } = makePool({
      winner: { id: 'u_winner', elo: 1000 },
      loser: { id: 'u_loser', elo: 1000 },
      throwOnInsert: true,
    });

    await expect(
      submitMatchResult({
        pool,
        authUserId: 'u_winner',
        body: { winnerId: 'u_winner', loserId: 'u_loser' },
        sanitizeActionLog: () => [],
        generateMatchId: () => 'm_fixed',
      }),
    ).rejects.toThrow('insert failed');

    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledOnce();
  });
});
