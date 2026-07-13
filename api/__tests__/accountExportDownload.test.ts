import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { stageAccountExportDownload } = require('../accountExportDownload.cjs') as {
  stageAccountExportDownload: (input: Record<string, unknown>) => Promise<{
    filePath: string;
    sizeBytes: number;
    cleanup: () => Promise<void>;
    touch: () => Promise<void>;
  }>;
};

const maxBytes = 1024 * 1024;
let tempRoot = '';

function sha256(value: Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

function downloadDirectories(entries: string[]) {
  return entries.filter((entry) => entry.startsWith('download-'));
}

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'account-export-download-test-'));
});

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

describe('account export download staging', () => {
  it('consumes the complete async body and verifies SHA-256 and size before returning', async () => {
    const chunks = [Buffer.from('gzip-header-'), Buffer.from('private-account-'), Buffer.from('export-body')];
    const expected = Buffer.concat(chunks);
    let bodyCompleted = false;
    const body = {
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) {
          await Promise.resolve();
          yield chunk;
        }
        bodyCompleted = true;
      },
    };

    const staged = await stageAccountExportDownload({
      body,
      expectedSize: expected.length,
      expectedSha256: sha256(expected),
      maxBytes,
      tempRoot,
    });

    expect(bodyCompleted).toBe(true);
    expect(staged.sizeBytes).toBe(expected.length);
    await expect(readFile(staged.filePath)).resolves.toEqual(expected);
    await staged.cleanup();
  });

  it('accepts a Node readable stream without returning a partially written file', async () => {
    const expected = Buffer.from('complete-readable-body');
    const staged = await stageAccountExportDownload({
      body: Readable.from([expected.subarray(0, 7), expected.subarray(7)]),
      expectedSize: expected.length,
      expectedSha256: sha256(expected),
      maxBytes,
      tempRoot,
    });

    expect(await readFile(staged.filePath)).toEqual(expected);
    expect(await readdir(dirname(staged.filePath))).toEqual(
      expect.arrayContaining(['.activity', 'account-export.json.gz']),
    );
    await staged.cleanup();
  });

  it('refreshes the upstream idle timeout for every received body chunk', async () => {
    const chunks = [Buffer.from('one-'), Buffer.from('two-'), Buffer.from('three')];
    const expected = Buffer.concat(chunks);
    const refreshTimeout = vi.fn();
    const staged = await stageAccountExportDownload({
      body: Readable.from(chunks),
      expectedSize: expected.length,
      expectedSha256: sha256(expected),
      refreshTimeout,
      maxBytes,
      tempRoot,
    });

    expect(refreshTimeout).toHaveBeenCalledTimes(chunks.length);
    await staged.cleanup();
  });
});

describe('account export download integrity failures', () => {
  it('removes staged data when the body is shorter than the declared size', async () => {
    const body = Buffer.from('short-body');

    await expect(
      stageAccountExportDownload({
        body: Readable.from([body]),
        expectedSize: body.length + 1,
        expectedSha256: sha256(body),
        maxBytes,
        tempRoot,
      }),
    ).rejects.toMatchObject({
      name: 'AccountExportIntegrityError',
      code: 'ACCOUNT_EXPORT_INTEGRITY',
      details: { sizeMatched: false, checksumMatched: true },
    });
    expect(downloadDirectories(await readdir(tempRoot))).toEqual([]);
  });

  it('removes staged data when the complete body checksum does not match', async () => {
    const body = Buffer.from('right-size-wrong-checksum');

    await expect(
      stageAccountExportDownload({
        body: Readable.from([body]),
        expectedSize: body.length,
        expectedSha256: '0'.repeat(64),
        maxBytes,
        tempRoot,
      }),
    ).rejects.toMatchObject({
      name: 'AccountExportIntegrityError',
      code: 'ACCOUNT_EXPORT_INTEGRITY',
      details: { sizeMatched: true, checksumMatched: false },
    });
    expect(downloadDirectories(await readdir(tempRoot))).toEqual([]);
  });

  it('stops oversized bodies early and removes every partial artifact', async () => {
    const body = Buffer.from('body-longer-than-declared');

    await expect(
      stageAccountExportDownload({
        body: Readable.from([body.subarray(0, 5), body.subarray(5)]),
        expectedSize: 5,
        expectedSha256: sha256(body),
        maxBytes,
        tempRoot,
      }),
    ).rejects.toMatchObject({
      name: 'AccountExportIntegrityError',
      code: 'ACCOUNT_EXPORT_INTEGRITY',
      details: { sizeMatched: false, checksumMatched: false },
    });
    expect(downloadDirectories(await readdir(tempRoot))).toEqual([]);
  });

  it('cleans its work directory when object storage returns an unreadable body', async () => {
    await expect(
      stageAccountExportDownload({
        body: { unsupported: true },
        expectedSize: 0,
        expectedSha256: sha256(Buffer.alloc(0)),
        maxBytes,
        tempRoot,
      }),
    ).rejects.toThrow('object storage returned an unreadable body');
    expect(downloadDirectories(await readdir(tempRoot))).toEqual([]);
  });

  it('fails before staging when declared size exceeds the configured cap', async () => {
    await expect(
      stageAccountExportDownload({
        body: Readable.from([]),
        expectedSize: maxBytes + 1,
        expectedSha256: sha256(Buffer.alloc(0)),
        maxBytes,
        tempRoot,
      }),
    ).rejects.toMatchObject({
      name: 'AccountExportIntegrityError',
      code: 'ACCOUNT_EXPORT_INTEGRITY',
    });
    expect(downloadDirectories(await readdir(tempRoot))).toEqual([]);
  });
});

describe('account export staged file permissions and cleanup', () => {
  it('uses a 0700 work directory and 0600 files, then cleans idempotently', async () => {
    const body = Buffer.from('private-export');
    const staged = await stageAccountExportDownload({
      body: Readable.from([body]),
      expectedSize: body.length,
      expectedSha256: sha256(body),
      maxBytes,
      tempRoot,
    });
    const workDir = dirname(staged.filePath);

    expect((await stat(tempRoot)).mode & 0o777).toBe(0o700);
    expect((await stat(workDir)).mode & 0o777).toBe(0o700);
    expect((await stat(staged.filePath)).mode & 0o777).toBe(0o600);
    expect((await stat(join(workDir, '.activity'))).mode & 0o777).toBe(0o600);
    await expect(staged.touch()).resolves.toBeUndefined();

    await staged.cleanup();
    await staged.cleanup();
    await expect(stat(workDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
