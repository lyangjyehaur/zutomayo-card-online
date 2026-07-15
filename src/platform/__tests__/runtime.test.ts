import { afterEach, describe, expect, it, vi } from 'vitest';
import { matchMaker } from '@colyseus/core';
import { createRequire } from 'node:module';
import { assertPlatformRuntimeSchema, createPlatformRuntime } from '../runtime';
import { CustomRoom, InviteRoom, LobbyRoom, MatchShellRoom, QuickMatchRoom } from '../rooms';

const require = createRequire(import.meta.url);
const {
  REQUIRED_RUNTIME_TABLES,
  REQUIRED_RUNTIME_COLUMNS,
  REQUIRED_RUNTIME_COLUMN_CONTRACTS,
  REQUIRED_RUNTIME_CONSTRAINTS,
  REQUIRED_RUNTIME_INDEXES,
} = require('../../../api/schemaGate.cjs') as {
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

const PLATFORM_ENV_KEYS = [
  'NODE_ENV',
  'PLATFORM_PORT',
  'PLATFORM_REDIS_MODE',
  'PLATFORM_FRIEND_STORE',
  'PLATFORM_BLOCK_STORE',
  'PLATFORM_MATCH_PARTICIPANT_STORE',
  'PLATFORM_CHAT_PREVIEW_STORE',
  'PLATFORM_DRAIN_GRACE_MS',
  'APP_VERSION',
  'APP_BUILD_ID',
  'GAME_RULES_VERSION',
  'RUNTIME_SCHEMA_DDL',
  'EXPECTED_SCHEMA_MIGRATION',
  'EXPECTED_SCHEMA_CHECKSUM',
] as const;

const originalEnv = new Map<string, string | undefined>(
  PLATFORM_ENV_KEYS.map((key) => [key, process.env[key]] as const),
);

function setLocalPlatformEnv() {
  process.env.NODE_ENV = 'test';
  delete process.env.PLATFORM_PORT;
  process.env.PLATFORM_REDIS_MODE = 'memory';
  process.env.PLATFORM_FRIEND_STORE = 'none';
  process.env.PLATFORM_BLOCK_STORE = 'none';
  process.env.PLATFORM_MATCH_PARTICIPANT_STORE = 'none';
  process.env.PLATFORM_CHAT_PREVIEW_STORE = 'none';
  process.env.PLATFORM_DRAIN_GRACE_MS = '0';
  process.env.APP_VERSION = '1.2.3';
  process.env.APP_BUILD_ID = 'build-test';
  process.env.GAME_RULES_VERSION = 'rules-test';
  delete process.env.RUNTIME_SCHEMA_DDL;
  delete process.env.EXPECTED_SCHEMA_MIGRATION;
  delete process.env.EXPECTED_SCHEMA_CHECKSUM;
}

afterEach(() => {
  for (const roomName of ['lobby', 'match_shell', 'quick_match', 'custom_room', 'invite']) {
    matchMaker.removeRoomType(roomName);
  }
  for (const key of PLATFORM_ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('platform runtime', () => {
  it('constructs the documented Colyseus platform shell in local memory mode', async () => {
    setLocalPlatformEnv();

    const platform = createPlatformRuntime({ gracefullyShutdown: false });

    expect(platform.port).toBe(3002);
    expect(platform.redisMode).toBe('memory');
    expect(platform.friendStoreMode).toBe('none');
    expect(platform.blockStoreMode).toBe('none');
    expect(platform.matchParticipantStoreMode).toBe('none');
    expect(platform.chatPreviewStoreMode).toBe('none');
    expect(platform.gameServer.options.presence).toBeUndefined();
    expect(platform.gameServer.options.driver).toBeUndefined();
    expect(platform.gameServer.options.greet).toBe(false);
    expect(platform.isDraining()).toBe(false);
    expect(platform.beginDrain()).toBe(true);
    expect(platform.isDraining()).toBe(true);
    expect(platform.versionInfo).toEqual({
      appVersion: '1.2.3',
      buildId: 'build-test',
      rulesVersion: 'rules-test',
    });
    await expect(platform.schemaReady).resolves.toBeUndefined();

    const roomDefinitions = [
      ['lobby', LobbyRoom, []],
      ['match_shell', MatchShellRoom, ['boardgameMatchID', 'status']],
      ['quick_match', QuickMatchRoom, ['status']],
      ['custom_room', CustomRoom, ['roomCode', 'status']],
      ['invite', InviteRoom, ['inviteId', 'status', 'targetUserId']],
    ] as const;

    for (const [roomName, roomClass, filterOptions] of roomDefinitions) {
      const handler = matchMaker.getHandler(roomName);
      expect(handler.klass).toBe(roomClass);
      expect(handler.filterOptions).toEqual(filterOptions);
    }

    await platform.closeStores();
  });

  it('uses the shared migration and checksum gate before production readiness', async () => {
    const checksum = 'a'.repeat(64);
    const query = vi
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
      });

    await expect(
      assertPlatformRuntimeSchema({ query } as never, {
        NODE_ENV: 'production',
        EXPECTED_SCHEMA_MIGRATION: '000020_schema_checksums',
        EXPECTED_SCHEMA_CHECKSUM: checksum,
      }),
    ).resolves.toBeUndefined();
    expect(query).toHaveBeenNthCalledWith(1, 'SELECT 1 FROM public.schema_migrations WHERE name = $1 LIMIT 1', [
      '000020_schema_checksums',
    ]);
  });

  it('fails closed when production has no PostgreSQL schema authority', async () => {
    await expect(
      assertPlatformRuntimeSchema(null, {
        NODE_ENV: 'production',
        EXPECTED_SCHEMA_MIGRATION: '000020_schema_checksums',
        EXPECTED_SCHEMA_CHECKSUM: 'a'.repeat(64),
      }),
    ).rejects.toThrow('requires PostgreSQL');
  });
});
