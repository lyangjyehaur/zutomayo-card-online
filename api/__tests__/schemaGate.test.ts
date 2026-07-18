import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  assertRuntimeSchema,
  normalizeExpectedChecksum,
  normalizeExpectedMigration,
  REQUIRED_RUNTIME_TABLES,
  REQUIRED_RUNTIME_COLUMNS,
  REQUIRED_RUNTIME_COLUMN_CONTRACTS,
  REQUIRED_RUNTIME_CONSTRAINTS,
  REQUIRED_RUNTIME_INDEXES,
} = require('../schemaGate.cjs') as {
  normalizeExpectedChecksum: (value: unknown) => string;
  normalizeExpectedMigration: (value: unknown) => string;
  REQUIRED_RUNTIME_TABLES: string[];
  REQUIRED_RUNTIME_COLUMNS: Record<string, string[]>;
  REQUIRED_RUNTIME_COLUMN_CONTRACTS: Array<{
    tableName: string;
    columnName: string;
    udtName: string;
    nullable: boolean;
    defaultToken: string | null;
  }>;
  REQUIRED_RUNTIME_CONSTRAINTS: Array<{
    tableName: string;
    constraintName?: string;
    constraintType: string;
    fragments: string[];
  }>;
  REQUIRED_RUNTIME_INDEXES: Array<{ tableName: string; indexName: string; fragments: string[] }>;
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
  const allColumnContractsValid = () =>
    REQUIRED_RUNTIME_COLUMN_CONTRACTS.map((contract) => ({
      table_name: contract.tableName,
      column_name: contract.columnName,
      udt_name: contract.udtName,
      is_nullable: contract.nullable ? 'YES' : 'NO',
      column_default: contract.defaultToken,
      present: true,
    }));
  const allConstraintsPresent = () =>
    REQUIRED_RUNTIME_CONSTRAINTS.map((contract) => ({
      table_name: contract.tableName,
      constraint_name: contract.constraintName || `${contract.tableName}_${contract.constraintType}`,
      constraint_type: contract.constraintType,
      definition: contract.fragments.join(' '),
    }));
  const allIndexesPresent = () =>
    REQUIRED_RUNTIME_INDEXES.map((contract) => ({
      table_name: contract.tableName,
      index_name: contract.indexName,
      index_definition: contract.fragments.join(' '),
    }));

  it('rejects missing or malformed expected migration identifiers', () => {
    expect(() => normalizeExpectedMigration('')).toThrow('EXPECTED_SCHEMA_MIGRATION');
    expect(() => normalizeExpectedMigration('latest')).toThrow('EXPECTED_SCHEMA_MIGRATION');
    expect(() => normalizeExpectedChecksum('')).toThrow('EXPECTED_SCHEMA_CHECKSUM');
    expect(() => normalizeExpectedChecksum('abc')).toThrow('EXPECTED_SCHEMA_CHECKSUM');
  });

  it('assigns poison delivery accounting only to the relationship outbox', () => {
    expect(REQUIRED_RUNTIME_COLUMNS.relationship_change_outbox).toContain('poison_count');
    expect(REQUIRED_RUNTIME_COLUMNS.account_deletion_requests).not.toContain('poison_count');
  });

  it('requires official and localized card text schema', () => {
    expect(REQUIRED_RUNTIME_TABLES).not.toContain('card_effects_i18n');
    expect(REQUIRED_RUNTIME_TABLES).toContain('card_texts_i18n');
    expect(REQUIRED_RUNTIME_TABLES).toContain('card_official_errata');
    expect(REQUIRED_RUNTIME_COLUMNS.cards).toContain('en_name_official');
    expect(REQUIRED_RUNTIME_COLUMNS.cards).toContain('has_official_errata');
    expect(REQUIRED_RUNTIME_COLUMNS.card_texts_i18n).toContain('review_status');
    expect(REQUIRED_RUNTIME_COLUMNS.card_official_errata).toContain('corrected_english_source');
    expect(REQUIRED_RUNTIME_COLUMNS.card_official_errata).not.toContain('corrected_japanese_text');
    expect(REQUIRED_RUNTIME_COLUMNS.card_official_errata).not.toContain('corrected_english_text');
    expect(REQUIRED_RUNTIME_CONSTRAINTS).toContainEqual(
      expect.objectContaining({
        tableName: 'card_texts_i18n',
        constraintName: 'card_texts_i18n_derived_lang_check',
      }),
    );
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
      .mockResolvedValueOnce({ rows: allColumnsPresent() })
      .mockResolvedValueOnce({ rows: allColumnContractsValid() })
      .mockResolvedValueOnce({ rows: allConstraintsPresent() })
      .mockResolvedValueOnce({ rows: allIndexesPresent() });

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

  it('rejects a critical column with the wrong type, nullability, or default', async () => {
    const invalidContractRows = allColumnContractsValid().map((row) =>
      row.table_name === 'matches' && row.column_name === 'completed_at'
        ? { ...row, udt_name: 'text', is_nullable: 'YES', column_default: null }
        : row,
    );
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [{ sha256: CHECKSUM }] })
      .mockResolvedValueOnce({ rows: allTablesPresent() })
      .mockResolvedValueOnce({ rows: allColumnsPresent() })
      .mockResolvedValueOnce({ rows: invalidContractRows });

    await expect(
      assertRuntimeSchema({
        pool: { query },
        expectedMigration: '000023_account_deletion_saga',
        expectedChecksum: CHECKSUM,
      }),
    ).rejects.toThrow('matches.completed_at');
  });

  it('rejects a missing integrity index or constraint', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [{ sha256: CHECKSUM }] })
      .mockResolvedValueOnce({ rows: allTablesPresent() })
      .mockResolvedValueOnce({ rows: allColumnsPresent() })
      .mockResolvedValueOnce({ rows: allColumnContractsValid() })
      .mockResolvedValueOnce({
        rows: allConstraintsPresent().filter(({ table_name }) => table_name !== 'season_ratings'),
      })
      .mockResolvedValueOnce({ rows: allIndexesPresent() });

    await expect(
      assertRuntimeSchema({
        pool: { query },
        expectedMigration: '000023_account_deletion_saga',
        expectedChecksum: CHECKSUM,
      }),
    ).rejects.toThrow('season_ratings');
  });

  it('rejects a missing or malformed partial index', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [{ sha256: CHECKSUM }] })
      .mockResolvedValueOnce({ rows: allTablesPresent() })
      .mockResolvedValueOnce({ rows: allColumnsPresent() })
      .mockResolvedValueOnce({ rows: allColumnContractsValid() })
      .mockResolvedValueOnce({ rows: allConstraintsPresent() })
      .mockResolvedValueOnce({
        rows: allIndexesPresent().filter(({ index_name }) => index_name !== 'uq_account_deletion_requests_active_user'),
      });

    await expect(
      assertRuntimeSchema({
        pool: { query },
        expectedMigration: '000023_account_deletion_saga',
        expectedChecksum: CHECKSUM,
      }),
    ).rejects.toThrow('uq_account_deletion_requests_active_user');
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
