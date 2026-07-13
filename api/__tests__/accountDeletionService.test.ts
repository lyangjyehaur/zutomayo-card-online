import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { ACTIVE_DELETION_STATUSES, markProviderDeleted, markProviderDeletionStarted, markProviderDeletionFailure } =
  require('../accountDeletionService.cjs') as {
    ACTIVE_DELETION_STATUSES: string[];
    markProviderDeleted: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
    markProviderDeletionStarted: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
    markProviderDeletionFailure: (input: Record<string, unknown>) => Promise<void>;
  };

function createPool(
  handler: (sql: string, params?: unknown[]) => { rows?: Record<string, unknown>[]; rowCount?: number },
) {
  const query = vi.fn(async (sql: string, params?: unknown[]) => ({ rows: [], rowCount: 0, ...handler(sql, params) }));
  return { query };
}

describe('account deletion saga', () => {
  it('keeps all non-completed requests in the active set', () => {
    expect(ACTIVE_DELETION_STATUSES).toEqual(['prepared', 'provider_deleting', 'provider_deleted', 'provider_failed']);
  });

  it('blocks the provider call when an active account legal hold exists', async () => {
    const pool = createPool((sql) => {
      if (sql.includes('SELECT id, user_id FROM account_deletion_requests')) {
        return { rows: [{ id: 'delete_1', user_id: 'u_1' }] };
      }
      if (sql.includes('FROM legal_holds')) return { rows: [{ id: 'hold_1' }] };
      return {};
    });

    await expect(markProviderDeletionStarted({ pool, requestId: 'delete_1' })).resolves.toEqual({
      ok: false,
      status: 409,
      error: 'Account deletion is suspended by an active legal hold',
    });
    expect(pool.query).not.toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'provider_deleting'"),
      expect.anything(),
    );
    expect(pool.query).toHaveBeenCalledWith('COMMIT');
  });

  it('serializes and advances provider deletion after the hold check', async () => {
    const pool = createPool((sql, params) => {
      if (sql.includes('SELECT id, user_id FROM account_deletion_requests')) {
        return { rows: [{ id: 'delete_1', user_id: 'u_1' }] };
      }
      if (sql.includes('FROM legal_holds')) return { rows: [] };
      if (sql.includes("SET status = 'provider_deleting'")) {
        return {
          rows: [
            {
              id: params?.[0],
              user_id: 'u_1',
              provider: 'logto',
              provider_user_id: 'logto_1',
              status: 'provider_deleting',
              attempt_count: 1,
            },
          ],
        };
      }
      return {};
    });

    await expect(markProviderDeletionStarted({ pool, requestId: 'delete_1' })).resolves.toMatchObject({
      ok: true,
      body: { request: { id: 'delete_1', status: 'provider_deleting', attemptCount: 1 } },
    });
    expect(pool.query).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(hashtext($1))', [
      'zutomayo:retention-job:v1',
    ]);
    expect(pool.query).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(hashtext($1))', ['legal-hold:account:u_1']);
  });

  it('records provider completion inside a transaction even when a hold appears later', async () => {
    const pool = createPool((sql, params) => {
      if (sql.includes('SELECT id, user_id FROM account_deletion_requests')) {
        return { rows: [{ id: 'delete_1', user_id: 'u_1' }] };
      }
      if (sql.includes("SET status = 'provider_deleted'")) {
        return {
          rows: [
            {
              id: params?.[0],
              user_id: 'u_1',
              provider: 'logto',
              provider_user_id: 'logto_1',
              status: 'provider_deleted',
              attempt_count: 1,
            },
          ],
        };
      }
      return {};
    });

    await expect(markProviderDeleted({ pool, requestId: 'delete_1' })).resolves.toMatchObject({
      ok: true,
      body: { request: { id: 'delete_1', status: 'provider_deleted' } },
    });
    expect(pool.query).toHaveBeenCalledWith('COMMIT');
  });

  it('persists provider failures under the same account lock', async () => {
    const pool = createPool((sql) => {
      if (sql.includes('SELECT id, user_id FROM account_deletion_requests')) {
        return { rows: [{ id: 'delete_1', user_id: 'u_1' }] };
      }
      return {};
    });

    await expect(
      markProviderDeletionFailure({ pool, requestId: 'delete_1', error: 'timeout', retryable: false }),
    ).resolves.toBeUndefined();
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('SET status = $2'), [
      'delete_1',
      'provider_failed',
      'timeout',
    ]);
    expect(pool.query).toHaveBeenCalledWith('COMMIT');
  });
});
