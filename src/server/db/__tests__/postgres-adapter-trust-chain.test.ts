import crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { State } from 'boardgame.io';
import { MatchSeatReservationError, PostgresAdapter } from '../postgres-adapter';

type MockClient = {
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
};

function mockClient(handler?: (sql: string, params?: unknown[]) => Promise<unknown>): MockClient {
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => handler?.(sql, params) ?? { rows: [], rowCount: 1 }),
    release: vi.fn(),
  };
}

function mockPool(clients: MockClient[]) {
  return {
    connect: vi.fn(async () => {
      const client = clients.shift();
      if (!client) throw new Error('No mock PG client available');
      return client;
    }),
    query: vi.fn(async () => ({ rows: [], rowCount: 1 })),
    end: vi.fn(),
  };
}

function metadata() {
  return {
    gameName: 'zutomayo-card',
    players: {
      '0': {},
      '1': {},
    },
    setupData: {},
  };
}

function stateWithWinner(): State {
  return {
    _stateID: 1,
    G: {
      step: 'gameOver',
      winner: 0,
      turnNumber: 4,
      matchStartedAt: 1_000,
      matchEndedAt: 6_000,
      actionLog: [{ action: 'finish' }],
    },
    ctx: { gameover: { winner: 0 } },
  } as never;
}

describe('PostgresAdapter trust-chain transactions', () => {
  it('reserves a seat and identity under one row-lock transaction', async () => {
    const schemaClient = mockClient();
    const transactionClient = mockClient(async (sql) => {
      if (sql.includes('FROM bjg_matches') && sql.includes('FOR UPDATE')) {
        return { rows: [{ metadata: metadata() }], rowCount: 1 };
      }
      if (sql.includes('FROM bjg_match_seats')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    });
    const pool = mockPool([schemaClient, transactionClient]);
    const adapter = new PostgresAdapter({ pool: pool as never, createIndexes: false });

    await expect(
      adapter.reserveMatchSeat({
        matchID: 'match_1',
        playerID: '0',
        playerName: 'Alice',
        playerData: { userId: 'u_alice', identitySource: 'server', rankedEligible: true },
        userId: 'u_alice',
        rankedEligible: true,
        credentials: 'credential-a',
      }),
    ).resolves.toMatchObject({ playerID: '0', userId: 'u_alice', rankedEligible: true });

    expect(transactionClient.query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(transactionClient.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO bjg_match_seats'), [
      'match_1',
      '0',
      'u_alice',
      true,
      expect.any(String),
    ]);
    expect(transactionClient.query).toHaveBeenLastCalledWith('COMMIT');
  });

  it('rejects a duplicate identity before mutating metadata', async () => {
    const schemaClient = mockClient();
    const transactionClient = mockClient(async (sql) => {
      if (sql.includes('FROM bjg_matches') && sql.includes('FOR UPDATE')) {
        return { rows: [{ metadata: metadata() }], rowCount: 1 };
      }
      if (sql.includes('FROM bjg_match_seats')) {
        return {
          rows: [{ match_id: 'match_1', player_id: '1', user_id: 'u_alice', ranked_eligible: true }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    });
    const pool = mockPool([schemaClient, transactionClient]);
    const adapter = new PostgresAdapter({ pool: pool as never, createIndexes: false });

    await expect(
      adapter.reserveMatchSeat({
        matchID: 'match_1',
        playerID: '0',
        playerName: 'Alice',
        playerData: { userId: 'u_alice', identitySource: 'server', rankedEligible: true },
        userId: 'u_alice',
        rankedEligible: true,
        credentials: 'credential-a',
      }),
    ).rejects.toMatchObject({ reason: 'identity_taken' } satisfies Partial<MatchSeatReservationError>);
    expect(transactionClient.query).not.toHaveBeenCalledWith(
      expect.stringContaining('UPDATE bjg_matches'),
      expect.anything(),
    );
    expect(transactionClient.query).toHaveBeenLastCalledWith('ROLLBACK');
  });

  it('preserves atomically reserved seat fields when stale metadata is written', async () => {
    const schemaClient = mockClient();
    const reservedMetadata = {
      ...metadata(),
      players: {
        '0': {
          name: 'Alice',
          credentials: 'credential-a',
          data: { userId: 'u_alice', identitySource: 'server', rankedEligible: true },
        },
        '1': {},
      },
    };
    const transactionClient = mockClient(async (sql) => {
      if (sql.includes('SELECT metadata') && sql.includes('FOR UPDATE')) {
        return { rows: [{ metadata: reservedMetadata }], rowCount: 1 };
      }
      if (sql.includes('FROM bjg_match_seats')) {
        return { rows: [{ player_id: '0' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    const pool = mockPool([schemaClient, transactionClient]);
    const adapter = new PostgresAdapter({ pool: pool as never, createIndexes: false });

    await adapter.setMetadata('match_1', { ...metadata(), updatedAt: 123 } as never);

    const write = transactionClient.query.mock.calls.find(([sql]) =>
      String(sql).startsWith('INSERT INTO bjg_matches'),
    );
    expect(write).toBeDefined();
    const persisted = JSON.parse(String(write?.[1]?.[1])) as typeof reservedMetadata & { updatedAt: number };
    expect(persisted.updatedAt).toBe(123);
    expect(persisted.players['0']).toEqual(reservedMetadata.players['0']);
    expect(transactionClient.query).toHaveBeenLastCalledWith('COMMIT');
  });

  it('verifies resume credentials while holding the seat row lock', async () => {
    const credentialHash = crypto.createHash('sha256').update('credential-a').digest('hex');
    const schemaClient = mockClient();
    const transactionClient = mockClient(async (sql) => {
      if (sql.includes('FROM bjg_matches') && sql.includes('FOR UPDATE')) {
        return {
          rows: [
            {
              metadata: {
                ...metadata(),
                players: {
                  '0': {
                    name: 'Alice',
                    credentials: 'credential-a',
                    data: { userId: 'u_alice', identitySource: 'server', rankedEligible: true },
                  },
                  '1': {},
                },
              },
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes('FROM bjg_match_seats')) {
        return {
          rows: [
            {
              match_id: 'match_1',
              player_id: '0',
              user_id: 'u_alice',
              ranked_eligible: true,
              credential_hash: credentialHash,
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    });
    const pool = mockPool([schemaClient, transactionClient]);
    const adapter = new PostgresAdapter({ pool: pool as never, createIndexes: false });

    await expect(
      adapter.resumeMatchSeat({
        matchID: 'match_1',
        playerID: '0',
        credentials: 'credential-a',
        authenticatedUserId: 'u_alice',
      }),
    ).resolves.toMatchObject({ playerID: '0', userId: 'u_alice' });
    expect(transactionClient.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE bjg_match_seats'), [
      'match_1',
      '0',
    ]);
  });

  it('writes terminal state and canonical outbox row in the same transaction', async () => {
    const schemaClient = mockClient();
    const transactionClient = mockClient(async (sql) => {
      if (sql.includes('FROM bjg_match_seats')) {
        return {
          rows: [
            { match_id: 'match_1', player_id: '0', user_id: 'u_alice', ranked_eligible: true },
            { match_id: 'match_1', player_id: '1', user_id: 'u_bob', ranked_eligible: true },
          ],
          rowCount: 2,
        };
      }
      if (sql.startsWith('UPDATE bjg_matches')) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const pool = mockPool([schemaClient, transactionClient]);
    const adapter = new PostgresAdapter({ pool: pool as never, createIndexes: false });

    await adapter.setState('match_1', stateWithWinner());

    expect(transactionClient.query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(transactionClient.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO bjg_match_result_outbox'),
      [
        'match_1',
        'u_alice',
        'u_bob',
        0,
        'u_alice',
        'u_bob',
        true,
        4,
        5,
        JSON.stringify([{ action: 'finish' }]),
        1,
        'pending',
        null,
      ],
    );
    expect(transactionClient.query).toHaveBeenLastCalledWith('COMMIT');
  });

  it('marks eligible results unrated when ranked delivery is disabled', async () => {
    const schemaClient = mockClient();
    const transactionClient = mockClient(async (sql) => {
      if (sql.includes('FROM bjg_match_seats')) {
        return {
          rows: [
            { match_id: 'match_1', player_id: '0', user_id: 'u_alice', ranked_eligible: true },
            { match_id: 'match_1', player_id: '1', user_id: 'u_bob', ranked_eligible: true },
          ],
          rowCount: 2,
        };
      }
      if (sql.startsWith('UPDATE bjg_matches')) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const pool = mockPool([schemaClient, transactionClient]);
    const adapter = new PostgresAdapter({ pool: pool as never, createIndexes: false, rankedMatchesEnabled: false });

    await adapter.setState('match_1', stateWithWinner());

    expect(transactionClient.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO bjg_match_result_outbox'),
      expect.arrayContaining(['unrated', 'ranked_disabled']),
    );
  });
});
