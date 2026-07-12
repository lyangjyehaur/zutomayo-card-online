import { describe, expect, it, vi } from 'vitest';
import { PostgresAdapter } from '../postgres-adapter';

type MockClient = {
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
};

function client(handler?: (sql: string, params?: unknown[]) => Promise<unknown>): MockClient {
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => handler?.(sql, params) ?? { rows: [], rowCount: 1 }),
    release: vi.fn(),
  };
}

function pool(clients: MockClient[]) {
  return {
    connect: vi.fn(async () => {
      const next = clients.shift();
      if (!next) throw new Error('No mock PG client available');
      return next;
    }),
    query: vi.fn(),
    end: vi.fn(),
  };
}

describe('PostgresAdapter result retention', () => {
  it('does not wipe a match while its result is pending delivery', async () => {
    const schemaClient = client();
    const transactionClient = client(async (sql) => {
      if (sql.includes('FROM bjg_match_result_outbox')) return { rows: [{ status: 'pending' }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const pg = pool([schemaClient, transactionClient]);
    const adapter = new PostgresAdapter({ pool: pg as never, createIndexes: false });

    await adapter.wipe('match_pending');

    expect(transactionClient.query).toHaveBeenCalledWith(expect.stringContaining('FOR UPDATE'), ['match_pending']);
    expect(transactionClient.query).not.toHaveBeenCalledWith(
      'DELETE FROM bjg_matches WHERE match_id = $1',
      ['match_pending'],
    );
    expect(transactionClient.query).toHaveBeenLastCalledWith('COMMIT');
  });

  it('wipes a match after its result is delivered or explicitly unrated', async () => {
    const schemaClient = client();
    const transactionClient = client(async (sql) => {
      if (sql.includes('FROM bjg_match_result_outbox')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    });
    const pg = pool([schemaClient, transactionClient]);
    const adapter = new PostgresAdapter({ pool: pg as never, createIndexes: false });

    await adapter.wipe('match_delivered');

    expect(transactionClient.query).toHaveBeenCalledWith('DELETE FROM bjg_matches WHERE match_id = $1', [
      'match_delivered',
    ]);
    expect(transactionClient.query).toHaveBeenLastCalledWith('COMMIT');
  });
});
