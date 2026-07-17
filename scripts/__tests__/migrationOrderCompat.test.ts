import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require_ = createRequire(import.meta.url);
const {
  CANONICAL_CARD_MIGRATIONS,
  DEFERRED_HARDENING_MIGRATIONS,
  LEGACY_CARD_MIGRATIONS,
  LEGACY_CARD_MIGRATION_IGNORE_PATTERN,
  PRE_CARD_HARDENING_BASELINE,
  assertAppliedMigrationOrder,
  assertOutOfOrderBackfillApplied,
  listAppliedMigrationNames,
  migrationIgnorePatternForApplied,
  migrationOrderPolicyForApplied,
  normalizeAppliedMigrationOrder,
} = require_('../migration-order-compat.cjs') as {
  CANONICAL_CARD_MIGRATIONS: string[];
  DEFERRED_HARDENING_MIGRATIONS: string[];
  LEGACY_CARD_MIGRATIONS: string[];
  LEGACY_CARD_MIGRATION_IGNORE_PATTERN: string;
  PRE_CARD_HARDENING_BASELINE: string[];
  assertAppliedMigrationOrder: (appliedNames: string[]) => void;
  assertOutOfOrderBackfillApplied: (requiredNames: string[], appliedNames: string[]) => void;
  listAppliedMigrationNames: (pool: { query: ReturnType<typeof vi.fn> }) => Promise<string[]>;
  migrationIgnorePatternForApplied: (appliedNames: string[]) => string | undefined;
  migrationOrderPolicyForApplied: (appliedNames: string[]) => {
    ignorePattern: string | undefined;
    checkOrder: boolean;
    outOfOrderBackfill: string[];
    normalizeOrder: boolean;
  };
  normalizeAppliedMigrationOrder: (pool: { query: ReturnType<typeof vi.fn> }) => Promise<void>;
};

describe('migration order compatibility', () => {
  it('skips the superseded low-number card migrations for canonical and existing P0-P5 histories', () => {
    expect(migrationIgnorePatternForApplied([])).toBe(LEGACY_CARD_MIGRATION_IGNORE_PATTERN);
    expect(migrationIgnorePatternForApplied(['000026_account_export_jobs'])).toBe(LEGACY_CARD_MIGRATION_IGNORE_PATTERN);
  });

  it.each(LEGACY_CARD_MIGRATIONS)('keeps an already-applied legacy chain visible from %s onward', (name) => {
    expect(migrationIgnorePatternForApplied([name])).toBeUndefined();
  });

  it('permits only the reviewed master card-first lineage to backfill deferred migrations', () => {
    const policy = migrationOrderPolicyForApplied([...PRE_CARD_HARDENING_BASELINE, ...CANONICAL_CARD_MIGRATIONS]);

    expect(policy).toEqual({
      ignorePattern: LEGACY_CARD_MIGRATION_IGNORE_PATTERN,
      checkOrder: false,
      outOfOrderBackfill: DEFERRED_HARDENING_MIGRATIONS,
      normalizeOrder: true,
    });
  });

  it('supports a canonical-card prefix and an interrupted deferred backfill', () => {
    const partialBackfill = DEFERRED_HARDENING_MIGRATIONS.slice(0, 4);
    const policy = migrationOrderPolicyForApplied([
      ...PRE_CARD_HARDENING_BASELINE,
      ...partialBackfill,
      CANONICAL_CARD_MIGRATIONS[0],
    ]);

    expect(policy.checkOrder).toBe(false);
    expect(policy.outOfOrderBackfill).toEqual(DEFERRED_HARDENING_MIGRATIONS.slice(4));
    expect(policy.normalizeOrder).toBe(true);
  });

  it('restores strict ordering after the deferred hardening chain is complete', () => {
    expect(
      migrationOrderPolicyForApplied([
        ...PRE_CARD_HARDENING_BASELINE,
        ...DEFERRED_HARDENING_MIGRATIONS,
        ...CANONICAL_CARD_MIGRATIONS,
      ]),
    ).toMatchObject({ checkOrder: true, outOfOrderBackfill: [], normalizeOrder: false });
  });

  it('normalizes a completed card-first history once before restoring strict ordering', async () => {
    const cardFirstHistory = [
      ...PRE_CARD_HARDENING_BASELINE,
      ...CANONICAL_CARD_MIGRATIONS,
      ...DEFERRED_HARDENING_MIGRATIONS,
      '000031_official_card_data_releases',
    ];
    const policy = migrationOrderPolicyForApplied(cardFirstHistory);
    expect(policy).toMatchObject({ checkOrder: false, outOfOrderBackfill: [], normalizeOrder: true });

    expect(() => assertAppliedMigrationOrder(cardFirstHistory)).toThrow('canonical filename order');
    expect(() => assertAppliedMigrationOrder([...cardFirstHistory].sort())).not.toThrow();

    const query = vi.fn().mockResolvedValue({ rows: [] });
    await normalizeAppliedMigrationOrder({ query });
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[0]).toContain('LOCK TABLE public.schema_migrations IN ACCESS EXCLUSIVE MODE');
    expect(query.mock.calls[0]?.[0]).toContain('ROW_NUMBER() OVER (ORDER BY name)');
    expect(query.mock.calls[0]?.[0]).toContain("INTERVAL '1 microsecond'");
    expect(query.mock.calls[0]?.[0]).toContain("pg_get_serial_sequence('public.schema_migrations', 'id')");
  });

  it('rejects incomplete, non-prefix, and unknown card-first histories', () => {
    expect(() =>
      migrationOrderPolicyForApplied([...PRE_CARD_HARDENING_BASELINE.slice(1), CANONICAL_CARD_MIGRATIONS[0]]),
    ).toThrow('required pre-card baseline is incomplete');
    expect(() =>
      migrationOrderPolicyForApplied([...PRE_CARD_HARDENING_BASELINE, CANONICAL_CARD_MIGRATIONS[1]]),
    ).toThrow('non-prefix canonical card history');
    expect(() =>
      migrationOrderPolicyForApplied([...PRE_CARD_HARDENING_BASELINE, CANONICAL_CARD_MIGRATIONS[0], '999999_unknown']),
    ).toThrow('unknown applied migrations');
  });

  it('fails closed when the runner did not finish every required compatibility migration', () => {
    expect(() =>
      assertOutOfOrderBackfillApplied(DEFERRED_HARDENING_MIGRATIONS, DEFERRED_HARDENING_MIGRATIONS.slice(0, -1)),
    ).toThrow(DEFERRED_HARDENING_MIGRATIONS.at(-1));
    expect(() =>
      assertOutOfOrderBackfillApplied(DEFERRED_HARDENING_MIGRATIONS, DEFERRED_HARDENING_MIGRATIONS),
    ).not.toThrow();
  });

  it('reads no history before node-pg-migrate creates its table', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ name: null }] });
    await expect(listAppliedMigrationNames({ query })).resolves.toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('returns every applied migration name when a history exists', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ name: 'schema_migrations' }] })
      .mockResolvedValueOnce({
        rows: [{ name: LEGACY_CARD_MIGRATIONS[0] }, { name: '000024_relationship_change_outbox' }],
      });
    await expect(listAppliedMigrationNames({ query })).resolves.toEqual([
      LEGACY_CARD_MIGRATIONS[0],
      '000024_relationship_change_outbox',
    ]);
  });
});
