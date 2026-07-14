import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// ===== Environment setup (must happen before requiring server.cjs) =====
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters!!';
process.env.NODE_ENV = 'test';
process.env.APP_VERSION = '0.2.0';
process.env.LOGTO_ENDPOINT = 'https://auth.example';
process.env.LOGTO_M2M_APP_ID = 'logto-management-client';
process.env.LOGTO_M2M_APP_SECRET = 'logto-management-secret';
process.env.GOOGLE_OAUTH_CLIENT_ID = 'google-test-client';
process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'google-test-secret';
delete process.env.TURNSTILE_SECRET_KEY;
delete process.env.TURNSTILE_REQUIRED;
delete process.env.SENTRY_DSN;
delete process.env.ALLOWED_ORIGINS; // Use dev origins fallback
delete process.env.CHAT_TRANSLATION_ENDPOINT;
delete process.env.CHAT_TRANSLATION_API_KEY;
delete process.env.CHAT_TRANSLATION_PROVIDER;
delete process.env.CHAT_TRANSLATION_MODEL;
delete process.env.CHAT_TRANSLATION_TIMEOUT_MS;

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

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
const mockRedisGetdel = vi.fn().mockResolvedValue(null);
const mockRedisSet = vi.fn().mockResolvedValue('OK');
const mockRedisEval = vi.fn().mockResolvedValue(null);
const mockRedisScan = vi.fn().mockResolvedValue(['0', []]);
const mockRedisMget = vi.fn().mockResolvedValue([]);
const mockRedisMmTryMatch = vi.fn().mockResolvedValue('');
const mockRedisMmCleanExpired = vi.fn().mockResolvedValue(0);
const mockRedisMmCancelPair = vi.fn().mockResolvedValue(0);
const mockRedisMmApplyBlock = vi.fn().mockResolvedValue(0);
const mockRedisSadd = vi.fn().mockResolvedValue(1);
const mockRedisSrem = vi.fn().mockResolvedValue(1);
const mockRedisPublish = vi.fn().mockResolvedValue(1);

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
  getdel: mockRedisGetdel,
  set: mockRedisSet,
  eval: mockRedisEval,
  scan: mockRedisScan,
  mget: mockRedisMget,
  mmTryMatch: mockRedisMmTryMatch,
  mmCleanExpired: mockRedisMmCleanExpired,
  mmCancelPair: mockRedisMmCancelPair,
  mmApplyBlock: mockRedisMmApplyBlock,
  sadd: mockRedisSadd,
  srem: mockRedisSrem,
  publish: mockRedisPublish,
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
  createGracefulShutdown: (options: {
    httpServer: {
      listening?: boolean;
      close: (callback: (error?: Error) => void) => void;
      closeIdleConnections?: () => void;
      closeAllConnections?: () => void;
    };
    beginDrain: () => void;
    stopWorkers: () => Promise<void>;
    closeResources: () => Promise<void>;
    closeTelemetry?: () => Promise<void>;
    httpDrainTimeoutMs?: number;
    shutdownTimeoutMs?: number;
    log?: {
      info: (...args: unknown[]) => void;
      warn: (...args: unknown[]) => void;
      error: (...args: unknown[]) => void;
    };
    setExitCode?: (code: number) => void;
    forceExit?: (code: number) => void;
  }) => (signal?: string) => Promise<void>;
  markApiDraining: () => void;
  recoverAccountDeletions: () => Promise<void>;
};
Module_._load = originalLoad;

const { createGracefulShutdown, handleRequest, markApiDraining, recoverAccountDeletions } = serverModule;

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
  mockQuery.mockResolvedValueOnce({ rows: [{ role: 'player' }], rowCount: 1 });
}

function mockRoomParticipant() {
  mockQuery.mockResolvedValueOnce({ rows: [{ role: 'player' }], rowCount: 1 });
}

function base64urlJson(value: Record<string, unknown>) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function createAdminJwt() {
  const now = Math.floor(Date.now() / 1000);
  const header = base64urlJson({ alg: 'HS256', typ: 'JWT' });
  const payload = base64urlJson({
    admin: true,
    adminUserId: 'admin_test',
    role: 'admin',
    jti: 'admin-session-test',
    iat: now,
    exp: now + 60 * 60,
  });
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

function encryptOAuthTokenForTest(value: string): string {
  const key = crypto
    .createHash('sha256')
    .update(`zutomayo-secret:${process.env.JWT_SECRET || ''}`)
    .digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}

function createRevocableUserJwt(userId = 'u_test', jti = 'access-token-test') {
  const now = Math.floor(Date.now() / 1000);
  const header = base64urlJson({ alg: 'HS256', typ: 'JWT' });
  const payload = base64urlJson({ sub: userId, userId, jti, iat: now, exp: now + 60 * 60 });
  const input = `${header}.${payload}`;
  const signature = crypto
    .createHmac('sha256', process.env.JWT_SECRET || '')
    .update(input)
    .digest('base64url');
  return `${input}.${signature}`;
}

function createRefreshJwt(userId = 'u_test', sessionIat?: number) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64urlJson({ alg: 'HS256', typ: 'JWT' });
  const payload = base64urlJson({
    sub: userId,
    userId,
    typ: 'refresh',
    jti: 'refresh-token-test',
    iat: now,
    exp: now + 60 * 60,
    ...(sessionIat === undefined ? {} : { sessionIat }),
  });
  const input = `${header}.${payload}`;
  const signature = crypto
    .createHmac('sha256', process.env.JWT_SECRET || '')
    .update(input)
    .digest('base64url');
  return `${input}.${signature}`;
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1] || '', 'base64url').toString()) as Record<string, unknown>;
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
    mockFetch.mockReset();
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
    mockRedisGetdel.mockResolvedValue(null);
    mockRedisEval.mockResolvedValue(null);
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM admin_sessions')) {
        return { rows: [{ admin_user_id: 'admin_test', role: 'admin' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    mockRedisSet.mockResolvedValue('OK');
    mockRedisScan.mockResolvedValue(['0', []]);
    mockRedisMget.mockResolvedValue([]);
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
      expect(body.appVersion).toBe('0.2.0');
      expect(body.buildId).toBeDefined();
      expect(body.rulesVersion).toBeDefined();
    });

    it('GET /api/version returns same version info', async () => {
      const res = await sendRequest('GET', '/api/version');
      expect(res.statusCode).toBe(200);
      const body = parseBody(res) as Record<string, unknown>;
      expect(body.appVersion).toBe('0.2.0');
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

    it('binds OAuth state to HttpOnly cookies and sends an S256 PKCE challenge', async () => {
      const res = await sendRequest('GET', '/api/oauth/google/start?returnTo=/profile');
      expect(res.statusCode).toBe(302);
      const location = new URL(String(res.headers.location));
      expect(location.searchParams.get('code_challenge_method')).toBe('S256');
      expect(location.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(location.searchParams.get('state')).toBeTruthy();
      const setCookie = res.headers['set-cookie'];
      const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
      expect(
        cookies.some(
          (cookie) => String(cookie).includes('zutomayo_oauth_state_') && String(cookie).includes('HttpOnly'),
        ),
      ).toBe(true);
      expect(
        cookies.some(
          (cookie) => String(cookie).includes('zutomayo_oauth_pkce_') && String(cookie).includes('HttpOnly'),
        ),
      ).toBe(true);
      const state = location.searchParams.get('state') || '';
      const statePayload = JSON.parse(Buffer.from(state.split('.')[0], 'base64url').toString()) as {
        returnTo?: string;
      };
      expect(statePayload.returnTo).toBe('/profile');
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('normalizes protocol-relative OAuth return paths to a local route', async () => {
      const res = await sendRequest('GET', '/api/oauth/google/start?returnTo=%2F%2Fevil.example%2Flogin');
      expect(res.statusCode).toBe(302);
      const state = new URL(String(res.headers.location)).searchParams.get('state') || '';
      const statePayload = JSON.parse(Buffer.from(state.split('.')[0], 'base64url').toString()) as {
        returnTo?: string;
      };
      expect(statePayload.returnTo).toBe('/');
    });

    it('rejects an OAuth callback when the original browser cookies are missing', async () => {
      const start = await sendRequest('GET', '/api/oauth/google/start');
      const state = new URL(String(start.headers.location)).searchParams.get('state');
      const callback = await sendRequest(
        'GET',
        `/api/oauth/google/callback?code=provider-code&state=${encodeURIComponent(String(state))}`,
      );

      expect(callback.statusCode).toBe(400);
      expect(callback._body).toContain('Invalid_OAuth_state');
      expect(callback.headers['cache-control']).toContain('no-store');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('redeems a successful OAuth session ticket exactly once', async () => {
      const oauthValues = new Map<string, string>();
      mockRedisSet.mockImplementation(async (key: string, value: string) => {
        if (key.startsWith('oauth:')) oauthValues.set(key, value);
        return 'OK';
      });
      mockRedisEval.mockImplementation(async (_script: string, _keyCount: number, key: string) => {
        if (!key.startsWith('oauth:')) return null;
        const value = oauthValues.get(key) || null;
        oauthValues.delete(key);
        return value;
      });
      mockQuery.mockImplementation(async (sql: string) => {
        if (sql.includes('account_deletion_requests') && sql.includes('provider_user_id')) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('SELECT user_id FROM user_identities')) return { rows: [], rowCount: 0 };
        if (sql.includes('SELECT id FROM users WHERE email')) return { rows: [], rowCount: 0 };
        if (sql.includes('INSERT INTO users')) return { rows: [], rowCount: 1 };
        if (sql.includes('SELECT auth_version, deleted_at FROM users')) {
          return { rows: [{ auth_version: 1, deleted_at: null }], rowCount: 1 };
        }
        if (sql.includes('SELECT provider_user_id FROM user_identities')) return { rows: [], rowCount: 0 };
        if (sql.includes('INSERT INTO user_identities')) return { rows: [], rowCount: 1 };
        if (sql.includes('SELECT * FROM users')) {
          return {
            rows: [
              {
                id: 'u_oauth',
                email: 'oauth@example.com',
                nickname: 'OAuth User',
                elo: 1000,
                wins: 0,
                match_count: 0,
                password_hash: 'oauth:disabled',
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      });
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ access_token: 'provider-access-token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            sub: 'google-user-1',
            email: 'oauth@example.com',
            email_verified: true,
            name: 'OAuth User',
          }),
        });

      const start = await sendRequest('GET', '/api/oauth/google/start?returnTo=/profile');
      const location = new URL(String(start.headers.location));
      const state = location.searchParams.get('state') || '';
      const setCookie = start.headers['set-cookie'];
      const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
      const browserCookie = cookies.map((cookie) => String(cookie).split(';', 1)[0]).join('; ');
      const callback = await sendRequest(
        'GET',
        `/api/oauth/google/callback?code=provider-code&state=${encodeURIComponent(state)}`,
        undefined,
        { cookie: browserCookie },
      );

      expect(callback.statusCode).toBe(200);
      expect(callback.headers['cache-control']).toContain('no-store');
      const ticket = callback._body.match(/body: JSON\.stringify\(\{ ticket: "([^"]+)" \}\)/)?.[1];
      expect(ticket).toBeTruthy();

      const firstRedeem = await sendRequest('POST', '/api/oauth/session', { ticket });
      expect(firstRedeem.statusCode).toBe(200);
      const secondRedeem = await sendRequest('POST', '/api/oauth/session', { ticket });
      expect(secondRedeem.statusCode).toBe(401);
    });

    it('rejects account linking when the initiating session is no longer current', async () => {
      const oauthValues = new Map<string, string>();
      mockRedisSet.mockImplementation(async (key: string, value: string) => {
        if (key.startsWith('oauth:')) oauthValues.set(key, value);
        return 'OK';
      });
      mockRedisEval.mockImplementation(async (_script: string, _keyCount: number, key: string) => {
        const value = oauthValues.get(key) || null;
        oauthValues.delete(key);
        return value;
      });

      const start = await sendRequest('GET', '/api/oauth/google/start?mode=link&returnTo=/profile', undefined, {
        authorization: `Bearer ${createUserJwt('u_link')}`,
      });
      expect(start.statusCode).toBe(302);
      const state = new URL(String(start.headers.location)).searchParams.get('state') || '';
      const setCookie = start.headers['set-cookie'];
      const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
      const oauthCookies = cookies.map((cookie) => String(cookie).split(';', 1)[0]).join('; ');

      const callback = await sendRequest(
        'GET',
        `/api/oauth/google/callback?code=provider-code&state=${encodeURIComponent(state)}`,
        undefined,
        { cookie: oauthCookies },
      );

      expect(callback.statusCode).toBe(401);
      expect(callback._body).toContain('Account_linking_session_expired');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('input validation', () => {
    it('POST /api/register rejects missing email', async () => {
      const res = await sendRequest('POST', '/api/register', { password: 'a-very-long-secret' });
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

    it('GET /api/profile returns the authenticated user profile', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'u_test',
              email: 'user@example.com',
              nickname: 'User',
              elo: 1000,
              match_count: 4,
              wins: 3,
              created_at: '2026-07-10T00:00:00.000Z',
            },
          ],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [{ password_hash: 'current-hash', has_logto_identity: false }],
          rowCount: 1,
        });

      const res = await sendRequest('GET', '/api/profile', null, {
        authorization: `Bearer ${createUserJwt()}`,
      });

      expect(res.statusCode).toBe(200);
      expect(parseBody(res)).toEqual(
        expect.objectContaining({
          id: 'u_test',
          email: 'user@example.com',
          nickname: 'User',
          elo: 1000,
          matchCount: 4,
          wins: 3,
          winRate: 75,
        }),
      );
      expect(mockQuery).toHaveBeenCalledWith('SELECT * FROM users WHERE id = $1', ['u_test']);
    });

    it('rejects access tokens when the blacklist lookup is unavailable', async () => {
      mockRedisGet.mockRejectedValueOnce(new Error('Redis unavailable'));

      const res = await sendRequest('GET', '/api/profile', null, {
        authorization: `Bearer ${createRevocableUserJwt()}`,
      });

      expect(res.statusCode).toBe(401);
      expect(parseBody(res)).toEqual({ error: 'Unauthorized' });
      expect(mockQuery).not.toHaveBeenCalledWith('SELECT * FROM users WHERE id = $1', ['u_test']);
    });

    it('GET /api/friends returns 401 without auth', async () => {
      const res = await sendRequest('GET', '/api/friends');
      expect(res.statusCode).toBe(401);
    });

    it('commits a block relationship event to the outbox instead of publishing from the route', async () => {
      mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql === 'SELECT * FROM users WHERE id = $1 FOR UPDATE') {
          return { rows: [{ id: String(params?.[0]), deleted_at: null }], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO user_blocks')) {
          return { rows: [{ created_at: '2026-07-13T00:00:00.000Z' }], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO relationship_change_outbox')) {
          return { rows: [{ event_id: 'event-1' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      });

      const res = await sendRequest('POST', '/api/blocks', { targetUserId: 'u_target' }, userUnsafeHeaders('u_test'));

      expect(res.statusCode).toBe(200);
      expect(mockQuery.mock.calls.map(([sql]) => sql)).toEqual(
        expect.arrayContaining(['BEGIN', expect.stringContaining('INSERT INTO user_blocks'), 'COMMIT']),
      );
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO relationship_change_outbox'),
        expect.arrayContaining(['block_created:u_test:u_target:2026-07-13T00:00:00.000Z']),
      );
      expect(mockRedisPublish).not.toHaveBeenCalled();
      const commitIndex = mockQuery.mock.calls.findIndex(([sql]) => sql === 'COMMIT');
      const outboxIndex = mockQuery.mock.calls.findIndex(([sql]) =>
        sql.includes('INSERT INTO relationship_change_outbox'),
      );
      expect(mockQuery.mock.invocationCallOrder[outboxIndex]).toBeLessThan(
        mockQuery.mock.invocationCallOrder[commitIndex],
      );
    });

    it('keeps a committed block successful when the immediate Redis projection is unavailable', async () => {
      mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql === 'SELECT * FROM users WHERE id = $1 FOR UPDATE') {
          return { rows: [{ id: String(params?.[0]), deleted_at: null }], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO user_blocks')) {
          return { rows: [{ created_at: '2026-07-13T00:00:00.000Z' }], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO relationship_change_outbox')) {
          return { rows: [{ event_id: 'event-redis-down' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      });
      mockRedisMmApplyBlock.mockRejectedValueOnce(new Error('Redis projection unavailable'));

      const res = await sendRequest('POST', '/api/blocks', { targetUserId: 'u_target' }, userUnsafeHeaders('u_test'));

      expect(res.statusCode).toBe(200);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO relationship_change_outbox'),
        expect.any(Array),
      );
      expect(mockRedisPublish).not.toHaveBeenCalled();
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
            latest_message_id: 'chat_msg_latest',
          },
        ],
      });

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
          latestMessageId: 'chat_msg_latest',
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

    it('GET /api/chat/unread derives direct chat visibility from durable friendships', async () => {
      mockQuery.mockReset();
      mockQuery.mockResolvedValueOnce({ rows: [{ friend_user_id: 'u_friend' }] });
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'direct:v1:u_friend:u_reader',
            type: 'direct',
            subject_id: 'v1:u_friend:u_reader',
            title: 'Friend chat',
            status: 'active',
            created_at: '2026-07-10T00:00:00.000Z',
            updated_at: '2026-07-10T00:00:06.000Z',
            unread_count: '1',
            latest_message_at: '2026-07-10T00:00:06.000Z',
            latest_message_id: 'chat_msg_direct_latest',
          },
        ],
      });

      const res = await sendRequest('GET', '/api/chat/unread?limit=10', null, userUnsafeHeaders('u_reader'));
      expect(res.statusCode).toBe(200);
      const body = parseBody(res) as { conversations: Array<Record<string, unknown>> };
      expect(body.conversations).toEqual([
        expect.objectContaining({
          id: 'direct:v1:u_friend:u_reader',
          type: 'direct',
          subjectId: 'v1:u_friend:u_reader',
          unreadCount: 1,
          latestMessageId: 'chat_msg_direct_latest',
        }),
      ]);
      expect(mockQuery).toHaveBeenNthCalledWith(1, expect.stringContaining('FROM user_friends'), ['u_reader']);
      expect(mockQuery).toHaveBeenNthCalledWith(2, expect.stringContaining('c.subject_id = ANY($5::text[])'), [
        'u_reader',
        10,
        'u_reader',
        true,
        ['v1:u_friend:u_reader'],
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

    it('POST /api/admin/chat/messages/:messageId/moderation returns 401 without admin token', async () => {
      const csrfToken = 'valid-csrf-token-for-testing-1234567890';
      const res = await sendRequest(
        'POST',
        '/api/admin/chat/messages/chat_msg_1/moderation',
        { status: 'visible' },
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
          [testCase.expectedKey, 10, 'u_reader'],
        );
        expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('FROM user_blocks b'), [
          testCase.expectedKey,
          10,
          'u_reader',
        ]);
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

    it('rejects direct history, read, translation, and report routes for non-friends', async () => {
      const directSubjectId = 'v1:u_reader:u_stranger';
      const directConversationId = 'direct:v1:u_reader:u_stranger';
      const directMessageId = 'chat_msg_direct_stranger';

      mockQuery.mockReset();
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const historyRes = await sendRequest(
        'GET',
        `/api/chat/messages?type=direct&subjectId=${encodeURIComponent(directSubjectId)}`,
        null,
        userUnsafeHeaders('u_reader'),
      );
      expect(historyRes.statusCode).toBe(403);
      expect(parseBody(historyRes)).toEqual({ error: 'Forbidden' });
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('FROM user_friends'), ['u_reader', 'u_stranger']);
      expect(mockQuery).not.toHaveBeenCalledWith(expect.stringContaining('FROM chat_messages'), expect.any(Array));

      mockQuery.mockReset();
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const readRes = await sendRequest(
        'POST',
        '/api/chat/read',
        {
          conversationType: 'direct',
          subjectId: directSubjectId,
          lastReadMessageId: directMessageId,
        },
        userUnsafeHeaders('u_reader'),
      );
      expect(readRes.statusCode).toBe(403);
      expect(parseBody(readRes)).toEqual({ error: 'Forbidden' });
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('FROM user_friends'), ['u_reader', 'u_stranger']);
      expect(mockQuery).not.toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO chat_read_states'),
        expect.any(Array),
      );

      const directMessageRow = {
        id: directMessageId,
        conversation_id: directConversationId,
        content: 'private direct message',
        source_language: 'ja',
        type: 'direct',
        subject_id: directSubjectId,
      };

      mockQuery.mockReset();
      mockQuery
        .mockResolvedValueOnce({ rows: [directMessageRow], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const translateRes = await sendRequest(
        'POST',
        `/api/chat/messages/${directMessageId}/translate`,
        { targetLanguage: 'en' },
        userUnsafeHeaders('u_reader'),
      );
      expect(translateRes.statusCode).toBe(403);
      expect(parseBody(translateRes)).toEqual({ error: 'Forbidden' });
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('FROM user_friends'), ['u_reader', 'u_stranger']);
      expect(mockQuery).not.toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO chat_message_translations'),
        expect.any(Array),
      );

      mockQuery.mockReset();
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              ...directMessageRow,
              author_user_id: 'u_stranger',
              author_display_name: 'Stranger',
              author_role: 'player',
              moderation_status: 'visible',
              created_at: '2026-07-10T00:00:01.000Z',
              conversation_type: 'direct',
              conversation_subject_id: directSubjectId,
            },
          ],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const reportRes = await sendRequest(
        'POST',
        `/api/chat/messages/${directMessageId}/report`,
        { reason: 'abuse' },
        userUnsafeHeaders('u_reader'),
      );
      expect(reportRes.statusCode).toBe(403);
      expect(parseBody(reportRes)).toEqual({ error: 'Forbidden' });
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('FROM user_friends'), ['u_reader', 'u_stranger']);
      expect(mockQuery).not.toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO chat_reports'),
        expect.any(Array),
      );
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

    it('rejects match and room chat route access without durable participation evidence', async () => {
      const cases = [
        {
          type: 'match',
          subjectId: 'bgio-match-1',
          expectedTable: 'platform_match_participants',
          messageId: 'chat_msg_private_match',
          conversationId: 'match:bgio-match-1',
        },
        {
          type: 'room',
          subjectId: 'ROOM42',
          expectedTable: 'platform_room_participants',
          messageId: 'chat_msg_private_room',
          conversationId: 'room:ROOM42',
        },
      ];

      for (const testCase of cases) {
        mockQuery.mockReset();
        mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

        const historyParams = new URLSearchParams({
          type: testCase.type,
          subjectId: testCase.subjectId,
        });
        const historyRes = await sendRequest(
          'GET',
          `/api/chat/messages?${historyParams.toString()}`,
          null,
          userUnsafeHeaders('u_reader'),
        );
        expect(historyRes.statusCode).toBe(403);
        expect(parseBody(historyRes)).toEqual({ error: 'Forbidden' });
        expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining(testCase.expectedTable), [
          testCase.subjectId,
          'u_reader',
        ]);
        expect(mockQuery).not.toHaveBeenCalledWith(expect.stringContaining('FROM chat_messages'), expect.any(Array));

        mockQuery.mockReset();
        mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
        const sendRes = await sendRequest(
          'POST',
          '/api/chat/messages',
          {
            conversationType: testCase.type,
            subjectId: testCase.subjectId,
            content: 'private message',
            authorRole: 'player',
          },
          userUnsafeHeaders('u_reader'),
        );
        expect(sendRes.statusCode).toBe(403);
        expect(parseBody(sendRes)).toEqual({ error: 'Forbidden' });
        expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining(testCase.expectedTable), [
          testCase.subjectId,
          'u_reader',
        ]);
        expect(mockQuery).not.toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO chat_conversations'),
          expect.any(Array),
        );
        expect(mockQuery).not.toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO chat_messages'),
          expect.any(Array),
        );

        mockQuery.mockReset();
        mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
        const readRes = await sendRequest(
          'POST',
          '/api/chat/read',
          {
            conversationType: testCase.type,
            subjectId: testCase.subjectId,
            lastReadMessageId: testCase.messageId,
          },
          userUnsafeHeaders('u_reader'),
        );
        expect(readRes.statusCode).toBe(403);
        expect(parseBody(readRes)).toEqual({ error: 'Forbidden' });
        expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining(testCase.expectedTable), [
          testCase.subjectId,
          'u_reader',
        ]);
        expect(mockQuery).not.toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO chat_read_states'),
          expect.any(Array),
        );

        const messageRow = {
          id: testCase.messageId,
          conversation_id: testCase.conversationId,
          content: 'secret message',
          source_language: 'ja',
          type: testCase.type,
          subject_id: testCase.subjectId,
        };

        mockQuery.mockReset();
        mockQuery
          .mockResolvedValue({ rows: [], rowCount: 0 })
          .mockResolvedValueOnce({ rows: [messageRow], rowCount: 1 });
        const translateRes = await sendRequest(
          'POST',
          `/api/chat/messages/${testCase.messageId}/translate`,
          { targetLanguage: 'en' },
          userUnsafeHeaders('u_reader'),
        );
        expect(translateRes.statusCode).toBe(403);
        expect(parseBody(translateRes)).toEqual({ error: 'Forbidden' });
        expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining(testCase.expectedTable), [
          testCase.subjectId,
          'u_reader',
        ]);
        expect(mockQuery).not.toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO chat_message_translations'),
          expect.any(Array),
        );

        mockQuery.mockReset();
        mockQuery.mockResolvedValue({ rows: [], rowCount: 0 }).mockResolvedValueOnce({
          rows: [
            {
              ...messageRow,
              author_user_id: 'u_author',
              author_display_name: 'Author',
              author_role: 'player',
              moderation_status: 'visible',
              created_at: '2026-07-10T00:00:01.000Z',
              conversation_type: testCase.type,
              conversation_subject_id: testCase.subjectId,
            },
          ],
          rowCount: 1,
        });
        const reportRes = await sendRequest(
          'POST',
          `/api/chat/messages/${testCase.messageId}/report`,
          { reason: 'abuse' },
          userUnsafeHeaders('u_reader'),
        );
        expect(reportRes.statusCode).toBe(403);
        expect(parseBody(reportRes)).toEqual({ error: 'Forbidden' });
        expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining(testCase.expectedTable), [
          testCase.subjectId,
          'u_reader',
        ]);
        expect(mockQuery).not.toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO chat_reports'),
          expect.any(Array),
        );
      }
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
          'u_reader',
        ]);
        expect(mockQuery).toHaveBeenNthCalledWith(1, expect.stringContaining('FROM user_blocks b'), [
          testCase.messageId,
          'u_reader',
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
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              report_id: 'chat_report_1',
              report_message_id: 'chat_msg_1',
              report_conversation_id: 'match:bgio-match-1',
              reported_message_author_user_id: 'u_1',
              message_id: 'chat_msg_1',
              message_conversation_id: 'match:bgio-match-1',
              message_author_user_id: 'u_1',
            },
          ],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({
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
              created_by_user_id: 'admin_test',
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
      expect(mockQuery).toHaveBeenNthCalledWith(1, expect.stringContaining('FROM chat_reports'), [
        'chat_report_1',
        'chat_msg_1',
      ]);
      expect(mockQuery).toHaveBeenNthCalledWith(2, expect.stringContaining('UPDATE chat_user_sanctions'), [
        'u_1',
        'admin_test',
        'chat_mute',
      ]);
      expect(mockQuery).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining('INSERT INTO chat_user_sanctions'),
        expect.arrayContaining([
          'u_1',
          'chat_mute',
          'abuse',
          'chat_report_1',
          'chat_msg_1',
          'match:bgio-match-1',
          'admin_test',
        ]),
      );
    });

    it('POST /api/admin/chat/sanctions rejects evidence mismatches', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            report_id: 'chat_report_1',
            report_message_id: 'chat_msg_1',
            report_conversation_id: 'match:bgio-match-1',
            reported_message_author_user_id: 'u_author',
            message_id: 'chat_msg_1',
            message_conversation_id: 'match:bgio-match-1',
            message_author_user_id: 'u_author',
          },
        ],
        rowCount: 1,
      });

      const res = await sendRequest(
        'POST',
        '/api/admin/chat/sanctions',
        {
          targetUserId: 'u_other',
          type: 'chat_mute',
          sourceReportId: 'chat_report_1',
          sourceMessageId: 'chat_msg_1',
          conversationId: 'match:bgio-match-1',
        },
        adminUnsafeHeaders(),
      );

      expect(res.statusCode).toBe(400);
      expect(parseBody(res)).toEqual({ error: 'Report target mismatch' });
      expect(mockQuery).toHaveBeenCalledOnce();
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
            created_by_user_id: 'admin_test',
            created_at: '2026-07-10T00:00:03.000Z',
            expires_at: '2026-07-10T01:00:03.000Z',
            revoked_at: '2026-07-10T00:30:03.000Z',
            revoked_by_user_id: 'admin_test',
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
          revokedByUserId: 'admin_test',
          revocationReason: 'manual_revoke',
        }),
      );
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('UPDATE chat_user_sanctions'), [
        'chat_sanction_1',
        'admin_test',
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
            reviewer_user_id: 'admin_test',
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
          reviewerUserId: 'admin_test',
          resolutionNote: 'handled',
        }),
      );
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('UPDATE chat_reports'), [
        'chat_report_1',
        'resolved',
        'admin_test',
        'handled',
      ]);
    });

    it('POST /api/admin/chat/messages/:messageId/moderation reviews a hidden chat message', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'chat_msg_1',
              conversation_id: 'match:bgio-match-1',
              author_user_id: 'u_1',
              author_display_name: 'Alice',
              author_role: 'player',
              content: 'needs review',
              source_language: '',
              moderation_status: 'blocked',
              moderation_reason: 'manual blocked',
              metadata: {},
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
        '/api/admin/chat/messages/chat_msg_1/moderation',
        { status: 'blocked', reason: '<manual blocked>' },
        adminUnsafeHeaders(),
      );

      expect(res.statusCode).toBe(200);
      const body = parseBody(res) as { message: Record<string, unknown> };
      expect(body.message).toEqual(
        expect.objectContaining({
          id: 'chat_msg_1',
          moderationStatus: 'blocked',
          moderationReason: 'manual blocked',
        }),
      );
      expect(mockQuery).toHaveBeenNthCalledWith(1, expect.stringContaining('UPDATE chat_messages'), [
        'chat_msg_1',
        'blocked',
        'manual blocked',
      ]);
      expect(mockQuery).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('INSERT INTO chat_moderation_events'),
        expect.arrayContaining(['chat_msg_1', 'match:bgio-match-1', 'admin', 'admin', 'blocked', 'manual blocked']),
      );
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
        password: 'a-very-long-secret',
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

    it('does not report logout success when blacklist persistence fails', async () => {
      mockRedisSet.mockRejectedValueOnce(new Error('Redis unavailable'));
      const res = await sendRequest('POST', '/api/logout', null, {
        cookie: `zutomayo_session=${encodeURIComponent(createRevocableUserJwt())}`,
      });
      expect(res.statusCode).toBe(500);
    });
  });

  describe('auth refresh', () => {
    it('POST /api/auth/refresh returns 401 without refresh cookie', async () => {
      const res = await sendRequest('POST', '/api/auth/refresh');
      expect(res.statusCode).toBe(401);
    });

    it('consumes refresh tokens through the revocation-aware atomic path', async () => {
      mockRedisEval.mockResolvedValueOnce('u_test');
      const refreshToken = createRefreshJwt();
      const res = await sendRequest('POST', '/api/auth/refresh', null, {
        cookie: `zutomayo_refresh=${encodeURIComponent(refreshToken)}`,
      });
      expect(res.statusCode).toBe(200);
      expect(mockRedisEval).toHaveBeenCalledWith(
        expect.stringContaining('revokedBefore'),
        2,
        'refresh:refresh-token-test',
        'auth:revoked-before:u_test',
        expect.any(String),
        'u_test',
      );
      expect(mockRedisSet).toHaveBeenCalledWith(expect.stringMatching(/^refresh:/), 'u_test', 'EX', expect.any(Number));
    });

    it('preserves the original session lineage when rotating a refresh token', async () => {
      const sessionIat = Math.floor(Date.now() / 1000) - 120;
      mockRedisEval.mockResolvedValueOnce('u_test');
      const res = await sendRequest('POST', '/api/auth/refresh', null, {
        cookie: `zutomayo_refresh=${encodeURIComponent(createRefreshJwt('u_test', sessionIat))}`,
      });
      expect(res.statusCode).toBe(200);
      const body = parseBody(res) as { token?: string };
      expect(body.token).toEqual(expect.any(String));
      const payload = decodeJwtPayload(body.token as string);
      expect(payload.sub).toBe('u_test');
      expect(payload.sessionIat).toBe(sessionIat);
    });

    it('rejects refresh tokens consumed after a session cutoff', async () => {
      mockRedisEval.mockResolvedValueOnce(null);
      const res = await sendRequest('POST', '/api/auth/refresh', null, {
        cookie: `zutomayo_refresh=${encodeURIComponent(createRefreshJwt())}`,
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('password changes', () => {
    it('revokes all user sessions after updating the password', async () => {
      const currentPassword = 'current-password-long';
      const currentSalt = 'current-salt';
      const currentHash = crypto.pbkdf2Sync(currentPassword, currentSalt, 100000, 64, 'sha512').toString('hex');
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ password_hash: currentHash, has_logto_identity: false }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'u_test', password_hash: currentHash, salt: currentSalt }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });
      mockRedisScan.mockResolvedValueOnce(['0', ['refresh:owned', 'refresh:other']]);
      mockRedisMget.mockResolvedValueOnce(['u_test', 'u_other']);

      const res = await sendRequest(
        'PUT',
        '/api/profile/password',
        { currentPassword, newPassword: 'next-password-long' },
        userUnsafeHeaders(),
      );

      expect(res.statusCode).toBe(200);
      expect(parseBody(res)).toEqual({ ok: true });
      expect(mockRedisSet).toHaveBeenCalledWith(
        'auth:revoked-before:u_test',
        expect.stringMatching(/^\d+$/),
        'EX',
        7 * 24 * 60 * 60,
      );
      expect(mockRedisScan).toHaveBeenCalledWith('0', 'MATCH', 'refresh:*', 'COUNT', 200);
      expect(mockRedisMget).toHaveBeenCalledWith(['refresh:owned', 'refresh:other']);
      expect(mockRedisDel).toHaveBeenCalledWith('refresh:owned');
    });
  });

  describe('Logto account step-up', () => {
    function configureLogtoAccountMocks() {
      const encryptedAccessToken = encryptOAuthTokenForTest('logto-access-token');
      let deletionStatus = 'prepared';
      const deletionRequest = () => ({
        id: 'account_delete_test',
        user_id: 'u_test',
        provider: 'logto',
        provider_user_id: 'logto-user-test',
        status: deletionStatus,
        attempt_count: deletionStatus === 'prepared' ? 0 : 1,
        last_error: '',
        updated_at: new Date().toISOString(),
      });
      mockQuery.mockImplementation(async (sql: string) => {
        if (sql.includes('has_logto_identity')) {
          return { rows: [{ password_hash: 'oauth:disabled', has_logto_identity: true }], rowCount: 1 };
        }
        if (sql.includes('access_token_ciphertext')) {
          return {
            rows: [
              {
                access_token_ciphertext: encryptedAccessToken,
                refresh_token_ciphertext: null,
                token_expires_at: new Date(Date.now() + 60_000).toISOString(),
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('SELECT provider_user_id FROM user_identities')) {
          return { rows: [{ provider_user_id: 'logto-user-test' }], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO account_deletion_requests')) {
          deletionStatus = 'prepared';
          return { rows: [deletionRequest()], rowCount: 1 };
        }
        if (sql.includes('SELECT * FROM account_deletion_requests')) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('SELECT id, user_id FROM account_deletion_requests')) {
          return { rows: [{ id: 'account_delete_test', user_id: 'u_test' }], rowCount: 1 };
        }
        if (sql.includes("SET status = 'provider_deleting'")) {
          deletionStatus = 'provider_deleting';
          return { rows: [deletionRequest()], rowCount: 1 };
        }
        if (sql.includes("SET status = 'provider_deleted'")) {
          deletionStatus = 'provider_deleted';
          return { rows: [deletionRequest()], rowCount: 1 };
        }
        if (sql.includes('SELECT id, user_id, provider, status') && sql.includes('account_deletion_requests')) {
          return { rows: [deletionRequest()], rowCount: 1 };
        }
        if (sql.includes('FROM users') && sql.includes('FOR UPDATE')) {
          return { rows: [{ id: 'u_test' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      });
    }

    it('returns only a server-issued opaque token after provider verification', async () => {
      configureLogtoAccountMocks();
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: 'provider-verification-record' }),
      });

      const res = await sendRequest(
        'POST',
        '/api/account-center/verifications/password',
        { currentPassword: 'provider-password' },
        userUnsafeHeaders(),
      );

      expect(res.statusCode).toBe(200);
      const body = parseBody(res) as Record<string, unknown>;
      expect(body).toEqual({ stepUpToken: expect.any(String), expiresIn: 300 });
      expect(JSON.stringify(body)).not.toContain('provider-verification-record');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://auth.example/api/verifications/password',
        expect.objectContaining({ body: JSON.stringify({ password: 'provider-password' }) }),
      );
      expect(mockRedisSet).toHaveBeenCalledWith(
        expect.stringMatching(/^account:step-up:/),
        expect.stringContaining('provider-verification-record'),
        'EX',
        300,
        'NX',
      );
    });

    it('consumes a password step-up once and keeps the provider record server-side', async () => {
      configureLogtoAccountMocks();
      mockRedisGetdel.mockResolvedValueOnce(
        JSON.stringify({
          userId: 'u_test',
          purpose: 'password-change',
          providerVerificationRecordId: 'provider-verification-record',
        }),
      );
      mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => '' });

      const res = await sendRequest(
        'POST',
        '/api/account-center/password',
        { stepUpToken: 'opaque-step-up-token-12345678901234567890', newPassword: 'new-provider-password' },
        userUnsafeHeaders(),
      );

      expect(res.statusCode).toBe(200);
      expect(parseBody(res)).toEqual({ ok: true });
      expect(mockRedisGetdel).toHaveBeenCalledWith(expect.stringMatching(/^account:step-up:/));
      expect(mockFetch).toHaveBeenCalledWith(
        'https://auth.example/api/my-account/password',
        expect.objectContaining({
          body: JSON.stringify({ password: 'new-provider-password' }),
          headers: expect.objectContaining({ 'logto-verification-record-id': 'provider-verification-record' }),
        }),
      );
      expect(mockRedisSet).toHaveBeenCalledWith(
        'auth:revoked-before:u_test',
        expect.any(String),
        'EX',
        7 * 24 * 60 * 60,
      );
    });

    it('rejects a raw provider record on the password route', async () => {
      configureLogtoAccountMocks();
      const res = await sendRequest(
        'POST',
        '/api/account-center/password',
        { verificationRecordId: 'provider-verification-record', newPassword: 'new-provider-password' },
        userUnsafeHeaders(),
      );

      expect(res.statusCode).toBe(400);
      expect(mockRedisGetdel).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('uses the delete purpose and revokes sessions only after the hold checks', async () => {
      configureLogtoAccountMocks();
      mockRedisGetdel.mockResolvedValueOnce(
        JSON.stringify({
          userId: 'u_test',
          purpose: 'account-delete',
          providerVerificationRecordId: 'provider-verification-record',
        }),
      );
      mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => '{}' });

      const res = await sendRequest(
        'DELETE',
        '/api/account',
        { confirmation: 'DELETE', stepUpToken: 'opaque-step-up-token-12345678901234567890' },
        {
          ...userUnsafeHeaders(),
          authorization: `Bearer ${createRevocableUserJwt('u_test', 'bearer-access-token-test')}`,
          cookie: `zutomayo_csrf=valid-csrf-token-for-testing-1234567890; zutomayo_session=${encodeURIComponent(
            createRevocableUserJwt('u_test', 'cookie-access-token-test'),
          )}`,
        },
      );

      expect(res.statusCode).toBe(200);
      expect(parseBody(res)).toEqual({ deleted: true });
      expect(mockRedisGetdel).toHaveBeenCalledWith(expect.stringMatching(/^account:step-up:/));
      expect(mockFetch).toHaveBeenCalledWith(
        'https://auth.example/api/my-account',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({ 'logto-verification-record-id': 'provider-verification-record' }),
        }),
      );
      const sqls = mockQuery.mock.calls.map(([sql]) => String(sql));
      const retentionLock = sqls.indexOf('SELECT pg_advisory_xact_lock(hashtext($1))');
      const identityDelete = sqls.findIndex((sql) => sql.includes('DELETE FROM user_identities'));
      expect(retentionLock).toBeGreaterThanOrEqual(0);
      expect(identityDelete).toBeGreaterThan(retentionLock);
      expect(mockRedisSet).toHaveBeenCalledWith(
        'auth:revoked-before:u_test',
        expect.any(String),
        'EX',
        7 * 24 * 60 * 60,
      );
      expect(mockRedisSet).toHaveBeenCalledWith('blacklist:bearer-access-token-test', '1', 'EX', expect.any(Number));
      expect(mockRedisSet).toHaveBeenCalledWith('blacklist:cookie-access-token-test', '1', 'EX', expect.any(Number));
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("SET status = 'completed'"), [
        'account_delete_test',
        'u_test',
      ]);
    });

    it('recovers an ambiguous provider deletion with the least-privilege M2M client', async () => {
      let deletionStatus = 'provider_deleting';
      const requestRow = () => ({
        id: 'account_delete_recovery',
        user_id: 'u_recovery',
        provider: 'logto',
        provider_user_id: 'logto-recovery-user',
        status: deletionStatus,
        attempt_count: 1,
        last_error: '',
        updated_at: '2026-07-13T00:00:00.000Z',
      });
      mockQuery.mockImplementation(async (sql: string) => {
        if (sql.includes('WHERE status = ANY($1::text[])')) return { rows: [requestRow()], rowCount: 1 };
        if (sql.includes('SELECT id, user_id FROM account_deletion_requests')) {
          return { rows: [{ id: 'account_delete_recovery', user_id: 'u_recovery' }], rowCount: 1 };
        }
        if (sql.includes("SET status = 'provider_deleted'")) {
          deletionStatus = 'provider_deleted';
          return { rows: [requestRow()], rowCount: 1 };
        }
        if (sql.includes('FROM users') && sql.includes('FOR UPDATE')) {
          return { rows: [{ id: 'u_recovery' }], rowCount: 1 };
        }
        if (sql.includes('SELECT id, user_id, provider, status') && sql.includes('account_deletion_requests')) {
          return { rows: [requestRow()], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      });
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ access_token: 'm2m-access-token', expires_in: 3600 }),
        })
        .mockResolvedValueOnce({ ok: false, status: 404, text: async () => '' });

      await recoverAccountDeletions();

      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'https://auth.example/oidc/token',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('scope=delete%3Ausers'),
        }),
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'https://auth.example/api/users/logto-recovery-user',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({ Authorization: 'Bearer m2m-access-token' }),
        }),
      );
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("SET status = 'completed'"), [
        'account_delete_recovery',
        'u_recovery',
      ]);
    });
  });

  describe('logout token validation', () => {
    it('does not persist a blacklist entry for a forged access cookie', async () => {
      const now = Math.floor(Date.now() / 1000);
      const header = base64urlJson({ alg: 'HS256', typ: 'JWT' });
      const payload = base64urlJson({ sub: 'u_attacker', jti: 'forged-token-identifier', iat: now, exp: now + 86400 });
      const forged = `${header}.${payload}.not-a-valid-signature`;
      const res = await sendRequest('POST', '/api/logout', null, {
        cookie: `zutomayo_session=${encodeURIComponent(forged)}`,
      });
      expect(res.statusCode).toBe(200);
      expect(mockRedisSet).not.toHaveBeenCalledWith(
        expect.stringMatching(/^blacklist:/),
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
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

  describe('season and legal-hold routes', () => {
    it('requires authentication to list player rewards', async () => {
      const res = await sendRequest('GET', '/api/seasons/rewards');
      expect(res.statusCode).toBe(401);
    });

    it('rejects unknown fields in an admin season request', async () => {
      const res = await sendRequest(
        'POST',
        '/api/admin/seasons',
        {
          id: 'season-2026-1',
          name: 'Season 1',
          startsAt: '2026-08-01T00:00:00.000Z',
          endsAt: '2026-09-01T00:00:00.000Z',
          startingRating: 1000,
          placementMatches: 5,
          ratingDecayPercent: 25,
          rulesVersion: 'rules-1',
          rewardConfig: { tiers: [] },
          unexpected: true,
        },
        adminUnsafeHeaders(),
      );
      expect(res.statusCode).toBe(400);
      expect(parseBody(res)).toMatchObject({ error: 'Validation failed' });
    });

    it('requires an audit-friendly reason when creating a legal hold', async () => {
      const res = await sendRequest(
        'POST',
        '/api/admin/legal-holds',
        { subjectType: 'account', subjectId: 'u_1', owner: 'legal-team', reason: 'short' },
        adminUnsafeHeaders(),
      );
      expect(res.statusCode).toBe(400);
      expect(parseBody(res)).toMatchObject({ error: 'Validation failed' });
    });

    it('rejects malformed season ids before claiming a reward', async () => {
      const res = await sendRequest('POST', '/api/seasons/not%20valid/rewards/claim', null, userUnsafeHeaders());
      expect(res.statusCode).toBe(400);
    });

    it('binds reward claims to the authenticated player', async () => {
      mockQuery.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM season_rewards') && sql.includes('FOR UPDATE')) {
          return { rows: [{ reward_tier: 'champion', reward_payload: {}, claimed_at: null }], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO season_reward_entitlements')) {
          return {
            rows: [{ id: 1, reward_tier: 'champion', reward_payload: {}, granted_at: '2026-07-12T00:00:00.000Z' }],
            rowCount: 1,
          };
        }
        if (sql.includes('UPDATE season_rewards')) {
          return { rows: [{ claimed_at: '2026-07-12T00:00:00.000Z' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      });
      const res = await sendRequest(
        'POST',
        '/api/seasons/season-2026-1/rewards/claim',
        null,
        userUnsafeHeaders('u_claimant'),
      );
      expect(res.statusCode).toBe(200);
      expect(parseBody(res)).toMatchObject({ claimed: true, reward: { reward_tier: 'champion' } });
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('UPDATE season_rewards'), [
        'season-2026-1',
        'u_claimant',
      ]);
    });
  });

  describe('API graceful shutdown', () => {
    function shutdownLog() {
      return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    }

    it('marks readiness down synchronously, drains HTTP, then stops workers and dependencies in order', async () => {
      const events: string[] = [];
      let finishHttpDrain: ((error?: Error) => void) | undefined;
      const setExitCode = vi.fn();
      const httpServer = {
        listening: true,
        close: vi.fn((callback: (error?: Error) => void) => {
          events.push('server.close');
          finishHttpDrain = callback;
        }),
        closeIdleConnections: vi.fn(() => events.push('server.closeIdleConnections')),
        closeAllConnections: vi.fn(),
      };
      const shutdown = createGracefulShutdown({
        httpServer,
        beginDrain: () => events.push('readiness-down'),
        stopWorkers: async () => {
          events.push('workers');
        },
        closeResources: async () => {
          events.push('postgres-redis');
        },
        closeTelemetry: async () => {
          events.push('telemetry');
        },
        httpDrainTimeoutMs: 1_000,
        shutdownTimeoutMs: 2_000,
        log: shutdownLog(),
        setExitCode,
        forceExit: vi.fn(),
      });

      const shutdownPromise = shutdown('SIGTERM');

      expect(events).toEqual(['readiness-down', 'server.close', 'server.closeIdleConnections']);
      expect(setExitCode).not.toHaveBeenCalled();
      finishHttpDrain?.();
      await shutdownPromise;

      expect(events).toEqual([
        'readiness-down',
        'server.close',
        'server.closeIdleConnections',
        'workers',
        'postgres-redis',
        'telemetry',
      ]);
      expect(setExitCode).toHaveBeenCalledWith(0);
    });

    it('bounds HTTP drain time before stopping workers', async () => {
      const events: string[] = [];
      const httpServer = {
        listening: true,
        close: vi.fn(() => events.push('server.close')),
        closeIdleConnections: vi.fn(),
        closeAllConnections: vi.fn(() => events.push('forced-connections')),
      };
      const shutdown = createGracefulShutdown({
        httpServer,
        beginDrain: () => events.push('readiness-down'),
        stopWorkers: async () => {
          events.push('workers');
        },
        closeResources: async () => {
          events.push('resources');
        },
        httpDrainTimeoutMs: 5,
        shutdownTimeoutMs: 1_000,
        log: shutdownLog(),
        setExitCode: vi.fn(),
        forceExit: vi.fn(),
      });

      await shutdown();

      expect(events).toEqual(['readiness-down', 'server.close', 'forced-connections', 'workers', 'resources']);
    });

    it('coalesces repeated shutdown signals into the same drain', async () => {
      let finishHttpDrain: (() => void) | undefined;
      const beginDrain = vi.fn();
      const stopWorkers = vi.fn(async () => undefined);
      const closeResources = vi.fn(async () => undefined);
      const setExitCode = vi.fn();
      const httpServer = {
        listening: true,
        close: vi.fn((callback: () => void) => {
          finishHttpDrain = callback;
        }),
        closeIdleConnections: vi.fn(),
        closeAllConnections: vi.fn(),
      };
      const shutdown = createGracefulShutdown({
        httpServer,
        beginDrain,
        stopWorkers,
        closeResources,
        httpDrainTimeoutMs: 1_000,
        shutdownTimeoutMs: 2_000,
        log: shutdownLog(),
        setExitCode,
        forceExit: vi.fn(),
      });

      const sigtermShutdown = shutdown('SIGTERM');
      const sigintShutdown = shutdown('SIGINT');

      expect(sigintShutdown).toBe(sigtermShutdown);
      expect(beginDrain).toHaveBeenCalledOnce();
      expect(httpServer.close).toHaveBeenCalledOnce();

      finishHttpDrain?.();
      await Promise.all([sigtermShutdown, sigintShutdown]);

      expect(stopWorkers).toHaveBeenCalledOnce();
      expect(closeResources).toHaveBeenCalledOnce();
      expect(setExitCode).toHaveBeenCalledOnce();
    });

    it('uses the hard watchdog without stopping dependencies ahead of in-flight HTTP', async () => {
      let finishHttpDrain: ((error?: Error) => void) | undefined;
      const stopWorkers = vi.fn(async () => undefined);
      const closeResources = vi.fn(async () => undefined);
      const forceExit = vi.fn();
      const httpServer = {
        listening: true,
        close: vi.fn((callback: (error?: Error) => void) => {
          finishHttpDrain = callback;
        }),
        closeIdleConnections: vi.fn(),
        closeAllConnections: vi.fn(() => finishHttpDrain?.()),
      };
      const shutdown = createGracefulShutdown({
        httpServer,
        beginDrain: vi.fn(),
        stopWorkers,
        closeResources,
        httpDrainTimeoutMs: 1_000,
        shutdownTimeoutMs: 5,
        log: shutdownLog(),
        setExitCode: vi.fn(),
        forceExit,
      });

      await shutdown();

      expect(httpServer.closeAllConnections).toHaveBeenCalledOnce();
      expect(forceExit).toHaveBeenCalledWith(1);
      expect(stopWorkers).not.toHaveBeenCalled();
      expect(closeResources).not.toHaveBeenCalled();
    });

    it('returns readiness 503 when drain begins during a dependency probe while keeping health available', async () => {
      let resolvePostgresProbe: ((value: { rows: Array<Record<string, number>> }) => void) | undefined;
      let signalPostgresProbeStarted: (() => void) | undefined;
      const postgresProbeStarted = new Promise<void>((resolve) => {
        signalPostgresProbeStarted = resolve;
      });
      let deferNextPostgresProbe = true;
      mockQuery.mockImplementation((sql: string) => {
        if (sql === 'SELECT 1' && deferNextPostgresProbe) {
          deferNextPostgresProbe = false;
          signalPostgresProbeStarted?.();
          return new Promise((resolve) => {
            resolvePostgresProbe = resolve;
          });
        }
        if (sql === 'SELECT 1') return Promise.resolve({ rows: [{ '?column?': 1 }], rowCount: 1 });
        return Promise.resolve({ rows: [], rowCount: 0 });
      });
      mockRedisPing.mockResolvedValue('PONG');

      const readyResponsePromise = sendRequest('GET', '/ready');
      await postgresProbeStarted;
      markApiDraining();
      resolvePostgresProbe?.({ rows: [{ '?column?': 1 }] });

      const readyResponse = await readyResponsePromise;
      expect(readyResponse.statusCode).toBe(503);
      expect(parseBody(readyResponse)).toMatchObject({
        ready: false,
        checks: { draining: 'down', postgres: 'up', redis: 'up' },
      });

      const healthResponse = await sendRequest('GET', '/health');
      expect(healthResponse.statusCode).toBe(200);
      expect(parseBody(healthResponse)).toMatchObject({ status: 'ok' });
    });
  });
});
