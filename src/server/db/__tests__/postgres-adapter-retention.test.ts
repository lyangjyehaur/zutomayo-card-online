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

function runtimeState(terminal: boolean) {
  return {
    _stateID: 4,
    G: {
      step: terminal ? 'gameOver' : 'turnSet',
      turnNumber: 3,
      matchStartedAt: 1_000,
      ...(terminal ? { matchEndedAt: 10_000, winner: 0 } : {}),
      actionLog: [],
      players: [{ hp: 100 }, { hp: 80 }],
    },
    ctx: terminal ? { gameover: { winner: 0 } } : {},
  };
}

function initialState() {
  return {
    G: {
      players: [0, 1].map((player) => ({
        deck: Array.from({ length: 15 }, (_, index) => ({
          defId: `card-${player}-${index + 5}`,
          instanceId: `private-${player}-${index + 5}`,
        })),
        hand: Array.from({ length: 5 }, (_, index) => ({
          defId: `card-${player}-${index}`,
          instanceId: `private-${player}-${index}`,
        })),
      })),
    },
  };
}

function matchRow(terminal = true) {
  return {
    match_id: 'match_1',
    state: runtimeState(terminal),
    initial_state: initialState(),
    metadata: { setupData: { rulesVersion: 'rules-v1' } },
    updated_at: new Date('2026-07-31T05:00:00.000Z'),
  };
}

describe('PostgresAdapter result retention', () => {
  it('does not wipe a match while its result is pending delivery', async () => {
    const schemaClient = client();
    const transactionClient = client(async (sql) => {
      if (sql.includes('FROM bjg_matches') && sql.includes('FOR UPDATE')) {
        return { rows: [matchRow()], rowCount: 1 };
      }
      if (sql.includes('FROM bjg_match_result_outbox')) {
        return {
          rows: [
            {
              status: 'pending',
              integrity_sha256: null,
              deck_count: null,
              event_count: null,
              archived_deck_count: '0',
              archived_event_count: '0',
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    });
    const pg = pool([schemaClient, transactionClient]);
    const adapter = new PostgresAdapter({ pool: pg as never, createIndexes: false });

    await expect(adapter.wipe('match_pending')).resolves.toBe(false);

    expect(transactionClient.query).toHaveBeenCalledWith(expect.stringContaining('FOR UPDATE'), [
      'match_pending',
      expect.stringMatching(/^[0-9a-f]{64}$/),
    ]);
    expect(transactionClient.query).not.toHaveBeenCalledWith('DELETE FROM bjg_matches WHERE match_id = $1', [
      'match_pending',
    ]);
    expect(transactionClient.query).toHaveBeenLastCalledWith('COMMIT');
  });

  it('wipes a terminal match only after its anonymous archive reconciles', async () => {
    const schemaClient = client();
    const transactionClient = client(async (sql) => {
      if (sql.includes('FROM bjg_matches') && sql.includes('FOR UPDATE')) {
        return { rows: [matchRow()], rowCount: 1 };
      }
      if (sql.includes('FROM bjg_match_result_outbox')) {
        return {
          rows: [
            {
              status: 'unrated',
              integrity_sha256: 'a'.repeat(64),
              deck_count: 2,
              event_count: 17,
              archived_deck_count: '2',
              archived_event_count: '17',
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    });
    const pg = pool([schemaClient, transactionClient]);
    const adapter = new PostgresAdapter({ pool: pg as never, createIndexes: false });

    await expect(adapter.wipe('match_delivered')).resolves.toBe(true);

    expect(transactionClient.query).toHaveBeenCalledWith('DELETE FROM bjg_matches WHERE match_id = $1', [
      'match_delivered',
    ]);
    expect(transactionClient.query).toHaveBeenLastCalledWith('COMMIT');
  });

  it('retains a terminal match when its anonymous archive is missing or incomplete', async () => {
    const schemaClient = client();
    const transactionClient = client(async (sql) => {
      if (sql.includes('FROM bjg_matches') && sql.includes('FOR UPDATE')) {
        return { rows: [matchRow()], rowCount: 1 };
      }
      if (sql.includes('FROM bjg_match_result_outbox')) {
        return {
          rows: [
            {
              status: 'delivered',
              integrity_sha256: 'a'.repeat(64),
              deck_count: 2,
              event_count: 17,
              archived_deck_count: '2',
              archived_event_count: '16',
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    });
    const pg = pool([schemaClient, transactionClient]);
    const adapter = new PostgresAdapter({ pool: pg as never, createIndexes: false });

    await expect(adapter.wipe('match_incomplete_archive')).resolves.toBe(false);

    expect(transactionClient.query).not.toHaveBeenCalledWith('DELETE FROM bjg_matches WHERE match_id = $1', [
      'match_incomplete_archive',
    ]);
    expect(transactionClient.query).toHaveBeenLastCalledWith('COMMIT');
  });

  it('archives a stale unfinished room as abandoned before removing runtime state', async () => {
    let sourceDigest = '';
    let integrityDigest = '';
    let eventCount = 0;
    const schemaClient = client();
    const transactionClient = client(async (sql, params) => {
      if (sql.includes('FROM bjg_matches') && sql.includes('FOR UPDATE')) {
        return { rows: [matchRow(false)], rowCount: 1 };
      }
      if (sql.includes('FROM bjg_match_result_outbox')) return { rows: [], rowCount: 0 };
      if (sql.includes('FROM bjg_match_seats')) {
        return {
          rows: [
            {
              match_id: 'match_unfinished',
              player_id: '0',
              user_id: 'u-alice',
              ranked_eligible: true,
              credential_hash: 'private',
              resume_count: 2,
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes('FROM bjg_match_telemetry')) {
        return {
          rows: [
            {
              match_mode: 'custom_room',
              traffic_class: 'production',
              player0_disconnect_count: 1,
              player1_disconnect_count: 0,
              player0_reconnect_count: 1,
              player1_reconnect_count: 0,
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.startsWith('INSERT INTO match_analytics (')) {
        sourceDigest = String(params?.[0]);
        eventCount = Number(params?.[27]);
        integrityDigest = String(params?.[29]);
        return { rows: [{ integrity_sha256: integrityDigest }], rowCount: 1 };
      }
      if (sql.includes('FROM match_analytics analytics')) {
        return {
          rows: [
            {
              integrity_sha256: integrityDigest,
              deck_count: 2,
              event_count: eventCount,
              archived_deck_count: '2',
              archived_event_count: String(eventCount),
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    });
    const pg = pool([schemaClient, transactionClient]);
    const adapter = new PostgresAdapter({ pool: pg as never, createIndexes: false });

    await expect(adapter.wipe('match_unfinished')).resolves.toBe(true);

    expect(transactionClient.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO match_analytics ('),
      expect.arrayContaining([sourceDigest, 'abandoned', 'inactive-room']),
    );
    expect(transactionClient.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO match_analytics ('),
      expect.arrayContaining(['production', 'custom_room', [1, 0], [1, 0], [2, 0]]),
    );
    expect(transactionClient.query).toHaveBeenCalledWith('DELETE FROM bjg_matches WHERE match_id = $1', [
      'match_unfinished',
    ]);
  });

  it('retains a terminal state when its outbox and analytics archive are missing', async () => {
    const schemaClient = client();
    const transactionClient = client(async (sql) => {
      if (sql.includes('FROM bjg_matches') && sql.includes('FOR UPDATE')) {
        return { rows: [matchRow(true)], rowCount: 1 };
      }
      if (sql.includes('FROM bjg_match_result_outbox')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    });
    const pg = pool([schemaClient, transactionClient]);
    const adapter = new PostgresAdapter({ pool: pg as never, createIndexes: false });

    await expect(adapter.wipe('match_terminal_without_archive')).resolves.toBe(false);

    expect(transactionClient.query).not.toHaveBeenCalledWith(
      'DELETE FROM bjg_matches WHERE match_id = $1',
      expect.anything(),
    );
    expect(transactionClient.query).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO match_analytics ('),
      expect.anything(),
    );
  });

  it('retains an unfinished room when abandoned projection cannot prove two deck snapshots', async () => {
    const broken = matchRow(false);
    broken.initial_state = { G: { players: [] } } as never;
    const schemaClient = client();
    const transactionClient = client(async (sql) => {
      if (sql.includes('FROM bjg_matches') && sql.includes('FOR UPDATE')) {
        return { rows: [broken], rowCount: 1 };
      }
      if (sql.includes('FROM bjg_match_result_outbox')) return { rows: [], rowCount: 0 };
      if (sql.includes('FROM bjg_match_seats')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    });
    const pg = pool([schemaClient, transactionClient]);
    const adapter = new PostgresAdapter({ pool: pg as never, createIndexes: false });

    await expect(adapter.wipe('match_broken_unfinished')).resolves.toBe(false);

    expect(transactionClient.query).not.toHaveBeenCalledWith(
      'DELETE FROM bjg_matches WHERE match_id = $1',
      expect.anything(),
    );
  });
});
