import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  assertRuntimeSchema,
  normalizeExpectedChecksum,
  normalizeExpectedMigration,
  REQUIRED_RUNTIME_TABLES,
  REQUIRED_RUNTIME_COLUMNS,
} = require('../schemaGate.cjs') as {
  normalizeExpectedChecksum: (value: unknown) => string;
  normalizeExpectedMigration: (value: unknown) => string;
  REQUIRED_RUNTIME_TABLES: string[];
  REQUIRED_RUNTIME_COLUMNS: Record<string, string[]>;
  assertRuntimeSchema: (options: {
    pool: { query: ReturnType<typeof vi.fn> };
    expectedMigration: string;
    expectedChecksum: string;
  }) => Promise<{ expectedMigration: string; expectedChecksum: string }>;
};

const CHECKSUM = 'a'.repeat(64);

describe('production schema gate', () => {
  const allTablesPresent = () => REQUIRED_RUNTIME_TABLES.map((table_name) => ({ table_name, present: true }));
  const allColumnsPresent = () =>
    Object.entries(REQUIRED_RUNTIME_COLUMNS).flatMap(([table_name, columns]) =>
      columns.map((column_name) => ({ table_name, column_name, present: true })),
    );

  it('rejects missing or malformed expected migration identifiers', () => {
    expect(() => normalizeExpectedMigration('')).toThrow('EXPECTED_SCHEMA_MIGRATION');
    expect(() => normalizeExpectedMigration('latest')).toThrow('EXPECTED_SCHEMA_MIGRATION');
    expect(() => normalizeExpectedChecksum('')).toThrow('EXPECTED_SCHEMA_CHECKSUM');
    expect(() => normalizeExpectedChecksum('abc')).toThrow('EXPECTED_SCHEMA_CHECKSUM');
  });

  it('requires the release migration and every runtime table', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [{ sha256: CHECKSUM }] })
      .mockResolvedValueOnce({
        rows: [
          ...allTablesPresent().filter(({ table_name }) => table_name !== 'bjg_matches'),
          { table_name: 'bjg_matches', present: false },
        ],
      });

    await expect(
      assertRuntimeSchema({
        pool: { query },
        expectedMigration: '000015_game_seats_result_outbox',
        expectedChecksum: CHECKSUM,
      }),
    ).rejects.toThrow('bjg_matches');
  });

  it('accepts a fully migrated runtime schema without issuing DDL', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [{ sha256: CHECKSUM }] })
      .mockResolvedValueOnce({ rows: allTablesPresent() })
      .mockResolvedValueOnce({ rows: allColumnsPresent() });

    await expect(
      assertRuntimeSchema({
        pool: { query },
        expectedMigration: '000015_game_seats_result_outbox',
        expectedChecksum: CHECKSUM,
      }),
    ).resolves.toEqual({ expectedMigration: '000015_game_seats_result_outbox', expectedChecksum: CHECKSUM });
    expect(query.mock.calls.every(([sql]) => !/^\s*(CREATE|ALTER|DROP)/i.test(String(sql)))).toBe(true);
  });

  it('rejects a table with a missing post-migration column', async () => {
    const columns = allColumnsPresent().filter(
      ({ table_name, column_name }) => !(table_name === 'legal_hold_objects' && column_name === 'object_id'),
    );
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [{ sha256: CHECKSUM }] })
      .mockResolvedValueOnce({ rows: allTablesPresent() })
      .mockResolvedValueOnce({
        rows: [...columns, { table_name: 'legal_hold_objects', column_name: 'object_id', present: false }],
      });

    await expect(
      assertRuntimeSchema({
        pool: { query },
        expectedMigration: '000023_account_deletion_saga',
        expectedChecksum: CHECKSUM,
      }),
    ).rejects.toThrow('legal_hold_objects.object_id');
  });

  it('rejects a same-name migration with different contents', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [{ sha256: 'b'.repeat(64) }] });
    await expect(
      assertRuntimeSchema({
        pool: { query },
        expectedMigration: '000015_game_seats_result_outbox',
        expectedChecksum: CHECKSUM,
      }),
    ).rejects.toThrow('checksum mismatch');
  });
});
