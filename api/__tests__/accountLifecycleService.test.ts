import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  backfillLegacyDeletedAccount,
  deleteAccount,
  exportAccountData,
  hashAccountToken,
  requestEmailVerification,
  requestPasswordReset,
  resetPassword,
  verifyEmailToken,
} = require('../accountLifecycleService.cjs') as {
  backfillLegacyDeletedAccount: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
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
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('identity_anonymized_at = NOW()'),
      expect.arrayContaining(['u_1']),
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
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE season_match_results'), ['u_1']);
    expect(pool.query).toHaveBeenCalledWith('SELECT public.zutomayo_anonymize_account_export_audit($1)', ['u_1']);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE account_export_jobs'), ['u_1']);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM chat_message_translations'), ['u_1']);
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
      expect.stringMatching(/^deleted-feedback-[a-f0-9]{32}$/),
    ]);
    expect(pool.query).toHaveBeenCalledWith('DELETE FROM chat_read_states WHERE user_id = $1', ['u_1']);
    expect(pool.query).toHaveBeenCalledWith('DELETE FROM chat_user_sanctions WHERE target_user_id = $1', ['u_1']);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE legal_hold_objects'), [
      'u_1',
      expect.stringMatching(/^deleted-hold-[a-f0-9]{32}$/),
    ]);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE account_deletion_requests'), [
      'u_1',
      expect.stringMatching(/^deleted-request-[a-f0-9]{32}$/),
      expect.stringMatching(/^deleted-provider-[a-f0-9]{32}$/),
    ]);
    expect(pool.query).toHaveBeenCalledWith(
      'SELECT public.zutomayo_anonymize_admin_audit_identity($1, $2) AS affected',
      ['u_1', expect.stringMatching(/^deleted-admin-audit-[a-f0-9]{32}$/)],
    );
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("idempotency_key = 'redacted:' || event_id"), [
      'u_1',
    ]);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO relationship_change_outbox'),
      expect.arrayContaining([expect.stringMatching(/^[a-f0-9]{64}$/), 'account_deleted', ['u_1']]),
    );

    const usersUpdate = pool.query.mock.calls.find(([sql]) => String(sql).includes("nickname = 'Deleted Player'"));
    const feedbackUpdate = pool.query.mock.calls.find(([sql]) => String(sql).includes('UPDATE feedback_posts'));
    const holdObjectUpdate = pool.query.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE legal_hold_objects AS object'),
    );
    const deletionRequestUpdate = pool.query.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE account_deletion_requests'),
    );
    const adminAuditCall = pool.query.mock.calls.find(([sql]) =>
      String(sql).includes('zutomayo_anonymize_admin_audit_identity'),
    );
    const usersUpdateIndex = pool.query.mock.calls.findIndex(([sql]) =>
      String(sql).includes("nickname = 'Deleted Player'"),
    );
    const exportAuditIndex = pool.query.mock.calls.findIndex(([sql]) =>
      String(sql).includes('zutomayo_anonymize_account_export_audit'),
    );
    const adminAuditIndex = pool.query.mock.calls.findIndex(([sql]) =>
      String(sql).includes('zutomayo_anonymize_admin_audit_identity'),
    );
    expect(usersUpdateIndex).toBeGreaterThanOrEqual(0);
    expect(usersUpdateIndex).toBeLessThan(exportAuditIndex);
    expect(usersUpdateIndex).toBeLessThan(adminAuditIndex);
    const persistedRefs = [
      usersUpdate?.[1]?.[1],
      feedbackUpdate?.[1]?.[1],
      holdObjectUpdate?.[1]?.[1],
      deletionRequestUpdate?.[1]?.[1],
      deletionRequestUpdate?.[1]?.[2],
      adminAuditCall?.[1]?.[1],
    ];
    expect(persistedRefs.every((value) => typeof value === 'string' && value.length > 0)).toBe(true);
    expect(new Set(persistedRefs).size).toBe(persistedRefs.length);
  });

  it('structurally anonymizes arbitrary game JSON and rekeys direct conversation primary/foreign keys', async () => {
    const pool = createPool((sql) => {
      if (sql.includes('FROM account_deletion_requests')) return { rows: [] };
      if (sql.includes('FROM bjg_matches AS m') && sql.includes('FOR UPDATE OF m')) {
        return {
          rows: [
            {
              match_id: 'bg_1',
              state: {
                _stateID: 4,
                G: {
                  step: 'turnSet',
                  [`owner:u_1`]: { userId: 'u_1' },
                  composite: 'actor:u_1:turn',
                },
                ctx: { turn: 2 },
              },
              initial_state: {
                _stateID: 0,
                G: { step: 'janken', owner: 'u_1' },
                ctx: { turn: 0 },
              },
              metadata: {
                gameName: 'zutomayo',
                players: {
                  0: {
                    id: 0,
                    name: 'Player u_1',
                    credentials: 'credential:u_1',
                    data: { userId: 'u_1' },
                    isConnected: true,
                  },
                  1: { id: 1, name: 'Peer', data: { userId: 'u_2' } },
                },
                setupData: { 'deck:u_1': 'reservation:u_1' },
              },
              log: [{ action: { payload: { actorUserId: 'u_1' } } }],
              deleted_player_ids: ['0'],
            },
            {
              match_id: 'bg_2',
              state: { _stateID: 8, G: { step: 'gameOver', winner: 'u_1' }, ctx: { turn: 4 } },
              initial_state: { _stateID: 0, G: { step: 'janken', userId: 'u_1' }, ctx: { turn: 0 } },
              metadata: {
                gameName: 'zutomayo',
                players: {
                  0: { id: 0, name: 'Peer' },
                  1: { id: 1, name: 'u_1', credentials: 'u_1-secret', data: { userId: 'u_1' } },
                },
              },
              log: [{ actor: 'turn:u_1:final' }],
              deleted_player_ids: ['1'],
            },
          ],
        };
      }
      if (sql.includes('FROM chat_conversations') && sql.includes("type = 'direct'")) {
        return {
          rows: [
            {
              id: 'direct:v1:u_1:u_2',
              subject_id: 'v1:u_1:u_2',
              title: 'private',
              status: 'active',
              created_at: '2026-07-13T00:00:00.000Z',
            },
          ],
        };
      }
      if (sql.includes('FROM legal_holds') && sql.includes('released_at')) return { rows: [] };
      if (sql.includes('FROM admin_audit_log')) return { rows: [] };
      if (sql.includes('FOR UPDATE')) return { rows: [{ id: 'u_1' }] };
      return { rows: [] };
    });

    await expect(deleteAccount({ pool, userId: 'u_1' })).resolves.toMatchObject({ ok: true });

    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('FOR UPDATE OF m'), ['u_1']);
    const boardgameUpdates = pool.query.mock.calls.filter(([sql]) => String(sql).includes('SET state = $2::jsonb'));
    expect(boardgameUpdates).toHaveLength(2);
    const boardgameRefs = new Set<string>();
    for (const [, params] of boardgameUpdates) {
      const serialized = JSON.stringify(params);
      expect(serialized).not.toContain('u_1');
      expect(params?.slice(1)).not.toContain(null);
      const refs = serialized.match(/deleted-boardgame-[a-f0-9]{32}/g) ?? [];
      expect(new Set(refs).size).toBe(1);
      boardgameRefs.add(refs[0]);
    }
    expect(boardgameRefs.size).toBe(2);

    const firstBoardgameUpdate = boardgameUpdates.find(([, params]) => params?.[0] === 'bg_1');
    const firstState = JSON.parse(String(firstBoardgameUpdate?.[1]?.[1])) as Record<string, unknown>;
    const firstInitialState = JSON.parse(String(firstBoardgameUpdate?.[1]?.[2])) as Record<string, unknown>;
    const firstMetadata = JSON.parse(String(firstBoardgameUpdate?.[1]?.[3])) as {
      players: Record<string, Record<string, unknown>>;
    };
    expect(firstState).toMatchObject({ _stateID: 4, G: { step: 'turnSet' }, ctx: { turn: 2 } });
    expect(firstInitialState).toMatchObject({ _stateID: 0, G: { step: 'janken' }, ctx: { turn: 0 } });
    expect(firstMetadata.players['0']).toEqual({ id: 0, isConnected: true });
    expect(firstMetadata.players['1']).toEqual({ id: 1, name: 'Peer', data: { userId: 'u_2' } });
    expect(firstMetadata).toMatchObject({ accountDeletionLocked: true });
    expect(Object.keys((firstState.G ?? {}) as Record<string, unknown>)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^owner:deleted-boardgame-[a-f0-9]{32}$/)]),
    );
    const conversationInsert = pool.query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO chat_conversations'),
    );
    expect(conversationInsert?.[1]?.[0]).toMatch(
      /^direct:v1:(deleted-conversation-[a-f0-9]{32}:u_2|u_2:deleted-conversation-[a-f0-9]{32})$/,
    );
    expect(JSON.stringify(conversationInsert?.[1])).not.toContain('u_1');
    for (const tableName of [
      'chat_messages',
      'chat_read_states',
      'chat_reports',
      'chat_moderation_events',
      'chat_user_sanctions',
    ]) {
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining(`UPDATE ${tableName} SET conversation_id`),
        expect.arrayContaining(['direct:v1:u_1:u_2', expect.stringMatching(/^direct:v1:/)]),
      );
    }
    expect(pool.query).toHaveBeenCalledWith('DELETE FROM chat_conversations WHERE id = $1', ['direct:v1:u_1:u_2']);
  });

  it('clears a legacy metadata identity when no durable seat row exists', async () => {
    const pool = createPool((sql) => {
      if (sql.includes('FROM account_deletion_requests')) return { rows: [] };
      if (sql.includes('FROM bjg_matches AS m') && sql.includes('FOR UPDATE OF m')) {
        return {
          rows: [
            {
              match_id: 'bg_legacy_no_seat',
              state: { _stateID: 2, G: { step: 'turnSet' }, ctx: { turn: 1 } },
              initial_state: { _stateID: 0, G: { step: 'janken' }, ctx: { turn: 0 } },
              metadata: {
                gameName: 'zutomayo',
                players: {
                  0: {
                    id: 0,
                    name: 'Legacy Player',
                    credentials: 'legacy-secret',
                    data: { userId: 'u_legacy', identitySource: 'server', rankedEligible: true },
                    isConnected: false,
                  },
                  1: {
                    id: 1,
                    name: 'Peer',
                    credentials: 'peer-secret',
                    data: { userId: 'u_peer', identitySource: 'server' },
                    isConnected: true,
                  },
                },
              },
              log: [],
              deleted_player_ids: [],
            },
          ],
        };
      }
      if (sql.includes('FROM chat_conversations') && sql.includes("type = 'direct'")) return { rows: [] };
      if (sql.includes('FROM legal_holds') && sql.includes('released_at')) return { rows: [] };
      if (sql.includes('FROM users') && sql.includes('FOR UPDATE')) return { rows: [{ id: 'u_legacy' }] };
      return { rows: [] };
    });

    await expect(deleteAccount({ pool, userId: 'u_legacy' })).resolves.toMatchObject({ ok: true });

    const update = pool.query.mock.calls.find(([sql]) => String(sql).includes('SET state = $2::jsonb'));
    const metadata = JSON.parse(String(update?.[1]?.[3])) as {
      accountDeletionLocked?: boolean;
      players: Record<string, Record<string, unknown>>;
    };
    expect(metadata.accountDeletionLocked).toBe(true);
    expect(metadata.players['0']).toEqual({ id: 0, isConnected: false });
    expect(metadata.players['1']).toEqual({
      id: 1,
      name: 'Peer',
      credentials: 'peer-secret',
      data: { userId: 'u_peer', identitySource: 'server' },
      isConnected: true,
    });
    expect(JSON.stringify(metadata)).not.toContain('u_legacy');
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

  it('rolls account deletion back when the durable revocation event cannot be enqueued', async () => {
    const pool = createPool((sql) => {
      if (sql.includes('FROM users') && sql.includes('FOR UPDATE')) return { rows: [{ id: 'u_1' }] };
      if (sql.includes('INSERT INTO relationship_change_outbox')) throw new Error('outbox unavailable');
      return { rows: [] };
    });

    await expect(deleteAccount({ pool, userId: 'u_1' })).rejects.toThrow('outbox unavailable');
    expect(pool.query).toHaveBeenCalledWith('ROLLBACK');
    expect(pool.query).not.toHaveBeenCalledWith('COMMIT');
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

  it('backfills only an existing deleted tombstone without emitting a second deletion event', async () => {
    const pool = createPool((sql) => {
      if (sql.includes('FROM users') && sql.includes('deleted_at IS NOT NULL')) {
        return { rows: [{ id: 'u_legacy_deleted' }] };
      }
      return { rows: [] };
    });

    await expect(backfillLegacyDeletedAccount({ pool, userId: 'u_legacy_deleted' })).resolves.toEqual({
      ok: true,
      body: { deleted: true },
    });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('identity_anonymized_at = NOW()'),
      expect.arrayContaining(['u_legacy_deleted']),
    );
    expect(pool.query).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO relationship_change_outbox'),
      expect.anything(),
    );
    expect(pool.query.mock.calls.some(([sql]) => String(sql).includes('FROM account_deletion_requests'))).toBe(false);
    expect(pool.query).toHaveBeenCalledWith('COMMIT');
  });

  it('rejects a live account passed to the legacy tombstone backfill', async () => {
    const pool = createPool(() => ({ rows: [] }));

    await expect(backfillLegacyDeletedAccount({ pool, userId: 'u_live' })).resolves.toEqual({
      ok: false,
      status: 404,
      error: 'Legacy deleted account not found',
    });
    expect(pool.query).not.toHaveBeenCalledWith(
      expect.stringContaining("nickname = 'Deleted Player'"),
      expect.anything(),
    );
  });

  it('treats a tombstone completed by a concurrent backfill as an idempotent no-op', async () => {
    const pool = createPool((sql) => {
      if (sql.includes('FROM users') && sql.includes('deleted_at IS NOT NULL')) {
        return { rows: [{ id: 'u_already_backfilled', identity_anonymized_at: '2026-07-17T00:00:00.000Z' }] };
      }
      return { rows: [] };
    });

    await expect(backfillLegacyDeletedAccount({ pool, userId: 'u_already_backfilled' })).resolves.toEqual({
      ok: true,
      body: { deleted: true, alreadyBackfilled: true },
    });
    expect(pool.query).not.toHaveBeenCalledWith(
      expect.stringContaining("nickname = 'Deleted Player'"),
      expect.anything(),
    );
    expect(pool.query).toHaveBeenCalledWith('COMMIT');
  });

  it('keeps a legacy tombstone pending when any related evidence is under legal hold', async () => {
    const pool = createPool((sql) => {
      if (sql.includes('FROM users') && sql.includes('deleted_at IS NOT NULL')) {
        return { rows: [{ id: 'u_legacy_held' }] };
      }
      if (sql.includes('WITH account_objects')) return { rows: [{ id: 'hold_legacy' }] };
      return { rows: [] };
    });

    await expect(backfillLegacyDeletedAccount({ pool, userId: 'u_legacy_held' })).resolves.toEqual({
      ok: false,
      status: 409,
      error: 'Account deletion is suspended by an active legal hold',
    });
    expect(pool.query).not.toHaveBeenCalledWith(
      expect.stringContaining("nickname = 'Deleted Player'"),
      expect.anything(),
    );
  });

  it('uses a caller-owned lease client for local anonymization without reconnecting or releasing it', async () => {
    const connect = vi.fn(async () => {
      throw new Error('lease client must not be reconnected');
    });
    const release = vi.fn(() => {
      throw new Error('lease client must not be released by the nested transaction');
    });
    const client = {
      connect,
      release,
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM users') && sql.includes('FOR UPDATE')) return { rows: [{ id: 'u_1' }] };
        if (sql.includes('FROM account_deletion_requests') && sql.includes('WHERE id = $1 AND user_id = $2')) {
          return { rows: [{ id: 'delete_1', user_id: 'u_1', provider: 'logto', status: 'provider_deleted' }] };
        }
        return { rows: [] };
      }),
    };
    await expect(deleteAccount({ pool: client, userId: 'u_1', deletionRequestId: 'delete_1' })).resolves.toEqual({
      ok: true,
      body: { deleted: true },
    });
    expect(connect).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenCalledWith('BEGIN');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
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
