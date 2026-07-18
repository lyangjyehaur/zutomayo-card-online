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

  it('requires the official English card fields used by API, game, and seed readers', () => {
    expect(REQUIRED_RUNTIME_COLUMNS.cards).toEqual(expect.arrayContaining(['en_name_official', 'en_effect_official']));
    expect(REQUIRED_RUNTIME_COLUMN_CONTRACTS).toEqual(
      expect.arrayContaining([
        {
          tableName: 'cards',
          columnName: 'en_name_official',
          udtName: 'text',
          nullable: false,
          defaultToken: "''",
        },
        {
          tableName: 'cards',
          columnName: 'en_effect_official',
          udtName: 'text',
          nullable: false,
          defaultToken: "''",
        },
      ]),
    );
  });

  it('requires the protected signed official-card dataset ledger', () => {
    expect(REQUIRED_RUNTIME_TABLES).toContain('official_card_data_releases');
    expect(REQUIRED_RUNTIME_COLUMNS.official_card_data_releases).toEqual([
      'dataset_sha256',
      'extraction_sha256',
      'errata_sha256',
      'review_provenance_sha256',
      'release_sha',
      'card_count',
      'errata_count',
      'applied_at',
    ]);
    expect(
      REQUIRED_RUNTIME_COLUMN_CONTRACTS.filter(({ tableName }) => tableName === 'official_card_data_releases')
        .map(({ columnName }) => columnName)
        .sort(),
    ).toEqual([...REQUIRED_RUNTIME_COLUMNS.official_card_data_releases].sort());
    expect(REQUIRED_RUNTIME_COLUMN_CONTRACTS).toEqual(
      expect.arrayContaining([
        {
          tableName: 'official_card_data_releases',
          columnName: 'review_provenance_sha256',
          udtName: 'text',
          nullable: false,
          defaultToken: null,
        },
        {
          tableName: 'official_card_data_releases',
          columnName: 'card_count',
          udtName: 'int4',
          nullable: false,
          defaultToken: null,
        },
        {
          tableName: 'official_card_data_releases',
          columnName: 'applied_at',
          udtName: 'timestamptz',
          nullable: false,
          defaultToken: 'now()',
        },
      ]),
    );
    expect(REQUIRED_RUNTIME_CONSTRAINTS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tableName: 'official_card_data_releases',
          constraintType: 'p',
          fragments: ['primary key (dataset_sha256)'],
        }),
        expect.objectContaining({
          tableName: 'official_card_data_releases',
          constraintType: 'c',
          fragments: ['dataset_sha256', '^[a-f0-9]{64}$'],
        }),
        expect.objectContaining({
          tableName: 'official_card_data_releases',
          constraintType: 'c',
          fragments: ['review_provenance_sha256', '^[a-f0-9]{64}$'],
        }),
        expect.objectContaining({
          tableName: 'official_card_data_releases',
          constraintType: 'c',
          fragments: ['release_sha', '^[a-f0-9]{40}$'],
        }),
        expect.objectContaining({
          tableName: 'official_card_data_releases',
          constraintType: 'c',
          fragments: ['card_count > 0'],
        }),
        expect.objectContaining({
          tableName: 'official_card_data_releases',
          constraintType: 'c',
          fragments: ['errata_count <= card_count'],
        }),
      ]),
    );
  });

  it('requires the credential, revocation, and durable admin audit schema contracts', () => {
    expect(REQUIRED_RUNTIME_COLUMNS.users).toContain('identity_anonymized_at');
    expect(REQUIRED_RUNTIME_COLUMN_CONTRACTS).toContainEqual({
      tableName: 'users',
      columnName: 'identity_anonymized_at',
      udtName: 'timestamptz',
      nullable: true,
      defaultToken: null,
    });
    expect(REQUIRED_RUNTIME_INDEXES).toContainEqual({
      tableName: 'users',
      indexName: 'idx_users_deleted_identity_pending',
      fragments: ['(deleted_at)', 'deleted_at is not null', 'identity_anonymized_at is null'],
    });
    expect(REQUIRED_RUNTIME_COLUMNS.admin_users).toEqual(
      expect.arrayContaining([
        'user_id',
        'password_hash',
        'salt',
        'totp_secret_ciphertext',
        'updated_at',
        'disabled_at',
      ]),
    );
    for (const columnName of ['user_id', 'password_hash', 'salt']) {
      expect(REQUIRED_RUNTIME_COLUMN_CONTRACTS).toContainEqual({
        tableName: 'admin_users',
        columnName,
        udtName: 'text',
        nullable: true,
        defaultToken: null,
      });
    }
    expect(REQUIRED_RUNTIME_COLUMNS.admin_sessions).toEqual(
      expect.arrayContaining(['jti', 'admin_user_id', 'expires_at', 'revoked_at', 'last_seen_at']),
    );
    expect(REQUIRED_RUNTIME_COLUMNS.admin_audit_log).toEqual(
      expect.arrayContaining(['admin_user_id', 'target_id', 'details', 'created_at', 'identity_anonymized_at']),
    );
    expect(REQUIRED_RUNTIME_INDEXES).toContainEqual({
      tableName: 'admin_sessions',
      indexName: 'idx_admin_sessions_user_expiry',
      fragments: ['admin_user_id', 'expires_at'],
    });
    expect(REQUIRED_RUNTIME_INDEXES).toContainEqual({
      tableName: 'admin_users',
      indexName: 'uq_admin_users_user_id',
      fragments: ['unique index', '(user_id)'],
    });
    expect(REQUIRED_RUNTIME_CONSTRAINTS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tableName: 'admin_users', constraintType: 'u', fragments: ['unique (username)'] }),
        expect.objectContaining({
          tableName: 'admin_users',
          constraintType: 'f',
          fragments: expect.arrayContaining(['foreign key (user_id)', 'references users(id)', 'on delete cascade']),
        }),
        expect.objectContaining({
          tableName: 'admin_users',
          constraintName: 'admin_users_auth_mode_check',
          constraintType: 'c',
          fragments: expect.arrayContaining([
            'user_id is null',
            'password_hash is not null',
            'salt is not null',
            'user_id is not null',
          ]),
        }),
        expect.objectContaining({
          tableName: 'admin_sessions',
          constraintType: 'f',
          fragments: expect.arrayContaining(['references admin_users(id)', 'on delete cascade']),
        }),
      ]),
    );
  });

  it('requires the complete asynchronous account export schema contract', () => {
    expect(REQUIRED_RUNTIME_TABLES).toEqual(expect.arrayContaining(['account_export_jobs', 'account_export_audit']));
    expect(REQUIRED_RUNTIME_COLUMNS.account_export_jobs).toEqual(
      expect.arrayContaining(['lease_token', 'lease_expires_at', 'object_version_id', 'content_sha256', 'purged_at']),
    );
    expect(REQUIRED_RUNTIME_INDEXES.map(({ indexName }) => indexName)).toEqual(
      expect.arrayContaining([
        'uq_account_export_jobs_active_user',
        'idx_account_export_jobs_purge',
        'idx_account_export_jobs_retention',
        'idx_account_export_audit_retention',
        'uq_account_export_audit_request_event',
        'uq_account_export_audit_request_terminal',
      ]),
    );
    const auditConstraint = REQUIRED_RUNTIME_CONSTRAINTS.find(
      ({ tableName, constraintType }) => tableName === 'account_export_audit' && constraintType === 'c',
    );
    expect(auditConstraint?.fragments).toEqual(
      expect.arrayContaining([
        'download_started',
        'download_completed',
        'download_interrupted',
        'integrity_failed',
        'expired',
        'purged',
      ]),
    );
    expect(REQUIRED_RUNTIME_COLUMN_CONTRACTS).toEqual(
      expect.arrayContaining([
        {
          tableName: 'account_export_jobs',
          columnName: 'user_id',
          udtName: 'text',
          nullable: true,
          defaultToken: null,
        },
        {
          tableName: 'account_export_audit',
          columnName: 'user_id',
          udtName: 'text',
          nullable: true,
          defaultToken: null,
        },
        {
          tableName: 'season_match_results',
          columnName: 'winner_user_id',
          udtName: 'text',
          nullable: true,
          defaultToken: null,
        },
      ]),
    );
    expect(
      REQUIRED_RUNTIME_CONSTRAINTS.find(
        ({ tableName, constraintType, fragments }) =>
          tableName === 'account_export_jobs' && constraintType === 'f' && fragments.includes('foreign key (user_id)'),
      )?.fragments,
    ).toContain('on delete set null');
  });

  it('requires official and localized card text schema', () => {
    expect(REQUIRED_RUNTIME_TABLES).toContain('card_effects_i18n');
    expect(REQUIRED_RUNTIME_TABLES).toContain('card_texts_i18n');
    expect(REQUIRED_RUNTIME_TABLES).toContain('card_official_errata');
    expect(REQUIRED_RUNTIME_COLUMNS.cards).toContain('en_name_official');
    expect(REQUIRED_RUNTIME_COLUMNS.cards).toContain('has_official_errata');
    expect(REQUIRED_RUNTIME_COLUMNS.card_texts_i18n).toEqual(
      expect.arrayContaining(['card_id', 'lang', 'review_status', 'review_note', 'updated_at']),
    );
    expect(REQUIRED_RUNTIME_COLUMNS.card_official_errata).toEqual(
      expect.arrayContaining([
        'errata_id',
        'card_id',
        'published_at',
        'incorrect_text',
        'corrected_japanese_text',
        'corrected_english_text',
        'corrected_english_source',
        'updated_at',
      ]),
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
        {
          tableName: 'card_official_errata',
          columnName: 'corrected_japanese_text',
          udtName: 'text',
          nullable: true,
          defaultToken: null,
        },
        {
          tableName: 'card_official_errata',
          columnName: 'corrected_english_text',
          udtName: 'text',
          nullable: true,
          defaultToken: null,
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
        expect.objectContaining({
          tableName: 'card_official_errata',
          constraintName: 'card_official_errata_no_corrected_text_cache',
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
        expectedMigration: '000034_card_text_rollback_compat',
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
        expectedMigration: '000034_card_text_rollback_compat',
        expectedChecksum: CHECKSUM,
      }),
    ).rejects.toThrow('card_official_errata_english_source_check');
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
  const expectedMigration = '000034_card_text_rollback_compat';
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
