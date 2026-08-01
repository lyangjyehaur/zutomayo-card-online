import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { auditRef, expectedCount, runLegacyTombstoneBackfill } =
  require('../backfill-legacy-deleted-accounts-pg.cjs') as {
    auditRef: (userId: string) => string;
    expectedCount: (value: unknown) => number | null;
    runLegacyTombstoneBackfill: (input: {
      pool: { query: ReturnType<typeof vi.fn> };
      env?: Record<string, string | undefined>;
      backfill?: (input: { pool: unknown; userId: string }) => Promise<Record<string, unknown>>;
    }) => Promise<{ reviewed: number; backfilled: number }>;
  };

describe('legacy deleted-account backfill gate', () => {
  it('accepts only safe non-negative integer review counts', () => {
    expect(expectedCount('0')).toBe(0);
    expect(expectedCount('2')).toBe(2);
    expect(expectedCount('-1')).toBeNull();
    expect(expectedCount('1.5')).toBeNull();
    expect(expectedCount('01')).toBeNull();
    expect(expectedCount('1e2')).toBeNull();
    expect(expectedCount('not-a-count')).toBeNull();
  });

  it('is a no-op without approval when no legacy tombstones are pending', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const backfill = vi.fn();

    await expect(runLegacyTombstoneBackfill({ pool, env: {}, backfill })).resolves.toEqual({
      reviewed: 0,
      backfilled: 0,
    });
    expect(backfill).not.toHaveBeenCalled();
  });

  it('fails closed when pending tombstones have not been explicitly approved', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'private-user-1' }] }) };
    const backfill = vi.fn();

    await expect(runLegacyTombstoneBackfill({ pool, env: {}, backfill })).rejects.toThrow(
      'set LEGACY_TOMBSTONE_BACKFILL_APPROVED=true',
    );
    expect(backfill).not.toHaveBeenCalled();
  });

  it('fails closed when the reviewed count has drifted', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'private-user-1' }, { id: 'private-user-2' }] }) };
    const backfill = vi.fn();

    await expect(
      runLegacyTombstoneBackfill({
        pool,
        env: {
          LEGACY_TOMBSTONE_BACKFILL_APPROVED: 'true',
          LEGACY_TOMBSTONE_BACKFILL_EXPECTED_COUNT: '1',
        },
        backfill,
      }),
    ).rejects.toThrow('expected 1, found 2');
    expect(backfill).not.toHaveBeenCalled();
  });

  it('backfills every reviewed tombstone and verifies that none remain', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: 'private-user-1' }, { id: 'private-user-2' }] })
        .mockResolvedValueOnce({ rows: [] }),
    };
    const backfill = vi.fn().mockResolvedValue({ ok: true });

    await expect(
      runLegacyTombstoneBackfill({
        pool,
        env: {
          LEGACY_TOMBSTONE_BACKFILL_APPROVED: 'true',
          LEGACY_TOMBSTONE_BACKFILL_EXPECTED_COUNT: '2',
        },
        backfill,
      }),
    ).resolves.toEqual({ reviewed: 2, backfilled: 2 });
    expect(backfill.mock.calls.map(([input]) => input.userId)).toEqual(['private-user-1', 'private-user-2']);
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  it('reports a hash reference without leaking a failed account id or nested error', async () => {
    const userId = 'sensitive-account-id';
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ id: userId }] }) };
    const backfill = vi.fn().mockRejectedValue(new Error(`database rejected ${userId}`));

    let failure: Error | undefined;
    try {
      await runLegacyTombstoneBackfill({
        pool,
        env: {
          LEGACY_TOMBSTONE_BACKFILL_APPROVED: 'true',
          LEGACY_TOMBSTONE_BACKFILL_EXPECTED_COUNT: '1',
        },
        backfill,
      });
    } catch (error) {
      failure = error as Error;
    }

    expect(failure?.message).toContain(auditRef(userId));
    expect(failure?.message).not.toContain(userId);
    expect(failure?.message).not.toContain('database rejected');
  });
});
