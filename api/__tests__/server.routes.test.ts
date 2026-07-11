import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// ===== Environment setup (must happen before requiring server.cjs) =====
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters!!';
process.env.NODE_ENV = 'test';
process.env.APP_VERSION = '0.1.3';
delete process.env.TURNSTILE_SECRET_KEY;
delete process.env.TURNSTILE_REQUIRED;
delete process.env.SENTRY_DSN;
delete process.env.ALLOWED_ORIGINS; // Use dev origins fallback
delete process.env.CHAT_TRANSLATION_ENDPOINT;
delete process.env.CHAT_TRANSLATION_API_KEY;
delete process.env.CHAT_TRANSLATION_PROVIDER;
delete process.env.CHAT_TRANSLATION_MODEL;
delete process.env.CHAT_TRANSLATION_TIMEOUT_MS;

// ===== Mock pg and ioredis via Module._load interception =====
const mockQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
const mockPoolEnd = vi.fn().mockResolvedValue(undefined);
const mockPoolOn = vi.fn();
const mockPool = { query: mockQuery, end: mockPoolEnd, on: mockPoolOn };

const mockRedisIncr = vi.fn().mockResolvedValue(1);
const mockRedisExpire = vi.fn().mockResolvedValue(1);
const mockRedisPing = vi.fn().mockResolvedValue('PONG');
const mockRedisQuit = vi.fn().mockResolvedValue(undefined);
const mockRedisDefineCommand = vi.fn();
const mockRedisOn = vi.fn();
const mockRedisHgetall = vi.fn().mockResolvedValue({});
const mockRedisHset = vi.fn().mockResolvedValue(1);
const mockRedisZadd = vi.fn().mockResolvedValue(1);
const mockRedisZrem = vi.fn().mockResolvedValue(1);
const mockRedisZcount = vi.fn().mockResolvedValue(0);
const mockRedisZremrangebyscore = vi.fn().mockResolvedValue(0);
const mockRedisDel = vi.fn().mockResolvedValue(1);
const mockRedisGet = vi.fn().mockResolvedValue(null);
const mockRedisSet = vi.fn().mockResolvedValue('OK');
const mockRedisMmTryMatch = vi.fn().mockResolvedValue('');
const mockRedisMmCleanExpired = vi.fn().mockResolvedValue(0);

const mockRedis = {
  incr: mockRedisIncr,
  expire: mockRedisExpire,
  ping: mockRedisPing,
  quit: mockRedisQuit,
  defineCommand: mockRedisDefineCommand,
  on: mockRedisOn,
  hgetall: mockRedisHgetall,
  hset: mockRedisHset,
  zadd: mockRedisZadd,
  zrem: mockRedisZrem,
  zcount: mockRedisZcount,
  zremrangebyscore: mockRedisZremrangebyscore,
  del: mockRedisDel,
  get: mockRedisGet,
  set: mockRedisSet,
  mmTryMatch: mockRedisMmTryMatch,
  mmCleanExpired: mockRedisMmCleanExpired,
};

// Clear cached pg and ioredis so Module._load interception returns our mocks.
const cacheCleaner = createRequire(import.meta.url);
for (const key of Object.keys(cacheCleaner.cache)) {
  if (key.includes('/node_modules/pg/') || key.includes('/node_modules/ioredis/')) {
    delete cacheCleaner.cache[key];
  }
}

// Intercept Module._load to mock pg and ioredis during server.cjs load.
const nodeRequire = createRequire(import.meta.url);
const Module_ = nodeRequire('module') as typeof import('node:module');
const originalLoad = Module_._load;
Module_._load = function (request: string, parent: NodeJS.Module | undefined, isMain: boolean) {
  if (request === 'pg') {
    return {
      Pool: function () {
        return mockPool;
      },
    };
  }
  if (request === 'ioredis') {
    return function () {
      return mockRedis;
    };
  }
  return originalLoad.call(Module_, request, parent, isMain);
};

const require_ = createRequire(import.meta.url);
const serverModule = require_('../server.cjs') as {
  handleRequest: (req: unknown, res: unknown) => void;
};
Module_._load = originalLoad;

const { handleRequest } = serverModule;

// ===== Mock req/res helpers =====

interface MockRes {
  statusCode: number;
  headers: Record<string, string>;
  headersSent: boolean;
  ended: boolean;
  destroyed: boolean;
  _body: string;
  setHeader: (name: string, value: string) => void;
  getHeader: (name: string) => string | undefined;
  writeHead: (status: number, headers?: Record<string, string>) => void;
  end: (data?: unknown) => void;
  destroy: (err?: unknown) => void;
  once: (event: string, cb: () => void) => void;
  on: (event: string, cb: (...args: unknown[]) => void) => void;
}

function createMockReq(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  const bodyStr = body !== undefined && body !== null ? JSON.stringify(body) : '';
  return {
    method,
    url,
    headers: { ...headers },
    socket: { remoteAddress: '127.0.0.1', localPort: 3001 },
    on(event: string, cb: (chunk?: unknown) => void) {
      if (event === 'data' && bodyStr) {
        process.nextTick(() => cb(bodyStr));
      } else if (event === 'end') {
        process.nextTick(() => cb());
      }
    },
  };
}

function createMockRes(resolveEnd: () => void): MockRes {
  const listeners: Record<string, Array<() => void>> = {};
  const res: MockRes = {
    statusCode: 200,
    headers: {},
    headersSent: false,
    ended: false,
    destroyed: false,
    _body: '',
    setHeader(name, value) {
      res.headers[name.toLowerCase()] = value;
    },
    getHeader(name) {
      return res.headers[name.toLowerCase()];
    },
    writeHead(status, headers) {
      res.statusCode = status;
      if (headers) {
        for (const [k, v] of Object.entries(headers)) {
          res.headers[k.toLowerCase()] = v;
        }
      }
      res.headersSent = true;
    },
    end(data) {
      if (data !== undefined) res._body = String(data);
      res.headersSent = true;
      res.ended = true;
      // Emit 'finish' event like Node.js ServerResponse does
      const finishCbs = listeners['finish'];
      if (finishCbs) for (const cb of finishCbs) cb();
      resolveEnd();
    },
    destroy() {
      res.destroyed = true;
      resolveEnd();
    },
    once(event, cb) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(cb);
    },
    on(event, cb) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(cb as () => void);
    },
  };
  return res;
}

async function sendRequest(
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<MockRes> {
  const req = createMockReq(method, url, body, headers);
  let resolveEnd: () => void;
  const endPromise = new Promise<void>((resolve) => {
    resolveEnd = resolve;
  });
  const res = createMockRes(resolveEnd!);
  handleRequest(req, res);
  await Promise.race([
    endPromise,
    new Promise<void>((_, reject) => setTimeout(() => reject(new Error('Response timeout')), 5000)),
  ]);
  return res;
}

function parseBody(res: MockRes): Record<string, unknown> | string {
  try {
    return JSON.parse(res._body) as Record<string, unknown>;
  } catch {
    return res._body;
  }
}

function mockMatchParticipant() {
  mockQuery.mockResolvedValueOnce({ rows: [{ exists: 1 }], rowCount: 1 });
}

function mockRoomParticipant() {
  mockQuery.mockResolvedValueOnce({ rows: [{ exists: 1 }], rowCount: 1 });
}

function base64urlJson(value: Record<string, unknown>) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function createAdminJwt() {
  const now = Math.floor(Date.now() / 1000);
  const header = base64urlJson({ alg: 'HS256', typ: 'JWT' });
  const payload = base64urlJson({ admin: true, iat: now, exp: now + 60 * 60 });
  const input = `${header}.${payload}`;
  const signature = crypto
    .createHmac('sha256', process.env.JWT_SECRET || '')
    .update(input)
    .digest('base64url');
  return `${input}.${signature}`;
}

function createUserJwt(userId = 'u_test') {
  const now = Math.floor(Date.now() / 1000);
  const header = base64urlJson({ alg: 'HS256', typ: 'JWT' });
  const payload = base64urlJson({ sub: userId, userId, iat: now, exp: now + 60 * 60 });
  const input = `${header}.${payload}`;
  const signature = crypto
    .createHmac('sha256', process.env.JWT_SECRET || '')
    .update(input)
    .digest('base64url');
  return `${input}.${signature}`;
}

function adminHeaders(headers: Record<string, string> = {}) {
  return {
    authorization: `Bearer ${createAdminJwt()}`,
    ...headers,
  };
}

function userUnsafeHeaders(userId = 'u_test') {
  const csrfToken = 'valid-csrf-token-for-testing-1234567890';
  return {
    authorization: `Bearer ${createUserJwt(userId)}`,
    cookie: `zutomayo_csrf=${csrfToken}`,
    'x-csrf-token': csrfToken,
  };
}

function adminUnsafeHeaders() {
  const csrfToken = 'valid-csrf-token-for-testing-1234567890';
  return adminHeaders({
    cookie: `zutomayo_csrf=${csrfToken}`,
    'x-csrf-token': csrfToken,
  });
}

// ===== Tests =====

describe('server routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset default mock behavior after clearAllMocks
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    mockRedisIncr.mockResolvedValue(1);
    mockRedisExpire.mockResolvedValue(1);
    mockRedisPing.mockResolvedValue('PONG');
    mockRedisZcount.mockResolvedValue(0);
    mockRedisZremrangebyscore.mockResolvedValue(0);
    mockRedisZadd.mockResolvedValue(1);
    mockRedisHgetall.mockResolvedValue({});
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
  });

  describe('security headers', () => {
    it('sets X-Content-Type-Options: nosniff', async () => {
      const res = await sendRequest('GET', '/api/app-version');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('sets X-Frame-Options: DENY', async () => {
      const res = await sendRequest('GET', '/api/app-version');
      expect(res.headers['x-frame-options']).toBe('DENY');
    });

    it('sets Strict-Transport-Security header', async () => {
      const res = await sendRequest('GET', '/api/app-version');
      expect(res.headers['strict-transport-security']).toContain('max-age=31536000');
    });

    it('sets Referrer-Policy: no-referrer', async () => {
      const res = await sendRequest('GET', '/api/app-version');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
    });

    it('sets Permissions-Policy header', async () => {
      const res = await sendRequest('GET', '/api/app-version');
      expect(res.headers['permissions-policy']).toContain('geolocation=()');
    });
  });

  describe('CORS', () => {
    it('allows requests from whitelisted localhost origin', async () => {
      const res = await sendRequest('GET', '/api/app-version', null, {
        origin: 'http://localhost:5173',
      });
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
      expect(res.headers['vary']).toBe('Origin');
    });

    it('does not set CORS origin for unknown origins', async () => {
      const res = await sendRequest('GET', '/api/app-version', null, {
        origin: 'http://evil.example.com',
      });
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('responds 200 to OPTIONS preflight from allowed origin', async () => {
      const res = await sendRequest('OPTIONS', '/api/app-version', null, {
        origin: 'http://localhost:5173',
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    });

    it('sets Allow-Methods and Allow-Headers on all responses', async () => {
      const res = await sendRequest('GET', '/api/app-version');
      expect(res.headers['access-control-allow-methods']).toContain('GET');
      expect(res.headers['access-control-allow-headers']).toContain('Authorization');
    });
  });

  describe('health endpoint', () => {
    it('returns 200 when PG and Redis are healthy', async () => {
      mockQuery.mockResolvedValue({ rows: [{ '?column?': 1 }] });
      mockRedisPing.mockResolvedValue('PONG');
      const res = await sendRequest('GET', '/health');
      expect(res.statusCode).toBe(200);
      const body = parseBody(res) as Record<string, unknown>;
      expect(body.status).toBe('ok');
      expect(body.checks).toEqual({ postgres: 'up', redis: 'up' });
    });

    it('returns 503 degraded when PG is down', async () => {
      mockQuery.mockRejectedValue(new Error('PG connection failed'));
      mockRedisPing.mockResolvedValue('PONG');
      const res = await sendRequest('GET', '/health');
      expect(res.statusCode).toBe(503);
      const body = parseBody(res) as Record<string, unknown>;
      expect(body.status).toBe('degraded');
      expect((body.checks as Record<string, unknown>).postgres).toBe('down');
    });

    it('returns 503 degraded when Redis is down', async () => {
      mockQuery.mockResolvedValue({ rows: [{ '?column?': 1 }] });
      mockRedisPing.mockRejectedValue(new Error('Redis down'));
      const res = await sendRequest('GET', '/health');
      expect(res.statusCode).toBe(503);
      const body = parseBody(res) as Record<string, unknown>;
      expect(body.status).toBe('degraded');
      expect((body.checks as Record<string, unknown>).redis).toBe('down');
    });
  });

  describe('version endpoints', () => {
    it('GET /api/app-version returns version info', async () => {
      const res = await sendRequest('GET', '/api/app-version');
      expect(res.statusCode).toBe(200);
      const body = parseBody(res) as Record<string, unknown>;
      expect(body.appVersion).toBe('0.1.3');
      expect(body.buildId).toBeDefined();
      expect(body.rulesVersion).toBeDefined();
    });

    it('GET /api/version returns same version info', async () => {
      const res = await sendRequest('GET', '/api/version');
      expect(res.statusCode).toBe(200);
      const body = parseBody(res) as Record<string, unknown>;
      expect(body.appVersion).toBe('0.1.3');
    });
  });

  describe('oauth providers', () => {
    it('GET /api/oauth/providers returns provider config', async () => {
      const res = await sendRequest('GET', '/api/oauth/providers');
      expect(res.statusCode).toBe(200);
      const body = parseBody(res) as Record<string, unknown>;
      expect(body.authMode).toBeDefined();
      expect(body.localAuthEnabled).toBe(true);
      expect(Array.isArray(body.providers)).toBe(true);
    });
  });

  describe('input validation', () => {
    it('POST /api/register rejects missing email', async () => {
      const res = await sendRequest('POST', '/api/register', { password: 'secret1' });
      expect(res.statusCode).toBe(400);
      const body = parseBody(res) as Record<string, unknown>;
      expect(body.error).toContain('Validation');
    });

    it('POST /api/register rejects short password', async () => {
      const res = await sendRequest('POST', '/api/register', {
        email: 'a@b.com',
        password: '123',
      });
      expect(res.statusCode).toBe(400);
    });

    it('POST /api/login rejects empty body', async () => {
      const res = await sendRequest('POST', '/api/login', {});
      expect(res.statusCode).toBe(400);
    });

    it('POST /api/admin/login rejects missing password', async () => {
      const res = await sendRequest('POST', '/api/admin/login', {});
      expect(res.statusCode).toBe(400);
    });

    it('POST /api/presence/heartbeat rejects missing visitorId', async () => {
      const res = await sendRequest('POST', '/api/presence/heartbeat', {});
      expect(res.statusCode).toBe(400);
    });

    it('POST /api/presence/heartbeat rejects invalid visitorId format', async () => {
      const res = await sendRequest('POST', '/api/presence/heartbeat', { visitorId: 'short' });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('404 routing', () => {
    it('returns 404 for unknown path', async () => {
      const res = await sendRequest('GET', '/unknown-path');
      expect(res.statusCode).toBe(404);
    });

    it('returns 404 for unknown API path', async () => {
      const res = await sendRequest('GET', '/api/nonexistent');
      expect(res.statusCode).toBe(404);
    });
  });

  describe('auth middleware', () => {
    it('GET /api/profile returns 401 without auth', async () => {
      const res = await sendRequest('GET', '/api/profile');
      expect(res.statusCode).toBe(401);
    });

    it('GET /api/friends returns 401 without auth', async () => {
      const res = await sendRequest('GET', '/api/friends');
      expect(res.statusCode).toBe(401);
    });

    it('GET /api/decks returns 401 without auth', async () => {
      const res = await sendRequest('GET', '/api/decks');
      expect(res.statusCode).toBe(401);
    });

    it('GET /api/matches returns 401 without auth', async () => {
      const res = await sendRequest('GET', '/api/matches');
      expect(res.statusCode).toBe(401);
    });

    it('GET /api/chat/messages returns 401 without auth', async () => {
      const res = await sendRequest('GET', '/api/chat/messages?type=match&subjectId=bgio-match-1');
      expect(res.statusCode).toBe(401);
    });

    it('POST /api/chat/messages returns 401 without auth even with valid CSRF', async () => {
      const csrfToken = 'valid-csrf-token-for-testing-1234567890';
      const res = await sendRequest(
        'POST',
        '/api/chat/messages',
        {
          conversationType: 'match',
          subjectId: 'bgio-match-1',
          content: 'anonymous spectator message',
          authorDisplayName: 'Spectator',
          authorRole: 'spectator',
        },
        {
          cookie: `zutomayo_csrf=${csrfToken}`,
          'x-csrf-token': csrfToken,
        },
      );
      expect(res.statusCode).toBe(401);
    });

    it('GET /api/chat/unread returns 401 without auth', async () => {
      const res = await sendRequest('GET', '/api/chat/unread');
      expect(res.statusCode).toBe(401);
    });

    it('GET /api/chat/unread keeps tombstoned-author conversations in summaries', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'match:bgio-match-1',
            type: 'match',
            subject_id: 'bgio-match-1',
            title: 'Ranked match',
            status: 'active',
            created_at: '2026-07-10T00:00:00.000Z',
            updated_at: '2026-07-10T00:00:06.000Z',
            unread_count: '2',
            latest_message_at: '2026-07-10T00:00:06.000Z',
          },
        ],
      });
      mockMatchParticipant();

      const res = await sendRequest('GET', '/api/chat/unread?limit=10', null, userUnsafeHeaders('u_reader'));
      expect(res.statusCode).toBe(200);
      const body = parseBody(res) as { conversations: Array<Record<string, unknown>> };
      expect(body.conversations).toEqual([
        expect.objectContaining({
          id: 'match:bgio-match-1',
          type: 'match',
          subjectId: 'bgio-match-1',
          unreadCount: 2,
          latestMessageAt: '2026-07-10T00:00:06.000Z',
        }),
      ]);
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('FROM user_friends'), ['u_reader']);
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('FROM platform_match_participants'), [
        'u_reader',
        10,
        'u_reader',
        true,
        [],
        true,
        true,
      ]);
    });

    it('GET /api/admin/users returns 401 without admin token', async () => {
      const res = await sendRequest('GET', '/api/admin/users');
      expect(res.statusCode).toBe(401);
    });

    it('GET /api/admin/matches returns 401 without admin token', async () => {
      const res = await sendRequest('GET', '/api/admin/matches');
      expect(res.statusCode).toBe(401);
    });

    it('GET /api/admin/chat/reports returns 401 without admin token', async () => {
      const res = await sendRequest('GET', '/api/admin/chat/reports');
      expect(res.statusCode).toBe(401);
    });

    it('GET /api/admin/chat/conversations/:conversationId/messages returns 401 without admin token', async () => {
      const res = await sendRequest('GET', '/api/admin/chat/conversations/match%3Abgio-match-1/messages');
      expect(res.statusCode).toBe(401);
    });

    it('POST /api/admin/chat/sanctions returns 401 without admin token', async () => {
      const csrfToken = 'valid-csrf-token-for-testing-1234567890';
      const res = await sendRequest(
        'POST',
        '/api/admin/chat/sanctions',
        {
          targetUserId: 'u_1',
          durationMinutes: 1440,
        },
        {
          cookie: `zutomayo_csrf=${csrfToken}`,
          'x-csrf-token': csrfToken,
        },
      );
      expect(res.statusCode).toBe(401);
    });

    it('DELETE /api/admin/chat/sanctions/:sanctionId returns 401 without admin token', async () => {
      const csrfToken = 'valid-csrf-token-for-testing-1234567890';
      const res = await sendRequest('DELETE', '/api/admin/chat/sanctions/chat_sanction_1', null, {
        cookie: `zutomayo_csrf=${csrfToken}`,
        'x-csrf-token': csrfToken,
      });
      expect(res.statusCode).toBe(401);
    });

    it('GET /api/matchmaking/status returns 401 without auth', async () => {
      const res = await sendRequest('GET', '/api/matchmaking/status');
      expect(res.statusCode).toBe(401);
    });
  });

  describe('chat routes', () => {
    it('GET /api/chat/messages syncs every durable conversation type through the same route', async () => {
      const cases = [
        {
          query: { type: 'match', subjectId: 'bgio-match-1' },
          expectedKey: 'match:bgio-match-1',
        },
        {
          query: { type: 'room', subjectId: 'ROOM42' },
          expectedKey: 'room:ROOM42',
        },
        {
          query: { type: 'global', subjectId: 'online-lobby' },
          expectedKey: 'global:online-lobby',
        },
        {
          query: { type: 'direct', subjectId: 'v1:u_friend:u_reader' },
          expectedKey: 'direct:v1:u_friend:u_reader',
        },
      ];

      for (const testCase of cases) {
        mockQuery.mockReset();
        if (testCase.query.type === 'match') {
          mockMatchParticipant();
        }
        if (testCase.query.type === 'room') {
          mockRoomParticipant();
        }
        if (testCase.query.type === 'direct') {
          mockQuery.mockResolvedValueOnce({ rows: [{ exists: 1 }], rowCount: 1 });
        }
        mockQuery.mockResolvedValueOnce({
          rows: [
            {
              id: `chat_msg_${testCase.query.type}`,
              conversation_id: testCase.expectedKey,
              author_user_id: 'u_friend',
              author_display_name: 'Friend',
              author_role: 'player',
              content: `history ${testCase.query.type}`,
              source_language: 'en',
              moderation_status: 'visible',
              moderation_reason: '',
              metadata: { transport: 'api' },
              created_at: '2026-07-10T00:00:01.000Z',
              edited_at: null,
              deleted_at: null,
            },
          ],
          rowCount: 1,
        });

        const params = new URLSearchParams({
          type: testCase.query.type,
          subjectId: testCase.query.subjectId,
          limit: '10',
        });
        const res = await sendRequest(
          'GET',
          `/api/chat/messages?${params.toString()}`,
          null,
          userUnsafeHeaders('u_reader'),
        );

        expect(res.statusCode).toBe(200);
        const body = parseBody(res) as { messages: Array<Record<string, unknown>> };
        expect(body.messages).toEqual([
          expect.objectContaining({
            id: `chat_msg_${testCase.query.type}`,
            conversationId: testCase.expectedKey,
            content: `history ${testCase.query.type}`,
          }),
        ]);
        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining("moderation_status IN ('visible', 'pending_review')"),
          [testCase.expectedKey, 10],
        );
      }
    });

    it('POST /api/chat/messages persists every durable conversation type through the same route', async () => {
      const cases = [
        {
          body: { conversationType: 'match', subjectId: 'bgio-match-1', authorRole: 'player' },
          expectedKey: 'match:bgio-match-1',
          expectedType: 'match',
          expectedSubjectId: 'bgio-match-1',
        },
        {
          body: { conversationType: 'room', subjectId: 'ROOM42', authorRole: 'player' },
          expectedKey: 'room:ROOM42',
          expectedType: 'room',
          expectedSubjectId: 'ROOM42',
        },
        {
          body: { conversationType: 'global', subjectId: 'online-lobby', authorRole: 'player' },
          expectedKey: 'global:online-lobby',
          expectedType: 'global',
          expectedSubjectId: 'online-lobby',
        },
        {
          body: { conversationType: 'direct', subjectId: 'v1:u_reader:u_friend', authorRole: 'player' },
          expectedKey: 'direct:v1:u_friend:u_reader',
          expectedType: 'direct',
          expectedSubjectId: 'v1:u_friend:u_reader',
        },
      ];

      for (const testCase of cases) {
        mockQuery.mockReset();
        if (testCase.expectedType === 'match') {
          mockMatchParticipant();
        }
        if (testCase.expectedType === 'room') {
          mockRoomParticipant();
        }
        if (testCase.expectedType === 'direct') {
          mockQuery.mockResolvedValueOnce({ rows: [{ exists: 1 }], rowCount: 1 });
        }
        mockQuery
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockResolvedValueOnce({
            rows: [
              {
                id: testCase.expectedKey,
                type: testCase.expectedType,
                subject_id: testCase.expectedSubjectId,
                title: '',
                status: 'active',
                created_at: '2026-07-10T00:00:00.000Z',
                updated_at: '2026-07-10T00:00:00.000Z',
              },
            ],
            rowCount: 1,
          })
          .mockResolvedValueOnce({
            rows: [
              {
                id: `chat_msg_${testCase.expectedType}`,
                conversation_id: testCase.expectedKey,
                author_user_id: 'u_reader',
                author_display_name: 'Reader',
                author_role: testCase.body.authorRole,
                content: `hello ${testCase.expectedType}`,
                source_language: 'en',
                moderation_status: 'visible',
                moderation_reason: '',
                metadata: { transport: 'api' },
                created_at: '2026-07-10T00:00:01.000Z',
                edited_at: null,
                deleted_at: null,
              },
            ],
            rowCount: 1,
          })
          .mockResolvedValueOnce({ rows: [], rowCount: 1 });

        const res = await sendRequest(
          'POST',
          '/api/chat/messages',
          {
            ...testCase.body,
            content: `hello ${testCase.expectedType}`,
            authorDisplayName: 'Reader',
            sourceLanguage: 'en',
          },
          userUnsafeHeaders('u_reader'),
        );

        expect(res.statusCode).toBe(201);
        const body = parseBody(res) as { conversation: Record<string, unknown>; message: Record<string, unknown> };
        expect(body.conversation).toEqual(
          expect.objectContaining({
            id: testCase.expectedKey,
            type: testCase.expectedType,
            subjectId: testCase.expectedSubjectId,
          }),
        );
        expect(body.message).toEqual(
          expect.objectContaining({
            conversationId: testCase.expectedKey,
            authorUserId: 'u_reader',
            content: `hello ${testCase.expectedType}`,
          }),
        );
        expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO chat_conversations'), [
          testCase.expectedKey,
          testCase.expectedType,
          testCase.expectedSubjectId,
          '',
        ]);
        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO chat_messages'),
          expect.arrayContaining([testCase.expectedKey, 'u_reader', 'Reader', testCase.body.authorRole]),
        );
      }
    });

    it('POST /api/chat/messages rejects group-shaped direct conversation subjects before persistence', async () => {
      mockQuery.mockReset();

      const res = await sendRequest(
        'POST',
        '/api/chat/messages',
        {
          conversationType: 'direct',
          subjectId: 'v1:u_reader:u_friend:u_other',
          content: 'hello group',
        },
        userUnsafeHeaders('u_reader'),
      );

      expect(res.statusCode).toBe(400);
      expect(parseBody(res)).toEqual({ error: 'Invalid conversation' });
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('POST /api/chat/messages rejects direct messages to non-friends', async () => {
      mockQuery.mockReset();
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const res = await sendRequest(
        'POST',
        '/api/chat/messages',
        {
          conversationType: 'direct',
          subjectId: 'v1:u_reader:u_stranger',
          content: 'hello stranger',
        },
        userUnsafeHeaders('u_reader'),
      );

      expect(res.statusCode).toBe(403);
      expect(parseBody(res)).toEqual({ error: 'Forbidden' });
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('FROM user_friends'), ['u_reader', 'u_stranger']);
    });

    it('POST /api/chat/messages rejects client-reported moderator roles', async () => {
      mockQuery.mockReset();

      const res = await sendRequest(
        'POST',
        '/api/chat/messages',
        {
          conversationType: 'match',
          subjectId: 'bgio-match-1',
          content: 'official-looking text',
          authorRole: 'moderator',
        },
        userUnsafeHeaders('u_reader'),
      );

      expect(res.statusCode).toBe(403);
      expect(parseBody(res)).toEqual({ error: 'Forbidden' });
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('POST /api/chat/read marks every durable conversation type through the same route', async () => {
      const cases = [
        {
          body: { conversationType: 'match', subjectId: 'bgio-match-1', lastReadMessageId: 'chat_msg_match' },
          expectedKey: 'match:bgio-match-1',
        },
        {
          body: { conversationType: 'room', subjectId: 'ROOM42', lastReadMessageId: 'chat_msg_room' },
          expectedKey: 'room:ROOM42',
        },
        {
          body: { conversationType: 'global', subjectId: 'online-lobby', lastReadMessageId: 'chat_msg_global' },
          expectedKey: 'global:online-lobby',
        },
        {
          body: { conversationType: 'direct', subjectId: 'v1:u_friend:u_reader', lastReadMessageId: 'chat_msg_direct' },
          expectedKey: 'direct:v1:u_friend:u_reader',
        },
      ];

      for (const testCase of cases) {
        mockQuery.mockClear();
        if (testCase.body.conversationType === 'match') {
          mockMatchParticipant();
        }
        if (testCase.body.conversationType === 'room') {
          mockRoomParticipant();
        }
        if (testCase.body.conversationType === 'direct') {
          mockQuery.mockResolvedValueOnce({ rows: [{ exists: 1 }], rowCount: 1 });
        }
        const res = await sendRequest('POST', '/api/chat/read', testCase.body, userUnsafeHeaders('u_reader'));
        expect(res.statusCode).toBe(200);
        expect(parseBody(res)).toEqual({ ok: true });
        expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO chat_read_states'), [
          testCase.expectedKey,
          'u_reader',
          testCase.body.lastReadMessageId,
        ]);
      }
    });

    it('POST /api/chat/messages/:messageId/translate returns 202 when translation is queued', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'chat_msg_1',
              conversation_id: 'match:bgio-match-1',
              content: 'こんにちは',
              source_language: 'ja',
              type: 'match',
              subject_id: 'bgio-match-1',
            },
          ],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [{ exists: 1 }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({
          rows: [
            {
              message_id: 'chat_msg_1',
              target_language: 'en',
              translated_content: '',
              provider: 'unconfigured',
              model: '',
              status: 'pending',
              created_at: '2026-07-10T00:00:02.000Z',
              updated_at: '2026-07-10T00:00:02.000Z',
            },
          ],
          rowCount: 1,
        });

      const res = await sendRequest(
        'POST',
        '/api/chat/messages/chat_msg_1/translate',
        { targetLanguage: 'en' },
        userUnsafeHeaders('u_reader'),
      );

      expect(res.statusCode).toBe(202);
      const body = parseBody(res) as { translation: Record<string, unknown>; cached: boolean };
      expect(body.cached).toBe(false);
      expect(body.translation).toEqual(
        expect.objectContaining({
          messageId: 'chat_msg_1',
          targetLanguage: 'en',
          provider: 'unconfigured',
          status: 'pending',
        }),
      );
      expect(mockQuery).toHaveBeenLastCalledWith(expect.stringContaining('INSERT INTO chat_message_translations'), [
        'chat_msg_1',
        'en',
        '',
        'unconfigured',
        '',
        'pending',
      ]);
    });

    it('POST /api/chat/messages/:messageId/translate queues every durable conversation type through the same route', async () => {
      const cases = [
        {
          messageId: 'chat_msg_translate_match',
          type: 'match',
          subjectId: 'bgio-match-1',
          conversationId: 'match:bgio-match-1',
        },
        {
          messageId: 'chat_msg_translate_room',
          type: 'room',
          subjectId: 'ROOM42',
          conversationId: 'room:ROOM42',
        },
        {
          messageId: 'chat_msg_translate_global',
          type: 'global',
          subjectId: 'online-lobby',
          conversationId: 'global:online-lobby',
        },
        {
          messageId: 'chat_msg_translate_direct',
          type: 'direct',
          subjectId: 'v1:u_friend:u_reader',
          conversationId: 'direct:v1:u_friend:u_reader',
        },
      ];

      for (const testCase of cases) {
        mockQuery.mockReset();
        mockQuery.mockResolvedValueOnce({
          rows: [
            {
              id: testCase.messageId,
              conversation_id: testCase.conversationId,
              content: `こんにちは ${testCase.type}`,
              source_language: 'ja',
              type: testCase.type,
              subject_id: testCase.subjectId,
            },
          ],
          rowCount: 1,
        });
        if (testCase.type === 'match') {
          mockMatchParticipant();
        }
        if (testCase.type === 'room') {
          mockRoomParticipant();
        }
        if (testCase.type === 'direct') {
          mockQuery.mockResolvedValueOnce({ rows: [{ exists: 1 }], rowCount: 1 });
        }
        mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }).mockResolvedValueOnce({
          rows: [
            {
              message_id: testCase.messageId,
              target_language: 'en',
              translated_content: '',
              provider: 'unconfigured',
              model: '',
              status: 'pending',
              created_at: '2026-07-10T00:00:02.000Z',
              updated_at: '2026-07-10T00:00:02.000Z',
            },
          ],
          rowCount: 1,
        });

        const res = await sendRequest(
          'POST',
          `/api/chat/messages/${testCase.messageId}/translate`,
          { targetLanguage: 'en' },
          userUnsafeHeaders('u_reader'),
        );

        expect(res.statusCode).toBe(202);
        const body = parseBody(res) as { translation: Record<string, unknown>; cached: boolean };
        expect(body).toEqual({
          cached: false,
          translation: expect.objectContaining({
            messageId: testCase.messageId,
            targetLanguage: 'en',
            status: 'pending',
          }),
        });
        expect(mockQuery).toHaveBeenNthCalledWith(1, expect.stringContaining('JOIN chat_conversations'), [
          testCase.messageId,
        ]);
        expect(mockQuery).toHaveBeenLastCalledWith(expect.stringContaining('INSERT INTO chat_message_translations'), [
          testCase.messageId,
          'en',
          '',
          'unconfigured',
          '',
          'pending',
        ]);
      }
    });

    it('POST /api/chat/messages/:messageId/report snapshots every durable conversation type through the same route', async () => {
      const cases = [
        {
          messageId: 'chat_msg_report_match',
          type: 'match',
          subjectId: 'bgio-match-1',
          conversationId: 'match:bgio-match-1',
        },
        {
          messageId: 'chat_msg_report_room',
          type: 'room',
          subjectId: 'ROOM42',
          conversationId: 'room:ROOM42',
        },
        {
          messageId: 'chat_msg_report_global',
          type: 'global',
          subjectId: 'online-lobby',
          conversationId: 'global:online-lobby',
        },
        {
          messageId: 'chat_msg_report_direct',
          type: 'direct',
          subjectId: 'v1:u_friend:u_reader',
          conversationId: 'direct:v1:u_friend:u_reader',
        },
      ];

      for (const testCase of cases) {
        mockQuery.mockReset();
        mockQuery.mockResolvedValueOnce({
          rows: [
            {
              id: testCase.messageId,
              conversation_id: testCase.conversationId,
              author_user_id: 'u_author',
              author_display_name: 'Author',
              author_role: testCase.type === 'match' ? 'spectator' : 'player',
              content: `reportable ${testCase.type}`,
              moderation_status: 'visible',
              created_at: '2026-07-10T00:00:01.000Z',
              conversation_type: testCase.type,
              conversation_subject_id: testCase.subjectId,
            },
          ],
          rowCount: 1,
        });
        if (testCase.type === 'match') {
          mockMatchParticipant();
        }
        if (testCase.type === 'room') {
          mockRoomParticipant();
        }
        if (testCase.type === 'direct') {
          mockQuery.mockResolvedValueOnce({ rows: [{ exists: 1 }], rowCount: 1 });
        }
        mockQuery.mockResolvedValueOnce({
          rows: [
            {
              id: `chat_report_${testCase.type}`,
              message_id: testCase.messageId,
              conversation_id: testCase.conversationId,
              reporter_user_id: 'u_reader',
              reason: 'abuse',
              note: 'needs review',
              reported_message_content: `reportable ${testCase.type}`,
              reported_message_author_user_id: 'u_author',
              reported_message_author_display_name: 'Author',
              reported_message_author_role: testCase.type === 'match' ? 'spectator' : 'player',
              reported_message_moderation_status: 'visible',
              reported_message_created_at: '2026-07-10T00:00:01.000Z',
              status: 'open',
              reviewer_user_id: null,
              resolution_note: '',
              created_at: '2026-07-10T00:00:03.000Z',
              reviewed_at: null,
            },
          ],
          rowCount: 1,
        });

        const res = await sendRequest(
          'POST',
          `/api/chat/messages/${testCase.messageId}/report`,
          { reason: 'abuse', note: '<needs review>' },
          userUnsafeHeaders('u_reader'),
        );

        expect(res.statusCode).toBe(201);
        const body = parseBody(res) as { report: Record<string, unknown> };
        expect(body.report).toEqual(
          expect.objectContaining({
            id: `chat_report_${testCase.type}`,
            messageId: testCase.messageId,
            conversationId: testCase.conversationId,
            reason: 'abuse',
            note: 'needs review',
            message: expect.objectContaining({
              content: `reportable ${testCase.type}`,
              authorUserId: 'u_author',
              authorDisplayName: 'Author',
            }),
          }),
        );
        expect(mockQuery).toHaveBeenNthCalledWith(1, expect.stringContaining('JOIN chat_conversations'), [
          testCase.messageId,
        ]);
        expect(mockQuery).toHaveBeenLastCalledWith(
          expect.stringContaining('reported_message_content'),
          expect.arrayContaining([
            testCase.messageId,
            testCase.conversationId,
            'u_reader',
            'abuse',
            'needs review',
            `reportable ${testCase.type}`,
            'u_author',
            'Author',
            testCase.type === 'match' ? 'spectator' : 'player',
            'visible',
            '2026-07-10T00:00:01.000Z',
          ]),
        );
      }
    });
  });

  describe('admin chat moderation routes', () => {
    it('GET /api/admin/chat/reports returns snapshotted message evidence', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'chat_report_1',
            message_id: 'chat_msg_1',
            conversation_id: 'match:bgio-match-1',
            reporter_user_id: 'u_2',
            reason: 'spam',
            note: '',
            status: 'open',
            reviewer_user_id: null,
            resolution_note: '',
            created_at: '2026-07-10T00:00:03.000Z',
            reviewed_at: null,
            reported_message_content: 'snapshotted text',
            reported_message_author_user_id: 'u_1',
            reported_message_author_display_name: 'Alice at report time',
            reported_message_author_role: 'player',
            reported_message_moderation_status: 'pending_review',
            reported_message_created_at: '2026-07-10T00:00:01.000Z',
            message_content: 'edited later',
            message_author_user_id: 'u_9',
            message_author_display_name: 'Changed',
            message_author_role: 'spectator',
            message_moderation_status: 'visible',
            message_created_at: '2026-07-10T00:00:09.000Z',
            sanction_id: 'chat_sanction_1',
            sanction_target_user_id: 'u_1',
            sanction_type: 'chat_mute',
            sanction_status: 'active',
            sanction_reason: 'chat_report:spam',
            sanction_source_report_id: 'chat_report_1',
            sanction_source_message_id: 'chat_msg_1',
            sanction_conversation_id: 'match:bgio-match-1',
            sanction_created_by_user_id: 'admin',
            sanction_created_at: '2026-07-10T00:00:03.000Z',
            sanction_expires_at: '2026-07-11T00:00:03.000Z',
            sanction_revoked_at: null,
            sanction_revoked_by_user_id: null,
            sanction_revocation_reason: '',
          },
        ],
        rowCount: 1,
      });

      const res = await sendRequest('GET', '/api/admin/chat/reports?status=open&limit=10', null, adminHeaders());

      expect(res.statusCode).toBe(200);
      const body = parseBody(res) as { reports: Array<{ message: Record<string, unknown> }> };
      expect(body.reports[0]?.message).toEqual(
        expect.objectContaining({
          content: 'snapshotted text',
          authorUserId: 'u_1',
          authorDisplayName: 'Alice at report time',
          moderationStatus: 'pending_review',
          activeSanction: expect.objectContaining({
            id: 'chat_sanction_1',
            targetUserId: 'u_1',
          }),
        }),
      );
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('LEFT JOIN chat_messages'), ['open', 10]);
    });

    it('GET /api/admin/chat/conversations/:conversationId/messages returns full evidence context', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'match:bgio-match-1',
              type: 'match',
              subject_id: 'bgio-match-1',
              title: 'Ranked match',
              status: 'active',
              created_at: '2026-07-10T00:00:00.000Z',
              updated_at: '2026-07-10T00:00:05.000Z',
            },
          ],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'chat_msg_deleted',
              conversation_id: 'match:bgio-match-1',
              author_user_id: 'u_3',
              author_display_name: 'Carol',
              author_role: 'spectator',
              content: 'deleted evidence',
              source_language: '',
              moderation_status: 'deleted',
              moderation_reason: 'manual_remove',
              metadata: {},
              created_at: '2026-07-10T00:00:03.000Z',
              edited_at: null,
              deleted_at: '2026-07-10T00:00:04.000Z',
            },
            {
              id: 'chat_msg_blocked',
              conversation_id: 'match:bgio-match-1',
              author_user_id: 'u_1',
              author_display_name: 'Alice',
              author_role: 'player',
              content: 'blocked evidence',
              source_language: '',
              moderation_status: 'blocked',
              moderation_reason: 'blocked_keyword',
              metadata: {},
              created_at: '2026-07-10T00:00:01.000Z',
              edited_at: null,
              deleted_at: null,
            },
          ],
          rowCount: 2,
        });

      const res = await sendRequest(
        'GET',
        '/api/admin/chat/conversations/match%3Abgio-match-1/messages?limit=20',
        null,
        adminHeaders(),
      );

      expect(res.statusCode).toBe(200);
      const body = parseBody(res) as {
        conversation: Record<string, unknown>;
        messages: Array<Record<string, unknown>>;
      };
      expect(body.conversation).toEqual(
        expect.objectContaining({ id: 'match:bgio-match-1', subjectId: 'bgio-match-1' }),
      );
      expect(body.messages).toEqual([
        expect.objectContaining({ id: 'chat_msg_blocked', moderationStatus: 'blocked' }),
        expect.objectContaining({ id: 'chat_msg_deleted', moderationStatus: 'deleted' }),
      ]);
      expect(mockQuery).toHaveBeenNthCalledWith(
        2,
        expect.not.stringContaining("moderation_status IN ('visible', 'pending_review')"),
        ['match:bgio-match-1', 20],
      );
    });

    it('POST /api/admin/chat/sanctions creates a durable mute sanction', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }).mockResolvedValueOnce({
        rows: [
          {
            id: 'chat_sanction_1',
            target_user_id: 'u_1',
            type: 'chat_mute',
            status: 'active',
            reason: 'abuse',
            source_report_id: 'chat_report_1',
            source_message_id: 'chat_msg_1',
            conversation_id: 'match:bgio-match-1',
            created_by_user_id: 'admin',
            created_at: '2026-07-10T00:00:03.000Z',
            expires_at: '2026-07-10T01:00:03.000Z',
            revoked_at: null,
            revoked_by_user_id: null,
            revocation_reason: '',
          },
        ],
        rowCount: 1,
      });

      const res = await sendRequest(
        'POST',
        '/api/admin/chat/sanctions',
        {
          targetUserId: 'u_1',
          type: 'chat_mute',
          durationMinutes: 60,
          reason: '<abuse>',
          sourceReportId: 'chat_report_1',
          sourceMessageId: 'chat_msg_1',
          conversationId: 'match:bgio-match-1',
        },
        adminUnsafeHeaders(),
      );

      expect(res.statusCode).toBe(201);
      const body = parseBody(res) as { sanction: Record<string, unknown> };
      expect(body.sanction).toEqual(
        expect.objectContaining({
          id: 'chat_sanction_1',
          targetUserId: 'u_1',
          reason: 'abuse',
          sourceReportId: 'chat_report_1',
        }),
      );
      expect(mockQuery).toHaveBeenNthCalledWith(1, expect.stringContaining('UPDATE chat_user_sanctions'), [
        'u_1',
        'admin',
        'chat_mute',
      ]);
      expect(mockQuery).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('INSERT INTO chat_user_sanctions'),
        expect.arrayContaining([
          'u_1',
          'chat_mute',
          'abuse',
          'chat_report_1',
          'chat_msg_1',
          'match:bgio-match-1',
          'admin',
        ]),
      );
    });

    it('DELETE /api/admin/chat/sanctions/:sanctionId revokes an active mute', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'chat_sanction_1',
            target_user_id: 'u_1',
            type: 'chat_mute',
            status: 'revoked',
            reason: 'abuse',
            source_report_id: 'chat_report_1',
            source_message_id: 'chat_msg_1',
            conversation_id: 'match:bgio-match-1',
            created_by_user_id: 'admin',
            created_at: '2026-07-10T00:00:03.000Z',
            expires_at: '2026-07-10T01:00:03.000Z',
            revoked_at: '2026-07-10T00:30:03.000Z',
            revoked_by_user_id: 'admin',
            revocation_reason: 'manual_revoke',
          },
        ],
        rowCount: 1,
      });

      const res = await sendRequest('DELETE', '/api/admin/chat/sanctions/chat_sanction_1', null, adminUnsafeHeaders());

      expect(res.statusCode).toBe(200);
      const body = parseBody(res) as { sanction: Record<string, unknown> };
      expect(body.sanction).toEqual(
        expect.objectContaining({
          id: 'chat_sanction_1',
          status: 'revoked',
          revokedByUserId: 'admin',
          revocationReason: 'manual_revoke',
        }),
      );
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('UPDATE chat_user_sanctions'), [
        'chat_sanction_1',
        'admin',
        'manual_revoke',
      ]);
    });

    it('POST /api/admin/chat/reports/:reportId reviews a chat report', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'chat_report_1',
            message_id: 'chat_msg_1',
            conversation_id: 'match:bgio-match-1',
            reporter_user_id: 'u_2',
            reason: 'spam',
            note: '',
            status: 'resolved',
            reviewer_user_id: 'admin',
            resolution_note: 'handled',
            created_at: '2026-07-10T00:00:03.000Z',
            reviewed_at: '2026-07-10T00:30:03.000Z',
          },
        ],
        rowCount: 1,
      });

      const res = await sendRequest(
        'POST',
        '/api/admin/chat/reports/chat_report_1',
        { status: 'resolved', resolutionNote: '<handled>' },
        adminUnsafeHeaders(),
      );

      expect(res.statusCode).toBe(200);
      const body = parseBody(res) as { report: Record<string, unknown> };
      expect(body.report).toEqual(
        expect.objectContaining({
          id: 'chat_report_1',
          status: 'resolved',
          reviewerUserId: 'admin',
          resolutionNote: 'handled',
        }),
      );
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('UPDATE chat_reports'), [
        'chat_report_1',
        'resolved',
        'admin',
        'handled',
      ]);
    });
  });

  describe('rate limiting', () => {
    it('returns 429 when default rate limit is exceeded', async () => {
      mockRedisIncr.mockResolvedValue(121); // > RATE_LIMIT_DEFAULT (120)
      const res = await sendRequest('GET', '/api/app-version');
      expect(res.statusCode).toBe(429);
      const body = parseBody(res) as Record<string, unknown>;
      expect(body.error).toContain('Too many requests');
      expect(res.headers['retry-after']).toBe('60');
    });

    it('returns 429 for auth endpoints after limit exceeded', async () => {
      mockRedisIncr.mockResolvedValue(11); // > RATE_LIMIT_AUTH (10)
      const res = await sendRequest('POST', '/api/login', {
        email: 'a@b.com',
        password: 'secret1',
      });
      expect(res.statusCode).toBe(429);
    });
  });

  describe('logout', () => {
    it('POST /api/logout returns ok', async () => {
      const res = await sendRequest('POST', '/api/logout');
      expect(res.statusCode).toBe(200);
      const body = parseBody(res) as Record<string, unknown>;
      expect(body.ok).toBe(true);
    });
  });

  describe('auth refresh', () => {
    it('POST /api/auth/refresh returns 401 without refresh cookie', async () => {
      const res = await sendRequest('POST', '/api/auth/refresh');
      expect(res.statusCode).toBe(401);
    });
  });

  describe('CSRF protection', () => {
    it('GET /api/csrf-token returns token and sets cookie', async () => {
      const res = await sendRequest('GET', '/api/csrf-token');
      expect(res.statusCode).toBe(200);
      const body = parseBody(res) as Record<string, unknown>;
      expect(typeof body.token).toBe('string');
      expect((body.token as string).length).toBeGreaterThan(0);
      const setCookie = res.headers['set-cookie'];
      const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : setCookie || '';
      expect(cookieStr).toContain('zutomayo_csrf=');
    });

    it('PUT /api/profile without CSRF token returns 403', async () => {
      const res = await sendRequest('PUT', '/api/profile', { nickname: 'test' });
      expect(res.statusCode).toBe(403);
      const body = parseBody(res) as Record<string, unknown>;
      expect(body.error).toContain('CSRF');
    });

    it('PUT /api/profile with valid CSRF token passes CSRF check (returns 401 for auth)', async () => {
      const csrfToken = 'valid-csrf-token-for-testing-1234567890';
      const res = await sendRequest(
        'PUT',
        '/api/profile',
        { nickname: 'test' },
        {
          cookie: `zutomayo_csrf=${csrfToken}`,
          'x-csrf-token': csrfToken,
        },
      );
      expect(res.statusCode).toBe(401);
    });

    it('POST /api/login is exempt from CSRF check', async () => {
      // login is exempt; without CSRF it should proceed to validation (400 for empty body)
      const res = await sendRequest('POST', '/api/login', {});
      expect(res.statusCode).toBe(400);
    });
  });

  describe('presence', () => {
    it('GET /api/presence returns online count', async () => {
      mockRedisZremrangebyscore.mockResolvedValue(0);
      mockRedisZcount.mockResolvedValue(5);
      const res = await sendRequest('GET', '/api/presence');
      expect(res.statusCode).toBe(200);
      const body = parseBody(res) as Record<string, unknown>;
      expect(body.onlineCount).toBe(5);
    });

    it('POST /api/presence/heartbeat accepts valid visitorId', async () => {
      mockRedisZremrangebyscore.mockResolvedValue(0);
      mockRedisZcount.mockResolvedValue(1);
      mockRedisZadd.mockResolvedValue(1);
      mockRedisExpire.mockResolvedValue(1);
      const res = await sendRequest('POST', '/api/presence/heartbeat', {
        visitorId: 'presence:abc_12345',
      });
      expect(res.statusCode).toBe(200);
      const body = parseBody(res) as Record<string, unknown>;
      expect(body.onlineCount).toBeDefined();
    });
  });
});
