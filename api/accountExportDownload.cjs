/* global module */

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { cleanupStaleAccountExportArtifacts, ensureAccountExportTempRoot } = require('./accountExportArtifact.cjs');

class AccountExportIntegrityError extends Error {
  constructor(details) {
    super('Account export body integrity verification failed');
    this.name = 'AccountExportIntegrityError';
    this.code = 'ACCOUNT_EXPORT_INTEGRITY';
    this.details = details;
  }
}

function readableBody(body) {
  if (body && typeof body.pipe === 'function') return body;
  if (body && typeof body[Symbol.asyncIterator] === 'function') return Readable.from(body);
  throw new Error('Account export object storage returned an unreadable body');
}

async function stageAccountExportDownload({
  body,
  expectedSize,
  expectedSha256,
  refreshTimeout,
  maxBytes,
  tempRoot = process.env.ACCOUNT_EXPORT_TMP_DIR || path.join(os.tmpdir(), 'zutomayo-account-exports'),
}) {
  const size = Number(expectedSize);
  const maximum = Number(maxBytes);
  const checksum = String(expectedSha256 || '').toLowerCase();
  if (!Number.isSafeInteger(size) || size < 0) throw new Error('Account export download size is invalid');
  if (!Number.isSafeInteger(maximum) || maximum < 1024 * 1024 || size > maximum) {
    throw new AccountExportIntegrityError({ sizeMatched: false, checksumMatched: false });
  }
  if (!/^[a-f0-9]{64}$/.test(checksum)) {
    throw new Error('Account export download checksum is invalid');
  }

  await ensureAccountExportTempRoot(tempRoot);
  await cleanupStaleAccountExportArtifacts({ tempRoot });
  const workDir = await fsPromises.mkdtemp(path.join(tempRoot, 'download-'));
  const activityPath = path.join(workDir, '.activity');
  const filePath = path.join(workDir, 'account-export.json.gz');
  await fsPromises.writeFile(activityPath, '', { flag: 'wx', mode: 0o600 });
  const touchActivity = () => {
    const now = new Date();
    return fsPromises.utimes(activityPath, now, now);
  };
  const activityTimer = setInterval(() => void touchActivity().catch(() => undefined), 30_000);
  activityTimer.unref?.();
  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    clearInterval(activityTimer);
    await fsPromises.rm(workDir, { recursive: true, force: true });
  };

  let receivedBytes = 0;
  const hash = crypto.createHash('sha256');
  const verifier = new Transform({
    transform(chunk, encoding, callback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
      receivedBytes += buffer.length;
      if (receivedBytes > size || receivedBytes > maximum) {
        callback(new AccountExportIntegrityError({ sizeMatched: false, checksumMatched: false }));
        return;
      }
      hash.update(buffer);
      refreshTimeout?.();
      callback(null, buffer);
    },
  });

  try {
    await pipeline(readableBody(body), verifier, fs.createWriteStream(filePath, { flags: 'wx', mode: 0o600 }));
    const receivedSha256 = hash.digest('hex');
    if (receivedBytes !== size || receivedSha256 !== checksum) {
      throw new AccountExportIntegrityError({
        sizeMatched: receivedBytes === size,
        checksumMatched: receivedSha256 === checksum,
      });
    }
    return { filePath, sizeBytes: receivedBytes, cleanup, touch: touchActivity };
  } catch (error) {
    await cleanup().catch(() => undefined);
    throw error;
  }
}

module.exports = {
  AccountExportIntegrityError,
  stageAccountExportDownload,
};
