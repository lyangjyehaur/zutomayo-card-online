import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { applyCanonicalSeasonResult } = require('../seasonResultService.cjs') as {
  applyCanonicalSeasonResult: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

function clientForResult(
  options: {
    season?: Record<string, unknown>;
    configuredSeason?: Record<string, unknown>;
    existing?: Record<string, unknown>;
  } = {},
) {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes('FROM season_match_results') && sql.includes('WHERE source_match_id')) {
        return { rows: options.existing ? [options.existing] : [], rowCount: options.existing ? 1 : 0 };
      }
      if (sql.includes('FROM seasons') && sql.includes('FOR SHARE')) {
        return { rows: options.season ? [options.season] : [], rowCount: options.season ? 1 : 0 };
      }
      if (sql.includes('FROM seasons') && sql.includes('SELECT id, status')) {
        return {
          rows: options.configuredSeason ? [options.configuredSeason] : [],
          rowCount: options.configuredSeason ? 1 : 0,
        };
      }
      if (sql.includes('FROM season_ratings') && sql.includes('FOR UPDATE')) {
        return {
          rows: [
            { user_id: 'u_loser', rating: 1000, match_count: 0 },
            { user_id: 'u_winner', rating: 1000, match_count: 0 },
          ],
          rowCount: 2,
        };
      }
      return { rows: [], rowCount: 1 };
    }),
  };
}

describe('canonical season result application', () => {
  it('resolves the season from authoritative completion time and rules version', async () => {
    const client = clientForResult({
      season: { id: 'season_1', starting_rating: 1000, placement_matches: 5, rules_version: 'rules-1' },
    });

    await expect(
      applyCanonicalSeasonResult({
        client,
        sourceMatchId: 'source_1',
        canonicalMatchId: 'match_1',
        completedAt: '2026-01-31T23:59:59.999Z',
        rulesVersion: 'rules-1',
        winnerId: 'u_winner',
        loserId: 'u_loser',
      }),
    ).resolves.toMatchObject({
      applied: true,
      seasonId: 'season_1',
      winnerRating: 1016,
      loserRating: 984,
    });

    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('starts_at <= $1'), [
      '2026-01-31T23:59:59.999Z',
      'rules-1',
    ]);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO season_match_results'), [
      'season_1',
      'source_1',
      'match_1',
      'u_winner',
      'u_loser',
      16,
      -16,
      '2026-01-31T23:59:59.999Z',
      'rules-1',
      1000,
      1016,
      1000,
      984,
    ]);
  });

  it('does not fall into the currently active season when the completion window does not match', async () => {
    const client = clientForResult();
    await expect(
      applyCanonicalSeasonResult({
        client,
        sourceMatchId: 'source_boundary',
        canonicalMatchId: 'match_boundary',
        completedAt: '2026-02-01T00:00:00.000Z',
        rulesVersion: 'rules-1',
        winnerId: 'u_winner',
        loserId: 'u_loser',
      }),
    ).resolves.toEqual({ applied: false, reason: 'no-matching-season' });
    expect(client.query).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE season_ratings'), expect.anything());
  });

  it('treats source match identity as globally idempotent before resolving a season', async () => {
    const client = clientForResult({
      existing: { season_id: 'season_1', winner_delta: 16, loser_delta: -16 },
    });
    await expect(
      applyCanonicalSeasonResult({
        client,
        sourceMatchId: 'source_1',
        canonicalMatchId: 'match_1',
        completedAt: '2026-03-01T00:00:00.000Z',
        rulesVersion: 'rules-2',
        winnerId: 'u_winner',
        loserId: 'u_loser',
      }),
    ).resolves.toMatchObject({ applied: false, reason: 'duplicate', seasonId: 'season_1' });
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('FROM seasons'))).toBe(false);
  });

  it('rejects a duplicate source id that points at different immutable result evidence', async () => {
    const client = clientForResult({
      existing: {
        season_id: 'season_1',
        canonical_match_id: 'match_other',
        winner_user_id: 'u_winner',
        loser_user_id: 'u_loser',
        completed_at: '2026-03-01T00:00:00.000Z',
        rules_version: 'rules-2',
      },
    });
    await expect(
      applyCanonicalSeasonResult({
        client,
        sourceMatchId: 'source_1',
        canonicalMatchId: 'match_1',
        completedAt: '2026-03-01T00:00:00.000Z',
        rulesVersion: 'rules-2',
        winnerId: 'u_winner',
        loserId: 'u_loser',
      }),
    ).rejects.toThrow('Season result identity conflict for source match source_1');
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('FROM seasons'))).toBe(false);
  });

  it('returns a retryable state when a configured season is not active or settling yet', async () => {
    const client = clientForResult({ configuredSeason: { id: 'season_waiting', status: 'scheduled' } });
    await expect(
      applyCanonicalSeasonResult({
        client,
        sourceMatchId: 'source_waiting',
        canonicalMatchId: 'match_waiting',
        completedAt: '2026-04-01T00:00:00.000Z',
        rulesVersion: 'rules-waiting',
        winnerId: 'u_winner',
        loserId: 'u_loser',
      }),
    ).resolves.toMatchObject({
      applied: false,
      reason: 'season-not-settled',
      seasonId: 'season_waiting',
      seasonStatus: 'scheduled',
    });
  });
});
