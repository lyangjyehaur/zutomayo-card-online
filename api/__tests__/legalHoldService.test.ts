import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { LEGAL_HOLD_LOCK_NAME, createLegalHold, listLegalHolds, releaseLegalHold } =
  require('../legalHoldService.cjs') as {
    LEGAL_HOLD_LOCK_NAME: string;
    createLegalHold: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
    listLegalHolds: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
    releaseLegalHold: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  };

function transactionPool(
  handler: (sql: string, params?: unknown[]) => { rows?: Record<string, unknown>[]; rowCount?: number },
) {
  const query = vi.fn(async (sql: string, params?: unknown[]) => ({ rows: [], rowCount: 0, ...handler(sql, params) }));
  return { query, connect: vi.fn(async () => ({ query, release: vi.fn() })) };
}

describe('legal hold service', () => {
  it('uses the shared retention lock namespace before expanding a hold', async () => {
    expect(LEGAL_HOLD_LOCK_NAME).toBe('zutomayo:retention-job:v1');
  });

  it('creates a hold and its admin audit entry in one transaction', async () => {
    const pool = transactionPool((sql, params) => {
      if (sql.includes('SELECT id FROM users')) return { rows: [{ id: 'u_1' }] };
      if (sql.includes('INSERT INTO legal_holds')) {
        return {
          rows: [
            {
              id: params?.[0],
              subject_type: 'account',
              subject_id: 'u_1',
              reason: 'Pending litigation request',
              owner: 'legal-team',
            },
          ],
        };
      }
      return {};
    });

    await expect(
      createLegalHold({
        pool,
        adminUserId: 'admin_1',
        subjectType: 'account',
        subjectId: 'u_1',
        reason: 'Pending litigation request',
        owner: 'legal-team',
        expiresAt: '2099-07-12T00:00:00.000Z',
        caseReference: 'CASE-2026-1',
        generateId: () => 'legal_hold_test_1',
      }),
    ).resolves.toMatchObject({ ok: true, body: { hold: { id: 'legal_hold_test_1' } } });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO admin_audit_log'), [
      'admin_1',
      'legal_hold.create',
      'legal_hold_test_1',
      expect.stringContaining('CASE-2026-1'),
    ]);
    expect(pool.query).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(hashtext($1))', ['legal-hold:account:u_1']);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO legal_hold_objects'), [
      'legal_hold_test_1',
      expect.stringContaining('"object_type":"account"'),
    ]);
    expect(pool.query).toHaveBeenCalledWith('COMMIT');
  });

  it('builds a bounded active-hold query with subject filters', async () => {
    const pool = transactionPool(() => ({ rows: [] }));
    await expect(
      listLegalHolds({ pool, status: 'active', subjectType: 'match', subjectId: 'm_1', limit: 9999 }),
    ).resolves.toEqual({ ok: true, body: { holds: [] } });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('h.released_at IS NULL'), ['match', 'm_1', 500]);
  });

  it('requires an expiry and rejects a missing subject before writing a hold', async () => {
    const pool = transactionPool(() => ({ rows: [] }));
    await expect(
      createLegalHold({
        pool,
        adminUserId: 'admin_1',
        subjectType: 'account',
        subjectId: 'u_missing',
        reason: 'Pending litigation request',
        owner: 'legal-team',
        expiresAt: '2099-07-12T00:00:00.000Z',
      }),
    ).resolves.toMatchObject({ ok: false, status: 404 });
    expect(pool.query).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO legal_holds'), expect.anything());

    await expect(
      createLegalHold({
        pool,
        adminUserId: 'admin_1',
        subjectType: 'account',
        subjectId: 'u_missing',
        reason: 'Pending litigation request',
        owner: 'legal-team',
      }),
    ).resolves.toMatchObject({ ok: false, status: 400 });
  });

  it('fails closed while an account provider deletion is in flight', async () => {
    const pool = transactionPool((sql) => {
      if (sql.includes('FROM account_deletion_requests')) return { rows: [{ id: 'delete_1' }] };
      return {};
    });
    await expect(
      createLegalHold({
        pool,
        adminUserId: 'admin_1',
        subjectType: 'account',
        subjectId: 'u_1',
        reason: 'Pending litigation request',
        owner: 'legal-team',
        expiresAt: '2099-07-12T00:00:00.000Z',
      }),
    ).resolves.toMatchObject({ ok: false, status: 409 });
    expect(pool.query).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO legal_holds'), expect.anything());
  });

  it('releases a hold once and records the release reason', async () => {
    const pool = transactionPool((sql) => {
      if (sql.includes('FROM legal_holds') && sql.includes('FOR UPDATE')) {
        return {
          rows: [{ id: 'legal_hold_test_1', subject_type: 'account', subject_id: 'u_1', released_at: null }],
        };
      }
      if (sql.includes('UPDATE legal_holds')) {
        return { rows: [{ id: 'legal_hold_test_1', released_at: '2026-07-12T00:00:00.000Z' }] };
      }
      return {};
    });
    await expect(
      releaseLegalHold({
        pool,
        adminUserId: 'admin_1',
        holdId: 'legal_hold_test_1',
        reason: 'Matter closed by legal counsel',
      }),
    ).resolves.toMatchObject({ ok: true, body: { released: true } });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE legal_holds'), [
      'legal_hold_test_1',
      expect.stringContaining('Matter closed by legal counsel'),
    ]);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO admin_audit_log'), [
      'admin_1',
      'legal_hold.release',
      'legal_hold_test_1',
      expect.stringContaining('Matter closed by legal counsel'),
    ]);
  });

  it('does not write a second audit entry for an already released hold', async () => {
    const pool = transactionPool((sql) =>
      sql.includes('FROM legal_holds')
        ? {
            rows: [
              {
                id: 'legal_hold_test_1',
                subject_type: 'account',
                subject_id: 'u_1',
                released_at: '2026-07-12T00:00:00.000Z',
              },
            ],
          }
        : {},
    );
    await expect(
      releaseLegalHold({
        pool,
        adminUserId: 'admin_1',
        holdId: 'legal_hold_test_1',
        reason: 'Repeated release request',
      }),
    ).resolves.toMatchObject({ ok: true, body: { released: false, reason: 'already-released' } });
    expect(pool.query).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO admin_audit_log'),
      expect.anything(),
    );
  });
});
