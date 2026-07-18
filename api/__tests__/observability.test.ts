import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  accountExportJobsFailed,
  accountExportJobsPending,
  accountExportMetricsRefreshSuccess,
  accountExportPurgePending,
  accountExportPurgeRetrying,
  register,
} = require('../observability.cjs') as {
  accountExportJobsFailed: { set: (value: number) => void };
  accountExportJobsPending: { set: (value: number) => void };
  accountExportMetricsRefreshSuccess: { set: (value: number) => void };
  accountExportPurgePending: { set: (value: number) => void };
  accountExportPurgeRetrying: { set: (value: number) => void };
  register: { resetMetrics: () => void; metrics: () => Promise<string> };
};

describe('API operational metrics', () => {
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
