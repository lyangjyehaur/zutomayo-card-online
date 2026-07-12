import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { LEGAL_HOLD_LOCK_NAME, RETENTION_LOCK_NAME, retentionCutoff, runRetention } =
  require('../retentionService.cjs') as {
    LEGAL_HOLD_LOCK_NAME: string;
    RETENTION_LOCK_NAME: string;
    retentionCutoff: (now: string | Date, days: number) => string;
    runRetention: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  };

function createPool() {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  const pool = {
    queries,
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params });
      if (sql.includes('COUNT(*)')) return { rows: [{ count: 2 }], rowCount: 2 };
      if (/UPDATE matches|UPDATE chat_messages|DELETE FROM/.test(sql)) return { rows: [], rowCount: 2 };
      return { rows: [], rowCount: 0 };
    }),
  };
  return pool;
}

describe('retention service', () => {
  it('calculates deterministic UTC cutoffs', () => {
    expect(retentionCutoff('2026-01-31T00:00:00.000Z', 30)).toBe('2026-01-01T00:00:00.000Z');
  });

  it('runs in dry-run mode without mutating rows and records counts', async () => {
    const pool = createPool();
    const result = await runRetention({
      pool,
      now: '2026-01-31T00:00:00.000Z',
      dryRun: true,
      runId: 'retention_test',
    });

    expect(result).toMatchObject({ ok: true, dryRun: true, runId: 'retention_test' });
    expect(result.counts).toMatchObject({
      actionLogs: 2,
      matches: 2,
      chat: 2,
      translations: 2,
      reports: 2,
      adminAudit: 2,
      accountTokens: 2,
      relationshipOutbox: 2,
    });
    expect(pool.queries.some(({ sql }) => sql.startsWith('UPDATE matches'))).toBe(false);
    expect(pool.queries.some(({ sql }) => sql.startsWith('DELETE FROM chat_reports'))).toBe(false);
    expect(pool.queries.some(({ sql }) => sql.includes("status = 'succeeded'"))).toBe(true);
  });

  it('uses legal holds in every destructive candidate query', async () => {
    const pool = createPool();
    await runRetention({ pool, dryRun: false, runId: 'retention_live' });
    const destructiveQueries = pool.queries.filter(({ sql }) =>
      /UPDATE matches|UPDATE chat_messages|DELETE FROM chat_reports|DELETE FROM admin_audit_log/.test(sql),
    );
    expect(destructiveQueries.length).toBeGreaterThanOrEqual(4);
    expect(destructiveQueries.every(({ sql }) => sql.includes('legal_holds'))).toBe(true);
    expect(destructiveQueries.find(({ sql }) => sql.includes('admin_audit_log'))?.sql).toContain(
      "a.target_type = 'legal_hold'",
    );
  });

  it('protects live account-owned evidence even before snapshot reconciliation', async () => {
    const pool = createPool();
    await runRetention({ pool, dryRun: true, runId: 'retention_live_account_scope' });
    const matchQuery = pool.queries.find(({ sql }) => sql.includes('FROM matches m'))?.sql || '';
    const chatQuery = pool.queries.find(({ sql }) => sql.includes('FROM chat_messages m'))?.sql || '';
    expect(matchQuery).toContain("account_hold.subject_type = 'account'");
    expect(matchQuery).toContain('account_hold.subject_id IN (m.player0_id');
    expect(chatQuery).toContain('account_hold.subject_id IN (m.author_user_id)');
    const relationshipQuery =
      pool.queries.find(({ sql }) => sql.includes('FROM relationship_change_outbox o'))?.sql || '';
    expect(relationshipQuery).toContain("h.subject_type = 'account'");
    expect(relationshipQuery).toContain('h.subject_id = ANY(o.user_ids)');
  });

  it('uses one shared lock key for retention, hold creation, and account deletion', () => {
    expect(LEGAL_HOLD_LOCK_NAME).toBe(RETENTION_LOCK_NAME);
    expect(RETENTION_LOCK_NAME).toBe('zutomayo:retention-job:v1');
  });

  it('persists a failed run after rolling back the destructive transaction', async () => {
    const queries: string[] = [];
    const pool = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql);
        if (sql.includes('UPDATE matches')) throw new Error('retention mutation failed');
        return { rows: [], rowCount: 0 };
      }),
    };

    await expect(runRetention({ pool, dryRun: false, runId: 'retention_failed' })).rejects.toThrow(
      'retention mutation failed',
    );

    const rollbackIndex = queries.indexOf('ROLLBACK');
    const failureIndex = queries.findIndex((sql) => sql.includes("status = 'failed'"));
    expect(rollbackIndex).toBeGreaterThan(-1);
    expect(failureIndex).toBeGreaterThan(rollbackIndex);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("status = 'failed'"), [
      'retention_failed',
      expect.any(Number),
      expect.any(Number),
      'retention mutation failed',
    ]);
  });

  it('binds only the parameters used by the match retention SQL', async () => {
    const pool = createPool();
    await runRetention({ pool, dryRun: true, runId: 'retention_bindings' });
    const matchCountQuery = pool.queries.find(({ sql }) => sql.includes('FROM matches m'));
    expect(matchCountQuery?.params).toHaveLength(1);
  });

  it('drains more than one batch without repeatedly selecting already-purged rows', async () => {
    let actionLogBatch = 0;
    const queries: string[] = [];
    const pool = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql);
        if (sql.includes('SET action_log = NULL')) {
          actionLogBatch += 1;
          return { rows: [], rowCount: actionLogBatch === 1 ? 2 : 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    const result = await runRetention({ pool, dryRun: false, batchSize: 2, runId: 'retention_batches' });
    expect(result.counts).toMatchObject({ actionLogs: 3 });
    expect(actionLogBatch).toBe(2);
    expect(queries.find((sql) => sql.includes('SET action_log = NULL'))).toContain('action_log_purged_at IS NULL');
  });

  it('skips cleanly when another retention worker owns the session lock', async () => {
    const pool = {
      query: vi.fn(async (sql: string) =>
        sql.includes('pg_try_advisory_lock') ? { rows: [{ acquired: false }], rowCount: 1 } : { rows: [], rowCount: 0 },
      ),
    };
    await expect(runRetention({ pool, runId: 'retention_contended' })).resolves.toEqual({
      ok: false,
      skipped: true,
      reason: 'already-running',
      runId: 'retention_contended',
    });
    expect(pool.query).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO retention_runs'),
      expect.anything(),
    );
  });
});
