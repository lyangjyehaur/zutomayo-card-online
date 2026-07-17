import { describe, expect, it, vi } from 'vitest';
import type { LogEntry, State } from 'boardgame.io';
import { PostgresAdapter, StaleStateWriteError } from '../postgres-adapter';

type MockClient = {
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
};

function mockClient(handler?: (sql: string, params?: unknown[]) => Promise<unknown>): MockClient {
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => handler?.(sql, params) ?? { rows: [], rowCount: 0 }),
    release: vi.fn(),
  };
}

function mockPool(clients: MockClient[], query?: ReturnType<typeof vi.fn>) {
  return {
    connect: vi.fn(async () => {
      const client = clients.shift();
      if (!client) throw new Error('No mock PG client available');
      return client;
    }),
    query: query ?? vi.fn(async () => ({ rows: [], rowCount: 0 })),
    end: vi.fn(),
  };
}

function stateWithID(_stateID: number): State {
  return { _stateID, G: {}, ctx: {} } as State;
}

describe('PostgresAdapter state constraints', () => {
  it('rejects stale state writes instead of overwriting newer match state', async () => {
    const schemaClient = mockClient();
    const poolQuery = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    const pool = mockPool([schemaClient], poolQuery);
    const adapter = new PostgresAdapter({ pool: pool as never, createIndexes: false });

    await expect(adapter.setState('match_1', stateWithID(2))).rejects.toBeInstanceOf(StaleStateWriteError);

    expect(poolQuery).toHaveBeenCalledWith(
      expect.stringContaining(`COALESCE((state->>'_stateID')::integer, -1) = $3`),
      ['match_1', JSON.stringify(stateWithID(2)), 1],
    );
  });

  it('locks boardgame.io update state fetches until setState commits the same transaction', async () => {
    const schemaClient = mockClient();
    const lockClient = mockClient(async (sql: string) => {
      if (sql.includes('FOR UPDATE')) return { rows: [{ state: stateWithID(0) }], rowCount: 1 };
      if (sql.startsWith('UPDATE bjg_matches')) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const poolQuery = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    const pool = mockPool([schemaClient, lockClient], poolQuery);
    const adapter = new PostgresAdapter({ pool: pool as never, createIndexes: false });

    await expect(adapter.fetch('match_1', { state: true })).resolves.toEqual({ state: stateWithID(0) });
    await adapter.setState('match_1', stateWithID(1), [] as LogEntry[]);

    expect(lockClient.query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(lockClient.query).toHaveBeenNthCalledWith(
      2,
      `SELECT match_id, state FROM bjg_matches WHERE match_id = $1 FOR UPDATE`,
      ['match_1'],
    );
    expect(lockClient.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining(`COALESCE((state->>'_stateID')::integer, -1) = $3`),
      ['match_1', JSON.stringify(stateWithID(1)), 0],
    );
    expect(lockClient.query).toHaveBeenNthCalledWith(4, 'COMMIT');
    expect(lockClient.release).toHaveBeenCalledTimes(1);
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it('releases an update lock on the next event-loop turn when boardgame.io rejects the move', async () => {
    const schemaClient = mockClient();
    const lockClient = mockClient(async (sql: string) => {
      if (sql.includes('FOR UPDATE')) return { rows: [{ state: stateWithID(4) }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const pool = mockPool([schemaClient, lockClient]);
    const adapter = new PostgresAdapter({ pool: pool as never, createIndexes: false });

    await expect(adapter.fetch('match_1', { state: true })).resolves.toEqual({ state: stateWithID(4) });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(lockClient.query).toHaveBeenNthCalledWith(3, 'ROLLBACK');
    expect(lockClient.release).toHaveBeenCalledTimes(1);
  });
});
