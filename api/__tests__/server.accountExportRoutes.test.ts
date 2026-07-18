import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters!!';
process.env.NODE_ENV = 'test';
process.env.APP_VERSION = '0.2.0';
process.env.RUNTIME_SCHEMA_DDL = 'false';
delete process.env.ALLOWED_ORIGINS;
delete process.env.SENTRY_DSN;
delete process.env.TURNSTILE_REQUIRED;
delete process.env.TURNSTILE_SECRET_KEY;

const JOB_ID = '11111111-2222-4333-8444-555555555555';
const CONTENT_SHA256 = 'a'.repeat(64);
const REQUEST_ID = 'account-export-route-request-1';

const mockQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
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
  getdel: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue('OK'),
  eval: vi.fn().mockResolvedValue(null),
  scan: vi.fn().mockResolvedValue(['0', []]),
  mget: vi.fn().mockResolvedValue([]),
  mmTryMatch: vi.fn().mockResolvedValue(''),
  mmCleanExpired: vi.fn().mockResolvedValue(0),
  mmCancelPair: vi.fn().mockResolvedValue(0),
  mmApplyBlock: vi.fn().mockResolvedValue(0),
  sadd: vi.fn().mockResolvedValue(1),
  srem: vi.fn().mockResolvedValue(1),
  publish: vi.fn().mockResolvedValue(1),
};

const mockCreateAccountExportJob = vi.fn();
const mockListAccountExportJobs = vi.fn();
const mockGetAccountExportJob = vi.fn();
const mockRecordAccountExportDownloadEvent = vi.fn();
const mockAccountExportWorkerStop = vi.fn().mockResolvedValue(undefined);
const mockCreateAccountExportWorker = vi.fn(() => ({
  start: vi.fn(),
  stop: mockAccountExportWorkerStop,
  tick: vi.fn().mockResolvedValue(undefined),
}));

const mockStorageGetObject = vi.fn();
const mockAccountExportStorage = {
  configured: true,
  getObject: mockStorageGetObject,
};

const mockStageAccountExportDownload = vi.fn();
let mockStagedCleanup = vi.fn().mockResolvedValue(undefined);

type StreamDisposition = 'finish' | 'close' | 'error';
let streamDisposition: StreamDisposition = 'finish';
let streamError = new Error('verified file stream failed');

function createFakeReadStream() {
  const listeners = new Map<string, Array<(error?: Error) => void>>();
  const stream = {
    destroy: vi.fn(),
    once(event: string, callback: (error?: Error) => void) {
      const current = listeners.get(event) ?? [];
      current.push(callback);
      listeners.set(event, current);
      return stream;
    },
    pipe(destination: { end: (data?: unknown) => void; destroy: (error?: Error) => void; simulateClose: () => void }) {
      process.nextTick(() => {
        if (streamDisposition === 'finish') destination.end(Buffer.from('verified-export'));
        else if (streamDisposition === 'close') destination.simulateClose();
        else for (const callback of listeners.get('error') ?? []) callback(streamError);
      });
      return destination;
    },
  };
  return stream;
}

const mockCreateReadStream = vi.fn(createFakeReadStream);

const require_ = createRequire(import.meta.url);
const actualFs = require_('node:fs') as typeof import('node:fs');
const cacheCleaner = createRequire(import.meta.url);
for (const key of Object.keys(cacheCleaner.cache)) {
  if (key.endsWith('/api/server.cjs') || key.includes('/node_modules/pg/') || key.includes('/node_modules/ioredis/')) {
    delete cacheCleaner.cache[key];
  }
}

const Module_ = require_('module') as typeof import('node:module');
const originalLoad = Module_._load;
Module_._load = function (request: string, parent: NodeJS.Module | undefined, isMain: boolean) {
  const fromServer = parent?.filename.endsWith('/api/server.cjs');
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
  if (fromServer && request === 'node:fs') {
    return { ...actualFs, createReadStream: mockCreateReadStream };
  }
  if (fromServer && request === './schemaGate.cjs') {
    return { assertRuntimeSchema: vi.fn().mockResolvedValue(undefined) };
  }
  if (fromServer && request === './accountExportService.cjs') {
    return {
      accountExportStats: vi.fn().mockResolvedValue({
        pending: 0,
        failed: 0,
        oldestAgeSeconds: 0,
        purgePending: 0,
        purgeRetrying: 0,
      }),
      createAccountExportJob: mockCreateAccountExportJob,
      createAccountExportWorker: mockCreateAccountExportWorker,
      getAccountExportJob: mockGetAccountExportJob,
      listAccountExportJobs: mockListAccountExportJobs,
      recordAccountExportDownloadEvent: mockRecordAccountExportDownloadEvent,
    };
  }
  if (fromServer && request === './accountExportArtifact.cjs') {
    return {
      cleanupStaleAccountExportArtifacts: vi.fn().mockResolvedValue(undefined),
      createAccountExportArtifact: vi.fn(),
      resolveAccountExportPseudonymKey: vi.fn(() => Buffer.alloc(32, 1)),
    };
  }
  if (fromServer && request === './accountExportDownload.cjs') {
    return { stageAccountExportDownload: mockStageAccountExportDownload };
  }
  if (fromServer && request === './accountExportStorage.cjs') {
    return { createAccountExportStorageFromEnv: vi.fn(() => mockAccountExportStorage) };
  }
  if (fromServer && request === './relationshipOutbox.cjs') {
    return {
      createRelationshipOutboxWorker: vi.fn(() => ({
        start: vi.fn(),
        stop: vi.fn().mockResolvedValue(undefined),
      })),
      RelationshipOutboxPermanentError: class RelationshipOutboxPermanentError extends Error {},
      relationshipOutboxConfig: vi.fn(() => ({})),
      relationshipOutboxStats: vi.fn().mockResolvedValue({ pending: 0, deadLetter: 0, oldestAgeSeconds: 0 }),
    };
  }
  return originalLoad.call(Module_, request, parent, isMain);
};

let serverModule: {
  handleRequest: (req: unknown, res: unknown) => void;
  closeDatabase: () => Promise<void>;
  schemaReady: Promise<void>;
};
try {
  serverModule = require_('../server.cjs') as typeof serverModule;
} finally {
  Module_._load = originalLoad;
}

const { handleRequest, schemaReady } = serverModule;

type EventCallback = (...args: unknown[]) => void;
type StoredListener = { callback: EventCallback; once: boolean };

interface MockReq {
  method: string;
  url: string;
  headers: Record<string, string>;
  socket: { remoteAddress: string; localPort: number };
  destroyed: boolean;
  on: (event: string, callback: EventCallback) => MockReq;
  once: (event: string, callback: EventCallback) => MockReq;
  off: (event: string, callback: EventCallback) => MockReq;
}

interface MockRes {
  statusCode: number;
  headers: Record<string, string>;
  headersSent: boolean;
  ended: boolean;
  destroyed: boolean;
  body: Buffer;
  setHeader: (name: string, value: unknown) => void;
  getHeader: (name: string) => string | undefined;
  writeHead: (status: number, headers?: Record<string, unknown>) => MockRes;
  end: (data?: unknown) => void;
  destroy: (error?: Error) => void;
  on: (event: string, callback: EventCallback) => MockRes;
  once: (event: string, callback: EventCallback) => MockRes;
  off: (event: string, callback: EventCallback) => MockRes;
  simulateClose: () => void;
}

function addListener(listeners: Map<string, StoredListener[]>, event: string, callback: EventCallback, once: boolean) {
  const current = listeners.get(event) ?? [];
  current.push({ callback, once });
  listeners.set(event, current);
}

function removeListener(listeners: Map<string, StoredListener[]>, event: string, callback: EventCallback) {
  listeners.set(
    event,
    (listeners.get(event) ?? []).filter((listener) => listener.callback !== callback),
  );
}

function emit(listeners: Map<string, StoredListener[]>, event: string, ...args: unknown[]) {
  const current = [...(listeners.get(event) ?? [])];
  listeners.set(
    event,
    (listeners.get(event) ?? []).filter((listener) => !listener.once),
  );
  for (const listener of current) listener.callback(...args);
}

function createMockReq(method: string, url: string, headers: Record<string, string> = {}): MockReq {
  const listeners = new Map<string, StoredListener[]>();
  const req: MockReq = {
    method,
    url,
    headers: { ...headers },
    socket: { remoteAddress: '127.0.0.1', localPort: 3001 },
    destroyed: false,
    on(event, callback) {
      addListener(listeners, event, callback, false);
      return req;
    },
    once(event, callback) {
      addListener(listeners, event, callback, true);
      return req;
    },
    off(event, callback) {
      removeListener(listeners, event, callback);
      return req;
    },
  };
  return req;
}

function createMockRes(resolveResponse: () => void): MockRes {
  const listeners = new Map<string, StoredListener[]>();
  const chunks: Buffer[] = [];
  const res: MockRes = {
    statusCode: 200,
    headers: {},
    headersSent: false,
    ended: false,
    destroyed: false,
    body: Buffer.alloc(0),
    setHeader(name, value) {
      res.headers[name.toLowerCase()] = String(value);
    },
    getHeader(name) {
      return res.headers[name.toLowerCase()];
    },
    writeHead(status, headers) {
      res.statusCode = status;
      for (const [name, value] of Object.entries(headers ?? {})) res.setHeader(name, value);
      res.headersSent = true;
      return res;
    },
    end(data) {
      if (data !== undefined) chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(String(data)));
      res.body = Buffer.concat(chunks);
      res.headersSent = true;
      res.ended = true;
      emit(listeners, 'finish');
      resolveResponse();
    },
    destroy(error) {
      res.destroyed = true;
      emit(listeners, 'close', error);
      resolveResponse();
    },
    on(event, callback) {
      addListener(listeners, event, callback, false);
      return res;
    },
    once(event, callback) {
      addListener(listeners, event, callback, true);
      return res;
    },
    off(event, callback) {
      removeListener(listeners, event, callback);
      return res;
    },
    simulateClose() {
      res.destroyed = true;
      emit(listeners, 'close');
      resolveResponse();
    },
  };
  return res;
}

async function sendRequest(method: string, url: string, headers: Record<string, string> = {}) {
  const req = createMockReq(method, url, headers);
  let resolveResponse!: () => void;
  const responsePromise = new Promise<void>((resolve) => {
    resolveResponse = resolve;
  });
  const res = createMockRes(resolveResponse);
  handleRequest(req, res);
  await Promise.race([
    responsePromise,
    new Promise<void>((_, reject) => setTimeout(() => reject(new Error('Response timeout')), 2_000)),
  ]);
  await new Promise<void>((resolve) => setImmediate(resolve));
  return res;
}

function parseJson(res: MockRes) {
  return JSON.parse(res.body.toString('utf8')) as Record<string, unknown>;
}

function createUserJwt(userId = 'user-owner') {
  const now = Math.floor(Date.now() / 1_000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: userId, userId, iat: now, exp: now + 3_600 })).toString(
    'base64url',
  );
  const input = `${header}.${payload}`;
  const signature = crypto
    .createHmac('sha256', process.env.JWT_SECRET ?? '')
    .update(input)
    .digest('base64url');
  return `${input}.${signature}`;
}

function authHeaders(userId = 'user-owner') {
  return {
    authorization: `Bearer ${createUserJwt(userId)}`,
    'x-request-id': REQUEST_ID,
  };
}

function unsafeAuthHeaders(userId = 'user-owner') {
  const csrf = 'account-export-csrf-token-123456789';
  return {
    ...authHeaders(userId),
    cookie: `zutomayo_csrf=${csrf}`,
    'x-csrf-token': csrf,
  };
}

function job(status: string) {
  return {
    id: JOB_ID,
    status,
    formatVersion: 1,
    sizeBytes: status === 'ready' ? 15 : null,
    uncompressedSizeBytes: status === 'ready' ? 30 : null,
    contentSha256: status === 'ready' ? CONTENT_SHA256 : null,
    attemptCount: status === 'queued' ? 0 : 1,
    maxAttempts: 5,
    requestedAt: '2026-07-14T00:00:00.000Z',
    snapshotAt: status === 'ready' ? '2026-07-14T00:00:01.000Z' : null,
    startedAt: status === 'queued' ? null : '2026-07-14T00:00:01.000Z',
    completedAt: status === 'ready' ? '2026-07-14T00:00:02.000Z' : null,
    expiresAt: status === 'ready' ? '2026-07-21T00:00:02.000Z' : null,
    downloadedAt: null,
    downloadCount: 0,
    errorCode: '',
  };
}

function lookup(status: string) {
  return {
    ok: true,
    body: {
      job: job(status),
      objectKey: status === 'ready' ? `account-exports/user-owner/${JOB_ID}.json.gz` : null,
      objectVersionId: status === 'ready' ? 'object-version-1' : null,
    },
  };
}

function useValidStoredObject() {
  const bodyDestroy = vi.fn();
  const cleanup = vi.fn();
  mockStorageGetObject.mockResolvedValue({
    body: { destroy: bodyDestroy },
    contentLength: 15,
    metadata: { sha256: CONTENT_SHA256 },
    cleanup,
    refreshTimeout: vi.fn(),
  });
  return { bodyDestroy, cleanup };
}

function expectAuditSequence(...eventTypes: string[]) {
  expect(mockRecordAccountExportDownloadEvent).toHaveBeenCalledTimes(eventTypes.length);
  expect(mockRecordAccountExportDownloadEvent.mock.calls.map(([input]) => input.eventType)).toEqual(eventTypes);
  for (const [input] of mockRecordAccountExportDownloadEvent.mock.calls) {
    expect(input).toMatchObject({ userId: 'user-owner', jobId: JOB_ID, requestId: REQUEST_ID });
  }
}

beforeAll(async () => {
  await schemaReady;
});

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  mockRedis.incr.mockResolvedValue(1);
  mockRedis.expire.mockResolvedValue(1);
  mockCreateAccountExportJob.mockResolvedValue({ ok: true, body: { job: job('queued') } });
  mockListAccountExportJobs.mockResolvedValue({ ok: true, body: { jobs: [job('queued')] } });
  mockGetAccountExportJob.mockResolvedValue(lookup('ready'));
  mockRecordAccountExportDownloadEvent.mockResolvedValue({ ok: true });
  mockStagedCleanup = vi.fn().mockResolvedValue(undefined);
  mockStageAccountExportDownload.mockResolvedValue({
    filePath: '/tmp/account-export-route-test/account-export.json.gz',
    sizeBytes: 15,
    cleanup: mockStagedCleanup,
  });
  streamDisposition = 'finish';
  streamError = new Error('verified file stream failed');
});

afterAll(async () => {
  await serverModule.closeDatabase();
});

describe('account export HTTP routes', () => {
  it('retires the legacy synchronous GET endpoint with successor headers', async () => {
    const res = await sendRequest('GET', '/api/account/export');

    expect(res.statusCode).toBe(410);
    expect(res.headers.deprecation).toBe('true');
    expect(res.headers.sunset).toBe('Wed, 14 Oct 2026 00:00:00 GMT');
    expect(res.headers.link).toBe('</api/account/exports>; rel="successor-version"');
    expect(parseJson(res).error).toContain('Synchronous account export was removed');
  });

  it('requires CSRF before creating an export job', async () => {
    const res = await sendRequest('POST', '/api/account/exports', authHeaders());

    expect(res.statusCode).toBe(403);
    expect(parseJson(res)).toEqual({ error: 'CSRF token validation failed' });
    expect(mockCreateAccountExportJob).not.toHaveBeenCalled();
  });

  it('requires authentication before creating an export job', async () => {
    const csrf = 'account-export-csrf-token-123456789';
    const res = await sendRequest('POST', '/api/account/exports', {
      cookie: `zutomayo_csrf=${csrf}`,
      'x-csrf-token': csrf,
    });

    expect(res.statusCode).toBe(401);
    expect(parseJson(res)).toEqual({ error: 'Unauthorized' });
    expect(mockCreateAccountExportJob).not.toHaveBeenCalled();
  });

  it('creates a queued job with polling headers and request correlation', async () => {
    const res = await sendRequest('POST', '/api/account/exports', unsafeAuthHeaders());

    expect(res.statusCode).toBe(202);
    expect(res.headers.location).toBe(`/api/account/exports/${JOB_ID}`);
    expect(res.headers['retry-after']).toBe('2');
    expect(res.headers['cache-control']).toBe('no-store, private');
    expect(res.headers.vary).toBe('Cookie, Authorization');
    expect(parseJson(res)).toEqual({ job: job('queued') });
    expect(mockCreateAccountExportJob).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-owner', requestId: REQUEST_ID }),
    );
  });

  it('scopes list queries to the authenticated user and does not leak another owner status', async () => {
    const listRes = await sendRequest('GET', '/api/account/exports', authHeaders());
    expect(listRes.statusCode).toBe(200);
    expect(mockListAccountExportJobs).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-owner' }));

    mockGetAccountExportJob.mockResolvedValueOnce({
      ok: false,
      status: 404,
      error: 'Account export not found',
    });
    const statusRes = await sendRequest('GET', `/api/account/exports/${JOB_ID}`, authHeaders());

    expect(statusRes.statusCode).toBe(404);
    expect(parseJson(statusRes)).toEqual({ error: 'Account export not found' });
    expect(mockGetAccountExportJob).toHaveBeenLastCalledWith(
      expect.objectContaining({ userId: 'user-owner', jobId: JOB_ID }),
    );
  });

  it.each([
    ['queued', 409],
    ['expired', 410],
  ])('rejects a %s download with %i', async (status, expectedStatus) => {
    mockGetAccountExportJob.mockResolvedValue(lookup(status));

    const res = await sendRequest('GET', `/api/account/exports/${JOB_ID}/download`, authHeaders());

    expect(res.statusCode).toBe(expectedStatus);
    expect(parseJson(res)).toEqual({ error: 'Account export is not ready' });
    expect(mockStorageGetObject).not.toHaveBeenCalled();
    expect(mockRecordAccountExportDownloadEvent).not.toHaveBeenCalled();
  });

  it('fails closed and audits an object metadata mismatch', async () => {
    const bodyDestroy = vi.fn();
    const cleanup = vi.fn();
    mockStorageGetObject.mockResolvedValue({
      body: { destroy: bodyDestroy },
      contentLength: 14,
      metadata: { sha256: 'b'.repeat(64) },
      cleanup,
    });

    const res = await sendRequest('GET', `/api/account/exports/${JOB_ID}/download`, authHeaders());

    expect(res.statusCode).toBe(502);
    expect(parseJson(res)).toEqual({ error: 'Account export integrity verification failed' });
    expect(bodyDestroy).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
    expectAuditSequence('download_started', 'integrity_failed');
    expect(mockRecordAccountExportDownloadEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ details: { sizeMatched: false, checksumMatched: false } }),
    );
  });

  it('stages a verified object and audits completion only after response finish', async () => {
    const object = useValidStoredObject();

    const res = await sendRequest('GET', `/api/account/exports/${JOB_ID}/download`, authHeaders());

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/gzip');
    expect(res.headers['content-length']).toBe('15');
    expect(res.headers['x-content-sha256']).toBe(CONTENT_SHA256);
    expect(res.headers['content-disposition']).toContain(JOB_ID);
    expect(res.body.toString()).toBe('verified-export');
    expect(mockStageAccountExportDownload).toHaveBeenCalledWith(
      expect.objectContaining({ expectedSize: 15, expectedSha256: CONTENT_SHA256 }),
    );
    expect(object.cleanup).toHaveBeenCalledOnce();
    expect(mockStagedCleanup).toHaveBeenCalledOnce();
    expectAuditSequence('download_started', 'download_completed');
  });

  it('audits an interrupted terminal event when the client closes during streaming', async () => {
    useValidStoredObject();
    streamDisposition = 'close';

    const res = await sendRequest('GET', `/api/account/exports/${JOB_ID}/download`, authHeaders());

    expect(res.destroyed).toBe(true);
    expect(mockStagedCleanup).toHaveBeenCalledOnce();
    expectAuditSequence('download_started', 'download_interrupted');
    expect(mockRecordAccountExportDownloadEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ details: { phase: 'client_close' } }),
    );
  });

  it('audits object fetch failure and returns a retryable gateway error', async () => {
    mockStorageGetObject.mockRejectedValue(new Error('S3 unavailable'));

    const res = await sendRequest('GET', `/api/account/exports/${JOB_ID}/download`, authHeaders());

    expect(res.statusCode).toBe(502);
    expect(parseJson(res)).toEqual({ error: 'Account export object is temporarily unavailable' });
    expectAuditSequence('download_started', 'download_interrupted');
    expect(mockRecordAccountExportDownloadEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ details: { phase: 'object_fetch' } }),
    );
  });

  it('destroys the source, audits staging failure, and returns a retryable gateway error', async () => {
    const object = useValidStoredObject();
    mockStageAccountExportDownload.mockRejectedValue(new Error('temporary disk unavailable'));

    const res = await sendRequest('GET', `/api/account/exports/${JOB_ID}/download`, authHeaders());

    expect(res.statusCode).toBe(502);
    expect(parseJson(res)).toEqual({ error: 'Account export object is temporarily unavailable' });
    expect(object.bodyDestroy).toHaveBeenCalledOnce();
    expect(object.cleanup).toHaveBeenCalledOnce();
    expectAuditSequence('download_started', 'download_interrupted');
    expect(mockRecordAccountExportDownloadEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ details: { phase: 'object_stage' } }),
    );
  });
});
