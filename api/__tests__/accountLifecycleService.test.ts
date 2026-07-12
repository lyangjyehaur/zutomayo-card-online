import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  deleteAccount,
  exportAccountData,
  hashAccountToken,
  requestEmailVerification,
  requestPasswordReset,
  resetPassword,
  verifyEmailToken,
} = require('../accountLifecycleService.cjs') as {
  deleteAccount: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  exportAccountData: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  hashAccountToken: (token: string) => string;
  requestEmailVerification: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  requestPasswordReset: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  resetPassword: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  verifyEmailToken: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

type QueryResult = { rows: Record<string, unknown>[] };

function createPool(handler: (sql: string, params?: unknown[]) => QueryResult) {
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => handler(sql, params)),
  };
}

describe('account lifecycle service', () => {
  it('stores only the hash when issuing an email verification token', async () => {
    const pool = createPool((sql) => {
      if (sql.startsWith('SELECT id, email')) {
        return { rows: [{ id: 'u_1', email: 'user@example.com', email_verified: false, deleted_at: null }] };
      }
      if (sql.includes('SELECT id FROM users') && sql.includes('FOR UPDATE')) return { rows: [{ id: 'u_1' }] };
      return { rows: [] };
    });

    await expect(
      requestEmailVerification({ pool, userId: 'u_1', generateToken: () => 'raw-verification-token' }),
    ).resolves.toEqual({
      ok: true,
      body: { email: 'user@example.com', token: 'raw-verification-token', expiresIn: 1800 },
    });

    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO account_action_tokens'), [
      'u_1',
      'verify_email',
      hashAccountToken('raw-verification-token'),
      1800,
    ]);
    expect(pool.query).toHaveBeenCalledWith('SELECT id FROM users WHERE id = $1 FOR UPDATE', ['u_1']);
    expect(pool.query).toHaveBeenCalledWith('COMMIT');
  });

  it('atomically consumes a verification token before marking the email verified', async () => {
    const pool = createPool((sql) => {
      if (sql.includes('RETURNING user_id')) return { rows: [{ user_id: 'u_1' }] };
      return { rows: [] };
    });

    await expect(verifyEmailToken({ pool, token: 'verify-me' })).resolves.toEqual({
      ok: true,
      body: { verified: true },
    });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("action_type = 'verify_email'"), [
      hashAccountToken('verify-me'),
    ]);
    expect(pool.query).toHaveBeenCalledWith(
      'UPDATE users SET email_verified = TRUE WHERE id = $1 AND deleted_at IS NULL',
      ['u_1'],
    );
    expect(pool.query).toHaveBeenCalledWith('COMMIT');
  });

  it('does not reveal whether a password reset email exists', async () => {
    const pool = createPool(() => ({ rows: [] }));
    await expect(requestPasswordReset({ pool, email: 'missing@example.com' })).resolves.toEqual({
      ok: true,
      body: { accepted: true },
    });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('requires a 12-character password and increments auth_version after reset', async () => {
    const pool = createPool((sql) => {
      if (sql.includes('RETURNING user_id')) return { rows: [{ user_id: 'u_1' }] };
      return { rows: [] };
    });

    await expect(
      resetPassword({
        pool,
        token: 'reset-me',
        newPassword: 'too-short',
        hashPassword: vi.fn(),
        generateSalt: () => 'salt',
      }),
    ).resolves.toMatchObject({ ok: false, status: 400 });

    const hashPassword = vi.fn(async () => 'new-hash');
    await expect(
      resetPassword({
        pool,
        token: 'reset-me',
        newPassword: 'long-enough-password',
        hashPassword,
        generateSalt: () => 'new-salt',
      }),
    ).resolves.toEqual({ ok: true, body: { reset: true, revokeSessions: true, userId: 'u_1' } });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('auth_version = auth_version + 1'), [
      'new-hash',
      'new-salt',
      'u_1',
    ]);
  });

  it('exports account data without password material', async () => {
    const pool = createPool((sql) => {
      if (sql.includes('FROM users')) {
        return { rows: [{ id: 'u_1', email: 'user@example.com', nickname: 'User' }] };
      }
      return { rows: [] };
    });

    const result = (await exportAccountData({ pool, userId: 'u_1' })) as {
      ok: boolean;
      body: { account: Record<string, unknown> };
    };
    expect(result.ok).toBe(true);
    expect(result.body.account).not.toHaveProperty('password_hash');
    expect(result.body.account).not.toHaveProperty('salt');
    expect(pool.query).toHaveBeenCalledWith('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(pool.query).toHaveBeenCalledWith('COMMIT');
  });

  it('rejects synchronous exports that exceed the configured byte cap', async () => {
    const pool = createPool((sql) => {
      if (sql.includes('FROM users')) {
        return { rows: [{ id: 'u_1', email: 'user@example.com', nickname: 'x'.repeat(70 * 1024) }] };
      }
      return { rows: [] };
    });

    await expect(exportAccountData({ pool, userId: 'u_1', maxBytes: 64 * 1024 })).resolves.toEqual({
      ok: false,
      status: 413,
      error: 'Account export exceeds the synchronous size limit',
    });
  });

  it('includes first-party chat, report, feedback, and social records in the export', async () => {
    const pool = createPool((sql) => {
      if (sql.includes('FROM users')) return { rows: [{ id: 'u_1', email: 'user@example.com' }] };
      if (sql.includes('FROM chat_messages')) return { rows: [{ id: 'msg_1' }] };
      if (sql.includes('FROM chat_reports')) return { rows: [{ id: 'report_1' }] };
      if (sql.includes('FROM feedback_posts')) return { rows: [{ id: 'post_1' }] };
      if (sql.includes('FROM feedback_comments')) return { rows: [{ id: 'comment_1' }] };
      return { rows: [] };
    });

    const result = (await exportAccountData({ pool, userId: 'u_1' })) as {
      body: Record<string, unknown[]>;
    };
    expect(result.body.chatMessages).toEqual([{ id: 'msg_1' }]);
    expect(result.body.chatReports).toEqual([{ id: 'report_1' }]);
    expect(result.body.feedbackPosts).toEqual([{ id: 'post_1' }]);
    expect(result.body.feedbackComments).toEqual([{ id: 'comment_1' }]);
    expect(result.body).toHaveProperty('friendRequests');
    expect(result.body).toHaveProperty('sanctions');
  });

  it('exports season ratings and reward records while bounding each collection query', async () => {
    const pool = createPool((sql, params) => {
      if (sql.includes('FROM users')) return { rows: [{ id: 'u_1', email: 'user@example.com' }] };
      if (sql.includes('FROM season_ratings')) return { rows: [{ season_id: 's_1', rating: 1200 }] };
      if (sql.includes('FROM season_rewards')) return { rows: [{ season_id: 's_1', reward_tier: 'gold' }] };
      if (sql.includes('FROM season_reward_entitlements')) return { rows: [{ id: 1, season_id: 's_1' }] };
      if (sql.includes('LIMIT $2')) expect(params).toEqual(['u_1', 3]);
      return { rows: [] };
    });

    const result = (await exportAccountData({ pool, userId: 'u_1', maxRowsPerCollection: 2 })) as {
      ok: boolean;
      body: Record<string, unknown[]>;
    };
    expect(result.ok).toBe(true);
    expect(result.body.seasonRatings).toEqual([{ season_id: 's_1', rating: 1200 }]);
    expect(result.body.seasonRewards).toEqual([{ season_id: 's_1', reward_tier: 'gold' }]);
    expect(result.body.seasonRewardEntitlements).toEqual([{ id: 1, season_id: 's_1' }]);
  });

  it('rejects a collection that exceeds the synchronous row limit before serializing it', async () => {
    const pool = createPool((sql) => {
      if (sql.includes('FROM users')) return { rows: [{ id: 'u_1', email: 'user@example.com' }] };
      if (sql.includes('FROM chat_messages')) return { rows: [{ id: 'm_1' }, { id: 'm_2' }, { id: 'm_3' }] };
      return { rows: [] };
    });

    await expect(exportAccountData({ pool, userId: 'u_1', maxRowsPerCollection: 2 })).resolves.toEqual({
      ok: false,
      status: 413,
      error: 'Account export exceeds the synchronous row limit for chatMessages',
    });
  });

  it('anonymizes an account while retaining match referential integrity', async () => {
    const pool = createPool((sql) => {
      if (sql.includes('FROM account_deletion_requests')) return { rows: [] };
      if (sql.includes('FOR UPDATE')) return { rows: [{ id: 'u_1' }] };
      return { rows: [] };
    });

    await expect(deleteAccount({ pool, userId: 'u_1' })).resolves.toEqual({
      ok: true,
      body: { deleted: true },
    });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("nickname = 'Deleted Player'"),
      expect.arrayContaining(['u_1', expect.stringMatching(/^deleted\+[a-f0-9]{32}@invalid\.local$/)]),
    );
    expect(pool.query).not.toHaveBeenCalledWith(expect.stringContaining('DELETE FROM matches'), expect.anything());
    expect(pool.query).toHaveBeenCalledWith('DELETE FROM deck_reservations WHERE user_id = $1', ['u_1']);
    expect(pool.query).toHaveBeenCalledWith('DELETE FROM platform_match_participants WHERE user_id = $1', ['u_1']);
    expect(pool.query).toHaveBeenCalledWith('DELETE FROM platform_room_participants WHERE user_id = $1', ['u_1']);
    expect(pool.query).toHaveBeenCalledWith('DELETE FROM bjg_match_seats WHERE user_id = $1', ['u_1']);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE bjg_match_result_outbox'), ['u_1']);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE matches'), ['u_1']);
    expect(pool.query).toHaveBeenCalledWith('DELETE FROM season_reward_entitlements WHERE user_id = $1', ['u_1']);
    expect(pool.query).toHaveBeenCalledWith('DELETE FROM season_rewards WHERE user_id = $1', ['u_1']);
    expect(pool.query).toHaveBeenCalledWith('DELETE FROM season_ratings WHERE user_id = $1', ['u_1']);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE chat_messages'), ['u_1']);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE chat_reports'), ['u_1']);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('reviewer_user_id = CASE WHEN reviewer_user_id = $1 THEN NULL'),
      ['u_1'],
    );
    expect(pool.query).toHaveBeenCalledWith(
      'UPDATE chat_moderation_events SET actor_user_id = NULL WHERE actor_user_id = $1',
      ['u_1'],
    );
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE feedback_posts'), [
      'u_1',
      expect.stringMatching(/^deleted-[a-f0-9]{32}$/),
    ]);
    expect(pool.query).toHaveBeenCalledWith('DELETE FROM chat_read_states WHERE user_id = $1', ['u_1']);
  });

  it('does not erase an account protected by an active legal hold', async () => {
    const pool = createPool((sql) => {
      if (sql.includes('FROM users') && sql.includes('FOR UPDATE')) return { rows: [{ id: 'u_held' }] };
      if (sql.includes('FROM legal_holds')) return { rows: [{ id: 'legal_hold_1' }] };
      return { rows: [] };
    });

    await expect(deleteAccount({ pool, userId: 'u_held' })).resolves.toEqual({
      ok: false,
      status: 409,
      error: 'Account deletion is suspended by an active legal hold',
    });
    expect(pool.query).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(hashtext($1))', [
      'legal-hold:account:u_held',
    ]);
    expect(pool.query).not.toHaveBeenCalledWith(
      expect.stringContaining("nickname = 'Deleted Player'"),
      expect.anything(),
    );
  });

  it('blocks deletion when a related match is held even without an account hold', async () => {
    const pool = createPool((sql) => {
      if (sql.includes('FROM users') && sql.includes('FOR UPDATE')) return { rows: [{ id: 'u_match' }] };
      if (sql.includes('WITH account_objects')) {
        return { rows: [{ id: 'hold_match', subject_type: 'match', subject_id: 'm_1' }] };
      }
      return { rows: [] };
    });

    await expect(deleteAccount({ pool, userId: 'u_match' })).resolves.toEqual({
      ok: false,
      status: 409,
      error: 'Account deletion is suspended by an active legal hold',
    });
    expect(pool.query).not.toHaveBeenCalledWith(expect.stringContaining('DELETE FROM platform_match_participants'), [
      'u_match',
    ]);
  });

  it('serializes deletion with retention and revokes sessions after hold checks', async () => {
    const order: string[] = [];
    const pool = createPool((sql) => {
      order.push(sql);
      if (sql.includes('FROM users') && sql.includes('FOR UPDATE')) return { rows: [{ id: 'u_1' }] };
      return { rows: [] };
    });
    const beforeDelete = vi.fn(async () => {
      order.push('beforeDelete');
    });

    await expect(deleteAccount({ pool, userId: 'u_1', beforeDelete })).resolves.toMatchObject({
      ok: true,
      body: { deleted: true },
    });
    expect(beforeDelete).toHaveBeenCalledOnce();
    expect(order.indexOf('SELECT pg_advisory_xact_lock(hashtext($1))')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('beforeDelete')).toBeLessThan(
      order.findIndex((sql) => sql.includes('DELETE FROM user_identities')),
    );
    expect(pool.query).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(hashtext($1))', [
      'zutomayo:retention-job:v1',
    ]);
    expect(pool.query).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(hashtext($1))', ['legal-hold:account:u_1']);
  });

  it('does not bypass an in-flight provider deletion saga', async () => {
    const pool = createPool((sql) => {
      if (sql.includes('FROM users') && sql.includes('FOR UPDATE')) return { rows: [{ id: 'u_1' }] };
      if (sql.includes('FROM account_deletion_requests')) {
        return { rows: [{ id: 'delete_1', status: 'provider_deleted' }] };
      }
      return { rows: [] };
    });

    await expect(deleteAccount({ pool, userId: 'u_1' })).resolves.toEqual({
      ok: false,
      status: 409,
      error: 'Account deletion is already in progress; complete the provider deletion first',
    });
    expect(pool.query).not.toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM user_identities'),
      expect.anything(),
    );
  });

  it('finishes a provider-deleted saga with local anonymization atomically', async () => {
    const pool = createPool((sql) => {
      if (sql.includes('FROM users') && sql.includes('FOR UPDATE')) return { rows: [{ id: 'u_1' }] };
      if (sql.includes('FROM account_deletion_requests') && sql.includes('WHERE id = $1 AND user_id = $2')) {
        return { rows: [{ id: 'delete_1', user_id: 'u_1', provider: 'logto', status: 'provider_deleted' }] };
      }
      return { rows: [] };
    });

    await expect(deleteAccount({ pool, userId: 'u_1', deletionRequestId: 'delete_1' })).resolves.toEqual({
      ok: true,
      body: { deleted: true },
    });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("SET status = 'completed'"), ['delete_1', 'u_1']);
    expect(pool.query).toHaveBeenCalledWith('COMMIT');
  });

  it('requires provider_deleted before completing a deletion saga', async () => {
    const pool = createPool((sql) => {
      if (sql.includes('FROM users') && sql.includes('FOR UPDATE')) return { rows: [{ id: 'u_1' }] };
      if (sql.includes('FROM account_deletion_requests') && sql.includes('WHERE id = $1 AND user_id = $2')) {
        return { rows: [{ id: 'delete_1', user_id: 'u_1', provider: 'logto', status: 'provider_deleting' }] };
      }
      return { rows: [] };
    });

    await expect(deleteAccount({ pool, userId: 'u_1', deletionRequestId: 'delete_1' })).resolves.toEqual({
      ok: false,
      status: 409,
      error: 'Account provider deletion has not completed',
    });
    expect(pool.query).not.toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM user_identities'),
      expect.anything(),
    );
  });
});
