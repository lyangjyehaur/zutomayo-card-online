import { createRequire } from 'node:module';
import { gunzip as gunzipCallback } from 'node:zlib';
import { mkdtemp, readFile, readdir, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  EXPORT_COLLECTIONS,
  assertSafeExportValue,
  cleanupStaleAccountExportArtifacts,
  createAccountExportArtifact,
  ensureAccountExportTempRoot,
  resolveAccountExportPseudonymKey,
  sanitizeExportValue,
} = require('../accountExportArtifact.cjs') as {
  EXPORT_COLLECTIONS: Array<{ key: string; sql: string }>;
  assertSafeExportValue: (value: unknown) => void;
  cleanupStaleAccountExportArtifacts: (input: Record<string, unknown>) => Promise<number>;
  createAccountExportArtifact: (input: Record<string, unknown>) => Promise<{
    ok: boolean;
    filePath: string;
    sizeBytes: number;
    uncompressedBytes: number;
    snapshotAt: string;
    contentSha256: string;
    cleanup: () => Promise<void>;
  }>;
  ensureAccountExportTempRoot: (tempRoot: string) => Promise<void>;
  resolveAccountExportPseudonymKey: (env: Record<string, string>) => string;
  sanitizeExportValue: (value: unknown) => unknown;
};

const gunzip = promisify(gunzipCallback);
const pseudonymKey = 'account-export-pseudonym-key-for-tests-1234567890';
const userId = 'subject-user-1';
const jobId = 'export-job-12345678';
let tempRoot = '';

type CursorQuery = {
  cursor: {
    text: string;
    values: unknown[];
    _conf: { batchSize: number; highWaterMark: number };
  };
  _readableState: { highWaterMark: number };
};

function createArtifactPool(rowsForSql: (sql: string) => Array<Record<string, unknown>>) {
  const cursorQueries: CursorQuery[] = [];
  const sqlQueries: Array<{ sql: string; params?: unknown[] }> = [];
  const release = vi.fn();
  const client = {
    release,
    query: vi.fn((query: string | CursorQuery, params?: unknown[]) => {
      if (typeof query !== 'string') {
        cursorQueries.push(query);
        return Readable.from(rowsForSql(query.cursor.text), { objectMode: true });
      }
      sqlQueries.push({ sql: query, params });
      if (query.includes('FROM users WHERE id = $1')) {
        return Promise.resolve({
          rows: [
            {
              id: userId,
              email: 'subject@example.com',
              email_verified: true,
              nickname: 'Subject',
              elo: 1512,
              match_count: 4,
              wins: 3,
              created_at: '2025-01-01T00:00:00.000Z',
            },
          ],
          rowCount: 1,
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    }),
  };
  return {
    pool: { connect: vi.fn(async () => client) },
    client,
    cursorQueries,
    sqlQueries,
    release,
  };
}

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'account-export-artifact-test-'));
});

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

describe('account export artifact streaming', () => {
  it('uses bounded PostgreSQL cursors and produces a valid gzip snapshot', async () => {
    const { pool, cursorQueries, sqlQueries, release } = createArtifactPool((sql) => {
      if (sql.includes('FROM user_identities')) {
        return [
          {
            provider: 'discord',
            provider_user_id: 'owned-provider-identity',
            email: 'subject@example.com',
            email_verified: true,
            display_name: 'Subject',
            avatar_url: null,
            oauth_token: 'must-never-be-exported',
          },
        ];
      }
      if (sql.includes('FROM user_friends')) {
        return [{ friend_user_id: 'counterpart-user-99', created_at: '2026-01-01T00:00:00.000Z' }];
      }
      return [];
    });

    const artifact = await createAccountExportArtifact({
      pool,
      userId,
      jobId,
      pseudonymKey,
      tempRoot,
    });

    expect(artifact).toMatchObject({
      ok: true,
      sizeBytes: expect.any(Number),
      uncompressedBytes: expect.any(Number),
      contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      snapshotAt: expect.any(String),
    });
    expect(artifact.sizeBytes).toBeGreaterThan(0);
    expect(artifact.uncompressedBytes).toBeGreaterThan(artifact.sizeBytes);
    const decoded = JSON.parse((await gunzip(await readFile(artifact.filePath))).toString('utf8')) as Record<
      string,
      unknown
    >;
    expect(decoded).toMatchObject({
      formatVersion: 1,
      account: { id: userId, email: 'subject@example.com' },
      identities: [expect.objectContaining({ provider: 'discord' })],
      friends: [
        {
          counterpart: expect.stringMatching(/^subject:[a-f0-9]{32}$/),
          created_at: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    expect(JSON.stringify(decoded)).not.toContain('must-never-be-exported');
    expect(JSON.stringify(decoded)).not.toContain('counterpart-user-99');

    expect(cursorQueries).toHaveLength(EXPORT_COLLECTIONS.length);
    expect(cursorQueries.every((query) => query.cursor._conf.batchSize === 250)).toBe(true);
    expect(cursorQueries.every((query) => query.cursor._conf.highWaterMark === 500)).toBe(true);
    expect(cursorQueries.every((query) => query._readableState.highWaterMark === 250)).toBe(true);
    const historyCursor = cursorQueries.find((query) => query.cursor.text.includes('account_export_jobs'));
    expect(historyCursor?.cursor.values).toEqual([userId, jobId]);
    expect(sqlQueries.map(({ sql }) => sql)).toEqual([
      'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
      expect.stringContaining('FROM users WHERE id = $1'),
      'COMMIT',
    ]);
    expect(release).toHaveBeenCalledOnce();

    const fileMode = (await stat(artifact.filePath)).mode & 0o777;
    expect(fileMode).toBe(0o600);
    await artifact.cleanup();
    await expect(stat(artifact.filePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('enforces the uncompressed size cap while streaming and removes partial files', async () => {
    const oversized = 'x'.repeat(1024 * 1024 + 64 * 1024);
    const { pool, sqlQueries, release } = createArtifactPool((sql) =>
      sql.includes('FROM user_identities') ? [{ provider: 'discord', display_name: oversized }] : [],
    );

    await expect(
      createAccountExportArtifact({
        pool,
        userId,
        jobId,
        pseudonymKey,
        maxBytes: 1024 * 1024,
        tempRoot,
      }),
    ).rejects.toMatchObject({
      name: 'AccountExportPermanentError',
      code: 'too_large',
      permanent: true,
    });

    expect(sqlQueries.map(({ sql }) => sql)).toContain('ROLLBACK');
    expect(release).toHaveBeenCalledOnce();
    expect((await readdir(tempRoot)).filter((name) => name.startsWith('job-'))).toEqual([]);
  });

  it('maps PostgreSQL schema failures to a permanent non-sensitive error and cleans temp state', async () => {
    const release = vi.fn();
    const client = {
      release,
      query: vi.fn((query: string | CursorQuery) => {
        if (typeof query !== 'string') return Readable.from([], { objectMode: true });
        if (query.includes('FROM users WHERE id = $1')) {
          const error = Object.assign(new Error('relation private_table does not exist'), { code: '42P01' });
          return Promise.reject(error);
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      }),
    };

    await expect(
      createAccountExportArtifact({
        pool: { connect: vi.fn(async () => client) },
        userId,
        jobId,
        pseudonymKey,
        tempRoot,
      }),
    ).rejects.toMatchObject({
      name: 'AccountExportPermanentError',
      code: 'schema_error',
      message: 'Account export schema is unavailable',
    });
    expect(release).toHaveBeenCalledOnce();
    expect((await readdir(tempRoot)).filter((name) => name.startsWith('job-'))).toEqual([]);
  });
});

describe('account export privacy defenses', () => {
  it('removes forbidden credential, token, network, and moderator fields recursively', () => {
    const sanitized = sanitizeExportValue({
      displayName: 'safe',
      passwordHash: 'password',
      nested: {
        session_token: 'token',
        accessCredential: 'credential',
        clientIp: '127.0.0.1',
        adminNote: 'internal note',
        safe: [{ ciphertext: 'ciphertext', value: 7 }],
      },
    });

    expect(sanitized).toEqual({
      displayName: 'safe',
      nested: { safe: [{ value: 7 }] },
    });
  });

  it('rejects forbidden keys that survive a schema transform with their precise path', () => {
    expect(() => assertSafeExportValue({ matches: [{ safe: true }, { moderator_note: 'do not export' }] })).toThrow(
      'Unsafe account export field: matches.1.moderator_note',
    );
  });

  it('requires a dedicated strong pseudonym key in production', () => {
    expect(() => resolveAccountExportPseudonymKey({ NODE_ENV: 'production' })).toThrow(
      'ACCOUNT_EXPORT_PSEUDONYM_KEY is required in production',
    );
    expect(() =>
      resolveAccountExportPseudonymKey({ NODE_ENV: 'production', ACCOUNT_EXPORT_PSEUDONYM_KEY: 'too-short' }),
    ).toThrow('must be at least 32 bytes');
    expect(
      resolveAccountExportPseudonymKey({
        NODE_ENV: 'production',
        ACCOUNT_EXPORT_PSEUDONYM_KEY: pseudonymKey,
      }),
    ).toBe(pseudonymKey);
  });
});

describe('account export temp directory cleanup', () => {
  it('removes only stale job directories and leaves recent, unrelated, and symlink entries intact', async () => {
    const stale = join(tempRoot, 'job-stale');
    const recent = join(tempRoot, 'job-recent');
    const unrelated = join(tempRoot, 'other-directory');
    await ensureAccountExportTempRoot(stale);
    await ensureAccountExportTempRoot(recent);
    await ensureAccountExportTempRoot(unrelated);
    const now = Date.parse('2026-07-14T12:00:00.000Z');
    const old = new Date(now - 3 * 60 * 60 * 1000);
    await utimes(stale, old, old);
    await utimes(recent, new Date(now - 10 * 60 * 1000), new Date(now - 10 * 60 * 1000));
    await symlink(unrelated, join(tempRoot, 'job-symlink'));

    await expect(cleanupStaleAccountExportArtifacts({ tempRoot, maxAgeMs: 2 * 60 * 60 * 1000, now })).resolves.toBe(1);

    await expect(stat(stale)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(recent)).resolves.toBeDefined();
    await expect(stat(unrelated)).resolves.toBeDefined();
    await expect(stat(join(tempRoot, 'job-symlink'))).resolves.toBeDefined();
  });

  it('removes stale download directories but preserves an old directory with a fresh activity marker', async () => {
    const staleDownload = join(tempRoot, 'download-stale');
    const activeDownload = join(tempRoot, 'download-active');
    await ensureAccountExportTempRoot(staleDownload);
    await ensureAccountExportTempRoot(activeDownload);
    const staleActivity = join(staleDownload, '.activity');
    const activeActivity = join(activeDownload, '.activity');
    await writeFile(staleActivity, '', { mode: 0o600 });
    await writeFile(activeActivity, '', { mode: 0o600 });
    const now = Date.parse('2026-07-14T12:00:00.000Z');
    const old = new Date(now - 3 * 60 * 60 * 1000);
    const active = new Date(now - 10 * 60 * 1000);
    await utimes(staleDownload, old, old);
    await utimes(activeDownload, old, old);
    await utimes(staleActivity, old, old);
    await utimes(activeActivity, active, active);

    await expect(cleanupStaleAccountExportArtifacts({ tempRoot, maxAgeMs: 2 * 60 * 60 * 1000, now })).resolves.toBe(1);

    await expect(stat(staleDownload)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(activeDownload)).resolves.toBeDefined();
    await expect(stat(activeActivity)).resolves.toBeDefined();
  });

  it('creates a private root and rejects symlink roots', async () => {
    const privateRoot = join(tempRoot, 'private-root');
    await ensureAccountExportTempRoot(privateRoot);
    expect((await stat(privateRoot)).mode & 0o777).toBe(0o700);

    const target = join(tempRoot, 'target');
    await ensureAccountExportTempRoot(target);
    const linkedRoot = join(tempRoot, 'linked-root');
    await symlink(target, linkedRoot);
    await expect(ensureAccountExportTempRoot(linkedRoot)).rejects.toMatchObject({
      name: 'AccountExportPermanentError',
      code: 'schema_error',
    });
  });
});
