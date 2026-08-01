import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  ACTIVE_DELETION_STATUSES,
  markProviderDeleted,
  markProviderDeletionStarted,
  markProviderDeletionFailure,
  withAccountDeletionRecoveryLease,
} = require('../accountDeletionService.cjs') as {
  ACTIVE_DELETION_STATUSES: string[];
  markProviderDeleted: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  markProviderDeletionStarted: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  markProviderDeletionFailure: (input: Record<string, unknown>) => Promise<void>;
  withAccountDeletionRecoveryLease: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

function createPool(
  handler: (sql: string, params?: unknown[]) => { rows?: Record<string, unknown>[]; rowCount?: number },
) {
  const query = vi.fn(async (sql: string, params?: unknown[]) => ({ rows: [], rowCount: 0, ...handler(sql, params) }));
  return { query };
}

describe('account deletion saga', () => {
  it('holds a session advisory lease while recovering a provider deletion', async () => {
    const release = vi.fn();
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: true }] };
      if (sql.includes('FROM account_deletion_requests')) {
        return {
          rows: [
            {
              id: 'delete_1',
              user_id: 'u_1',
              provider: 'logto',
              provider_user_id: 'logto_1',
              status: 'provider_deleting',
              attempt_count: 1,
            },
          ],
        };
      }
      return { rows: [] };
    });
    const operation = vi.fn(async (request) => ({ recovered: request.id }));

    await expect(
      withAccountDeletionRecoveryLease({
        pool: { connect: async () => ({ query, release }) },
        requestId: 'delete_1',
        operation,
      }),
    ).resolves.toMatchObject({ acquired: true, result: { recovered: 'delete_1' } });
    expect(operation).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'delete_1', status: 'provider_deleting' }),
      expect.objectContaining({ query }),
    );
    expect(query).toHaveBeenCalledWith('SELECT pg_advisory_unlock(hashtext($1), hashtext($2))', [
      'zutomayo:account-deletion-recovery:v1',
      'delete_1',
    ]);
    expect(release).toHaveBeenCalledOnce();
  });

  it('runs a nested provider transaction on the leased session without reconnecting or releasing it', async () => {
    const events: string[] = [];
    let releaseCount = 0;
    const requestRow = {
      id: 'delete_1',
      user_id: 'u_1',
      provider: 'logto',
      provider_user_id: 'logto_1',
      status: 'prepared',
      attempt_count: 0,
    };
    const leasedClient = {
      connect: vi.fn(async () => {
        throw new Error('lease client must not be reconnected');
      }),
      query: vi.fn(async (sql: string) => {
        events.push(sql);
        if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: true }] };
        if (sql.includes('WHERE id = $1 AND status = ANY($2::text[])')) return { rows: [requestRow] };
        if (sql.includes('FROM account_deletion_requests')) return { rows: [{ id: 'delete_1', user_id: 'u_1' }] };
        if (sql.includes('FROM legal_holds')) return { rows: [] };
        if (sql.includes("SET status = 'provider_deleting'")) {
          return { rows: [{ ...requestRow, status: 'provider_deleting', attempt_count: 1 }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(() => {
        releaseCount += 1;
        if (releaseCount > 1) throw new Error('lease client released more than once');
        events.push('release');
      }),
    };

    const result = await withAccountDeletionRecoveryLease({
      pool: { connect: async () => leasedClient },
      requestId: 'delete_1',
      statuses: ['prepared'],
      operation: async (request, client) => markProviderDeletionStarted({ pool: client, requestId: request.id }),
    });

    expect(result).toMatchObject({ acquired: true, result: { ok: true } });
    expect(leasedClient.connect).not.toHaveBeenCalled();
    expect(leasedClient.release).toHaveBeenCalledOnce();
    expect(events).toContain('BEGIN');
    expect(events).toContain('COMMIT');
    const unlockIndex = events.findIndex((sql) => sql.includes('pg_advisory_unlock'));
    expect(unlockIndex).toBeGreaterThan(events.indexOf('COMMIT'));
    expect(events.at(-1)).toBe('release');
  });

  it('does not run recovery when another process owns the advisory lease', async () => {
    const release = vi.fn();
    const query = vi.fn(async () => ({ rows: [{ acquired: false }] }));
    const operation = vi.fn();

    await expect(
      withAccountDeletionRecoveryLease({
        pool: { connect: async () => ({ query, release }) },
        requestId: 'delete_1',
        operation,
      }),
    ).resolves.toEqual({ acquired: false });
    expect(operation).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });

  it('destroys a pooled session when advisory unlock cannot be confirmed', async () => {
    const unlockError = new Error('connection lost during unlock');
    const release = vi.fn();
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: true }] };
      if (sql.includes('FROM account_deletion_requests')) {
        return { rows: [{ id: 'delete_1', user_id: 'u_1', provider: 'logto', status: 'provider_deleted' }] };
      }
      if (sql.includes('pg_advisory_unlock')) throw unlockError;
      return { rows: [] };
    });

    await expect(
      withAccountDeletionRecoveryLease({
        pool: { connect: async () => ({ query, release }) },
        requestId: 'delete_1',
        operation: async () => 'done',
      }),
    ).resolves.toMatchObject({ acquired: true, result: 'done' });
    expect(release).toHaveBeenCalledWith(unlockError);
  });

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
