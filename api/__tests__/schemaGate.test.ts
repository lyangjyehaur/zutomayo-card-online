import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  assertBoardgameRuntimeSchema,
  assertRuntimeSchema,
  normalizeExpectedChecksum,
  normalizeExpectedMigration,
  REQUIRED_BOARDGAME_RUNTIME_TABLES,
  REQUIRED_BOARDGAME_RUNTIME_COLUMNS,
  REQUIRED_BOARDGAME_RUNTIME_COLUMN_CONTRACTS,
  REQUIRED_BOARDGAME_RUNTIME_CONSTRAINTS,
  REQUIRED_BOARDGAME_RUNTIME_INDEXES,
  REQUIRED_RUNTIME_TABLES,
  REQUIRED_RUNTIME_COLUMNS,
  REQUIRED_RUNTIME_COLUMN_CONTRACTS,
  REQUIRED_RUNTIME_CONSTRAINTS,
  REQUIRED_RUNTIME_INDEXES,
  DECK_SHARING_RUNTIME_TABLES,
} = require('../schemaGate.cjs') as {
  assertBoardgameRuntimeSchema: (options: {
    pool: { query: ReturnType<typeof vi.fn> };
    expectedMigration: string;
    expectedChecksum: string;
  }) => Promise<{ expectedMigration: string; expectedChecksum: string }>;
  normalizeExpectedChecksum: (value: unknown) => string;
  normalizeExpectedMigration: (value: unknown) => string;
  REQUIRED_BOARDGAME_RUNTIME_TABLES: string[];
  REQUIRED_BOARDGAME_RUNTIME_COLUMNS: Record<string, string[]>;
  REQUIRED_BOARDGAME_RUNTIME_COLUMN_CONTRACTS: Array<{
    tableName: string;
    columnName: string;
    udtName: string;
    nullable: boolean;
    defaultToken: string | null;
  }>;
  REQUIRED_BOARDGAME_RUNTIME_CONSTRAINTS: Array<{
    tableName: string;
    constraintName?: string;
    constraintType: string;
    fragments: string[];
  }>;
  REQUIRED_BOARDGAME_RUNTIME_INDEXES: Array<{ tableName: string; indexName: string; fragments: string[] }>;
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
  DECK_SHARING_RUNTIME_TABLES: string[];
  assertRuntimeSchema: (options: {
    pool: { query: ReturnType<typeof vi.fn> };
    expectedMigration: string;
    expectedChecksum: string;
    requireDeckSharing?: boolean;
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

  it('requires the permanent anonymous match analytics contract', () => {
    expect(REQUIRED_RUNTIME_TABLES).toEqual(
      expect.arrayContaining([
        'bjg_match_telemetry',
        'match_analytics',
        'match_analytics_decks',
        'match_analytics_events',
      ]),
    );
    expect(REQUIRED_RUNTIME_COLUMNS.bjg_match_seats).toContain('resume_count');
    expect(REQUIRED_RUNTIME_COLUMNS.bjg_match_telemetry).toEqual(
      expect.arrayContaining(['match_mode', 'traffic_class', 'player0_disconnect_count', 'player1_reconnect_count']),
    );
    expect(REQUIRED_RUNTIME_COLUMNS.match_analytics).toEqual(
      expect.arrayContaining([
        'source_match_digest',
        'integrity_sha256',
        'disconnect_counts',
        'reconnect_counts',
        'seat_resume_counts',
        'deck_count',
        'event_count',
      ]),
    );
    expect(REQUIRED_RUNTIME_COLUMNS.match_analytics_decks).toContain('card_ids');
    expect(REQUIRED_RUNTIME_COLUMNS.match_analytics_events).toContain('payload');
    expect(REQUIRED_RUNTIME_CONSTRAINTS).toContainEqual(
      expect.objectContaining({
        tableName: 'match_analytics',
        constraintName: 'match_analytics_digest_check',
      }),
    );
    expect(REQUIRED_RUNTIME_INDEXES).toContainEqual(
      expect.objectContaining({ tableName: 'match_analytics', indexName: 'idx_match_analytics_completed_at' }),
    );
    expect(REQUIRED_RUNTIME_CONSTRAINTS).toContainEqual(
      expect.objectContaining({
        tableName: 'bjg_match_telemetry',
        constraintName: 'bjg_match_telemetry_classification_check',
      }),
    );
    expect(REQUIRED_RUNTIME_INDEXES).toContainEqual(
      expect.objectContaining({
        tableName: 'bjg_match_telemetry',
        indexName: 'idx_bjg_match_telemetry_classification',
      }),
    );
  });

  it('requires official and localized card text schema', () => {
    expect(REQUIRED_RUNTIME_TABLES).not.toContain('card_effects_i18n');
    expect(REQUIRED_RUNTIME_TABLES).toContain('card_texts_i18n');
    expect(REQUIRED_RUNTIME_TABLES).toContain('card_official_errata');
    expect(REQUIRED_RUNTIME_TABLES).toContain('official_qa_items');
    expect(REQUIRED_RUNTIME_TABLES).toContain('official_qa_item_revisions');
    expect(REQUIRED_RUNTIME_TABLES).toContain('card_official_errata_revisions');
    expect(REQUIRED_RUNTIME_TABLES).toContain('card_revisions');
    expect(REQUIRED_RUNTIME_TABLES).toContain('official_qa_translations');
    expect(REQUIRED_RUNTIME_TABLES).toContain('card_official_errata_translations');
    expect(REQUIRED_RUNTIME_TABLES).toContain('official_rulings_sync_runs');
    expect(REQUIRED_RUNTIME_TABLES).toContain('official_rule_documents');
    expect(REQUIRED_RUNTIME_TABLES).toContain('official_rule_sections');
    expect(REQUIRED_RUNTIME_TABLES).toContain('official_rule_section_translations');
    expect(REQUIRED_RUNTIME_TABLES).toContain('official_rule_active_versions');
    expect(REQUIRED_RUNTIME_TABLES).toContain('knowledge_search_zero_results');
    expect(REQUIRED_RUNTIME_COLUMNS.knowledge_search_zero_results).toContain('normalized_query');
    expect(REQUIRED_RUNTIME_COLUMNS.cards).toContain('en_name_official');
    expect(REQUIRED_RUNTIME_COLUMNS.cards).toContain('has_official_errata');
    expect(REQUIRED_RUNTIME_COLUMNS.card_texts_i18n).toEqual(
      expect.arrayContaining(['card_id', 'lang', 'review_status', 'review_note', 'updated_at']),
    );
    expect(REQUIRED_RUNTIME_COLUMNS.card_official_errata).toContain('corrected_english_source');
    expect(REQUIRED_RUNTIME_COLUMNS.card_official_errata).toContain('content_version');
    expect(REQUIRED_RUNTIME_COLUMNS.official_qa_items).toContain('question_ja');
    expect(REQUIRED_RUNTIME_COLUMNS.official_qa_item_revisions).toContain('content_version');
    expect(REQUIRED_RUNTIME_COLUMNS.card_official_errata_revisions).toContain('corrected_japanese_text');
    expect(REQUIRED_RUNTIME_COLUMNS.card_revisions).toContain('name');
    expect(REQUIRED_RUNTIME_COLUMNS.official_qa_translations).toContain('question_text');
    expect(REQUIRED_RUNTIME_COLUMNS.official_rulings_sync_runs).toContain('diff');
    expect(REQUIRED_RUNTIME_COLUMNS.official_rule_documents).toContain('source_sha256');
    expect(REQUIRED_RUNTIME_COLUMNS.official_rule_sections).toContain('body_ja');
    expect(REQUIRED_RUNTIME_COLUMNS.official_rule_section_translations).toContain('body_text');
    expect(REQUIRED_RUNTIME_COLUMNS.card_official_errata).not.toContain('corrected_japanese_text');
    expect(REQUIRED_RUNTIME_COLUMNS.card_official_errata).not.toContain('corrected_english_text');
    expect(REQUIRED_RUNTIME_CONSTRAINTS).toContainEqual(
      expect.objectContaining({
        tableName: 'card_texts_i18n',
        constraintName: 'card_texts_i18n_derived_lang_check',
      }),
    );
    expect(REQUIRED_RUNTIME_CONSTRAINTS).toContainEqual(
      expect.objectContaining({ tableName: 'official_qa_item_revisions', constraintType: 'p' }),
    );
    expect(REQUIRED_RUNTIME_CONSTRAINTS).toContainEqual(
      expect.objectContaining({
        tableName: 'card_texts_i18n',
        constraintName: 'card_texts_i18n_derived_review_status_check',
      }),
    );
    expect(
      REQUIRED_RUNTIME_COLUMN_CONTRACTS.filter(({ tableName }) => tableName === 'card_texts_i18n')
        .map(({ columnName }) => columnName)
        .sort(),
    ).toEqual([...REQUIRED_RUNTIME_COLUMNS.card_texts_i18n].sort());
    expect(
      REQUIRED_RUNTIME_COLUMN_CONTRACTS.filter(({ tableName }) => tableName === 'card_official_errata')
        .map(({ columnName }) => columnName)
        .sort(),
    ).toEqual([...REQUIRED_RUNTIME_COLUMNS.card_official_errata].sort());
    expect(REQUIRED_RUNTIME_COLUMN_CONTRACTS).toEqual(
      expect.arrayContaining([
        {
          tableName: 'card_texts_i18n',
          columnName: 'review_status',
          udtName: 'text',
          nullable: false,
          defaultToken: "'pending_review'",
        },
        {
          tableName: 'card_official_errata',
          columnName: 'corrected_english_source',
          udtName: 'text',
          nullable: false,
          defaultToken: "'official_japanese_errata_translation'",
        },
      ]),
    );
    expect(REQUIRED_RUNTIME_CONSTRAINTS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tableName: 'card_texts_i18n',
          constraintName: 'card_texts_i18n_derived_lang_check',
          constraintType: 'c',
        }),
        expect.objectContaining({
          tableName: 'card_texts_i18n',
          constraintName: 'card_texts_i18n_derived_review_status_check',
          constraintType: 'c',
        }),
        expect.objectContaining({
          tableName: 'card_texts_i18n',
          constraintType: 'p',
          fragments: ['primary key (card_id, lang)'],
        }),
        expect.objectContaining({
          tableName: 'card_texts_i18n',
          constraintType: 'f',
          fragments: expect.arrayContaining(['references cards(id)', 'on delete cascade']),
        }),
        expect.objectContaining({
          tableName: 'card_official_errata',
          constraintType: 'u',
          fragments: ['unique (card_id)'],
        }),
        expect.objectContaining({
          tableName: 'card_official_errata',
          constraintName: 'card_official_errata_english_source_check',
          constraintType: 'c',
        }),
      ]),
    );
    expect(REQUIRED_RUNTIME_INDEXES).toEqual(
      expect.arrayContaining([
        {
          tableName: 'card_texts_i18n',
          indexName: 'idx_card_texts_i18n_lang_review',
          fragments: ['(lang, review_status)'],
        },
        {
          tableName: 'cards',
          indexName: 'idx_cards_has_official_errata',
          fragments: ['(has_official_errata)'],
        },
      ]),
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

  it('requires deck-sharing tables only when the guarded feature is enabled', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [{ sha256: CHECKSUM }] })
      .mockResolvedValueOnce({
        rows: [
          ...allTablesPresent(),
          ...DECK_SHARING_RUNTIME_TABLES.map((table_name) => ({
            table_name,
            present: table_name !== 'deck_shares',
          })),
        ],
      });

    await expect(
      assertRuntimeSchema({
        pool: { query },
        expectedMigration: '000038_deck_sharing',
        expectedChecksum: CHECKSUM,
        requireDeckSharing: true,
      }),
    ).rejects.toThrow('deck_shares');
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
      .mockResolvedValueOnce({ rows: allIndexesPresent() })
      .mockResolvedValueOnce({ rows: [{ pending_count: '0' }] });

    await expect(
      assertRuntimeSchema({
        pool: { query },
        expectedMigration: '000015_game_seats_result_outbox',
        expectedChecksum: CHECKSUM,
      }),
    ).resolves.toEqual({ expectedMigration: '000015_game_seats_result_outbox', expectedChecksum: CHECKSUM });
    expect(query.mock.calls.every(([sql]) => !/^\s*(CREATE|ALTER|DROP)/i.test(String(sql)))).toBe(true);
  });

  it('rejects a fully migrated schema while legacy deleted accounts still await anonymization', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [{ sha256: CHECKSUM }] })
      .mockResolvedValueOnce({ rows: allTablesPresent() })
      .mockResolvedValueOnce({ rows: allColumnsPresent() })
      .mockResolvedValueOnce({ rows: allColumnContractsValid() })
      .mockResolvedValueOnce({ rows: allConstraintsPresent() })
      .mockResolvedValueOnce({ rows: allIndexesPresent() })
      .mockResolvedValueOnce({ rows: [{ pending_count: '2' }] });

    await expect(
      assertRuntimeSchema({
        pool: { query },
        expectedMigration: '000035_remove_card_text_rollback_compat',
        expectedChecksum: CHECKSUM,
      }),
    ).rejects.toThrow('2 legacy deleted accounts pending identity anonymization');
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

  it('rejects a same-name card errata source constraint with the wrong definition', async () => {
    const constraints = allConstraintsPresent().map((row) =>
      row.constraint_name === 'card_official_errata_english_source_check'
        ? { ...row, definition: 'CHECK (true)' }
        : row,
    );
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [{ sha256: CHECKSUM }] })
      .mockResolvedValueOnce({ rows: allTablesPresent() })
      .mockResolvedValueOnce({ rows: allColumnsPresent() })
      .mockResolvedValueOnce({ rows: allColumnContractsValid() })
      .mockResolvedValueOnce({ rows: constraints })
      .mockResolvedValueOnce({ rows: allIndexesPresent() });

    await expect(
      assertRuntimeSchema({
        pool: { query },
        expectedMigration: '000035_remove_card_text_rollback_compat',
        expectedChecksum: CHECKSUM,
      }),
    ).rejects.toThrow('card_official_errata_english_source_check');
  });

  it('rejects a same-name derived review-status constraint with the wrong definition', async () => {
    const constraints = allConstraintsPresent().map((row) =>
      row.constraint_name === 'card_texts_i18n_derived_review_status_check'
        ? { ...row, definition: "CHECK (review_status = 'verified')" }
        : row,
    );
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [{ sha256: CHECKSUM }] })
      .mockResolvedValueOnce({ rows: allTablesPresent() })
      .mockResolvedValueOnce({ rows: allColumnsPresent() })
      .mockResolvedValueOnce({ rows: allColumnContractsValid() })
      .mockResolvedValueOnce({ rows: constraints })
      .mockResolvedValueOnce({ rows: allIndexesPresent() });

    await expect(
      assertRuntimeSchema({
        pool: { query },
        expectedMigration: '000036_harden_card_i18n_contract',
        expectedChecksum: CHECKSUM,
      }),
    ).rejects.toThrow('card_texts_i18n_derived_review_status_check');
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

describe('boardgame runtime schema gate', () => {
  const expectedMigration = '000035_remove_card_text_rollback_compat';
  const allTablesPresent = () => REQUIRED_BOARDGAME_RUNTIME_TABLES.map((table_name) => ({ table_name, present: true }));
  const allColumnsPresent = () =>
    Object.entries(REQUIRED_BOARDGAME_RUNTIME_COLUMNS).flatMap(([table_name, columns]) =>
      columns.map((column_name) => ({ table_name, column_name, present: true })),
    );
  const allColumnContractsValid = () =>
    REQUIRED_BOARDGAME_RUNTIME_COLUMN_CONTRACTS.map((contract) => ({
      table_name: contract.tableName,
      column_name: contract.columnName,
      udt_name: contract.udtName,
      is_nullable: contract.nullable ? 'YES' : 'NO',
      column_default: contract.defaultToken,
      present: true,
    }));
  const allConstraintsPresent = () =>
    REQUIRED_BOARDGAME_RUNTIME_CONSTRAINTS.map((contract) => ({
      table_name: contract.tableName,
      constraint_name: contract.constraintName || `${contract.tableName}_${contract.constraintType}`,
      constraint_type: contract.constraintType,
      definition: contract.fragments.join(' '),
    }));
  const allIndexesPresent = () =>
    REQUIRED_BOARDGAME_RUNTIME_INDEXES.map((contract) => ({
      table_name: contract.tableName,
      index_name: contract.indexName,
      index_definition: contract.fragments.join(' '),
    }));

  it('accepts the least-privilege game schema without querying API-only tables or issuing DDL', async () => {
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
      assertBoardgameRuntimeSchema({
        pool: { query },
        expectedMigration,
        expectedChecksum: CHECKSUM,
      }),
    ).resolves.toEqual({ expectedMigration, expectedChecksum: CHECKSUM });

    const catalogTableParameters = [
      query.mock.calls[2]?.[1]?.[0],
      query.mock.calls[3]?.[1]?.[0],
      query.mock.calls[4]?.[1]?.[0],
      query.mock.calls[5]?.[1]?.[0],
      query.mock.calls[6]?.[1]?.[0],
    ].flat() as string[];
    const allowedTables = new Set(REQUIRED_BOARDGAME_RUNTIME_TABLES);
    expect(catalogTableParameters.every((tableName) => allowedTables.has(tableName))).toBe(true);
    expect(catalogTableParameters).not.toEqual(
      expect.arrayContaining(['admin_users', 'account_export_jobs', 'chat_messages', 'user_identities']),
    );
    expect(query.mock.calls.every(([sql]) => !/^\s*(CREATE|ALTER|DROP)/i.test(String(sql)))).toBe(true);
  });

  it('rejects a missing boardgame match table', async () => {
    const tables = allTablesPresent().map((row) =>
      row.table_name === 'bjg_matches' ? { ...row, present: false } : row,
    );
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [{ sha256: CHECKSUM }] })
      .mockResolvedValueOnce({ rows: tables });

    await expect(
      assertBoardgameRuntimeSchema({
        pool: { query },
        expectedMigration,
        expectedChecksum: CHECKSUM,
      }),
    ).rejects.toThrow('bjg_matches');
  });

  it('rejects a missing deck binding column', async () => {
    const columns = allColumnsPresent().map((row) =>
      row.table_name === 'deck_reservations' && row.column_name === 'consumed_at' ? { ...row, present: false } : row,
    );
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [{ sha256: CHECKSUM }] })
      .mockResolvedValueOnce({ rows: allTablesPresent() })
      .mockResolvedValueOnce({ rows: columns });

    await expect(
      assertBoardgameRuntimeSchema({
        pool: { query },
        expectedMigration,
        expectedChecksum: CHECKSUM,
      }),
    ).rejects.toThrow('deck_reservations.consumed_at');
  });

  it('rejects a missing boardgame seat integrity constraint', async () => {
    const constraints = allConstraintsPresent().filter(
      (row) => !(row.table_name === 'bjg_match_seats' && row.constraint_type === 'u'),
    );
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [{ sha256: CHECKSUM }] })
      .mockResolvedValueOnce({ rows: allTablesPresent() })
      .mockResolvedValueOnce({ rows: allColumnsPresent() })
      .mockResolvedValueOnce({ rows: allColumnContractsValid() })
      .mockResolvedValueOnce({ rows: constraints });

    await expect(
      assertBoardgameRuntimeSchema({
        pool: { query },
        expectedMigration,
        expectedChecksum: CHECKSUM,
      }),
    ).rejects.toThrow('bjg_match_seats:u');
  });

  it('rejects a missing boardgame query index', async () => {
    const indexes = allIndexesPresent().filter((row) => row.index_name !== 'idx_bjg_matches_game_name');
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [{ sha256: CHECKSUM }] })
      .mockResolvedValueOnce({ rows: allTablesPresent() })
      .mockResolvedValueOnce({ rows: allColumnsPresent() })
      .mockResolvedValueOnce({ rows: allColumnContractsValid() })
      .mockResolvedValueOnce({ rows: allConstraintsPresent() })
      .mockResolvedValueOnce({ rows: indexes });

    await expect(
      assertBoardgameRuntimeSchema({
        pool: { query },
        expectedMigration,
        expectedChecksum: CHECKSUM,
      }),
    ).rejects.toThrow('idx_bjg_matches_game_name');
  });

  it('rejects a boardgame runtime migration with the wrong checksum', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [{ sha256: 'b'.repeat(64) }] });

    await expect(
      assertBoardgameRuntimeSchema({
        pool: { query },
        expectedMigration,
        expectedChecksum: CHECKSUM,
      }),
    ).rejects.toThrow('checksum mismatch');
  });
});
