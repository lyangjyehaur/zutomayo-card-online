import { createRequire } from 'node:module';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// ===== Environment setup (must happen before requiring server.cjs) =====
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters!!';
process.env.NODE_ENV = 'test';
process.env.APP_VERSION = '0.1.3';
delete process.env.TURNSTILE_SECRET_KEY;
delete process.env.TURNSTILE_REQUIRED;
delete process.env.SENTRY_DSN;
delete process.env.ALLOWED_ORIGINS; // Use dev origins fallback

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

    it('GET /api/decks returns 401 without auth', async () => {
      const res = await sendRequest('GET', '/api/decks');
      expect(res.statusCode).toBe(401);
    });

    it('GET /api/matches returns 401 without auth', async () => {
      const res = await sendRequest('GET', '/api/matches');
      expect(res.statusCode).toBe(401);
    });

    it('GET /api/admin/users returns 401 without admin token', async () => {
      const res = await sendRequest('GET', '/api/admin/users');
      expect(res.statusCode).toBe(401);
    });

    it('GET /api/admin/matches returns 401 without admin token', async () => {
      const res = await sendRequest('GET', '/api/admin/matches');
      expect(res.statusCode).toBe(401);
    });

    it('GET /api/matchmaking/status returns 401 without auth', async () => {
      const res = await sendRequest('GET', '/api/matchmaking/status');
      expect(res.statusCode).toBe(401);
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
