import { describe, expect, it, vi } from 'vitest';
import { createPostgresPlatformMatchParticipantStore, resolveMatchTrafficClass } from '../matchParticipantStore';

function poolWithQuery(query: ReturnType<typeof vi.fn>) {
  return {
    query,
    connect: vi.fn(async () => ({ query, release: vi.fn() })),
  };
}

describe('platform match telemetry store', () => {
  it('derives traffic classification only from trusted process configuration', () => {
    expect(resolveMatchTrafficClass({ DEPLOYMENT_ENV: 'production' })).toBe('production');
    expect(resolveMatchTrafficClass({ NODE_ENV: 'test' })).toBe('synthetic');
    expect(resolveMatchTrafficClass({ DEPLOYMENT_ENV: 'production', MATCH_ANALYTICS_TRAFFIC_CLASS: 'operator' })).toBe(
      'operator',
    );
    expect(resolveMatchTrafficClass({ MATCH_ANALYTICS_TRAFFIC_CLASS: 'client-value' })).toBe('unknown');
  });

  it('records trusted provenance and rejects conflicting or missing matches', async () => {
    let invocation = 0;
    const query = vi.fn(async (_sql: string, _params?: unknown[]) => {
      invocation += 1;
      return invocation === 1 ? { rows: [{ source_match_id: 'match-1' }], rowCount: 1 } : { rows: [], rowCount: 0 };
    });
    const store = createPostgresPlatformMatchParticipantStore(poolWithQuery(query) as never, {
      trafficClass: 'production',
    });

    await store.recordMatchProvenance({ boardgameMatchID: ' match-1 ', matchMode: 'quick_match' });
    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("bjg_match_telemetry.match_mode IN ('direct', 'unknown')"),
      ['match-1', 'quick_match', 'production'],
    );
    await expect(store.recordMatchProvenance({ boardgameMatchID: 'match-1', matchMode: 'invite' })).rejects.toThrow(
      'conflicts with an existing classification or missing match',
    );
  });

  it('counts only valid boardgame seats and distinguishes reconnect from disconnect', async () => {
    const query = vi.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [], rowCount: 1 }));
    const store = createPostgresPlatformMatchParticipantStore(poolWithQuery(query) as never, {
      trafficClass: 'synthetic',
    });

    await store.recordMatchConnection({ boardgameMatchID: 'match-1', playerID: '0', event: 'disconnect' });
    await store.recordMatchConnection({ boardgameMatchID: 'match-1', playerID: '0', event: 'join' });
    await store.recordMatchConnection({ boardgameMatchID: 'match-1', playerID: '1', event: 'reconnect' });
    await store.recordMatchConnection({ boardgameMatchID: 'match-1', playerID: 'spectator', event: 'join' });

    expect(query).toHaveBeenCalledTimes(6);
    expect(query.mock.calls[1]?.[0]).toContain('player0_disconnect_count = player0_disconnect_count + 1');
    expect(query.mock.calls[3]?.[0]).toContain(
      "WHEN $2 = 'reconnect' OR player0_disconnect_count > player0_reconnect_count THEN 1",
    );
    expect(query.mock.calls[3]?.[1]).toEqual(['match-1', 'join']);
    expect(query.mock.calls[5]?.[0]).toContain('player1_reconnect_count = player1_reconnect_count + CASE');
    expect(query.mock.calls.flatMap((call) => call[1] ?? [])).not.toContain('spectator');
  });
});
