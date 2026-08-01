import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAccountExport,
  getAccountExport,
  getAccountExportDownloadUrl,
  listAccountExports,
  type AccountExportJob,
} from '../client';

const job: AccountExportJob = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  status: 'queued',
  formatVersion: 1,
  sizeBytes: null,
  uncompressedSizeBytes: null,
  contentSha256: null,
  attemptCount: 0,
  maxAttempts: 5,
  requestedAt: '2026-07-14T00:00:00.000Z',
  snapshotAt: null,
  startedAt: null,
  completedAt: null,
  expiresAt: null,
  downloadedAt: null,
  downloadCount: 0,
  errorCode: '',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('account export API client', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    vi.stubGlobal('document', { cookie: 'zutomayo_csrf=csrf-token' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates an asynchronous export job with CSRF protection', async () => {
    const fetch = vi.fn(async () => jsonResponse({ job }, 202));
    vi.stubGlobal('fetch', fetch);

    await expect(createAccountExport()).resolves.toEqual(job);
    expect(fetch).toHaveBeenCalledWith(
      '/api/account/exports',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: expect.objectContaining({ 'X-CSRF-Token': 'csrf-token' }),
      }),
    );
  });

  it('lists jobs and fetches an owned job status', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ jobs: [job] }))
      .mockResolvedValueOnce(jsonResponse({ job: { ...job, status: 'processing' } }));
    vi.stubGlobal('fetch', fetch);

    await expect(listAccountExports()).resolves.toEqual([job]);
    await expect(getAccountExport(job.id)).resolves.toMatchObject({ id: job.id, status: 'processing' });
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      `/api/account/exports/${job.id}`,
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('builds a streaming download URL instead of materializing JSON in the browser', () => {
    expect(getAccountExportDownloadUrl(job.id)).toBe(`/api/account/exports/${job.id}/download`);
  });
});
