import { afterEach, describe, expect, it, vi } from 'vitest';
import { matchMaker } from '@colyseus/core';
import { createRequire } from 'node:module';
import type { WebSocketTransport } from '@colyseus/ws-transport';
import { assertPlatformRuntimeSchema, createPlatformRuntime, platformPendingInviteRedisOptions } from '../runtime';
import { CustomRoom, InviteRoom, LobbyRoom, MatchShellRoom, QuickMatchRoom } from '../rooms';
import { platformMetricsRegister, platformMetricsText } from '../metrics';
import { PLATFORM_PENDING_INVITE_DISCOVERY_PATH } from '../pendingInviteDiscovery';

const require = createRequire(import.meta.url);
const {
  REQUIRED_PLATFORM_RUNTIME_TABLES,
  REQUIRED_PLATFORM_RUNTIME_COLUMNS,
  REQUIRED_PLATFORM_RUNTIME_COLUMN_CONTRACTS,
  REQUIRED_PLATFORM_RUNTIME_CONSTRAINTS,
  REQUIRED_PLATFORM_RUNTIME_INDEXES,
} = require('../../../api/schemaGate.cjs') as {
  REQUIRED_PLATFORM_RUNTIME_TABLES: string[];
  REQUIRED_PLATFORM_RUNTIME_COLUMNS: Record<string, string[]>;
  REQUIRED_PLATFORM_RUNTIME_COLUMN_CONTRACTS: Array<{
    tableName: string;
    columnName: string;
    udtName: string;
    nullable: boolean;
    defaultToken: string | null;
  }>;
  REQUIRED_PLATFORM_RUNTIME_CONSTRAINTS: Array<{
    tableName: string;
    constraintName?: string;
    constraintType: string;
    fragments: string[];
  }>;
  REQUIRED_PLATFORM_RUNTIME_INDEXES: Array<{ tableName: string; indexName: string; fragments: string[] }>;
};

const PLATFORM_ENV_KEYS = [
  'NODE_ENV',
  'PLATFORM_PORT',
  'PLATFORM_PUBLIC_ADDRESS',
  'PLATFORM_REDIS_MODE',
  'PLATFORM_FRIEND_STORE',
  'PLATFORM_BLOCK_STORE',
  'PLATFORM_MATCH_PARTICIPANT_STORE',
  'PLATFORM_CHAT_PREVIEW_STORE',
  'PLATFORM_DRAIN_GRACE_MS',
  'ALLOWED_ORIGINS',
  'APP_VERSION',
  'APP_BUILD_ID',
  'GAME_RULES_VERSION',
  'RUNTIME_SCHEMA_DDL',
  'EXPECTED_SCHEMA_MIGRATION',
  'EXPECTED_SCHEMA_CHECKSUM',
  'PLATFORM_INVITE_DISCOVERY_QUERY_TIMEOUT_MS',
  'PLATFORM_MATCHMAKER_REDIS_COMMAND_TIMEOUT_MS',
] as const;

const originalEnv = new Map<string, string | undefined>(
  PLATFORM_ENV_KEYS.map((key) => [key, process.env[key]] as const),
);

function setLocalPlatformEnv() {
  process.env.NODE_ENV = 'test';
  delete process.env.PLATFORM_PORT;
  delete process.env.PLATFORM_PUBLIC_ADDRESS;
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
  it('builds the dedicated pending invite Redis client options with a command timeout', () => {
    expect(platformPendingInviteRedisOptions(1_234, { rejectUnauthorized: true })).toEqual({
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      commandTimeout: 1_234,
      tls: { rejectUnauthorized: true },
    });
  });

  it.each([
    ['PLATFORM_INVITE_DISCOVERY_QUERY_TIMEOUT_MS', 'abc'],
    ['PLATFORM_INVITE_DISCOVERY_QUERY_TIMEOUT_MS', '99'],
    ['PLATFORM_INVITE_DISCOVERY_QUERY_TIMEOUT_MS', '5001'],
    ['PLATFORM_MATCHMAKER_REDIS_COMMAND_TIMEOUT_MS', 'abc'],
    ['PLATFORM_MATCHMAKER_REDIS_COMMAND_TIMEOUT_MS', '99'],
    ['PLATFORM_MATCHMAKER_REDIS_COMMAND_TIMEOUT_MS', '5001'],
  ] as const)('rejects invalid runtime timeout %s=%s before constructing services', (key, value) => {
    setLocalPlatformEnv();
    process.env[key] = value;

    expect(() => createPlatformRuntime({ gracefullyShutdown: false })).toThrow(
      `${key} must be an integer between 100 and 5000`,
    );
  });

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

  it('advertises the process-specific Colyseus address from an absolute WebSocket URL', async () => {
    setLocalPlatformEnv();
    process.env.PLATFORM_PUBLIC_ADDRESS = 'wss://platform-blue.example.test/colyseus/blue/';

    const platform = createPlatformRuntime({ gracefullyShutdown: false });

    expect(platform.publicAddress).toBe('wss://platform-blue.example.test/colyseus/blue');
    expect(platform.gameServer.options.publicAddress).toBe('platform-blue.example.test/colyseus/blue');
    await expect(platform.schemaReady).resolves.toBeUndefined();
    await platform.closeStores();
  });

  it('registers authenticated pending invite discovery on the platform HTTP runtime', async () => {
    setLocalPlatformEnv();
    const verifyUserId = vi.fn(async () => 'u_runtime');
    const queryRooms = vi.fn(async () => [
      {
        name: 'invite',
        roomId: 'runtime_invite_room',
        locked: false,
        metadata: { kind: 'invite', status: 'pending', targetUserId: 'u_runtime' },
      },
    ]);
    const platform = createPlatformRuntime({
      gracefullyShutdown: false,
      pendingInviteDiscovery: { verifyUserId, queryRooms },
    });
    await expect(platform.schemaReady).resolves.toBeUndefined();
    const expressApp = (platform.gameServer.transport as WebSocketTransport).getExpressApp();
    const router = expressApp as unknown as {
      router: { stack: Array<{ route?: { path?: string; methods?: Record<string, boolean> } }> };
    };
    const route = router.router.stack.find(
      (layer) => layer.route?.path === PLATFORM_PENDING_INVITE_DISCOVERY_PATH,
    )?.route;
    expect(route?.methods?.get).toBe(true);
    await platform.closeStores();
  });

  it('uses the shared migration and checksum gate before production readiness', async () => {
    const checksum = 'a'.repeat(64);
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [{ sha256: checksum }] })
      .mockResolvedValueOnce({
        rows: REQUIRED_PLATFORM_RUNTIME_TABLES.map((table_name) => ({ table_name, present: true })),
      })
      .mockResolvedValueOnce({
        rows: Object.entries(REQUIRED_PLATFORM_RUNTIME_COLUMNS).flatMap(([table_name, columns]) =>
          columns.map((column_name) => ({ table_name, column_name, present: true })),
        ),
      })
      .mockResolvedValueOnce({
        rows: REQUIRED_PLATFORM_RUNTIME_COLUMN_CONTRACTS.map((contract) => ({
          table_name: contract.tableName,
          column_name: contract.columnName,
          udt_name: contract.udtName,
          is_nullable: contract.nullable ? 'YES' : 'NO',
          column_default: contract.defaultToken,
          present: true,
        })),
      })
      .mockResolvedValueOnce({
        rows: REQUIRED_PLATFORM_RUNTIME_CONSTRAINTS.map((contract) => ({
          table_name: contract.tableName,
          constraint_name: contract.constraintName || `${contract.tableName}_${contract.constraintType}`,
          constraint_type: contract.constraintType,
          definition: contract.fragments.join(' '),
        })),
      })
      .mockResolvedValueOnce({
        rows: REQUIRED_PLATFORM_RUNTIME_INDEXES.map((contract) => ({
          table_name: contract.tableName,
          index_name: contract.indexName,
          index_definition: contract.fragments.join(' '),
        })),
      })
      .mockResolvedValueOnce({ rows: [{ pending_count: '0' }] });

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

  it('applies admission, metrics, request IDs, and error remapping on real matchmaking HTTP requests', async () => {
    setLocalPlatformEnv();
    process.env.ALLOWED_ORIGINS = 'https://cards.example.test';
    platformMetricsRegister.resetMetrics();
    const limiter = { check: vi.fn(async () => true) };
    const verifyAdmissionUserId = vi.fn(async () => '');
    const platform = createPlatformRuntime({
      gracefullyShutdown: false,
      admissionLimiter: limiter,
      verifyAdmissionUserId,
    });

    await platform.listen(0);
    const address = platform.httpServer.address();
    expect(address).not.toBeNull();
    const baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    const post = (path: string, init: RequestInit = {}) =>
      fetch(`${baseUrl}${path}`, {
        ...init,
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://cards.example.test', ...init.headers },
        body: init.body ?? '{}',
      });

    try {
      const revoked = await post('/matchmake/join/lobby', {
        headers: { cookie: 'zutomayo_session=revoked-token' },
      });
      expect(revoked.status).toBe(401);
      expect(await revoked.json()).toMatchObject({ error: 'Invalid or revoked authentication' });
      expect(revoked.headers.get('x-request-id')).toBeTruthy();
      expect(limiter.check).not.toHaveBeenCalled();

      limiter.check.mockResolvedValueOnce(false);
      const roomCountBeforeRejection = matchMaker.stats.local.roomCount;
      const exhausted = await post('/matchmake/create/custom_room');
      expect(exhausted.status).toBe(429);
      expect(exhausted.headers.get('retry-after')).toBe('60');
      expect(matchMaker.stats.local.roomCount).toBe(roomCountBeforeRejection);

      const created = await post('/matchmake/joinOrCreate/lobby', {
        body: JSON.stringify({ userId: 'guest:http-integration', displayName: 'HTTP integration', role: 'spectator' }),
      });
      expect(created.status).toBe(200);
      const reservation = (await created.json()) as { roomId?: string };
      expect(reservation.roomId).toBeTruthy();
      if (reservation.roomId) await matchMaker.getLocalRoomById(reservation.roomId)?.disconnect();

      const cases = [
        ['/matchmake/notAMethod/custom_room', 520, 'invalid method'],
        ['/matchmake/join/custom_room', 521, 'no rooms found with provided criteria'],
        ['/matchmake/joinById/not-a-real-room-id', 522, 'room'],
      ] as const;
      for (const [path, platformCode, detail] of cases) {
        const response = await post(path, { headers: { 'x-request-id': `req_${platformCode}` } });
        expect(response.status).toBe(404);
        expect(response.headers.get('x-platform-error-code')).toBe(String(platformCode));
        expect(response.headers.get('x-request-id')).toBe(`req_${platformCode}`);
        expect(response.headers.get('access-control-allow-origin')).toBe('https://cards.example.test');
        expect(await response.json()).toMatchObject({
          code: platformCode,
          platformCode,
          requestId: `req_${platformCode}`,
          error: expect.stringContaining(detail),
        });
      }

      expect(limiter.check).toHaveBeenCalledWith({ ip: '127.0.0.1' });
      const preflight = await fetch(`${baseUrl}/matchmake/join/custom_room`, {
        method: 'OPTIONS',
        headers: { origin: 'https://not-allowed.example.test' },
      });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get('access-control-allow-origin')).toBe('null');
      const metrics = await platformMetricsText();
      expect(metrics.body).toContain(
        'platform_http_requests_total{method="POST",path="/matchmake/:operation/:room",status="404"} 3',
      );
      expect(metrics.body).toContain(
        'platform_http_requests_total{method="POST",path="/matchmake/:operation/:room",status="429"} 1',
      );
      expect(metrics.body).toContain(
        'platform_http_requests_total{method="POST",path="/matchmake/:operation/:room",status="200"} 1',
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        platform.httpServer.close((error) => (error ? reject(error) : resolve())),
      );
      await platform.closeStores();
    }
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
