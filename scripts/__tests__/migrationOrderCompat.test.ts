import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require_ = createRequire(import.meta.url);
const {
  LEGACY_CARD_MIGRATIONS,
  LEGACY_CARD_MIGRATION_IGNORE_PATTERN,
  listAppliedMigrationNames,
  migrationIgnorePatternForApplied,
} = require_('../migration-order-compat.cjs') as {
  LEGACY_CARD_MIGRATIONS: string[];
  LEGACY_CARD_MIGRATION_IGNORE_PATTERN: string;
  listAppliedMigrationNames: (pool: { query: ReturnType<typeof vi.fn> }) => Promise<string[]>;
  migrationIgnorePatternForApplied: (appliedNames: string[]) => string | undefined;
};

describe('migration order compatibility', () => {
  it('skips the superseded low-number card migrations for canonical and existing P0-P5 histories', () => {
    expect(migrationIgnorePatternForApplied([])).toBe(LEGACY_CARD_MIGRATION_IGNORE_PATTERN);
    expect(migrationIgnorePatternForApplied(['000026_account_export_jobs'])).toBe(LEGACY_CARD_MIGRATION_IGNORE_PATTERN);
  });

  it.each(LEGACY_CARD_MIGRATIONS)('keeps an already-applied legacy chain visible from %s onward', (name) => {
    expect(migrationIgnorePatternForApplied([name])).toBeUndefined();
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
