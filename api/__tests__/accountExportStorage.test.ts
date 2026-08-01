import { createRequire } from 'node:module';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createAccountExportStorage, createAccountExportStorageFromEnv, resolveAccountExportStorageConfig } =
  require('../accountExportStorage.cjs') as {
    createAccountExportStorage: (
      config: Record<string, unknown>,
      options?: { client: { send: ReturnType<typeof vi.fn>; destroy?: ReturnType<typeof vi.fn> } },
    ) => Record<string, unknown>;
    createAccountExportStorageFromEnv: (
      env: Record<string, string>,
      options?: { client: { send: ReturnType<typeof vi.fn>; destroy?: ReturnType<typeof vi.fn> } },
    ) => Record<string, unknown>;
    resolveAccountExportStorageConfig: (env: Record<string, string>) => Record<string, unknown>;
  };

const checksum = 'a'.repeat(64);
let tempRoot = '';
let uploadPath = '';

function baseEnv(overrides: Record<string, string> = {}) {
  return {
    NODE_ENV: 'production',
    ACCOUNT_EXPORT_STORAGE_MODE: 's3',
    ACCOUNT_EXPORT_S3_BUCKET: 'zutomayo-account-exports',
    ACCOUNT_EXPORT_S3_REGION: 'ap-northeast-1',
    ACCOUNT_EXPORT_S3_VERSIONING_MODE: 'disabled',
    ACCOUNT_EXPORT_S3_LIFECYCLE_CONFIRMED: 'true',
    ...overrides,
  };
}

function configuredStorage(client: { send: ReturnType<typeof vi.fn>; destroy?: ReturnType<typeof vi.fn> }) {
  return createAccountExportStorageFromEnv(baseEnv(), { client }) as {
    putObject: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
    getObject: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
    deleteObject: (input: Record<string, unknown>) => Promise<void>;
    destroy: () => void;
  };
}

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'account-export-storage-test-'));
  uploadPath = join(tempRoot, 'artifact.json.gz');
  await writeFile(uploadPath, 'compressed-export');
});

afterEach(async () => {
  vi.useRealTimers();
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

describe('account export storage configuration', () => {
  it('fails closed when production storage is omitted or disabled', () => {
    expect(() => resolveAccountExportStorageConfig({ NODE_ENV: 'production' })).toThrow(
      'ACCOUNT_EXPORT_STORAGE_MODE=s3 is required in production',
    );
    expect(() =>
      resolveAccountExportStorageConfig({ NODE_ENV: 'production', ACCOUNT_EXPORT_STORAGE_MODE: 'disabled' }),
    ).toThrow('cannot be disabled in production');
  });

  it('requires production deployments to choose a versioning policy explicitly', () => {
    expect(() =>
      resolveAccountExportStorageConfig({
        NODE_ENV: 'production',
        ACCOUNT_EXPORT_STORAGE_MODE: 's3',
        ACCOUNT_EXPORT_S3_BUCKET: 'zutomayo-account-exports',
        ACCOUNT_EXPORT_S3_REGION: 'ap-northeast-1',
      }),
    ).toThrow('ACCOUNT_EXPORT_S3_VERSIONING_MODE must explicitly be disabled or required in production');
    expect(resolveAccountExportStorageConfig(baseEnv())).toMatchObject({ versioningMode: 'disabled' });
  });

  it('rejects production storage until the bucket lifecycle policy is explicitly confirmed', () => {
    expect(() =>
      resolveAccountExportStorageConfig(baseEnv({ ACCOUNT_EXPORT_S3_LIFECYCLE_CONFIRMED: 'false' })),
    ).toThrow('ACCOUNT_EXPORT_S3_LIFECYCLE_CONFIRMED=true is required in production');
    expect(resolveAccountExportStorageConfig(baseEnv())).toMatchObject({ lifecycleConfirmed: true });
  });

  it('allows disabled storage only outside production and exposes no silent fallback', async () => {
    const storage = createAccountExportStorageFromEnv({ NODE_ENV: 'test' }) as {
      configured: boolean;
      mode: string;
      putObject: (input: Record<string, unknown>) => Promise<unknown>;
    };
    expect(storage).toMatchObject({ configured: false, mode: 'disabled' });
    await expect(storage.putObject({})).rejects.toThrow('object storage is not configured');
  });

  it('rejects plaintext production endpoints and malformed endpoint origins', () => {
    expect(() =>
      resolveAccountExportStorageConfig(baseEnv({ ACCOUNT_EXPORT_S3_ENDPOINT: 'http://minio.internal:9000' })),
    ).toThrow('must use HTTPS in production');
    expect(() =>
      resolveAccountExportStorageConfig(baseEnv({ ACCOUNT_EXPORT_S3_ENDPOINT: 'https://minio.internal/path' })),
    ).toThrow('must not include a path');
    expect(() =>
      resolveAccountExportStorageConfig(
        baseEnv({ ACCOUNT_EXPORT_S3_ENDPOINT: 'https://user:password@minio.internal' }),
      ),
    ).toThrow('without credentials, query, or fragment');
  });

  it('uses the AWS default credential provider chain without materializing credentials', () => {
    expect(resolveAccountExportStorageConfig(baseEnv())).toMatchObject({
      mode: 's3',
      credentialsMode: 'default',
      credentials: undefined,
      forcePathStyle: false,
      serverSideEncryption: 'AES256',
    });
  });

  it('requires complete, sufficiently strong static credentials', () => {
    expect(() =>
      resolveAccountExportStorageConfig(
        baseEnv({
          ACCOUNT_EXPORT_S3_CREDENTIALS_MODE: 'static',
          ACCOUNT_EXPORT_S3_ACCESS_KEY_ID: 'access-key',
        }),
      ),
    ).toThrow('ACCOUNT_EXPORT_S3_SECRET_ACCESS_KEY is required');
    expect(() =>
      resolveAccountExportStorageConfig(
        baseEnv({
          ACCOUNT_EXPORT_S3_CREDENTIALS_MODE: 'static',
          ACCOUNT_EXPORT_S3_ACCESS_KEY_ID: 'access-key',
          ACCOUNT_EXPORT_S3_SECRET_ACCESS_KEY: 'short',
        }),
      ),
    ).toThrow('must be at least 24 bytes');

    expect(
      resolveAccountExportStorageConfig(
        baseEnv({
          ACCOUNT_EXPORT_S3_CREDENTIALS_MODE: 'static',
          ACCOUNT_EXPORT_S3_ACCESS_KEY_ID: 'access-key',
          ACCOUNT_EXPORT_S3_SECRET_ACCESS_KEY: 'x'.repeat(32),
          ACCOUNT_EXPORT_S3_SESSION_TOKEN: 'session-token',
        }),
      ),
    ).toMatchObject({
      credentialsMode: 'static',
      credentials: {
        accessKeyId: 'access-key',
        secretAccessKey: 'x'.repeat(32),
        sessionToken: 'session-token',
      },
    });
  });

  it('requires an explicit KMS key and preserves secure endpoint defaults', () => {
    expect(() =>
      resolveAccountExportStorageConfig(baseEnv({ ACCOUNT_EXPORT_S3_SERVER_SIDE_ENCRYPTION: 'aws:kms' })),
    ).toThrow('ACCOUNT_EXPORT_S3_KMS_KEY_ID is required');

    expect(
      resolveAccountExportStorageConfig(
        baseEnv({
          ACCOUNT_EXPORT_S3_ENDPOINT: 'https://minio.internal:9000',
          ACCOUNT_EXPORT_S3_SERVER_SIDE_ENCRYPTION: 'aws:kms',
          ACCOUNT_EXPORT_S3_KMS_KEY_ID: 'alias/zutomayo-account-exports',
        }),
      ),
    ).toMatchObject({
      endpoint: 'https://minio.internal:9000',
      forcePathStyle: true,
      serverSideEncryption: 'aws:kms',
      kmsKeyId: 'alias/zutomayo-account-exports',
    });
  });
});

describe('account export S3 operations', () => {
  it('uploads a private gzip object with checksum metadata and server-side encryption', async () => {
    const send = vi.fn(async () => ({ VersionId: 'version-9' }));
    const storage = configuredStorage({ send });

    await expect(
      storage.putObject({
        key: 'account-exports/2026/07/user/job/lease.json.gz',
        filePath: uploadPath,
        sizeBytes: 17,
        contentSha256: checksum,
      }),
    ).resolves.toEqual({
      key: 'account-exports/2026/07/user/job/lease.json.gz',
      versionId: 'version-9',
    });

    const command = send.mock.calls[0][0] as { constructor: { name: string }; input: Record<string, unknown> };
    expect(command.constructor.name).toBe('PutObjectCommand');
    expect(command.input).toMatchObject({
      Bucket: 'zutomayo-account-exports',
      Key: 'account-exports/2026/07/user/job/lease.json.gz',
      ContentLength: 17,
      ContentType: 'application/gzip',
      CacheControl: 'private, no-store',
      Metadata: { sha256: checksum, format: 'zutomayo-account-export-v1' },
      ServerSideEncryption: 'AES256',
    });
    expect(send.mock.calls[0][1]).toMatchObject({ abortSignal: expect.any(AbortSignal) });
  });

  it('returns download integrity metadata and requests the exact object version', async () => {
    const body = { pipe: vi.fn() };
    const send = vi.fn(async () => ({
      Body: body,
      ContentLength: 17,
      Metadata: { sha256: checksum, format: 'zutomayo-account-export-v1' },
    }));
    const storage = configuredStorage({ send });

    const object = await storage.getObject({
      key: 'account-exports/2026/07/user/job/lease.json.gz',
      versionId: 'version-9',
    });

    expect(object).toMatchObject({
      body,
      contentLength: 17,
      metadata: { sha256: checksum, format: 'zutomayo-account-export-v1' },
      cleanup: expect.any(Function),
    });
    const command = send.mock.calls[0][0] as { constructor: { name: string }; input: Record<string, unknown> };
    expect(command.constructor.name).toBe('GetObjectCommand');
    expect(command.input).toMatchObject({
      Key: 'account-exports/2026/07/user/job/lease.json.gz',
      VersionId: 'version-9',
      ResponseCacheControl: 'private, no-store',
      ResponseContentType: 'application/gzip',
    });
    (object.cleanup as () => void)();
  });

  it('deletes the exact version and never accepts keys outside the configured prefix', async () => {
    const send = vi.fn(async () => ({}));
    const storage = configuredStorage({ send });

    await storage.deleteObject({
      key: 'account-exports/2026/07/user/job/lease.json.gz',
      versionId: 'version-9',
    });
    const command = send.mock.calls[0][0] as { constructor: { name: string }; input: Record<string, unknown> };
    expect(command.constructor.name).toBe('DeleteObjectCommand');
    expect(command.input).toMatchObject({
      Key: 'account-exports/2026/07/user/job/lease.json.gz',
      VersionId: 'version-9',
    });

    await expect(storage.deleteObject({ key: 'other-prefix/private.json.gz', versionId: 'version-9' })).rejects.toThrow(
      'outside the configured prefix',
    );
    await expect(
      storage.deleteObject({ key: 'account-exports/../private.json.gz', versionId: 'version-9' }),
    ).rejects.toThrow('outside the configured prefix');
  });

  it('fails closed when required bucket versioning does not return or receive a VersionId', async () => {
    const send = vi.fn(async () => ({}));
    const config = resolveAccountExportStorageConfig(baseEnv({ ACCOUNT_EXPORT_S3_VERSIONING_MODE: 'required' }));
    const storage = createAccountExportStorage(config, { client: { send } }) as {
      putObject: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
      getObject: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
      deleteObject: (input: Record<string, unknown>) => Promise<void>;
    };

    await expect(
      storage.putObject({
        key: 'account-exports/2026/07/user/job/lease.json.gz',
        filePath: uploadPath,
        sizeBytes: 17,
        contentSha256: checksum,
      }),
    ).rejects.toThrow('bucket did not return the required object VersionId');
    await expect(storage.getObject({ key: 'account-exports/job.json.gz' })).rejects.toThrow(
      'VersionId is required for download',
    );
    await expect(storage.deleteObject({ key: 'account-exports/job.json.gz' })).rejects.toThrow(
      'VersionId is required for physical deletion',
    );
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('aborts an S3 operation at the configured timeout', async () => {
    vi.useFakeTimers();
    const send = vi.fn(
      (_command: unknown, { abortSignal }: { abortSignal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          abortSignal.addEventListener('abort', () => reject(abortSignal.reason), { once: true });
        }),
    );
    const config = resolveAccountExportStorageConfig(baseEnv({ ACCOUNT_EXPORT_S3_TIMEOUT_MS: '1000' }));
    const storage = createAccountExportStorage(config, { client: { send } }) as {
      deleteObject: (input: Record<string, unknown>) => Promise<void>;
    };

    const deletion = storage.deleteObject({ key: 'account-exports/job.json.gz' });
    const rejection = expect(deletion).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(1_000);
    await rejection;
  });

  it('cleans operation timers and destroys the owned client facade', async () => {
    vi.useFakeTimers();
    let capturedSignal: AbortSignal | undefined;
    const destroy = vi.fn();
    const send = vi.fn(async (_command: unknown, { abortSignal }: { abortSignal: AbortSignal }) => {
      capturedSignal = abortSignal;
      return { Body: {}, ContentLength: 0, Metadata: {} };
    });
    const storage = configuredStorage({ send, destroy });
    const object = await storage.getObject({ key: 'account-exports/job.json.gz' });

    (object.cleanup as () => void)();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(capturedSignal?.aborted).toBe(false);
    storage.destroy();
    expect(destroy).toHaveBeenCalledOnce();
  });
});
