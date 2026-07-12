import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

type Queryable = {
  query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }>;
};

type VerificationResult = {
  ok: boolean;
  status?: number;
  error?: string;
};

const require = createRequire(import.meta.url);
const {
  boardgameWinnerFromState,
  isBoardgameFinished,
  normalizeWinnerPlayer,
  playerDataUserId,
  verifyBoardgameMatchResult,
} = require('../matchVerification.cjs') as {
  boardgameWinnerFromState: (state: unknown) => 0 | 1 | null;
  isBoardgameFinished: (state: unknown) => boolean;
  normalizeWinnerPlayer: (value: unknown) => 0 | 1 | null;
  playerDataUserId: (metadata: unknown, player: 0 | 1) => string;
  verifyBoardgameMatchResult: (
    pool: Queryable,
    sourceMatchId: string,
    winnerPlayer: 0 | 1 | null,
    authUserId: string,
  ) => Promise<VerificationResult>;
};

function poolWithRows(rows: unknown[]): { pool: Queryable; query: ReturnType<typeof vi.fn> } {
  const query = vi.fn().mockResolvedValue({ rows });
  return { pool: { query }, query };
}

function trustedSeat(userId: string, rankedEligible = true) {
  return { data: { userId, identitySource: 'server', rankedEligible } };
}

describe('match verification helpers', () => {
  it('normalizes boardgame player ids from numbers and strings', () => {
    expect(normalizeWinnerPlayer(0)).toBe(0);
    expect(normalizeWinnerPlayer('0')).toBe(0);
    expect(normalizeWinnerPlayer(1)).toBe(1);
    expect(normalizeWinnerPlayer('1')).toBe(1);
    expect(normalizeWinnerPlayer('2')).toBeNull();
  });

  it('prefers ctx.gameover winner and treats draws as no winner', () => {
    expect(boardgameWinnerFromState({ ctx: { gameover: { winner: '1' } }, G: { winner: 0 } })).toBe(1);
    expect(boardgameWinnerFromState({ ctx: { gameover: { draw: true, winner: '1' } }, G: { winner: 1 } })).toBeNull();
  });

  it('falls back to G.winner and detects finished game state', () => {
    expect(boardgameWinnerFromState({ ctx: {}, G: { winner: 0 } })).toBe(0);
    expect(isBoardgameFinished({ ctx: { gameover: { winner: 0 } }, G: { step: 'battle' } })).toBe(true);
    expect(isBoardgameFinished({ ctx: {}, G: { step: 'gameOver' } })).toBe(true);
    expect(isBoardgameFinished({ ctx: {}, G: { step: 'battle' } })).toBe(false);
  });

  it('reads the authenticated user id stored on a boardgame seat', () => {
    const metadata = { players: { '1': { data: { userId: 'u_winner' } } } };
    expect(playerDataUserId(metadata, 1)).toBe('u_winner');
    expect(playerDataUserId(metadata, 0)).toBe('');
  });
});

describe('verifyBoardgameMatchResult', () => {
  it('requires a source match id for ranked verification', async () => {
    const { pool, query } = poolWithRows([]);
    await expect(verifyBoardgameMatchResult(pool, '', null, 'u_1')).resolves.toMatchObject({
      ok: false,
      status: 400,
    });
    expect(query).not.toHaveBeenCalled();
  });

  it('requires winnerPlayer when source match verification is requested', async () => {
    const { pool } = poolWithRows([]);
    await expect(verifyBoardgameMatchResult(pool, 'match_1', null, 'u_1')).resolves.toMatchObject({
      ok: false,
      status: 400,
    });
  });

  it('rejects missing, unfinished, mismatched, and unbound source matches', async () => {
    await expect(verifyBoardgameMatchResult(poolWithRows([]).pool, 'missing', 0, 'u_0')).resolves.toMatchObject({
      ok: false,
      status: 404,
    });

    await expect(
      verifyBoardgameMatchResult(
        poolWithRows([{ state: { ctx: {}, G: { step: 'battle', winner: 0 } }, metadata: {} }]).pool,
        'm',
        0,
        'u_0',
      ),
    ).resolves.toMatchObject({ ok: false, status: 409 });

    await expect(
      verifyBoardgameMatchResult(
        poolWithRows([
          {
            state: { ctx: { gameover: { winner: 1 } }, G: { step: 'gameOver', winner: 1 } },
            metadata: { players: { '1': { data: { userId: 'u_1' } } } },
          },
        ]).pool,
        'm',
        0,
        'u_0',
      ),
    ).resolves.toMatchObject({ ok: false, status: 403 });

    await expect(
      verifyBoardgameMatchResult(
        poolWithRows([
          {
            state: { ctx: { gameover: { winner: 0 } }, G: { step: 'gameOver', winner: 0 } },
            metadata: { players: { '0': trustedSeat('u_other'), '1': trustedSeat('u_other_2') } },
          },
        ]).pool,
        'm',
        0,
        'u_0',
      ),
    ).resolves.toMatchObject({ ok: false, status: 403 });
  });

  it('treats a missing boardgame table as a missing source match', async () => {
    const pool = {
      query: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('relation "bjg_matches" does not exist'), { code: '42P01' })),
    };

    await expect(verifyBoardgameMatchResult(pool, 'match_1', 0, 'u_0')).resolves.toMatchObject({
      ok: false,
      status: 404,
    });
  });

  it('rejects client-shaped seat metadata without server identity provenance', async () => {
    const { pool } = poolWithRows([
      {
        state: { ctx: { gameover: { winner: 0 } }, G: { step: 'gameOver', winner: 0 } },
        metadata: {
          players: {
            '0': { data: { userId: 'u_winner' } },
            '1': { data: { userId: 'u_victim' } },
          },
        },
      },
    ]);

    await expect(verifyBoardgameMatchResult(pool, 'match_1', 0, 'u_winner')).resolves.toMatchObject({
      ok: false,
      status: 409,
    });
  });

  it('accepts a finished source match whose winner seat belongs to the authenticated user', async () => {
    const { pool, query } = poolWithRows([
      {
        state: { ctx: { gameover: { winner: '1' } }, G: { step: 'gameOver', winner: 1 } },
        metadata: {
          players: {
            '0': trustedSeat('u_loser'),
            '1': trustedSeat('u_winner'),
          },
        },
      },
    ]);

    await expect(verifyBoardgameMatchResult(pool, 'match_1', 1, 'u_winner')).resolves.toMatchObject({
      ok: true,
      sourceMatchId: 'match_1',
      winnerPlayer: 1,
      loserPlayer: 0,
      winnerUserId: 'u_winner',
      loserUserId: 'u_loser',
    });
    expect(query).toHaveBeenCalledWith('SELECT state, metadata FROM bjg_matches WHERE match_id = $1', ['match_1']);
  });

  it('allows the authenticated loser to submit the same authoritative result', async () => {
    const { pool } = poolWithRows([
      {
        state: { ctx: { gameover: { winner: 0 } }, G: { step: 'gameOver', winner: 0 } },
        metadata: {
          players: {
            '0': trustedSeat('u_winner'),
            '1': trustedSeat('u_loser'),
          },
        },
      },
    ]);

    await expect(verifyBoardgameMatchResult(pool, 'match_1', 0, 'u_loser')).resolves.toMatchObject({
      ok: true,
      winnerUserId: 'u_winner',
      loserUserId: 'u_loser',
    });
  });
});
