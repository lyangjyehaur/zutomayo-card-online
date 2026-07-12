import { describe, expect, it, vi } from 'vitest';
import { matchResultRetryDelayMs, processMatchResultOutboxBatch } from '../matchResultOutbox';

function outboxRow() {
  return {
    source_match_id: 'match_1',
    player0_user_id: 'u_alice',
    player1_user_id: 'u_bob',
    winner_player: 0,
    winner_user_id: 'u_alice',
    loser_user_id: 'u_bob',
    ranked_eligible: true,
    turns: 4,
    duration_seconds: 5,
    action_log: [{ action: 'finish' }],
    state_id: 1,
    status: 'processing' as const,
    attempt_count: 1,
  };
}

describe('match result outbox worker', () => {
  it('uses bounded exponential retry delays', () => {
    expect(matchResultRetryDelayMs(1, 100, 1_000)).toBe(100);
    expect(matchResultRetryDelayMs(4, 100, 1_000)).toBe(800);
    expect(matchResultRetryDelayMs(20, 100, 1_000)).toBe(1_000);
  });

  it('delivers a claimed row and updates users exactly once', async () => {
    const row = outboxRow();
    const claim = vi.fn(async () => ({ rows: [row] }));
    const client = {
      query: vi.fn(async (sql: string, _params?: unknown[]) => {
        if (sql.startsWith('SELECT *')) return { rows: [row], rowCount: 1 };
        if (sql.startsWith('SELECT id, elo')) {
          return {
            rows: [
              { id: 'u_alice', elo: 1000 },
              { id: 'u_bob', elo: 1000 },
            ],
            rowCount: 2,
          };
        }
        if (sql.startsWith('INSERT INTO matches')) return { rows: [{ id: 'm_result' }], rowCount: 1 };
        return { rows: [], rowCount: 1 };
      }),
      release: vi.fn(),
    };
    const pool = {
      query: claim,
      connect: vi.fn(async () => client),
    } as never;

    await expect(processMatchResultOutboxBatch({ pool, generateMatchId: () => 'm_result' })).resolves.toEqual({
      claimed: 1,
      delivered: 1,
      retried: 0,
    });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE users'),
      expect.arrayContaining([1016, 'u_alice']),
    );
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("status = 'delivered'"), ['match_1', 'm_result']);
  });

  it('retains delivery failures as pending rows with a retry timestamp', async () => {
    const row = outboxRow();
    const claim = vi.fn(async () => ({ rows: [row] }));
    const client = {
      query: vi.fn(async (sql: string, _params?: unknown[]) => {
        if (sql === 'BEGIN') return { rows: [], rowCount: 0 };
        if (sql.startsWith('SELECT *')) throw new Error('temporary database failure');
        return { rows: [], rowCount: 1 };
      }),
      release: vi.fn(),
    };
    const pool = {
      query: claim,
      connect: vi.fn(async () => client),
    } as never;

    await expect(processMatchResultOutboxBatch({ pool, baseRetryMs: 100, maxRetryMs: 1_000 })).resolves.toEqual({
      claimed: 1,
      delivered: 0,
      retried: 1,
    });
    expect(claim).toHaveBeenLastCalledWith(expect.stringContaining("SET status = 'pending'"), [
      'match_1',
      100,
      'temporary database failure',
    ]);
  });

  it('sanitizes authoritative action logs before writing the public match record', async () => {
    const row = {
      ...outboxRow(),
      action_log: [
        {
          action: 'janken',
          player: 0,
          payload: { choice: 'rock', hiddenCardId: 'secret-card' },
          hiddenDeckOrder: ['secret-card'],
        },
      ],
    };
    const claim = vi.fn(async () => ({ rows: [row] }));
    const client = {
      query: vi.fn(async (sql: string, _params?: unknown[]) => {
        if (sql.startsWith('SELECT *')) return { rows: [row], rowCount: 1 };
        if (sql.startsWith('SELECT id, elo')) {
          return {
            rows: [
              { id: 'u_alice', elo: 1000 },
              { id: 'u_bob', elo: 1000 },
            ],
            rowCount: 2,
          };
        }
        if (sql.startsWith('INSERT INTO matches')) return { rows: [{ id: 'm_result' }], rowCount: 1 };
        return { rows: [], rowCount: 1 };
      }),
      release: vi.fn(),
    };
    const pool = {
      query: claim,
      connect: vi.fn(async () => client),
    } as never;

    await processMatchResultOutboxBatch({ pool, generateMatchId: () => 'm_result' });

    const insertCall = client.query.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO matches'));
    expect(insertCall).toBeDefined();
    const storedActionLog = JSON.parse(String(insertCall?.[1]?.[10]));
    expect(storedActionLog).toEqual([
      {
        turn: 0,
        step: 'unknown',
        player: 0,
        action: 'janken',
        timestamp: expect.any(Number),
        payload: { choice: 'rock' },
      },
    ]);
  });

  it('updates the active season before marking the outbox row delivered', async () => {
    const row = outboxRow();
    const claim = vi.fn(async () => ({ rows: [row] }));
    const client = {
      query: vi.fn(async (sql: string, _params?: unknown[]) => {
        if (sql.startsWith('SELECT *')) return { rows: [row], rowCount: 1 };
        if (sql.startsWith('SELECT id, elo')) {
          return {
            rows: [
              { id: 'u_alice', elo: 1000 },
              { id: 'u_bob', elo: 1000 },
            ],
            rowCount: 2,
          };
        }
        if (sql.startsWith('SELECT id, starting_rating')) {
          return { rows: [{ id: 'season_1', starting_rating: 1000, placement_matches: 5 }], rowCount: 1 };
        }
        if (sql.startsWith('SELECT winner_delta')) return { rows: [], rowCount: 0 };
        if (sql.startsWith('SELECT user_id, rating')) {
          return {
            rows: [
              { user_id: 'u_alice', rating: 1000, match_count: 0 },
              { user_id: 'u_bob', rating: 1000, match_count: 0 },
            ],
            rowCount: 2,
          };
        }
        if (sql.startsWith('INSERT INTO matches')) return { rows: [{ id: 'm_result' }], rowCount: 1 };
        return { rows: [], rowCount: 1 };
      }),
      release: vi.fn(),
    };
    const pool = {
      query: claim,
      connect: vi.fn(async () => client),
    } as never;

    await expect(processMatchResultOutboxBatch({ pool, generateMatchId: () => 'm_result' })).resolves.toEqual({
      claimed: 1,
      delivered: 1,
      retried: 0,
    });

    const seasonInsertIndex = client.query.mock.calls.findIndex(([sql]) =>
      sql.startsWith('INSERT INTO season_match_results'),
    );
    const deliveryUpdateIndex = client.query.mock.calls.findIndex(([sql]) => sql.includes("status = 'delivered'"));
    expect(seasonInsertIndex).toBeGreaterThan(-1);
    expect(deliveryUpdateIndex).toBeGreaterThan(seasonInsertIndex);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO season_match_results'), [
      'season_1',
      'match_1',
      'u_alice',
      'u_bob',
      16,
      -16,
    ]);
  });
});
