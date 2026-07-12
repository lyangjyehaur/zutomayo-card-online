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
type SubmitResult = { ok: true; body: Record<string, unknown> } | { ok: false; status: number; error: string };

const require = createRequire(import.meta.url);
const { calculateElo, submitMatchResult: submitMatchResultRaw } = require('../matchSubmission.cjs') as {
  calculateElo: (ratingA: number, ratingB: number, scoreA: number) => number;
  submitMatchResult: (input: {
    pool: Pool;
    authUserId: string;
    body: Record<string, unknown>;
    sanitizeActionLog: (value: unknown) => unknown[];
    rankedMatchesEnabled?: boolean;
    generateMatchId?: () => string;
  }) => Promise<SubmitResult>;
};

type SubmitInput = Parameters<typeof submitMatchResultRaw>[0];

function submitMatchResult(input: SubmitInput): Promise<SubmitResult> {
  return submitMatchResultRaw({ rankedMatchesEnabled: true, ...input });
}

function makePool(options: {
  winner?: Record<string, unknown>;
  loser?: Record<string, unknown>;
  sourceRows?: unknown[];
  existingMatch?: Record<string, unknown>;
  throwOnInsert?: boolean;
  uniqueOnInsert?: boolean;
}): { pool: Pool; client: Client } {
  let existingLookupCount = 0;
  const client: Client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql === 'SELECT * FROM users WHERE id = $1 FOR UPDATE') {
        if (params?.[0] === options.winner?.id) return { rows: [options.winner] };
        if (params?.[0] === options.loser?.id) return { rows: [options.loser] };
        return { rows: [] };
      }
      if (sql.startsWith('SELECT id, winner_elo_change, loser_elo_change FROM matches')) {
        existingLookupCount++;
        const visible = options.existingMatch && (!options.uniqueOnInsert || existingLookupCount > 1);
        return { rows: visible ? [options.existingMatch] : [] };
      }
      if (sql.startsWith('INSERT INTO matches') && options.throwOnInsert) {
        throw new Error('insert failed');
      }
      if (sql.startsWith('INSERT INTO matches') && options.uniqueOnInsert) {
        throw Object.assign(new Error('duplicate source match'), { code: '23505' });
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

function trustedSeat(userId: string) {
  return { data: { userId, identitySource: 'server', rankedEligible: true } };
}

describe('calculateElo', () => {
  it('uses the expected K=32 Elo delta', () => {
    expect(calculateElo(1000, 1000, 1)).toBe(1016);
    expect(calculateElo(1000, 1000, 0)).toBe(984);
  });
});

describe('submitMatchResult', () => {
  it('returns an explicit unrated result when ranked submissions are disabled', async () => {
    const { pool } = makePool({});

    await expect(
      submitMatchResultRaw({
        pool,
        authUserId: 'u_winner',
        body: { winnerId: 'u_winner', loserId: 'u_loser', sourceMatchId: 'match_1', winnerPlayer: 0 },
        sanitizeActionLog: () => [],
      }),
    ).resolves.toEqual({
      ok: true,
      body: {
        winnerEloChange: 0,
        loserEloChange: 0,
        unrated: true,
        reason: 'ranked_disabled',
      },
    });

    expect(pool.query).not.toHaveBeenCalled();
    expect(pool.connect).not.toHaveBeenCalled();
  });
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
          metadata: { players: { '1': trustedSeat('u_loser') } },
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
    const { pool, client } = makePool({
      winner,
      loser,
      sourceRows: [
        {
          state: {
            ctx: { gameover: { winner: 0 } },
            G: {
              step: 'gameOver',
              winner: 0,
              turnNumber: 7,
              matchStartedAt: 1000,
              matchEndedAt: 43_000,
              actionLog: [{ action: 'server' }],
            },
          },
          metadata: {
            players: {
              '0': trustedSeat('u_winner'),
              '1': trustedSeat('u_loser'),
            },
          },
        },
      ],
    });
    const sanitizeActionLog = vi.fn(() => [{ action: 'clean' }]);

    await expect(
      submitMatchResult({
        pool,
        authUserId: 'u_winner',
        body: {
          winnerId: 'u_winner',
          loserId: 'guest-player-1',
          sourceMatchId: 'bg_match_1',
          winnerPlayer: 0,
          turns: 7,
          duration: 42,
          actionLog: [{ action: 'raw' }],
        },
        sanitizeActionLog,
        generateMatchId: () => 'm_fixed',
      }),
    ).resolves.toEqual({
      ok: true,
      body: {
        matchId: 'm_fixed',
        winnerId: 'u_winner',
        loserId: 'u_loser',
        winnerEloChange: 16,
        loserEloChange: -16,
        winnerNewElo: 1016,
        loserNewElo: 984,
      },
    });

    expect(sanitizeActionLog).toHaveBeenCalledWith([{ action: 'server' }]);
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
      'INSERT INTO matches (id, source_match_id, player0_id, player1_id, winner_id, loser_id, winner_elo_change, loser_elo_change, turns, duration_seconds, action_log) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)',
      [
        'm_fixed',
        'bg_match_1',
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

  it('stores unsourced match records without changing Elo', async () => {
    const winner = { id: 'u_winner', elo: 1000 };
    const loser = { id: 'u_loser', elo: 1000 };
    const { pool, client } = makePool({ winner, loser });

    await expect(
      submitMatchResult({
        pool,
        authUserId: 'u_winner',
        body: { winnerId: 'u_winner', loserId: 'u_loser', turns: 3 },
        sanitizeActionLog: () => [],
        generateMatchId: () => 'm_unsourced',
      }),
    ).resolves.toMatchObject({
      ok: true,
      body: {
        matchId: 'm_unsourced',
        winnerEloChange: 0,
        loserEloChange: 0,
        winnerNewElo: 1000,
        loserNewElo: 1000,
      },
    });

    expect(client.query).not.toHaveBeenCalledWith(
      'UPDATE users SET elo = $1, match_count = match_count + 1, wins = wins + 1 WHERE id = $2',
      expect.anything(),
    );
  });

  it('returns the original Elo result when a ranked submission is retried', async () => {
    const { pool } = makePool({
      existingMatch: { id: 'm_existing', winner_elo_change: 14, loser_elo_change: -14 },
      sourceRows: [
        {
          state: { ctx: { gameover: { winner: 0 } }, G: { step: 'gameOver', winner: 0 } },
          metadata: {
            players: {
              '0': trustedSeat('u_winner'),
              '1': trustedSeat('u_loser'),
            },
          },
        },
      ],
    });

    await expect(
      submitMatchResult({
        pool,
        authUserId: 'u_winner',
        body: {
          winnerId: 'u_winner',
          loserId: 'u_loser',
          sourceMatchId: 'bg_match_1',
          winnerPlayer: 0,
        },
        sanitizeActionLog: () => [],
      }),
    ).resolves.toEqual({
      ok: true,
      body: {
        matchId: 'm_existing',
        winnerEloChange: 14,
        loserEloChange: -14,
        duplicate: true,
      },
    });
  });

  it('recovers the existing result when simultaneous clients race to insert', async () => {
    const { pool } = makePool({
      winner: { id: 'u_winner', elo: 1000 },
      loser: { id: 'u_loser', elo: 1000 },
      uniqueOnInsert: true,
      existingMatch: { id: 'm_winner', winner_elo_change: 16, loser_elo_change: -16 },
      sourceRows: [
        {
          state: { ctx: { gameover: { winner: 0 } }, G: { step: 'gameOver', winner: 0 } },
          metadata: {
            players: {
              '0': trustedSeat('u_winner'),
              '1': trustedSeat('u_loser'),
            },
          },
        },
      ],
    });

    await expect(
      submitMatchResult({
        pool,
        authUserId: 'u_loser',
        body: {
          winnerId: 'guest-player-0',
          loserId: 'u_loser',
          sourceMatchId: 'bg_match_1',
          winnerPlayer: 0,
        },
        sanitizeActionLog: () => [],
      }),
    ).resolves.toMatchObject({
      ok: true,
      body: { matchId: 'm_winner', winnerEloChange: 16, loserEloChange: -16, duplicate: true },
    });
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
