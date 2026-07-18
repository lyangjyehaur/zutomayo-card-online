/* global module */

const { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } = require('@aws-sdk/client-s3');
const fs = require('node:fs');

const STORAGE_MODE_DISABLED = 'disabled';
const STORAGE_MODE_S3 = 's3';

function production(env) {
  return env.NODE_ENV === 'production';
}

function requiredValue(env, name) {
  const value = secretValue(env, name);
  if (!value) throw new Error(`${name} is required when ACCOUNT_EXPORT_STORAGE_MODE=s3`);
  return value;
}

function secretValue(env, name) {
  const direct = String(env[name] || '').trim();
  const filePath = String(env[`${name}_FILE`] || '').trim();
  if (direct && filePath) throw new Error(`${name} and ${name}_FILE cannot both be set`);
  if (!filePath) return direct;
  const value = fs.readFileSync(filePath, 'utf8').trim();
  if (!value) throw new Error(`${name}_FILE is empty`);
  return value;
}

function normalizePrefix(value) {
  const prefix = String(value || 'account-exports')
    .trim()
    .replace(/^\/+|\/+$/g, '');
  if (!prefix || prefix.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('ACCOUNT_EXPORT_S3_PREFIX must be a safe object-key prefix');
  }
  return prefix;
}

function parseBoolean(value, defaultValue = false, name = 'value') {
  if (value === undefined || value === null || value === '') return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  throw new Error(`${name} must be true or false`);
}

function operationAbortSignal(parentSignal, timeoutMs) {
  const controller = new AbortController();
  let cleaned = false;
  let timer;
  const abort = () => controller.abort(parentSignal?.reason || new Error('Account export storage operation aborted'));
  if (parentSignal?.aborted) abort();
  else parentSignal?.addEventListener('abort', abort, { once: true });
  const refresh = () => {
    if (cleaned || controller.signal.aborted) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(
      () => controller.abort(new Error('Account export storage operation timed out while idle')),
      timeoutMs,
    );
    timer.unref?.();
  };
  refresh();
  return {
    signal: controller.signal,
    refresh,
    cleanup() {
      if (cleaned) return;
      cleaned = true;
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', abort);
    },
  };
}

function assertObjectKey(config, key) {
  const value = String(key || '');
  if (
    !value.startsWith(`${config.prefix}/`) ||
    value.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error('Account export object key is outside the configured prefix');
  }
  return value;
}

function resolveAccountExportStorageConfig(env = process.env) {
  const rawMode = String(env.ACCOUNT_EXPORT_STORAGE_MODE || '')
    .trim()
    .toLowerCase();
  const mode = rawMode || (production(env) ? '' : STORAGE_MODE_DISABLED);
  if (!mode) throw new Error('ACCOUNT_EXPORT_STORAGE_MODE=s3 is required in production');
  if (mode === STORAGE_MODE_DISABLED) {
    if (production(env)) throw new Error('ACCOUNT_EXPORT_STORAGE_MODE cannot be disabled in production');
    return { mode };
  }
  if (mode !== STORAGE_MODE_S3) throw new Error('ACCOUNT_EXPORT_STORAGE_MODE must be disabled or s3');

  const bucket = requiredValue(env, 'ACCOUNT_EXPORT_S3_BUCKET');
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
    throw new Error('ACCOUNT_EXPORT_S3_BUCKET is invalid');
  }
  const region = requiredValue(env, 'ACCOUNT_EXPORT_S3_REGION');
  const rawAccessKeyId = secretValue(env, 'ACCOUNT_EXPORT_S3_ACCESS_KEY_ID');
  const rawSecretAccessKey = secretValue(env, 'ACCOUNT_EXPORT_S3_SECRET_ACCESS_KEY');
  const credentialsMode = String(
    env.ACCOUNT_EXPORT_S3_CREDENTIALS_MODE || (rawAccessKeyId || rawSecretAccessKey ? 'static' : 'default'),
  )
    .trim()
    .toLowerCase();
  if (!['default', 'static'].includes(credentialsMode)) {
    throw new Error('ACCOUNT_EXPORT_S3_CREDENTIALS_MODE must be default or static');
  }
  let credentials;
  if (credentialsMode === 'static') {
    const accessKeyId = requiredValue(env, 'ACCOUNT_EXPORT_S3_ACCESS_KEY_ID');
    const secretAccessKey = requiredValue(env, 'ACCOUNT_EXPORT_S3_SECRET_ACCESS_KEY');
    if (Buffer.byteLength(secretAccessKey, 'utf8') < 24) {
      throw new Error('ACCOUNT_EXPORT_S3_SECRET_ACCESS_KEY must be at least 24 bytes');
    }
    const sessionToken = secretValue(env, 'ACCOUNT_EXPORT_S3_SESSION_TOKEN');
    credentials = { accessKeyId, secretAccessKey, ...(sessionToken ? { sessionToken } : {}) };
  }

  const rawEndpoint = String(env.ACCOUNT_EXPORT_S3_ENDPOINT || '').trim();
  let endpoint;
  if (rawEndpoint) {
    let parsed;
    try {
      parsed = new URL(rawEndpoint);
    } catch {
      throw new Error('ACCOUNT_EXPORT_S3_ENDPOINT must be an absolute URL');
    }
    if (production(env) && parsed.protocol !== 'https:') {
      throw new Error('ACCOUNT_EXPORT_S3_ENDPOINT must use HTTPS in production');
    }
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error('ACCOUNT_EXPORT_S3_ENDPOINT must be an HTTP(S) origin without credentials, query, or fragment');
    }
    if (parsed.pathname !== '/' && parsed.pathname !== '') {
      throw new Error('ACCOUNT_EXPORT_S3_ENDPOINT must not include a path');
    }
    endpoint = parsed.origin;
  }

  const serverSideEncryption = String(env.ACCOUNT_EXPORT_S3_SERVER_SIDE_ENCRYPTION || 'AES256').trim();
  if (!['AES256', 'aws:kms'].includes(serverSideEncryption)) {
    throw new Error('ACCOUNT_EXPORT_S3_SERVER_SIDE_ENCRYPTION must be AES256 or aws:kms');
  }
  const kmsKeyId = String(env.ACCOUNT_EXPORT_S3_KMS_KEY_ID || '').trim();
  if (serverSideEncryption === 'aws:kms' && !kmsKeyId) {
    throw new Error('ACCOUNT_EXPORT_S3_KMS_KEY_ID is required for aws:kms encryption');
  }
  const rawVersioningMode = String(env.ACCOUNT_EXPORT_S3_VERSIONING_MODE || '')
    .trim()
    .toLowerCase();
  if (production(env) && !rawVersioningMode) {
    throw new Error('ACCOUNT_EXPORT_S3_VERSIONING_MODE must explicitly be disabled or required in production');
  }
  const versioningMode = rawVersioningMode || 'disabled';
  if (!['disabled', 'required'].includes(versioningMode)) {
    throw new Error('ACCOUNT_EXPORT_S3_VERSIONING_MODE must be disabled or required');
  }
  const lifecycleConfirmed = parseBoolean(
    env.ACCOUNT_EXPORT_S3_LIFECYCLE_CONFIRMED,
    false,
    'ACCOUNT_EXPORT_S3_LIFECYCLE_CONFIRMED',
  );
  if (production(env) && !lifecycleConfirmed) {
    throw new Error('ACCOUNT_EXPORT_S3_LIFECYCLE_CONFIRMED=true is required in production');
  }

  return {
    mode,
    bucket,
    region,
    credentialsMode,
    credentials,
    endpoint,
    prefix: normalizePrefix(env.ACCOUNT_EXPORT_S3_PREFIX),
    forcePathStyle: parseBoolean(
      env.ACCOUNT_EXPORT_S3_FORCE_PATH_STYLE,
      Boolean(endpoint),
      'ACCOUNT_EXPORT_S3_FORCE_PATH_STYLE',
    ),
    serverSideEncryption,
    kmsKeyId: kmsKeyId || undefined,
    versioningMode,
    lifecycleConfirmed,
    timeoutMs: Math.max(1_000, Math.min(Number(env.ACCOUNT_EXPORT_S3_TIMEOUT_MS) || 60_000, 5 * 60 * 1000)),
  };
}

function createDisabledStorage() {
  const unavailable = async () => {
    throw new Error('Account export object storage is not configured');
  };
  return {
    mode: STORAGE_MODE_DISABLED,
    configured: false,
    putObject: unavailable,
    getObject: unavailable,
    deleteObject: unavailable,
  };
}

function createAccountExportStorage(config, { client } = {}) {
  if (!config || config.mode === STORAGE_MODE_DISABLED) return createDisabledStorage();
  if (config.mode !== STORAGE_MODE_S3) throw new Error('Unsupported account export storage mode');

  const s3 =
    client ||
    new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      ...(config.credentials ? { credentials: config.credentials } : {}),
      // Export jobs own the retry budget. A fresh attempt recreates a replayable
      // file stream and receives a new fenced object key.
      maxAttempts: 1,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });

  return {
    mode: STORAGE_MODE_S3,
    configured: true,
    prefix: config.prefix,
    async putObject({ key, filePath, sizeBytes, contentSha256, signal }) {
      const objectKey = assertObjectKey(config, key);
      if (!Number.isSafeInteger(Number(sizeBytes)) || Number(sizeBytes) < 0) {
        throw new Error('Account export object size is invalid');
      }
      if (!/^[a-f0-9]{64}$/.test(String(contentSha256 || ''))) {
        throw new Error('Account export object checksum is invalid');
      }
      const operation = operationAbortSignal(signal, config.timeoutMs);
      const body = fs.createReadStream(filePath);
      body.on('data', operation.refresh);
      const command = new PutObjectCommand({
        Bucket: config.bucket,
        Key: objectKey,
        Body: body,
        ContentLength: sizeBytes,
        ContentType: 'application/gzip',
        CacheControl: 'private, no-store',
        Metadata: { sha256: contentSha256, format: 'zutomayo-account-export-v1' },
        ServerSideEncryption: config.serverSideEncryption,
        ...(config.kmsKeyId ? { SSEKMSKeyId: config.kmsKeyId } : {}),
      });
      try {
        const result = await s3.send(command, { abortSignal: operation.signal });
        if (config.versioningMode === 'required' && !result.VersionId) {
          throw new Error('Account export bucket did not return the required object VersionId');
        }
        return { key: objectKey, versionId: result.VersionId || null };
      } finally {
        body.off('data', operation.refresh);
        operation.cleanup();
      }
    },
    async getObject({ key, versionId, signal }) {
      const objectKey = assertObjectKey(config, key);
      if (config.versioningMode === 'required' && !versionId) {
        throw new Error('Account export object VersionId is required for download');
      }
      const operation = operationAbortSignal(signal, config.timeoutMs);
      let result;
      try {
        result = await s3.send(
          new GetObjectCommand({
            Bucket: config.bucket,
            Key: objectKey,
            ...(versionId ? { VersionId: versionId } : {}),
            ResponseCacheControl: 'private, no-store',
            ResponseContentType: 'application/gzip',
          }),
          { abortSignal: operation.signal },
        );
      } catch (error) {
        operation.cleanup();
        throw error;
      }
      return {
        body: result.Body,
        contentLength: result.ContentLength,
        metadata: result.Metadata || {},
        refreshTimeout: operation.refresh,
        cleanup: operation.cleanup,
      };
    },
    async deleteObject({ key, versionId }) {
      const objectKey = assertObjectKey(config, key);
      if (config.versioningMode === 'required' && !versionId) {
        throw new Error('Account export object VersionId is required for physical deletion');
      }
      const operation = operationAbortSignal(undefined, config.timeoutMs);
      try {
        await s3.send(
          new DeleteObjectCommand({
            Bucket: config.bucket,
            Key: objectKey,
            ...(versionId ? { VersionId: versionId } : {}),
          }),
          { abortSignal: operation.signal },
        );
      } finally {
        operation.cleanup();
      }
    },
    destroy() {
      s3.destroy?.();
    },
  };
}

function createAccountExportStorageFromEnv(env = process.env, options) {
  return createAccountExportStorage(resolveAccountExportStorageConfig(env), options);
}

module.exports = {
  STORAGE_MODE_DISABLED,
  STORAGE_MODE_S3,
  createAccountExportStorage,
  createAccountExportStorageFromEnv,
  resolveAccountExportStorageConfig,
};
