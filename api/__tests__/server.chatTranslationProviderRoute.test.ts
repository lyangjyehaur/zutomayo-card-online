import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters!!';
process.env.NODE_ENV = 'test';
process.env.APP_VERSION = '0.1.3';
process.env.CHAT_TRANSLATION_ENDPOINT = 'https://llm.example.test/translate';
process.env.CHAT_TRANSLATION_API_KEY = 'test-translation-key';
process.env.CHAT_TRANSLATION_PROVIDER = 'llm-gateway';
process.env.CHAT_TRANSLATION_MODEL = 'zutomayo-translate-v1';
process.env.CHAT_TRANSLATION_TIMEOUT_MS = '5000';
delete process.env.TURNSTILE_SECRET_KEY;
delete process.env.TURNSTILE_REQUIRED;
delete process.env.SENTRY_DSN;
delete process.env.ALLOWED_ORIGINS;

type QueryResult = { rows: Array<Record<string, unknown>>; rowCount?: number };

const mockQuery = vi.fn<() => Promise<QueryResult>>().mockResolvedValue({ rows: [], rowCount: 0 });
const mockPoolEnd = vi.fn().mockResolvedValue(undefined);
const mockPoolOn = vi.fn();
const mockPool = { query: mockQuery, end: mockPoolEnd, on: mockPoolOn };

const mockRedis = {
  incr: vi.fn().mockResolvedValue(1),
  expire: vi.fn().mockResolvedValue(1),
  ping: vi.fn().mockResolvedValue('PONG'),
  quit: vi.fn().mockResolvedValue(undefined),
  defineCommand: vi.fn(),
  on: vi.fn(),
  hgetall: vi.fn().mockResolvedValue({}),
  hset: vi.fn().mockResolvedValue(1),
  zadd: vi.fn().mockResolvedValue(1),
  zrem: vi.fn().mockResolvedValue(1),
  zcount: vi.fn().mockResolvedValue(0),
  zremrangebyscore: vi.fn().mockResolvedValue(0),
  del: vi.fn().mockResolvedValue(1),
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue('OK'),
  mmTryMatch: vi.fn().mockResolvedValue(''),
  mmCleanExpired: vi.fn().mockResolvedValue(0),
};

const mockFetch = vi.fn().mockResolvedValue({
  ok: true,
  status: 200,
  json: async () => ({
    translatedContent: 'hello from provider',
    provider: 'llm-gateway',
    model: 'zutomayo-translate-v1',
  }),
});
vi.stubGlobal('fetch', mockFetch);

const cacheCleaner = createRequire(import.meta.url);
for (const key of Object.keys(cacheCleaner.cache)) {
  if (key.includes('/node_modules/pg/') || key.includes('/node_modules/ioredis/') || key.endsWith('/api/server.cjs')) {
    delete cacheCleaner.cache[key];
  }
}

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
  destroy: () => void;
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
      if (event === 'data' && bodyStr) process.nextTick(() => cb(bodyStr));
      else if (event === 'end') process.nextTick(() => cb());
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
        for (const [key, value] of Object.entries(headers)) res.headers[key.toLowerCase()] = value;
      }
      res.headersSent = true;
    },
    end(data) {
      if (data !== undefined) res._body = String(data);
      res.headersSent = true;
      res.ended = true;
      for (const cb of listeners.finish ?? []) cb();
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
  let resolveEnd!: () => void;
  const endPromise = new Promise<void>((resolve) => {
    resolveEnd = resolve;
  });
  const res = createMockRes(resolveEnd);
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

function base64urlJson(value: Record<string, unknown>) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function createUserJwt(userId = 'u_reader') {
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

function userUnsafeHeaders(userId = 'u_reader') {
  const csrfToken = 'valid-csrf-token-for-testing-1234567890';
  return {
    authorization: `Bearer ${createUserJwt(userId)}`,
    cookie: `zutomayo_csrf=${csrfToken}`,
    'x-csrf-token': csrfToken,
  };
}

describe('chat translation provider route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        translatedContent: 'hello from provider',
        provider: 'llm-gateway',
        model: 'zutomayo-translate-v1',
      }),
    });
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('returns 200 and persists ready translations from the configured HTTP LLM gateway', async () => {
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
      .mockResolvedValueOnce({ rows: [{ role: 'player' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({
        rows: [
          {
            message_id: 'chat_msg_1',
            target_language: 'en',
            translated_content: 'hello from provider',
            provider: 'llm-gateway',
            model: 'zutomayo-translate-v1',
            status: 'ready',
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

    expect(res.statusCode).toBe(200);
    expect(parseBody(res)).toEqual({
      cached: false,
      translation: expect.objectContaining({
        messageId: 'chat_msg_1',
        targetLanguage: 'en',
        translatedContent: 'hello from provider',
        provider: 'llm-gateway',
        model: 'zutomayo-translate-v1',
        status: 'ready',
      }),
    });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://llm.example.test/translate',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-translation-key',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          text: 'こんにちは',
          sourceLanguage: 'ja',
          targetLanguage: 'en',
          messageId: 'chat_msg_1',
          conversationId: 'match:bgio-match-1',
          model: 'zutomayo-translate-v1',
        }),
      }),
    );
    expect(mockQuery).toHaveBeenLastCalledWith(expect.stringContaining('INSERT INTO chat_message_translations'), [
      'chat_msg_1',
      'en',
      'hello from provider',
      'llm-gateway',
      'zutomayo-translate-v1',
      'ready',
    ]);
  });
});
