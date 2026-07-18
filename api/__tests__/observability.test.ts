import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  accountExportJobsFailed,
  accountExportJobsPending,
  accountExportMetricsRefreshSuccess,
  accountExportPurgePending,
  accountExportPurgeRetrying,
  register,
  refreshMatchmakingQueueDepth,
} = require('../observability.cjs') as {
  accountExportJobsFailed: { set: (value: number) => void };
  accountExportJobsPending: { set: (value: number) => void };
  accountExportMetricsRefreshSuccess: { set: (value: number) => void };
  accountExportPurgePending: { set: (value: number) => void };
  accountExportPurgeRetrying: { set: (value: number) => void };
  register: { resetMetrics: () => void; metrics: () => Promise<string> };
  refreshMatchmakingQueueDepth: (redis: { zcard: (key: string) => Promise<number> }) => Promise<void>;
};

describe('API operational metrics', () => {
  it('exports the live Redis matchmaking queue depth', async () => {
    register.resetMetrics();
    const zcard = vi.fn(async (key: string) => {
      expect(key).toBe('mm:queue');
      return 7;
    });

    await refreshMatchmakingQueueDepth({ zcard });
    const metrics = await register.metrics();
    expect(metrics).toContain('matchmaking_queue_depth 7');
    expect(zcard).toHaveBeenCalledOnce();
  });

  it('exports account export backlog, failure, purge, and refresh health', async () => {
    register.resetMetrics();
    accountExportJobsPending.set(3);
    accountExportJobsFailed.set(1);
    accountExportPurgePending.set(2);
    accountExportPurgeRetrying.set(1);
    accountExportMetricsRefreshSuccess.set(1);

    const metrics = await register.metrics();
    expect(metrics).toContain('account_export_jobs_pending 3');
    expect(metrics).toContain('account_export_jobs_failed 1');
    expect(metrics).toContain('account_export_purge_pending 2');
    expect(metrics).toContain('account_export_purge_retrying 1');
    expect(metrics).toContain('account_export_metrics_refresh_success 1');
  });
});
