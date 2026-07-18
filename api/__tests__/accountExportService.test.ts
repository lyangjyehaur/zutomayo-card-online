import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  claimAccountExportJob,
  completeAccountExportJob,
  createAccountExportWorker,
  expireAccountExportJobsForUser,
  expireDueAccountExportJobs,
  failAccountExportJob,
  markAccountExportPurged,
  objectKeyForJob,
  reapExhaustedAccountExportLeases,
  recordAccountExportDownloadEvent,
  renewAccountExportLease,
  scheduleAccountExportPurgeRetry,
} = require('../accountExportService.cjs') as {
  claimAccountExportJob: (input: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
  completeAccountExportJob: (input: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
  createAccountExportWorker: (input: Record<string, unknown>) => {
    tick: () => Promise<void>;
    stop: () => Promise<void>;
  };
  expireAccountExportJobsForUser: (input: Record<string, unknown>) => Promise<number>;
  expireDueAccountExportJobs: (input: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
  failAccountExportJob: (input: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
  markAccountExportPurged: (input: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
  objectKeyForJob: (prefix: string, job: Record<string, unknown>) => string;
  reapExhaustedAccountExportLeases: (input: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
  recordAccountExportDownloadEvent: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  renewAccountExportLease: (input: Record<string, unknown>) => Promise<boolean>;
  scheduleAccountExportPurgeRetry: (input: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
};

type Query = { sql: string; params?: unknown[] };
type QueryResult = { rows: Array<Record<string, unknown>>; rowCount?: number };

function createPool(handler: (sql: string, params?: unknown[]) => QueryResult | Promise<QueryResult>) {
  const queries: Query[] = [];
  const release = vi.fn();
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    queries.push({ sql, params });
    return handler(sql, params);
  });
  const client = { query, release };
  const pool = { query, connect: vi.fn(async () => client) };
  return { client, pool, queries, release };
}

function emptyResult(): QueryResult {
  return { rows: [], rowCount: 0 };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('account export lease fencing', () => {
  it('claims one eligible job with SKIP LOCKED and a fresh fenced lease token', async () => {
    const leaseToken = 'lease-token-1234567890-abcdef';
    const job = {
      id: 'export-job-12345678',
      user_id: 'user-1',
      status: 'processing',
      attempt_count: 2,
      lease_token: leaseToken,
    };
    const { pool, queries, release } = createPool((sql) =>
      sql.includes('WITH candidate AS') ? { rows: [job], rowCount: 1 } : emptyResult(),
    );

    await expect(
      claimAccountExportJob({
        pool,
        leaseMs: 12_345,
        generateLeaseToken: () => leaseToken,
      }),
    ).resolves.toEqual(job);

    const claim = queries.find(({ sql }) => sql.includes('WITH candidate AS'));
    expect(claim?.sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(claim?.sql).toContain("status = 'processing' AND lease_expires_at < NOW()");
    expect(claim?.sql).toContain('attempt_count = jobs.attempt_count + 1');
    expect(claim?.params).toEqual([12_345, leaseToken]);
    expect(queries.map(({ sql }) => sql)).toEqual([
      'BEGIN',
      expect.stringContaining('WITH candidate AS'),
      expect.stringContaining('INSERT INTO account_export_audit'),
      'COMMIT',
    ]);
    expect(release).toHaveBeenCalledOnce();
  });

  it('rejects weak lease tokens before touching PostgreSQL', async () => {
    const { pool } = createPool(() => emptyResult());
    await expect(claimAccountExportJob({ pool, generateLeaseToken: () => 'too-short' })).rejects.toThrow(
      'lease token is invalid',
    );
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('does not complete or audit a job after its lease has been superseded', async () => {
    const { pool, queries } = createPool((sql) =>
      sql.includes("SET status = 'ready'") ? emptyResult() : emptyResult(),
    );

    await expect(
      completeAccountExportJob({
        pool,
        jobId: 'export-job-12345678',
        leaseToken: 'stale-lease-token-1234567890',
        objectKey: 'exports/job.json.gz',
        objectVersionId: 'version-7',
        contentSha256: 'a'.repeat(64),
        sizeBytes: 100,
        uncompressedSizeBytes: 200,
        snapshotAt: '2026-07-14T00:00:00.000Z',
        expiresAt: '2026-07-21T00:00:00.000Z',
      }),
    ).resolves.toBeNull();

    const completion = queries.find(({ sql }) => sql.includes("SET status = 'ready'"));
    expect(completion?.sql).toContain("status = 'processing' AND lease_token = $9");
    expect(completion?.params?.[2]).toBe('version-7');
    expect(completion?.params?.[8]).toBe('stale-lease-token-1234567890');
    expect(queries.some(({ sql }) => sql.includes('account_export_audit'))).toBe(false);
  });

  it('renews only the matching processing lease', async () => {
    const { pool, queries } = createPool((_sql, params) => ({
      rows: params?.[1] === 'owned-lease-token-123456789' ? [{ id: 'job-1' }] : [],
      rowCount: params?.[1] === 'owned-lease-token-123456789' ? 1 : 0,
    }));

    await expect(
      renewAccountExportLease({
        pool,
        jobId: 'job-1',
        leaseToken: 'owned-lease-token-123456789',
        leaseMs: 25_000,
      }),
    ).resolves.toBe(true);
    await expect(
      renewAccountExportLease({
        pool,
        jobId: 'job-1',
        leaseToken: 'stale-lease-token-12345678',
        leaseMs: 25_000,
      }),
    ).resolves.toBe(false);

    expect(queries[0].sql).toContain("status = 'processing' AND lease_token = $2");
    expect(queries[0].params).toEqual(['job-1', 'owned-lease-token-123456789', 25_000]);
  });
});

describe('account export retries and reaping', () => {
  it('schedules a bounded retry and strips control characters from stored errors', async () => {
    const locked = {
      id: 'job-1',
      user_id: 'user-1',
      status: 'processing',
      attempt_count: 2,
      max_attempts: 5,
    };
    const queued = { ...locked, status: 'queued' };
    const { pool, queries } = createPool((sql) => {
      if (sql.startsWith('SELECT * FROM account_export_jobs')) return { rows: [locked], rowCount: 1 };
      if (sql.includes('SET status = $2')) return { rows: [queued], rowCount: 1 };
      return emptyResult();
    });

    await expect(
      failAccountExportJob({
        pool,
        jobId: 'job-1',
        leaseToken: 'owned-lease-token-123456789',
        error: new Error('storage\nconnection\tfailure'),
        errorCode: 'storage_error',
        baseRetryMs: 1_000,
        maxRetryMs: 60_000,
        random: () => 0,
      }),
    ).resolves.toEqual(queued);

    const update = queries.find(({ sql }) => sql.includes('SET status = $2'));
    expect(update?.params).toEqual(['job-1', 'queued', 1_600, 'storage connection failure', '']);
    const audit = queries.find(({ sql }) => sql.includes('account_export_audit'));
    expect(audit?.params?.[2]).toBe('retry_scheduled');
    expect(String(audit?.params?.[4])).toContain('"errorCode":"storage_error"');
  });

  it('marks permanent errors terminal with a normalized public error code', async () => {
    const locked = {
      id: 'job-1',
      user_id: 'user-1',
      status: 'processing',
      attempt_count: 1,
      max_attempts: 5,
    };
    const failed = { ...locked, status: 'failed', error_code: 'schema_error' };
    const { pool, queries } = createPool((sql) => {
      if (sql.startsWith('SELECT * FROM account_export_jobs')) return { rows: [locked], rowCount: 1 };
      if (sql.includes('SET status = $2')) return { rows: [failed], rowCount: 1 };
      return emptyResult();
    });

    await expect(
      failAccountExportJob({
        pool,
        jobId: 'job-1',
        leaseToken: 'owned-lease-token-123456789',
        error: new Error('schema missing'),
        errorCode: 'schema_error',
        permanent: true,
      }),
    ).resolves.toEqual(failed);

    expect(queries.find(({ sql }) => sql.includes('SET status = $2'))?.params).toEqual([
      'job-1',
      'failed',
      0,
      'schema missing',
      'schema_error',
    ]);
  });

  it('reaps every expired lease that has exhausted its retry budget', async () => {
    const exhausted = [
      { id: 'job-1', user_id: 'user-1', attempt_count: 5 },
      { id: 'job-2', user_id: 'user-2', attempt_count: 7 },
    ];
    const { pool, queries } = createPool((sql) =>
      sql.includes('processing lease expired') ? { rows: exhausted, rowCount: 2 } : emptyResult(),
    );

    await expect(reapExhaustedAccountExportLeases({ pool })).resolves.toEqual(exhausted);
    const reaper = queries.find(({ sql }) => sql.includes('processing lease expired'));
    expect(reaper?.sql).toContain('lease_expires_at < NOW()');
    expect(reaper?.sql).toContain('attempt_count >= max_attempts');
    expect(queries.filter(({ sql }) => sql.includes('account_export_audit'))).toHaveLength(2);
  });
});

describe('account export download audit lifecycle', () => {
  it('records download_started only for an owned ready and unexpired job', async () => {
    const ready = {
      id: 'export-job-12345678',
      user_id: 'user-1',
      status: 'ready',
      requested_at: '2026-07-14T00:00:00.000Z',
      expires_at: '2026-07-21T00:00:00.000Z',
      download_count: 0,
    };
    const { pool, queries } = createPool((sql) =>
      sql.startsWith('SELECT * FROM account_export_jobs') ? { rows: [ready], rowCount: 1 } : emptyResult(),
    );

    await expect(
      recordAccountExportDownloadEvent({
        pool,
        userId: 'user-1',
        jobId: 'export-job-12345678',
        eventType: 'download_started',
        requestId: 'request-download-1',
      }),
    ).resolves.toMatchObject({ ok: true, body: { job: { id: 'export-job-12345678', status: 'ready' } } });

    const selection = queries.find(({ sql }) => sql.startsWith('SELECT * FROM account_export_jobs'));
    expect(selection?.sql).toContain("status = 'ready' AND expires_at > NOW()");
    expect(selection?.sql).toContain('FOR UPDATE');
    expect(selection?.params).toEqual(['export-job-12345678', 'user-1']);
    const requestReuse = queries.find(({ sql }) => sql.startsWith('SELECT 1 FROM account_export_audit'));
    expect(requestReuse?.params).toEqual(['export-job-12345678', 'request-download-1']);
    const audit = queries.find(({ sql }) => sql.includes('INSERT INTO account_export_audit'));
    expect(audit?.params?.slice(0, 4)).toEqual([
      'export-job-12345678',
      'user-1',
      'download_started',
      'request-download-1',
    ]);
  });

  it('rejects download_started after the job is unavailable or expired', async () => {
    const { pool, queries } = createPool(() => emptyResult());

    await expect(
      recordAccountExportDownloadEvent({
        pool,
        userId: 'user-1',
        jobId: 'export-job-12345678',
        eventType: 'download_started',
        requestId: 'request-download-2',
      }),
    ).resolves.toEqual({
      ok: false,
      status: 410,
      error: 'Account export is unavailable or expired',
    });
    expect(queries.some(({ sql }) => sql.includes('INSERT INTO account_export_audit'))).toBe(false);
  });

  it('rejects reuse of a download request id before inserting another started event', async () => {
    const ready = {
      id: 'export-job-12345678',
      user_id: 'user-1',
      status: 'ready',
      requested_at: '2026-07-14T00:00:00.000Z',
      expires_at: '2026-07-21T00:00:00.000Z',
    };
    const { pool, queries } = createPool((sql) => {
      if (sql.startsWith('SELECT * FROM account_export_jobs')) return { rows: [ready], rowCount: 1 };
      if (sql.startsWith('SELECT 1 FROM account_export_audit')) return { rows: [{ '?column?': 1 }], rowCount: 1 };
      return emptyResult();
    });

    await expect(
      recordAccountExportDownloadEvent({
        pool,
        userId: 'user-1',
        jobId: 'export-job-12345678',
        eventType: 'download_started',
        requestId: 'request-download-reused',
      }),
    ).resolves.toEqual({
      ok: false,
      status: 409,
      error: 'Account export download request id was already used',
    });
    expect(queries.some(({ sql }) => sql.includes('INSERT INTO account_export_audit'))).toBe(false);
  });

  it('records completion by request id even if the job expired while its body was streaming', async () => {
    const expired = {
      id: 'export-job-12345678',
      user_id: 'user-1',
      status: 'expired',
      requested_at: '2026-07-14T00:00:00.000Z',
      completed_at: '2026-07-14T00:10:00.000Z',
      expires_at: '2026-07-14T00:10:00.000001Z',
      download_count: 1,
    };
    const { pool, queries } = createPool((sql) => {
      if (sql.startsWith('SELECT * FROM account_export_jobs')) return { rows: [expired], rowCount: 1 };
      if (sql.includes("BOOL_OR(event_type = 'download_started')")) {
        return { rows: [{ started: true, terminal: false }], rowCount: 1 };
      }
      if (sql.includes('download_count = download_count + 1')) return { rows: [expired], rowCount: 1 };
      return emptyResult();
    });

    await expect(
      recordAccountExportDownloadEvent({
        pool,
        userId: 'user-1',
        jobId: 'export-job-12345678',
        eventType: 'download_completed',
        requestId: 'request-download-3',
        details: { bytesSent: 1024 },
      }),
    ).resolves.toMatchObject({
      ok: true,
      body: { job: { id: 'export-job-12345678', status: 'expired', downloadCount: 1 } },
    });

    const lockedJob = queries.find(({ sql }) => sql.startsWith('SELECT * FROM account_export_jobs'));
    expect(lockedJob?.sql).toContain('FOR UPDATE');
    expect(lockedJob?.params).toEqual(['export-job-12345678', 'user-1']);
    const auditState = queries.find(({ sql }) => sql.includes("BOOL_OR(event_type = 'download_started')"));
    expect(auditState?.sql).toContain(
      "BOOL_OR(event_type IN ('download_completed', 'download_interrupted', 'integrity_failed')) AS terminal",
    );
    expect(auditState?.params).toEqual(['export-job-12345678', 'request-download-3']);
    const completion = queries.find(({ sql }) => sql.includes('download_count = download_count + 1'));
    expect(completion?.sql).not.toContain("account_export_jobs.status = 'ready'");
    expect(completion?.sql).not.toContain('account_export_jobs.expires_at > NOW()');
    expect(completion?.params).toEqual(['export-job-12345678', 'user-1']);
    const audit = queries.find(({ sql }) => sql.includes('INSERT INTO account_export_audit'));
    expect(audit?.params?.[2]).toBe('download_completed');
    expect(audit?.params?.[3]).toBe('request-download-3');
    expect(String(audit?.params?.[4])).toContain('"downloadCount":1');
  });

  it.each([
    {
      auditState: { started: false, terminal: false },
      error: 'Account export download was not started',
    },
    {
      auditState: { started: true, terminal: true },
      error: 'Account export download was already finalized',
    },
  ])('rejects completion when the request audit state is $auditState', async ({ auditState, error }) => {
    const job = {
      id: 'export-job-12345678',
      user_id: 'user-1',
      status: 'expired',
      requested_at: '2026-07-14T00:00:00.000Z',
    };
    const { pool, queries } = createPool((sql) => {
      if (sql.startsWith('SELECT * FROM account_export_jobs')) return { rows: [job], rowCount: 1 };
      if (sql.includes("BOOL_OR(event_type = 'download_started')")) {
        return { rows: [auditState], rowCount: 1 };
      }
      return emptyResult();
    });

    await expect(
      recordAccountExportDownloadEvent({
        pool,
        userId: 'user-1',
        jobId: 'export-job-12345678',
        eventType: 'download_completed',
        requestId: 'request-download-4',
      }),
    ).resolves.toEqual({
      ok: false,
      status: 409,
      error,
    });

    const completion = queries.find(({ sql }) => sql.includes('download_count = download_count + 1'));
    expect(completion).toBeUndefined();
    expect(queries.some(({ sql }) => sql.includes('INSERT INTO account_export_audit'))).toBe(false);
  });

  it('expires account-owned jobs and makes their artifacts immediately purgeable during deletion', async () => {
    const queries: Query[] = [];
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        if (sql.includes("SET status = 'expired'")) {
          return { rows: [{ id: 'job-1' }, { id: 'job-2' }], rowCount: 2 };
        }
        return emptyResult();
      }),
    };

    await expect(expireAccountExportJobsForUser({ client, userId: 'user-1' })).resolves.toBe(2);
    const expiration = queries.find(({ sql }) => sql.includes("SET status = 'expired'"));
    expect(expiration?.sql).toContain('expires_at = CASE');
    expect(expiration?.sql).toContain('WHEN completed_at IS NULL THEN NOW()');
    expect(expiration?.sql).toContain("GREATEST(NOW(), completed_at + INTERVAL '1 microsecond')");
    expect(expiration?.sql).toContain('purge_available_at = NOW()');
    expect(expiration?.params).toEqual(['user-1']);
    expect(queries.filter(({ sql }) => sql.includes('INSERT INTO account_export_audit'))).toHaveLength(2);
  });
});

describe('account export expiry and physical purge transition', () => {
  it('atomically moves due ready jobs to expired and records the TTL transition', async () => {
    const due = [
      { id: 'job-1', user_id: 'user-1' },
      { id: 'job-2', user_id: 'user-2' },
    ];
    const { pool, queries } = createPool((sql) =>
      sql.includes('WITH candidates AS') ? { rows: due, rowCount: 2 } : emptyResult(),
    );

    await expect(expireDueAccountExportJobs({ pool, limit: 900 })).resolves.toEqual(due);

    const transition = queries.find(({ sql }) => sql.includes('WITH candidates AS'));
    expect(transition?.sql).toContain("status = 'ready' AND expires_at <= NOW()");
    expect(transition?.sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(transition?.sql).toContain("SET status = 'expired', purge_available_at = NOW()");
    expect(transition?.params).toEqual([500]);
    const audits = queries.filter(({ sql }) => sql.includes('INSERT INTO account_export_audit'));
    expect(audits).toHaveLength(2);
    expect(audits.map(({ params }) => params?.[2])).toEqual(['expired', 'expired']);
    expect(audits.every(({ params }) => String(params?.[4]).includes('"reason":"ttl_elapsed"'))).toBe(true);
  });

  it('clears object identity only after an expired job is physically purged', async () => {
    const purged = {
      id: 'job-1',
      user_id: 'user-1',
      status: 'expired',
      object_key: null,
      object_version_id: null,
    };
    const { pool, queries } = createPool((sql) =>
      sql.includes('SET object_key = NULL') ? { rows: [purged], rowCount: 1 } : emptyResult(),
    );

    await expect(markAccountExportPurged({ pool, jobId: 'job-1' })).resolves.toEqual(purged);

    const update = queries.find(({ sql }) => sql.includes('SET object_key = NULL'));
    expect(update?.sql).toContain('object_version_id = NULL');
    expect(update?.sql).toContain("status = 'expired' AND object_key IS NOT NULL");
    expect(update?.sql).toContain('purged_at = NOW()');
    const audit = queries.find(({ sql }) => sql.includes('INSERT INTO account_export_audit'));
    expect(audit?.params?.[2]).toBe('purged');
    expect(String(audit?.params?.[4])).toContain('"artifactPurged":true');
  });
});

describe('account export worker', () => {
  it('transitions due jobs, deletes the exact S3 version, then purges object metadata', async () => {
    const expired = {
      id: 'job-expired',
      user_id: 'user-1',
      object_key: 'account-exports/2026/07/hash/job-expired/lease.json.gz',
      object_version_id: 's3-version-42',
      status: 'ready',
      purge_attempt_count: 0,
    };
    const steps: string[] = [];
    const { pool } = createPool((sql) => {
      if (sql.includes('processing lease expired')) return emptyResult();
      if (sql.includes('WITH candidate AS')) return emptyResult();
      if (sql.includes('WITH candidates AS')) {
        steps.push('transition-expired');
        return { rows: [{ id: expired.id, user_id: expired.user_id }], rowCount: 1 };
      }
      if (sql.startsWith('SELECT id, user_id, object_key')) {
        steps.push('list-expired');
        return { rows: [expired], rowCount: 1 };
      }
      if (sql.includes('SET object_key = NULL')) {
        steps.push('mark-purged');
        return { rows: [{ ...expired, object_key: null, object_version_id: null }], rowCount: 1 };
      }
      return emptyResult();
    });
    const storage = {
      configured: true,
      prefix: 'account-exports',
      putObject: vi.fn(),
      deleteObject: vi.fn(async () => {
        steps.push('delete-object');
      }),
    };
    const results: string[] = [];
    const worker = createAccountExportWorker({
      pool,
      storage,
      buildArtifact: vi.fn(),
      batchSize: 1,
      onResult: (result: string) => results.push(result),
    });

    await worker.tick();

    expect(storage.deleteObject).toHaveBeenCalledWith({
      key: expired.object_key,
      versionId: 's3-version-42',
    });
    expect(steps).toEqual(['transition-expired', 'list-expired', 'delete-object', 'mark-purged']);
    expect(results).toContain('expired');
  });

  it('backs off a failed version purge without clearing object ownership', async () => {
    const job = { id: 'job-1', user_id: 'user-1', purge_attempt_count: 2 };
    const updated = { user_id: 'user-1', purge_attempt_count: 3 };
    const { pool, queries } = createPool((sql) =>
      sql.includes('purge_attempt_count = purge_attempt_count + 1') ? { rows: [updated], rowCount: 1 } : emptyResult(),
    );

    await expect(
      scheduleAccountExportPurgeRetry({ pool, job, error: new Error('S3 unavailable\nretry later') }),
    ).resolves.toEqual(updated);

    const retry = queries.find(({ sql }) => sql.includes('purge_attempt_count = purge_attempt_count + 1'));
    expect(retry?.sql).toContain('WHERE id = $1 AND object_key IS NOT NULL');
    expect(retry?.params).toEqual(['job-1', 20_000, 'S3 unavailable retry later']);
  });

  it('always removes a completed artifact temp directory after upload', async () => {
    const job = {
      id: 'export-job-12345678',
      user_id: 'user-1',
      status: 'processing',
      attempt_count: 1,
      max_attempts: 5,
      requested_at: '2026-07-14T00:00:00.000Z',
      lease_token: 'owned-lease-token-123456789',
    };
    let claimed = false;
    const { pool, queries } = createPool((sql) => {
      if (sql.includes('processing lease expired')) return emptyResult();
      if (sql.includes('WITH candidate AS')) {
        if (claimed) return emptyResult();
        claimed = true;
        return { rows: [job], rowCount: 1 };
      }
      if (sql.includes("SET status = 'ready'")) return { rows: [{ ...job, status: 'ready' }], rowCount: 1 };
      if (sql.startsWith('SELECT id, user_id, object_key')) return emptyResult();
      return emptyResult();
    });
    const cleanup = vi.fn(async () => undefined);
    const buildArtifact = vi.fn(async () => ({
      ok: true,
      filePath: '/tmp/account-export.json.gz',
      sizeBytes: 128,
      uncompressedBytes: 512,
      contentSha256: 'a'.repeat(64),
      snapshotAt: '2026-07-14T00:00:00.000Z',
      cleanup,
    }));
    const storage = {
      configured: true,
      prefix: 'account-exports',
      putObject: vi.fn(async () => ({ versionId: 'version-1' })),
      deleteObject: vi.fn(async () => undefined),
    };
    const worker = createAccountExportWorker({ pool, storage, buildArtifact, batchSize: 1 });

    await worker.tick();

    expect(cleanup).toHaveBeenCalledOnce();
    expect(storage.putObject).toHaveBeenCalledWith(
      expect.objectContaining({
        key: expect.stringMatching(
          /^account-exports\/2026\/07\/[a-f0-9]{24}\/export-job-12345678\/[a-f0-9]{24}\.json\.gz$/,
        ),
        filePath: '/tmp/account-export.json.gz',
      }),
    );
    const completion = queries.find(({ sql }) => sql.includes("SET status = 'ready'"));
    expect(completion?.params?.[2]).toBe('version-1');
  });

  it('aborts work when the heartbeat discovers that the processing lease was lost', async () => {
    vi.useFakeTimers();
    const job = {
      id: 'export-job-12345678',
      user_id: 'user-1',
      status: 'processing',
      attempt_count: 1,
      max_attempts: 5,
      requested_at: '2026-07-14T00:00:00.000Z',
      lease_token: 'owned-lease-token-123456789',
    };
    let claimed = false;
    const { pool, queries } = createPool((sql) => {
      if (sql.includes('processing lease expired')) return emptyResult();
      if (sql.includes('WITH candidate AS')) {
        if (claimed) return emptyResult();
        claimed = true;
        return { rows: [job], rowCount: 1 };
      }
      if (sql.includes('SET lease_expires_at = NOW()')) return emptyResult();
      if (sql.startsWith('SELECT * FROM account_export_jobs')) return { rows: [job], rowCount: 1 };
      if (sql.includes('SET status = $2')) return { rows: [{ ...job, status: 'queued' }], rowCount: 1 };
      if (sql.startsWith('SELECT id, user_id, object_key')) return emptyResult();
      return emptyResult();
    });
    let notifyBuildStarted: () => void = () => undefined;
    const buildStarted = new Promise<void>((resolve) => {
      notifyBuildStarted = resolve;
    });
    const buildArtifact = vi.fn(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          notifyBuildStarted();
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
    );
    const storage = {
      configured: true,
      prefix: 'account-exports',
      putObject: vi.fn(),
      deleteObject: vi.fn(),
    };
    const results: string[] = [];
    const worker = createAccountExportWorker({
      pool,
      storage,
      buildArtifact,
      batchSize: 1,
      leaseMs: 10_000,
      random: () => 0,
      onResult: (result: string) => results.push(result),
      logger: { error: vi.fn() },
    });

    const tick = worker.tick();
    await buildStarted;
    expect(buildArtifact).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(5_000);
    await tick;

    const heartbeat = queries.find(({ sql }) => sql.includes('SET lease_expires_at = NOW()'));
    expect(heartbeat?.params).toEqual(['export-job-12345678', 'owned-lease-token-123456789', 10_000]);
    expect(storage.putObject).not.toHaveBeenCalled();
    expect(results).toContain('retry');
  });

  it('binds object identity to both the user and the current lease', () => {
    const baseJob = {
      id: 'export-job-12345678',
      user_id: 'private-user-id',
      requested_at: '2026-07-14T00:00:00.000Z',
    };
    const first = objectKeyForJob('account-exports', { ...baseJob, lease_token: 'lease-a' });
    const second = objectKeyForJob('account-exports', { ...baseJob, lease_token: 'lease-b' });

    expect(first).not.toBe(second);
    expect(first).not.toContain('private-user-id');
    expect(first).toMatch(/^account-exports\/2026\/07\/[a-f0-9]{24}\/export-job-12345678\/[a-f0-9]{24}\.json\.gz$/);
  });
});
