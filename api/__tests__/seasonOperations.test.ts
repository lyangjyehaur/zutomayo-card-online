import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { activateSeason, claimSeasonReward, closeSeason, createSeason, rewardForRank } =
  require('../seasonService.cjs') as {
    activateSeason: (input: Record<string, unknown>) => Promise<unknown>;
    claimSeasonReward: (input: Record<string, unknown>) => Promise<unknown>;
    closeSeason: (input: Record<string, unknown>) => Promise<unknown>;
    createSeason: (input: Record<string, unknown>) => Promise<unknown>;
    rewardForRank: (config: unknown, rank: number) => { id: string } | null;
  };

function transactionPool(
  handler: (sql: string, params?: unknown[]) => { rows?: Record<string, unknown>[]; rowCount?: number },
) {
  const query = vi.fn(async (sql: string, params?: unknown[]) => ({ rows: [], rowCount: 0, ...handler(sql, params) }));
  return { query, connect: vi.fn(async () => ({ query, release: vi.fn() })) };
}

describe('season operations', () => {
  it('normalizes rank tiers and picks the first matching reward', () => {
    const config = {
      tiers: [
        { id: 'top-100', maxRank: 100, payload: { badge: 'silver' } },
        { id: 'champion', maxRank: 1, payload: { badge: 'gold' } },
      ],
    };
    expect(rewardForRank(config, 1)).toMatchObject({ id: 'champion' });
    expect(rewardForRank(config, 20)).toMatchObject({ id: 'top-100' });
    expect(rewardForRank(config, 101)).toBeNull();
  });

  it('creates a validated scheduled season with immutable rules metadata', async () => {
    const pool = transactionPool((sql) =>
      sql.includes('INSERT INTO seasons') ? { rows: [{ id: 'season-2026-1', status: 'scheduled' }] } : {},
    );
    await expect(
      createSeason({
        pool,
        adminUserId: 'admin_1',
        id: 'season-2026-1',
        name: 'Season 1',
        startsAt: '2026-01-01T00:00:00Z',
        endsAt: '2026-02-01T00:00:00Z',
        startingRating: 1000,
        placementMatches: 5,
        ratingDecayPercent: 25,
        rulesVersion: 'rules-1',
        rewardConfig: { tiers: [{ id: 'champion', maxRank: 1, payload: { badge: 'gold' } }] },
      }),
    ).resolves.toMatchObject({ ok: true, body: { season: { id: 'season-2026-1' } } });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('rules_version'),
      expect.arrayContaining(['rules-1']),
    );
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO admin_audit_log'), [
      'admin_1',
      'season.create',
      'season-2026-1',
      expect.stringContaining('rules-1'),
    ]);
  });

  it('activates one scheduled season and seeds decayed ratings from the previous season', async () => {
    const pool = transactionPool((sql) => {
      if (sql.includes('FROM seasons WHERE id')) {
        return {
          rows: [
            {
              id: 's2',
              status: 'scheduled',
              starts_at: '2026-01-01T00:00:00Z',
              ends_at: '2999-01-01T00:00:00Z',
              starting_rating: 1000,
              rating_decay_percent: 25,
            },
          ],
        };
      }
      if (sql.includes("status = 'active' AND id <>")) return { rows: [] };
      if (sql.includes("status = 'closed'")) return { rows: [{ id: 's1', starting_rating: 1000 }] };
      if (sql.includes('INSERT INTO season_ratings')) return { rowCount: 42 };
      return {};
    });

    await expect(activateSeason({ pool, seasonId: 's2' })).resolves.toEqual({
      ok: true,
      body: { activated: true, seasonId: 's2', seededRatings: 42 },
    });
    expect(pool.query).toHaveBeenCalledWith("SELECT pg_advisory_xact_lock(hashtext('season-lifecycle'))");
  });

  it('closes an active season and grants each ranked reward once', async () => {
    const pool = transactionPool((sql) => {
      if (sql.includes('SELECT id, status, reward_config')) {
        return {
          rows: [
            {
              id: 's1',
              status: 'active',
              reward_config: { tiers: [{ id: 'top2', maxRank: 2 }] },
              starts_at: '2026-01-01T00:00:00Z',
              ends_at: '2026-02-01T00:00:00Z',
              rules_version: 'rules-1',
              has_ended: true,
            },
          ],
        };
      }
      if (sql.includes('AS pending_count')) return { rows: [{ pending_count: 0, unapplied_count: 0 }] };
      if (sql.includes('FROM season_ratings')) {
        return {
          rows: [
            { user_id: 'u1', rating: 1200 },
            { user_id: 'u2', rating: 1100 },
          ],
        };
      }
      if (sql.includes('INSERT INTO season_rewards')) return { rowCount: 1 };
      return {};
    });

    await expect(closeSeason({ pool, seasonId: 's1' })).resolves.toEqual({
      ok: true,
      body: { closed: true, seasonId: 's1', rewardCount: 2, playerCount: 2 },
    });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO season_reward_entitlements'), ['s1']);
  });

  it('claims a reward idempotently', async () => {
    const pool = transactionPool((sql) => {
      if (sql.includes('FROM season_rewards') && sql.includes('FOR UPDATE')) {
        return { rows: [{ reward_tier: 'top2', reward_payload: { badge: 'gold' }, claimed_at: null }] };
      }
      if (sql.includes('INSERT INTO season_reward_entitlements')) {
        return {
          rows: [{ id: 7, reward_tier: 'top2', reward_payload: { badge: 'gold' }, granted_at: '2026-01-02' }],
        };
      }
      if (sql.includes('UPDATE season_rewards')) return { rows: [{ claimed_at: '2026-01-02' }] };
      return {};
    });
    await expect(claimSeasonReward({ pool, userId: 'u1', seasonId: 's1' })).resolves.toMatchObject({
      ok: true,
      body: { claimed: true, reward: { reward_tier: 'top2' } },
    });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE season_rewards'), ['s1', 'u1']);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO season_reward_entitlements'), [
      's1',
      'u1',
      'top2',
      JSON.stringify({ badge: 'gold' }),
    ]);
  });

  it('keeps an ended season settling until every canonical result is applied', async () => {
    const pool = transactionPool((sql) => {
      if (sql.includes('SELECT id, status, reward_config')) {
        return {
          rows: [
            {
              id: 's1',
              status: 'active',
              reward_config: { tiers: [] },
              starts_at: '2026-01-01T00:00:00Z',
              ends_at: '2026-02-01T00:00:00Z',
              rules_version: 'rules-1',
              has_ended: true,
            },
          ],
        };
      }
      if (sql.includes('AS pending_count')) return { rows: [{ pending_count: 2, unapplied_count: 1 }] };
      return {};
    });

    await expect(closeSeason({ pool, seasonId: 's1', adminUserId: 'admin_1' })).resolves.toEqual({
      ok: true,
      body: {
        closed: false,
        settling: true,
        seasonId: 's1',
        pendingResults: 2,
        unappliedResults: 1,
      },
    });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("SET status = 'settling'"), ['s1']);
    expect(pool.query).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO season_rewards'),
      expect.anything(),
    );
  });

  it('does not close a settling season before its scheduled end', async () => {
    const pool = transactionPool((sql) => {
      if (sql.includes('SELECT id, status, reward_config')) {
        return {
          rows: [
            {
              id: 's1',
              status: 'settling',
              reward_config: { tiers: [] },
              starts_at: '2026-01-01T00:00:00Z',
              ends_at: '2999-02-01T00:00:00Z',
              rules_version: 'rules-1',
              has_ended: false,
            },
          ],
        };
      }
      return {};
    });

    await expect(closeSeason({ pool, seasonId: 's1' })).resolves.toEqual({
      ok: false,
      status: 409,
      error: 'Season cannot close before its scheduled end',
    });
    expect(pool.query).not.toHaveBeenCalledWith(expect.stringContaining('AS pending_count'), expect.anything());
  });
});
