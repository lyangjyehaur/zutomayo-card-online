import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { PostgresAdapter } from '../postgres-adapter';

const require = createRequire(import.meta.url);
const {
  REQUIRED_RUNTIME_TABLES,
  REQUIRED_RUNTIME_COLUMNS,
  REQUIRED_RUNTIME_COLUMN_CONTRACTS,
  REQUIRED_RUNTIME_CONSTRAINTS,
  REQUIRED_RUNTIME_INDEXES,
} = require('../../../../api/schemaGate.cjs') as {
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
};

describe('PostgresAdapter production schema gate', () => {
  const checksum = 'a'.repeat(64);

  it('checks the release migration and runtime tables without issuing DDL', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
        .mockResolvedValueOnce({ rows: [{ sha256: checksum }] })
        .mockResolvedValueOnce({
          rows: REQUIRED_RUNTIME_TABLES.map((table_name) => ({ table_name, present: true })),
        })
        .mockResolvedValueOnce({
          rows: Object.entries(REQUIRED_RUNTIME_COLUMNS).flatMap(([table_name, columns]) =>
            columns.map((column_name) => ({ table_name, column_name, present: true })),
          ),
        })
        .mockResolvedValueOnce({
          rows: REQUIRED_RUNTIME_COLUMN_CONTRACTS.map((contract) => ({
            table_name: contract.tableName,
            column_name: contract.columnName,
            udt_name: contract.udtName,
            is_nullable: contract.nullable ? 'YES' : 'NO',
            column_default: contract.defaultToken,
            present: true,
          })),
        })
        .mockResolvedValueOnce({
          rows: REQUIRED_RUNTIME_CONSTRAINTS.map((contract) => ({
            table_name: contract.tableName,
            constraint_name: contract.constraintName || `${contract.tableName}_${contract.constraintType}`,
            constraint_type: contract.constraintType,
            definition: contract.fragments.join(' '),
          })),
        })
        .mockResolvedValueOnce({
          rows: REQUIRED_RUNTIME_INDEXES.map((contract) => ({
            table_name: contract.tableName,
            index_name: contract.indexName,
            index_definition: contract.fragments.join(' '),
          })),
        }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client), query: vi.fn(), end: vi.fn() };
    const adapter = new PostgresAdapter({
      pool: pool as never,
      runtimeSchemaDdl: false,
      expectedSchemaMigration: '000015_game_seats_result_outbox',
      expectedSchemaChecksum: checksum,
    });

    await adapter.connect();

    expect(client.query).toHaveBeenNthCalledWith(1, 'SELECT 1 FROM public.schema_migrations WHERE name = $1 LIMIT 1', [
      '000015_game_seats_result_outbox',
    ]);
    expect(client.query.mock.calls[2]?.[1]?.[0]).toEqual(
      expect.arrayContaining(['account_deletion_requests', 'legal_hold_objects', 'chat_messages', 'user_blocks']),
    );
    expect(client.query.mock.calls.every(([sql]) => !/^\s*(CREATE|ALTER|DROP)/i.test(String(sql)))).toBe(true);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('fails closed when the expected release migration is absent', async () => {
    const client = { query: vi.fn(async () => ({ rows: [] })), release: vi.fn() };
    const pool = { connect: vi.fn(async () => client), query: vi.fn(), end: vi.fn() };
    const adapter = new PostgresAdapter({
      pool: pool as never,
      runtimeSchemaDdl: false,
      expectedSchemaMigration: '000015_game_seats_result_outbox',
      expectedSchemaChecksum: checksum,
    });

    await expect(adapter.connect()).rejects.toThrow('not applied');
    expect(client.release).toHaveBeenCalledOnce();
  });
});
