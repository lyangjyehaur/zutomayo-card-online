import crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { State } from 'boardgame.io';
import { MatchSeatReservationError, PostgresAdapter } from '../postgres-adapter';

type MockClient = {
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
};

function mockClient(
  handler?: (sql: string, params?: unknown[]) => Promise<unknown>,
  accountRow: Record<string, unknown> | null = { deleted_at: null, elo: 1000 },
): MockClient {
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql === 'SELECT * FROM users WHERE id = $1 FOR UPDATE') {
        const row = accountRow ? { id: params?.[0], ...accountRow } : null;
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }
      return handler?.(sql, params) ?? { rows: [], rowCount: 1 };
    }),
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
      players: [{ hp: 80 }, { hp: 0 }],
      actionLog: [{ action: 'finish' }],
    },
    ctx: { gameover: { winner: 0 } },
  } as never;
}

function initialStateForAnalytics(): State {
  const player = (seat: number) => ({
    deck: Array.from({ length: 15 }, (_, index) => ({ defId: `card-${seat}-${index}` })),
    hand: Array.from({ length: 5 }, (_, index) => ({ defId: `card-${seat}-${index + 15}` })),
  });
  return { G: { players: [player(0), player(1)] } } as never;
}

function stateBeforeDeckBind() {
  const makePlayer = () => ({
    hp: 100,
    deck: [],
    hand: [],
    battleZone: null,
  });
  return {
    _stateID: 0,
    G: {
      players: [makePlayer(), makePlayer()],
      rng: { algorithm: 'mulberry32-v1', seed: 123, counter: 38 },
      replayManifest: {
        schemaVersion: 1,
        rngAlgorithm: 'mulberry32-v1',
        seed: 123,
        rulesVersion: 'rules-v1',
        deckDefIds: [
          Array.from({ length: 20 }, (_, index) => `host-card-${index}`),
          Array.from({ length: 20 }, (_, index) => `placeholder-card-${index}`),
        ],
      },
      step: 'janken',
      turnNumber: 1,
    },
    ctx: {},
  };
}

describe('PostgresAdapter trust-chain transactions', () => {
  it('serializes rematch creation with a transaction-scoped advisory lock', async () => {
    const schemaClient = mockClient();
    const lockClient = mockClient();
    const pool = mockPool([schemaClient, lockClient]);
    const adapter = new PostgresAdapter({ pool: pool as never, createIndexes: false });
    const operation = vi.fn(async () => 'next-match');

    await expect(adapter.withRematchLock('match_1', operation)).resolves.toBe('next-match');

    expect(lockClient.query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(lockClient.query).toHaveBeenNthCalledWith(2, 'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      'match_1',
    ]);
    expect(lockClient.query).toHaveBeenLastCalledWith('COMMIT');
    expect(operation).toHaveBeenCalledOnce();
    expect(lockClient.release).toHaveBeenCalledOnce();
  });

  it('shuffles a reserved deck and marks only the opening hand face up', async () => {
    const initialState = stateBeforeDeckBind();
    const state = structuredClone(initialState);
    const matchMetadata = {
      ...metadata(),
      setupData: { rulesVersion: 'rules-v1' },
    };
    const schemaClient = mockClient();
    const transactionClient = mockClient(async (sql) => {
      if (sql.includes('SELECT match_id, state, initial_state, metadata')) {
        return {
          rows: [{ match_id: 'match_1', state, initial_state: initialState, metadata: matchMetadata }],
          rowCount: 1,
        };
      }
      if (sql.includes('FROM bjg_match_seats')) {
        return {
          rows: [{ match_id: 'match_1', player_id: '1', user_id: 'u_bob', ranked_eligible: true }],
          rowCount: 1,
        };
      }
      if (sql.includes('FROM deck_reservations')) {
        return {
          rows: [
            {
              id: 'dr_fixed',
              user_id: 'u_bob',
              deck_version: 'deck-v1',
              rules_version: 'rules-v1',
              card_ids: Array.from({ length: 20 }, (_, index) => `card-${index}`),
              expires_at: new Date(Date.now() + 60_000),
              match_id: null,
              player_id: null,
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    });
    const pool = mockPool([schemaClient, transactionClient]);
    const adapter = new PostgresAdapter({ pool: pool as never, createIndexes: false });
    const randomSpy = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('deck binding must not use global Math.random');
    });

    try {
      await adapter.bindDeckReservation({
        matchID: 'match_1',
        playerID: '1',
        userId: 'u_bob',
        reservationId: 'dr_fixed',
        rulesVersion: 'rules-v1',
      });
    } finally {
      randomSpy.mockRestore();
    }

    const update = transactionClient.query.mock.calls.find(([sql]) => String(sql).startsWith('UPDATE bjg_matches'));
    expect(update).toBeDefined();
    const persistedState = JSON.parse(String(update?.[1]?.[1])) as typeof state;
    const persistedInitial = JSON.parse(String(update?.[1]?.[2])) as typeof initialState;
    const player = persistedState.G.players[1];
    const initialPlayer = persistedInitial.G.players[1];
    expect(player.hand).toHaveLength(5);
    expect(player.deck).toHaveLength(15);
    expect(player.hand.every((card: { faceUp: boolean }) => card.faceUp)).toBe(true);
    expect(player.deck.every((card: { faceUp: boolean }) => !card.faceUp)).toBe(true);
    expect(
      player.hand
        .map((card: { defId: string }) => card.defId)
        .concat(player.deck.map((card: { defId: string }) => card.defId)),
    ).not.toEqual(Array.from({ length: 20 }, (_, index) => `card-${index}`));
    expect(initialPlayer.hand).toEqual(player.hand);
    expect(initialPlayer.deck).toEqual(player.deck);
    expect(persistedState.G.replayManifest.deckDefIds[1]).toEqual(
      Array.from({ length: 20 }, (_, index) => `card-${index}`),
    );
    expect(persistedInitial.G.replayManifest).toEqual(persistedState.G.replayManifest);
    expect(persistedInitial.G.rng).toEqual(persistedState.G.rng);
    expect(transactionClient.query).toHaveBeenLastCalledWith('COMMIT');
  });

  it('validates and binds a local deck while reserving the joining seat', async () => {
    const localDeckIds = Array.from({ length: 10 }, (_, index) => `card-${index}`).flatMap((id) => [id, id]);
    const initialState = stateBeforeDeckBind();
    const state = structuredClone(initialState);
    const matchMetadata = metadata();
    const schemaClient = mockClient();
    const transactionClient = mockClient(async (sql) => {
      if (sql.includes('FROM bjg_matches') && sql.includes('FOR UPDATE')) {
        return {
          rows: [{ match_id: 'match_1', state, initial_state: initialState, metadata: matchMetadata }],
          rowCount: 1,
        };
      }
      if (sql.includes('FROM bjg_match_seats')) return { rows: [], rowCount: 0 };
      if (sql.startsWith('SELECT id FROM cards')) {
        return { rows: [...new Set(localDeckIds)].map((id) => ({ id })), rowCount: 10 };
      }
      return { rows: [], rowCount: 1 };
    });
    const pool = mockPool([schemaClient, transactionClient]);
    const adapter = new PostgresAdapter({ pool: pool as never, createIndexes: false });

    await expect(
      adapter.reserveMatchSeat({
        matchID: 'match_1',
        playerID: '1',
        playerName: 'Local Player',
        playerData: { userId: 'guest:local', identitySource: 'server' },
        userId: 'guest:local',
        rankedEligible: false,
        credentials: 'credential-local',
        localDeckIds,
        deckRulesVersion: 'rules-v1',
      }),
    ).resolves.toMatchObject({ playerID: '1', userId: 'guest:local' });

    const update = transactionClient.query.mock.calls.find(([sql]) => String(sql).startsWith('UPDATE bjg_matches'));
    expect(update).toBeDefined();
    const persistedState = JSON.parse(String(update?.[1]?.[1])) as typeof state;
    expect(persistedState.G.players[1].hand).toHaveLength(5);
    expect(persistedState.G.players[1].deck).toHaveLength(15);
    expect(transactionClient.query).toHaveBeenCalledWith('SELECT id FROM cards WHERE id = ANY($1::text[])', [
      [...new Set(localDeckIds)],
    ]);
    expect(transactionClient.query).toHaveBeenLastCalledWith('COMMIT');
  });

  it('rolls back the seat when reservation ownership fails in the same transaction', async () => {
    const initialState = stateBeforeDeckBind();
    const schemaClient = mockClient();
    const transactionClient = mockClient(async (sql) => {
      if (sql.includes('FROM bjg_matches') && sql.includes('state, initial_state')) {
        return {
          rows: [
            {
              match_id: 'match_1',
              state: initialState,
              initial_state: structuredClone(initialState),
              metadata: metadata(),
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes('FROM bjg_match_seats')) return { rows: [], rowCount: 0 };
      if (sql.includes('FROM deck_reservations')) {
        return {
          rows: [
            {
              id: 'dr_fixed',
              user_id: 'u_other',
              deck_version: 'deck-v1',
              rules_version: 'rules-v1',
              card_ids: Array.from({ length: 20 }, (_, index) => `card-${index}`),
              expires_at: new Date(Date.now() + 60_000),
              match_id: null,
              player_id: null,
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
      adapter.reserveMatchSeat({
        matchID: 'match_1',
        playerID: '1',
        playerName: 'Bob',
        playerData: { userId: 'u_bob', identitySource: 'server' },
        userId: 'u_bob',
        rankedEligible: true,
        credentials: 'credential-b',
        deckReservationId: 'dr_fixed',
        deckRulesVersion: 'rules-v1',
      }),
    ).rejects.toMatchObject({ reason: 'identity_mismatch' });
    expect(transactionClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(transactionClient.query).not.toHaveBeenLastCalledWith('COMMIT');
  });

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

  it('rejects a deleted account before locking or writing the match seat', async () => {
    const schemaClient = mockClient();
    const transactionClient = mockClient(undefined, {
      deleted_at: '2026-07-13T00:00:00.000Z',
      elo: 1000,
    });
    const pool = mockPool([schemaClient, transactionClient]);
    const adapter = new PostgresAdapter({ pool: pool as never, createIndexes: false });

    await expect(
      adapter.reserveMatchSeat({
        matchID: 'match_1',
        playerID: '0',
        playerName: 'Deleted',
        playerData: { userId: 'u_deleted', identitySource: 'server' },
        userId: 'u_deleted',
        rankedEligible: true,
        credentials: 'credential-deleted',
      }),
    ).rejects.toMatchObject({ reason: 'identity_mismatch' });
    expect(transactionClient.query.mock.calls.some(([sql]) => String(sql).includes('FROM bjg_matches'))).toBe(false);
    expect(transactionClient.query).toHaveBeenCalledWith('ROLLBACK');
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

    const write = transactionClient.query.mock.calls.find(([sql]) => String(sql).startsWith('INSERT INTO bjg_matches'));
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
    expect(
      transactionClient.query.mock.calls.find(([sql]) => String(sql).includes('UPDATE bjg_match_seats'))?.[0],
    ).toContain('resume_count = resume_count + 1');
  });

  it('writes terminal state and canonical outbox row in the same transaction', async () => {
    const schemaClient = mockClient();
    const transactionClient = mockClient(async (sql) => {
      if (sql.startsWith('SELECT metadata, initial_state FROM bjg_matches')) {
        return {
          rows: [
            {
              metadata: { setupData: { rulesVersion: 'legacy' } },
              initial_state: initialStateForAnalytics(),
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes('FROM bjg_match_seats')) {
        return {
          rows: [
            { match_id: 'match_1', player_id: '0', user_id: 'u_alice', ranked_eligible: true, resume_count: 3 },
            { match_id: 'match_1', player_id: '1', user_id: 'u_bob', ranked_eligible: true, resume_count: 4 },
          ],
          rowCount: 2,
        };
      }
      if (sql.includes('FROM bjg_match_telemetry')) {
        return {
          rows: [
            {
              match_mode: 'quick_match',
              traffic_class: 'operator',
              player0_disconnect_count: 2,
              player1_disconnect_count: 1,
              player0_reconnect_count: 1,
              player1_reconnect_count: 1,
            },
          ],
          rowCount: 1,
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
        '1970-01-01T00:00:06.000Z',
        'legacy',
        JSON.stringify([{ action: 'finish' }]),
        1,
        'pending',
        null,
      ],
    );
    expect(transactionClient.query).toHaveBeenLastCalledWith('COMMIT');
    expect(transactionClient.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO match_analytics ('),
      expect.arrayContaining(['operator', 'quick_match', [2, 1], [1, 1], [3, 4]]),
    );
  });

  it('marks eligible results unrated when ranked delivery is disabled', async () => {
    const schemaClient = mockClient();
    const transactionClient = mockClient(async (sql) => {
      if (sql.startsWith('SELECT metadata, initial_state FROM bjg_matches')) {
        return {
          rows: [{ metadata: { setupData: { rulesVersion: 'legacy' } }, initial_state: initialStateForAnalytics() }],
          rowCount: 1,
        };
      }
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

  it('treats a duplicate terminal callback with the same integrity digest as idempotent', async () => {
    let integritySha256 = '';
    const schemaClient = mockClient();
    const transactionClient = mockClient(async (sql, params) => {
      if (sql.startsWith('SELECT metadata, initial_state FROM bjg_matches')) {
        return {
          rows: [{ metadata: { setupData: { rulesVersion: 'legacy' } }, initial_state: initialStateForAnalytics() }],
          rowCount: 1,
        };
      }
      if (sql.includes('FROM bjg_match_seats')) return { rows: [], rowCount: 0 };
      if (sql.startsWith('INSERT INTO match_analytics (')) {
        integritySha256 = String(params?.[29]);
        return { rows: [], rowCount: 0 };
      }
      if (sql.startsWith('SELECT integrity_sha256 FROM match_analytics')) {
        return { rows: [{ integrity_sha256: integritySha256 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    const pool = mockPool([schemaClient, transactionClient]);
    const adapter = new PostgresAdapter({ pool: pool as never, createIndexes: false });

    await expect(adapter.setState('match_1', stateWithWinner())).resolves.toBeUndefined();

    expect(transactionClient.query).toHaveBeenCalledWith(
      'SELECT integrity_sha256 FROM match_analytics WHERE source_match_digest = $1',
      [expect.stringMatching(/^[0-9a-f]{64}$/)],
    );
    expect(transactionClient.query).toHaveBeenLastCalledWith('COMMIT');
  });

  it('rolls back terminal state when anonymous analytics capture fails', async () => {
    const schemaClient = mockClient();
    const transactionClient = mockClient(async (sql) => {
      if (sql.startsWith('SELECT metadata, initial_state FROM bjg_matches')) {
        return {
          rows: [{ metadata: { setupData: { rulesVersion: 'legacy' } }, initial_state: initialStateForAnalytics() }],
          rowCount: 1,
        };
      }
      if (sql.includes('FROM bjg_match_seats')) return { rows: [], rowCount: 0 };
      if (sql.startsWith('INSERT INTO match_analytics (')) throw new Error('analytics unavailable');
      return { rows: [], rowCount: 1 };
    });
    const pool = mockPool([schemaClient, transactionClient]);
    const adapter = new PostgresAdapter({ pool: pool as never, createIndexes: false });

    await expect(adapter.setState('match_1', stateWithWinner())).rejects.toThrow('analytics unavailable');

    expect(transactionClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(transactionClient.query).not.toHaveBeenCalledWith('COMMIT');
  });
});
