import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  matchResultRetryDelayMs,
  processMatchResultOutboxBatch,
  refreshMatchResultOutboxMetrics,
} from '../matchResultOutbox';
import { register } from '../observability/metrics';

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
    completed_at: '2026-07-01T23:59:59.000Z',
    rules_version: 'rules-2026-07',
    action_log: [{ action: 'finish' }],
    state_id: 1,
    status: 'processing' as const,
    attempt_count: 1,
  };
}

describe('match result outbox worker', () => {
  beforeEach(() => {
    register.resetMetrics();
  });

  it('refreshes durable queue and row-count gauges from PostgreSQL', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('COUNT(*) FILTER')) {
          return { rows: [{ pending_count: '2', oldest_age_seconds: '301.5' }], rowCount: 1 };
        }
        return {
          rows: [
            { status: 'pending', row_count: '1' },
            { status: 'processing', row_count: '1' },
            { status: 'delivered', row_count: '8' },
          ],
          rowCount: 3,
        };
      }),
    } as never;

    await refreshMatchResultOutboxMetrics(pool);
    const metrics = await register.metrics();
    expect(metrics).toContain('match_result_outbox_pending 2');
    expect(metrics).toContain('match_result_outbox_oldest_age_seconds 301.5');
    expect(metrics).toContain('match_result_outbox_rows{status="delivered"} 8');
    expect(metrics).toContain('match_result_outbox_metrics_refresh_success 1');
  });

  it('marks the metrics refresh unhealthy when the durable query fails', async () => {
    const pool = { query: vi.fn(async () => Promise.reject(new Error('database unavailable'))) } as never;
    await expect(refreshMatchResultOutboxMetrics(pool)).rejects.toThrow('database unavailable');
    const metrics = await register.metrics();
    expect(metrics).toContain('match_result_outbox_metrics_refresh_success 0');
  });

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
    await expect(register.metrics()).resolves.toContain(
      'game_match_completions_total{rating_mode="ranked",result="winner"} 1',
    );
  });

  it('terminally marks a result unrated when a participant was deleted before delivery', async () => {
    const row = outboxRow();
    const claim = vi.fn(async () => ({ rows: [row] }));
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.startsWith('SELECT *')) return { rows: [row], rowCount: 1 };
        if (sql.startsWith('SELECT id, elo')) {
          return { rows: [{ id: 'u_bob', elo: 1000, deleted_at: null }], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      }),
      release: vi.fn(),
    };
    const pool = { query: claim, connect: vi.fn(async () => client) } as never;

    await expect(processMatchResultOutboxBatch({ pool })).resolves.toEqual({
      claimed: 1,
      delivered: 0,
      retried: 0,
    });
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("status = 'unrated'"), ['match_1']);
    expect(client.query).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE users'), expect.anything());
    expect(client.query).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO matches'), expect.anything());
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

  it('does not mark a result delivered while its configured season is still scheduled', async () => {
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
        if (sql.startsWith('SELECT id, starting_rating')) return { rows: [], rowCount: 0 };
        if (sql.includes('SELECT id, status'))
          return { rows: [{ id: 'season_waiting', status: 'scheduled' }], rowCount: 1 };
        return { rows: [], rowCount: 1 };
      }),
      release: vi.fn(),
    };
    const pool = { query: claim, connect: vi.fn(async () => client) } as never;

    await expect(processMatchResultOutboxBatch({ pool, baseRetryMs: 100, maxRetryMs: 1_000 })).resolves.toMatchObject({
      claimed: 1,
      delivered: 0,
      retried: 1,
    });
    expect(claim).toHaveBeenLastCalledWith(expect.stringContaining("SET status = 'pending'"), expect.any(Array));
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
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
    expect(insertCall?.[1]?.[10]).toBe('rules-2026-07');
    const storedActionLog = JSON.parse(String(insertCall?.[1]?.[11]));
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
          return {
            rows: [{ id: 'season_1', starting_rating: 1000, placement_matches: 5, rules_version: 'rules-2026-07' }],
            rowCount: 1,
          };
        }
        if (sql.startsWith('SELECT season_id')) return { rows: [], rowCount: 0 };
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
      'm_result',
      'u_alice',
      'u_bob',
      16,
      -16,
      '2026-07-01T23:59:59.000Z',
      'rules-2026-07',
      1000,
      1016,
      1000,
      984,
    ]);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('AND rules_version = $2'), [
      '2026-07-01T23:59:59.000Z',
      'rules-2026-07',
    ]);
  });
});
