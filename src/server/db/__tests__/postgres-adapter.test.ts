import { describe, expect, it, vi } from 'vitest';
import type { LogEntry, Server, State } from 'boardgame.io';
import {
  MatchAccountDeletionLockedError,
  MatchSeatReservationError,
  PostgresAdapter,
  StaleStateWriteError,
} from '../postgres-adapter';

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

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const ACCOUNT_ROW_LOCK_SQL = 'SELECT id, deleted_at, elo, match_count, wins FROM users WHERE id = $1 FOR UPDATE';
const STATE_TRANSACTION_CONFIG_SQL = `SELECT set_config('lock_timeout', '5000ms', true),
       set_config('statement_timeout', '10000ms', true)`;
const SEAT_ACCOUNT_IDS_SQL = `SELECT player_id, user_id
         FROM bjg_match_seats
        WHERE match_id = $1
        ORDER BY user_id, player_id`;
const STATE_MATCH_LOCK_SQL = 'SELECT match_id, state, metadata FROM bjg_matches WHERE match_id = $1 FOR UPDATE';
const STATE_AUTHORITATIVE_SEATS_SQL = `SELECT match_id, player_id, user_id, ranked_eligible, credential_hash
         FROM bjg_match_seats
        WHERE match_id = $1
        ORDER BY player_id`;
const METADATA_SEAT_ACCOUNT_IDS_SQL = `SELECT player_id, user_id
           FROM bjg_match_seats
          WHERE match_id = $1
          ORDER BY user_id, player_id`;
const METADATA_MATCH_LOCK_SQL = `SELECT metadata
           FROM bjg_matches
          WHERE match_id = $1
          FOR UPDATE`;
const METADATA_AUTHORITATIVE_SEATS_SQL = `SELECT player_id, user_id
           FROM bjg_match_seats
          WHERE match_id = $1
          ORDER BY player_id`;

describe('PostgresAdapter state constraints', () => {
  it('rejects stale state writes instead of overwriting newer match state', async () => {
    const schemaClient = mockClient();
    const lockClient = mockClient(async (sql: string) => {
      if (sql === STATE_MATCH_LOCK_SQL) {
        return { rows: [{ state: stateWithID(1), metadata: { players: {} } }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const poolQuery = vi.fn();
    const pool = mockPool([schemaClient, lockClient], poolQuery);
    const adapter = new PostgresAdapter({ pool: pool as never, createIndexes: false });

    await expect(adapter.setState('match_1', stateWithID(2))).rejects.toBeInstanceOf(StaleStateWriteError);

    expect(lockClient.query).toHaveBeenCalledWith(
      expect.stringContaining(`COALESCE((state->>'_stateID')::integer, -1) = $3`),
      ['match_1', JSON.stringify(stateWithID(2)), 1],
    );
    expect(lockClient.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it('locks boardgame.io update state fetches until setState commits the same transaction', async () => {
    const schemaClient = mockClient();
    const lockClient = mockClient(async (sql: string, params?: unknown[]) => {
      if (sql === SEAT_ACCOUNT_IDS_SQL) {
        return {
          rows: [
            { player_id: '0', user_id: 'u_alice' },
            { player_id: '1', user_id: 'u_bob' },
          ],
          rowCount: 2,
        };
      }
      if (sql === STATE_AUTHORITATIVE_SEATS_SQL) {
        return {
          rows: [
            {
              match_id: 'match_1',
              player_id: '0',
              user_id: 'u_alice',
              ranked_eligible: true,
              credential_hash: 'alice-hash',
            },
            {
              match_id: 'match_1',
              player_id: '1',
              user_id: 'u_bob',
              ranked_eligible: true,
              credential_hash: 'bob-hash',
            },
          ],
          rowCount: 2,
        };
      }
      if (sql === ACCOUNT_ROW_LOCK_SQL) {
        return { rows: [{ id: params?.[0], deleted_at: null }], rowCount: 1 };
      }
      if (sql === STATE_MATCH_LOCK_SQL) {
        return { rows: [{ state: stateWithID(0), metadata: { players: {} } }], rowCount: 1 };
      }
      if (sql.startsWith('UPDATE bjg_matches')) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const poolQuery = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    const pool = mockPool([schemaClient, lockClient], poolQuery);
    const adapter = new PostgresAdapter({ pool: pool as never, createIndexes: false });

    await expect(adapter.fetch('match_1', { state: true })).resolves.toEqual({ state: stateWithID(0) });
    await adapter.setState('match_1', stateWithID(1), [] as LogEntry[]);

    expect(lockClient.query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(lockClient.query).toHaveBeenNthCalledWith(2, STATE_TRANSACTION_CONFIG_SQL);
    expect(lockClient.query).toHaveBeenNthCalledWith(3, SEAT_ACCOUNT_IDS_SQL, ['match_1']);
    expect(lockClient.query).toHaveBeenNthCalledWith(4, 'SELECT pg_advisory_xact_lock(hashtext($1))', [
      'legal-hold:account:u_alice',
    ]);
    expect(lockClient.query).toHaveBeenNthCalledWith(5, 'SELECT pg_advisory_xact_lock(hashtext($1))', [
      'legal-hold:account:u_bob',
    ]);
    expect(lockClient.query).toHaveBeenNthCalledWith(6, ACCOUNT_ROW_LOCK_SQL, ['u_alice']);
    expect(lockClient.query).toHaveBeenNthCalledWith(7, ACCOUNT_ROW_LOCK_SQL, ['u_bob']);
    expect(lockClient.query).toHaveBeenNthCalledWith(8, STATE_MATCH_LOCK_SQL, ['match_1']);
    expect(lockClient.query).toHaveBeenNthCalledWith(9, STATE_AUTHORITATIVE_SEATS_SQL, ['match_1']);
    expect(lockClient.query).toHaveBeenNthCalledWith(
      10,
      expect.stringContaining(`COALESCE((state->>'_stateID')::integer, -1) = $3`),
      ['match_1', JSON.stringify(stateWithID(1)), 0],
    );
    expect(lockClient.query).toHaveBeenNthCalledWith(11, 'COMMIT');
    expect(lockClient.release).toHaveBeenCalledTimes(1);
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it('does not let the next-turn release roll back an active state write', async () => {
    vi.useFakeTimers();
    try {
      const schemaClient = mockClient();
      const updateStarted = deferred();
      const updateResult = deferred<{ rows: unknown[]; rowCount: number }>();
      const client = mockClient(async (sql: string) => {
        if (sql === STATE_MATCH_LOCK_SQL) {
          return {
            rows: [{ match_id: 'match_1', state: stateWithID(0), metadata: { players: {} } }],
            rowCount: 1,
          };
        }
        if (sql.startsWith('UPDATE bjg_matches')) {
          updateStarted.resolve();
          return updateResult.promise;
        }
        return { rows: [], rowCount: 0 };
      });
      const adapter = new PostgresAdapter({ pool: mockPool([schemaClient, client]) as never, createIndexes: false });

      await adapter.fetch('match_1', { state: true });
      const writing = adapter.setState('match_1', stateWithID(1));
      await updateStarted.promise;
      await vi.runAllTimersAsync();

      expect(client.query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(false);
      updateResult.resolve({ rows: [], rowCount: 1 });
      await writing;
      expect(client.query).toHaveBeenLastCalledWith('COMMIT');
      expect(client.release).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses a fresh transaction when the next-turn release wins before setState', async () => {
    vi.useFakeTimers();
    try {
      const schemaClient = mockClient();
      const retainedClient = mockClient(async (sql: string) => {
        if (sql === STATE_MATCH_LOCK_SQL) {
          return {
            rows: [{ match_id: 'match_1', state: stateWithID(0), metadata: { players: {} } }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      });
      const fallbackClient = mockClient(async (sql: string) => {
        if (sql === STATE_MATCH_LOCK_SQL) {
          return {
            rows: [{ match_id: 'match_1', state: stateWithID(0), metadata: { players: {} } }],
            rowCount: 1,
          };
        }
        if (sql.startsWith('UPDATE bjg_matches')) return { rows: [], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      });
      const adapter = new PostgresAdapter({
        pool: mockPool([schemaClient, retainedClient, fallbackClient]) as never,
        createIndexes: false,
      });

      await adapter.fetch('match_1', { state: true });
      await vi.runAllTimersAsync();
      await Promise.resolve();

      expect(retainedClient.query).toHaveBeenLastCalledWith('ROLLBACK');
      expect(retainedClient.release).toHaveBeenCalledTimes(1);

      await adapter.setState('match_1', stateWithID(1));

      expect(fallbackClient.query).toHaveBeenNthCalledWith(1, 'BEGIN');
      expect(fallbackClient.query).toHaveBeenNthCalledWith(2, STATE_TRANSACTION_CONFIG_SQL);
      expect(fallbackClient.query).toHaveBeenLastCalledWith('COMMIT');
      expect(fallbackClient.release).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('configures database timeouts before waiting on account or match locks', async () => {
    const schemaClient = mockClient();
    const lockTimeout = Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' });
    const client = mockClient(async (sql: string) => {
      if (sql === SEAT_ACCOUNT_IDS_SQL) {
        return { rows: [{ player_id: '0', user_id: 'u_alice' }], rowCount: 1 };
      }
      if (sql.includes('pg_advisory_xact_lock')) throw lockTimeout;
      return { rows: [], rowCount: 0 };
    });
    const adapter = new PostgresAdapter({ pool: mockPool([schemaClient, client]) as never, createIndexes: false });

    await expect(adapter.fetch('match_1', { state: true })).rejects.toBe(lockTimeout);

    expect(client.query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(client.query).toHaveBeenNthCalledWith(2, STATE_TRANSACTION_CONFIG_SQL);
    expect(client.query).toHaveBeenNthCalledWith(3, SEAT_ACCOUNT_IDS_SQL, ['match_1']);
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('rolls back and retries when a seat commits between the account pre-read and match lock', async () => {
    const schemaClient = mockClient();
    const aliceSeat = {
      match_id: 'match_1',
      player_id: '0',
      user_id: 'u_alice',
      ranked_eligible: true,
      credential_hash: 'alice-hash',
    };
    const bobSeat = {
      match_id: 'match_1',
      player_id: '1',
      user_id: 'u_bob',
      ranked_eligible: true,
      credential_hash: 'bob-hash',
    };
    const firstClient = mockClient(async (sql: string, params?: unknown[]) => {
      if (sql === SEAT_ACCOUNT_IDS_SQL) {
        return { rows: [{ player_id: '0', user_id: 'u_alice' }], rowCount: 1 };
      }
      if (sql === ACCOUNT_ROW_LOCK_SQL) {
        return { rows: [{ id: params?.[0], deleted_at: null }], rowCount: 1 };
      }
      if (sql === STATE_MATCH_LOCK_SQL) {
        return {
          rows: [{ match_id: 'match_1', state: stateWithID(0), metadata: { players: {} } }],
          rowCount: 1,
        };
      }
      if (sql === STATE_AUTHORITATIVE_SEATS_SQL) return { rows: [aliceSeat, bobSeat], rowCount: 2 };
      return { rows: [], rowCount: 0 };
    });
    const retryClient = mockClient(async (sql: string, params?: unknown[]) => {
      if (sql === SEAT_ACCOUNT_IDS_SQL) {
        return {
          rows: [
            { player_id: '0', user_id: 'u_alice' },
            { player_id: '1', user_id: 'u_bob' },
          ],
          rowCount: 2,
        };
      }
      if (sql === ACCOUNT_ROW_LOCK_SQL) {
        return { rows: [{ id: params?.[0], deleted_at: null }], rowCount: 1 };
      }
      if (sql === STATE_MATCH_LOCK_SQL) {
        return {
          rows: [{ match_id: 'match_1', state: stateWithID(0), metadata: { players: {} } }],
          rowCount: 1,
        };
      }
      if (sql === STATE_AUTHORITATIVE_SEATS_SQL) return { rows: [aliceSeat, bobSeat], rowCount: 2 };
      if (sql.startsWith('UPDATE bjg_matches')) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const adapter = new PostgresAdapter({
      pool: mockPool([schemaClient, firstClient, retryClient]) as never,
      createIndexes: false,
    });

    await expect(adapter.fetch('match_1', { state: true })).resolves.toEqual({ state: stateWithID(0) });
    await adapter.setState('match_1', stateWithID(1));

    expect(firstClient.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(firstClient.release).toHaveBeenCalledTimes(1);
    expect(retryClient.query).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(hashtext($1))', [
      'legal-hold:account:u_bob',
    ]);
    expect(retryClient.query).toHaveBeenCalledWith(STATE_MATCH_LOCK_SQL, ['match_1']);
    expect(retryClient.query).toHaveBeenLastCalledWith('COMMIT');
    expect(retryClient.release).toHaveBeenCalledTimes(1);
  });

  it('releases every transaction after three consecutive seat-set retries are exhausted', async () => {
    const schemaClient = mockClient();
    const aliceSeat = {
      match_id: 'match_1',
      player_id: '0',
      user_id: 'u_alice',
      ranked_eligible: true,
      credential_hash: 'alice-hash',
    };
    const bobSeat = {
      match_id: 'match_1',
      player_id: '1',
      user_id: 'u_bob',
      ranked_eligible: true,
      credential_hash: 'bob-hash',
    };
    const retryClients = Array.from({ length: 4 }, () =>
      mockClient(async (sql: string, params?: unknown[]) => {
        if (sql === SEAT_ACCOUNT_IDS_SQL) {
          return { rows: [{ player_id: '0', user_id: 'u_alice' }], rowCount: 1 };
        }
        if (sql === ACCOUNT_ROW_LOCK_SQL) {
          return { rows: [{ id: params?.[0], deleted_at: null }], rowCount: 1 };
        }
        if (sql === STATE_MATCH_LOCK_SQL) {
          return {
            rows: [{ match_id: 'match_1', state: stateWithID(0), metadata: { players: {} } }],
            rowCount: 1,
          };
        }
        if (sql === STATE_AUTHORITATIVE_SEATS_SQL) return { rows: [aliceSeat, bobSeat], rowCount: 2 };
        return { rows: [], rowCount: 0 };
      }),
    );
    const adapter = new PostgresAdapter({
      pool: mockPool([schemaClient, ...retryClients]) as never,
      createIndexes: false,
    });

    await expect(adapter.fetch('match_1', { state: true })).rejects.toMatchObject({
      code: 'MATCH_SEAT_SET_CHANGED',
    });

    for (const client of retryClients) {
      expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
      expect(client.release).toHaveBeenCalledTimes(1);
    }
  });

  it('uses the prelocked authoritative seat snapshot for terminal outbox writes', async () => {
    const schemaClient = mockClient();
    const seats = [
      {
        match_id: 'match_1',
        player_id: '0',
        user_id: 'u_alice',
        ranked_eligible: true,
        credential_hash: 'alice-hash',
      },
      {
        match_id: 'match_1',
        player_id: '1',
        user_id: 'u_bob',
        ranked_eligible: true,
        credential_hash: 'bob-hash',
      },
    ];
    const client = mockClient(async (sql: string, params?: unknown[]) => {
      if (sql === SEAT_ACCOUNT_IDS_SQL) {
        return {
          rows: seats.map(({ player_id, user_id }) => ({ player_id, user_id })),
          rowCount: 2,
        };
      }
      if (sql === ACCOUNT_ROW_LOCK_SQL) {
        return { rows: [{ id: params?.[0], deleted_at: null }], rowCount: 1 };
      }
      if (sql === STATE_MATCH_LOCK_SQL) {
        return {
          rows: [
            {
              match_id: 'match_1',
              state: stateWithID(0),
              metadata: { players: {}, setupData: { rulesVersion: 'test-rules' } },
            },
          ],
          rowCount: 1,
        };
      }
      if (sql === STATE_AUTHORITATIVE_SEATS_SQL) return { rows: seats, rowCount: 2 };
      if (sql.startsWith('UPDATE bjg_matches')) return { rows: [], rowCount: 1 };
      if (sql.includes('INSERT INTO bjg_match_result_outbox')) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const adapter = new PostgresAdapter({ pool: mockPool([schemaClient, client]) as never, createIndexes: false });
    const terminalState = {
      _stateID: 1,
      G: { step: 'gameOver', winner: 0, turnNumber: 4, actionLog: [{ type: 'end' }] },
      ctx: { gameover: { winner: '0' } },
    } as unknown as State;

    await adapter.setState('match_1', terminalState);

    const matchLockIndex = client.query.mock.calls.findIndex(([sql]) => sql === STATE_MATCH_LOCK_SQL);
    const callsAfterMatchLock = client.query.mock.calls.slice(matchLockIndex + 1);
    expect(callsAfterMatchLock.some(([sql]) => sql === ACCOUNT_ROW_LOCK_SQL)).toBe(false);
    expect(callsAfterMatchLock.some(([sql]) => String(sql).includes('pg_advisory_xact_lock'))).toBe(false);
    const outboxInsert = callsAfterMatchLock.find(([sql]) =>
      String(sql).includes('INSERT INTO bjg_match_result_outbox'),
    );
    expect(outboxInsert?.[1]?.slice(0, 7)).toEqual(['match_1', 'u_alice', 'u_bob', 0, 'u_alice', 'u_bob', true]);
  });

  it.each([
    ['missing', null],
    ['deleted', { id: 'u_unavailable', deleted_at: '2026-07-15T00:00:00.000Z' }],
  ])('rejects a %s seated account before locking the match row', async (_label, accountRow) => {
    const schemaClient = mockClient();
    const lockClient = mockClient(async (sql: string) => {
      if (sql.includes('FROM bjg_match_seats')) {
        return { rows: [{ user_id: 'u_unavailable' }], rowCount: 1 };
      }
      if (sql === ACCOUNT_ROW_LOCK_SQL) {
        return { rows: accountRow ? [accountRow] : [], rowCount: accountRow ? 1 : 0 };
      }
      return { rows: [], rowCount: 0 };
    });
    const pool = mockPool([schemaClient, lockClient]);
    const adapter = new PostgresAdapter({ pool: pool as never, createIndexes: false });

    await expect(adapter.fetch('match_1', { state: true })).rejects.toMatchObject({
      code: 'ACCOUNT_DELETED',
      userIds: ['u_unavailable'],
    });

    const queries = lockClient.query.mock.calls.map(([sql]) => String(sql));
    expect(queries).not.toContain(STATE_MATCH_LOCK_SQL);
    expect(lockClient.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(lockClient.release).toHaveBeenCalledTimes(1);
  });

  it('rejects update fetches and direct state writes for an account-deletion-locked match', async () => {
    const metadata = { players: { 0: { id: 0 } }, accountDeletionLocked: true } as unknown as Server.MatchData;
    const fetchSchemaClient = mockClient();
    const fetchClient = mockClient(async (sql: string) => {
      if (sql === STATE_MATCH_LOCK_SQL) return { rows: [{ state: stateWithID(4), metadata }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const fetchAdapter = new PostgresAdapter({
      pool: mockPool([fetchSchemaClient, fetchClient]) as never,
      createIndexes: false,
    });

    await expect(fetchAdapter.fetch('match_1', { state: true })).rejects.toBeInstanceOf(
      MatchAccountDeletionLockedError,
    );
    expect(fetchClient.query).toHaveBeenLastCalledWith('ROLLBACK');

    const writeSchemaClient = mockClient();
    const writeClient = mockClient(async (sql: string) => {
      if (sql === STATE_MATCH_LOCK_SQL) return { rows: [{ state: stateWithID(4), metadata }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const writeAdapter = new PostgresAdapter({
      pool: mockPool([writeSchemaClient, writeClient]) as never,
      createIndexes: false,
    });

    await expect(writeAdapter.setState('match_1', stateWithID(5))).rejects.toBeInstanceOf(
      MatchAccountDeletionLockedError,
    );
    expect(writeClient.query.mock.calls.some(([sql]) => String(sql).startsWith('UPDATE bjg_matches'))).toBe(false);
    expect(writeClient.query).toHaveBeenLastCalledWith('ROLLBACK');
  });

  it('does not let a new account reclaim a seat in an account-deletion-locked match', async () => {
    const schemaClient = mockClient();
    const metadata = {
      players: { 0: { id: 0 }, 1: { id: 1, name: 'Peer' } },
      accountDeletionLocked: true,
    } as unknown as Server.MatchData;
    const client = mockClient(async (sql: string, params?: unknown[]) => {
      if (sql === ACCOUNT_ROW_LOCK_SQL) {
        return { rows: [{ id: params?.[0], deleted_at: null }], rowCount: 1 };
      }
      if (sql.includes('SELECT match_id, state, initial_state, metadata')) {
        return { rows: [{ state: stateWithID(4), initial_state: stateWithID(0), metadata }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const adapter = new PostgresAdapter({ pool: mockPool([schemaClient, client]) as never, createIndexes: false });

    await expect(
      adapter.reserveMatchSeat({
        matchID: 'match_1',
        playerID: '0',
        playerName: 'Replacement',
        playerData: { userId: 'u_replacement' },
        userId: 'u_replacement',
        rankedEligible: false,
        credentials: 'replacement-credential',
      }),
    ).rejects.toMatchObject({ reason: 'match_not_found' } satisfies Partial<MatchSeatReservationError>);

    expect(client.query.mock.calls.some(([sql]) => String(sql).startsWith('INSERT INTO bjg_match_seats'))).toBe(false);
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
  });

  it('uses a cross-instance shared row lock for full state sync fetches', async () => {
    const schemaClient = mockClient();
    const storedState = stateWithID(4);
    const metadata = { gameName: 'zutomayo-card', players: {} };
    const poolQuery = vi.fn(async () => ({
      rows: [{ state: storedState, log: [], metadata, initial_state: stateWithID(0) }],
      rowCount: 1,
    }));
    const pool = mockPool([schemaClient], poolQuery);
    const adapter = new PostgresAdapter({ pool: pool as never, createIndexes: false });

    await expect(
      adapter.fetch('match_1', { state: true, log: true, metadata: true, initialState: true }),
    ).resolves.toEqual({ state: storedState, log: [], metadata, initialState: stateWithID(0) });

    expect(poolQuery).toHaveBeenCalledWith(
      'SELECT match_id, state, log, metadata, initial_state FROM bjg_matches WHERE match_id = $1 FOR SHARE',
      ['match_1'],
    );
  });

  it('does not lock metadata-only fetches behind state updates', async () => {
    const schemaClient = mockClient();
    const metadata = { gameName: 'zutomayo-card', players: {} };
    const poolQuery = vi.fn(async () => ({ rows: [{ metadata }], rowCount: 1 }));
    const pool = mockPool([schemaClient], poolQuery);
    const adapter = new PostgresAdapter({ pool: pool as never, createIndexes: false });

    await expect(adapter.fetch('match_1', { metadata: true })).resolves.toEqual({ metadata });

    expect(poolQuery).toHaveBeenCalledWith('SELECT match_id, metadata FROM bjg_matches WHERE match_id = $1', [
      'match_1',
    ]);
  });
});

describe('PostgresAdapter metadata fencing', () => {
  const currentMetadata = {
    gameName: 'zutomayo-card',
    players: {
      0: { id: 0, isConnected: false },
      1: {
        id: 1,
        name: 'Live peer',
        credentials: 'live-peer-credential',
        data: { userId: 'u_peer', identitySource: 'server' },
        isConnected: true,
      },
    },
    setupData: { owner: 'deleted-boardgame-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', rulesVersion: 'test' },
    createdAt: 1,
    updatedAt: 2,
  } satisfies Server.MatchData;

  function metadataClient(current: Server.MatchData | null) {
    return mockClient(async (sql: string, params?: unknown[]) => {
      if (sql === METADATA_SEAT_ACCOUNT_IDS_SQL || sql === METADATA_AUTHORITATIVE_SEATS_SQL) {
        return { rows: [{ player_id: '1', user_id: 'u_peer' }], rowCount: 1 };
      }
      if (sql === ACCOUNT_ROW_LOCK_SQL) {
        return { rows: [{ id: params?.[0], deleted_at: null }], rowCount: 1 };
      }
      if (sql === METADATA_MATCH_LOCK_SQL) {
        return { rows: current ? [{ metadata: current }] : [], rowCount: current ? 1 : 0 };
      }
      if (sql.startsWith('UPDATE bjg_matches')) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
  }

  it('uses account -> match ordering and drops stale identity for a deleted seat', async () => {
    const schemaClient = mockClient();
    const client = metadataClient(currentMetadata);
    const pool = mockPool([schemaClient, client]);
    const adapter = new PostgresAdapter({ pool: pool as never, createIndexes: false });
    const staleMetadata = {
      ...currentMetadata,
      players: {
        0: {
          id: 0,
          name: 'Deleted player',
          credentials: 'stale-deleted-credential',
          data: { userId: 'u_deleted', identitySource: 'server' },
        },
        1: currentMetadata.players[1],
      },
      setupData: { owner: 'u_deleted', rulesVersion: 'test' },
      updatedAt: 3,
    } satisfies Server.MatchData;

    await expect(adapter.setMetadata('match_1', staleMetadata)).resolves.toBeUndefined();

    expect(client.query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(client.query).toHaveBeenNthCalledWith(2, METADATA_SEAT_ACCOUNT_IDS_SQL, ['match_1']);
    expect(client.query).toHaveBeenNthCalledWith(3, 'SELECT pg_advisory_xact_lock(hashtext($1))', [
      'legal-hold:account:u_peer',
    ]);
    expect(client.query).toHaveBeenNthCalledWith(4, ACCOUNT_ROW_LOCK_SQL, ['u_peer']);
    expect(client.query).toHaveBeenNthCalledWith(5, METADATA_MATCH_LOCK_SQL, ['match_1']);
    expect(client.query).toHaveBeenNthCalledWith(6, METADATA_AUTHORITATIVE_SEATS_SQL, ['match_1']);
    expect(client.query).toHaveBeenNthCalledWith(7, 'COMMIT');
    expect(client.query.mock.calls.some(([sql]) => String(sql).startsWith('UPDATE bjg_matches'))).toBe(false);
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO bjg_matches'))).toBe(false);
  });

  it('updates only runtime metadata while retaining anonymized and authoritative fields', async () => {
    const schemaClient = mockClient();
    const client = metadataClient(currentMetadata);
    const pool = mockPool([schemaClient, client]);
    const adapter = new PostgresAdapter({ pool: pool as never, createIndexes: false });
    const incoming = {
      ...currentMetadata,
      players: {
        0: { id: 0, isConnected: true },
        1: {
          id: 1,
          name: 'Stale peer',
          credentials: 'stale-peer-credential',
          data: { userId: 'u_deleted' },
          isConnected: false,
        },
      },
      setupData: { owner: 'u_deleted', rulesVersion: 'stale' },
      gameover: { winner: 0, actorUserId: 'u_deleted' },
      nextMatchID: 'next_match',
      updatedAt: 10,
    } satisfies Server.MatchData;

    await adapter.setMetadata('match_1', incoming);

    const update = client.query.mock.calls.find(([sql]) => String(sql).startsWith('UPDATE bjg_matches'));
    expect(update?.[1]?.[0]).toBe('match_1');
    const stored = JSON.parse(String(update?.[1]?.[1])) as Server.MatchData;
    expect(JSON.stringify(stored)).not.toContain('u_deleted');
    expect(stored.setupData).toEqual(currentMetadata.setupData);
    expect(stored.players[0]).toEqual({ id: 0, isConnected: true });
    expect(stored.players[1]).toEqual({
      ...currentMetadata.players[1],
      isConnected: false,
    });
    expect(stored.gameover).toEqual({ winner: '0' });
    expect(stored.nextMatchID).toBe('next_match');
    expect(stored.updatedAt).toBe(10);
  });

  it('does not recreate a missing match', async () => {
    const schemaClient = mockClient();
    const client = metadataClient(null);
    const pool = mockPool([schemaClient, client]);
    const adapter = new PostgresAdapter({ pool: pool as never, createIndexes: false });

    await expect(adapter.setMetadata('missing_match', currentMetadata)).resolves.toBeUndefined();

    expect(client.query).toHaveBeenCalledWith(METADATA_MATCH_LOCK_SQL, ['missing_match']);
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO bjg_matches'))).toBe(false);
    expect(client.query.mock.calls.some(([sql]) => String(sql).startsWith('UPDATE bjg_matches'))).toBe(false);
    expect(client.query).toHaveBeenLastCalledWith('COMMIT');
  });

  it('abandons a metadata write when account deletion wins the lock race', async () => {
    const schemaClient = mockClient();
    const client = mockClient(async (sql: string) => {
      if (sql === METADATA_SEAT_ACCOUNT_IDS_SQL) {
        return { rows: [{ player_id: '0', user_id: 'u_deleted' }], rowCount: 1 };
      }
      if (sql === ACCOUNT_ROW_LOCK_SQL) {
        return { rows: [{ id: 'u_deleted', deleted_at: '2026-07-15T00:00:00.000Z' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const pool = mockPool([schemaClient, client]);
    const adapter = new PostgresAdapter({ pool: pool as never, createIndexes: false });

    await expect(adapter.setMetadata('match_1', currentMetadata)).resolves.toBeUndefined();

    expect(client.query.mock.calls.some(([sql]) => String(sql) === METADATA_MATCH_LOCK_SQL)).toBe(false);
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO bjg_matches'))).toBe(false);
    expect(client.query).toHaveBeenLastCalledWith('COMMIT');
  });
});
