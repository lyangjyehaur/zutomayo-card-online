import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
type MutationResult = {
  ok: boolean;
  status?: number;
  error?: string;
  body?: Record<string, unknown>;
};
type QueryResult = { rows: Record<string, unknown>[]; rowCount?: number };

const { addComment, createPost, getPost, listPosts, toggleCommentReaction, toggleCommentVote, toggleVote } =
  require('../feedbackService.cjs') as {
    addComment: (input: Record<string, unknown>) => Promise<MutationResult>;
    createPost: (input: Record<string, unknown>) => Promise<MutationResult>;
    listPosts: (input: Record<string, unknown>) => Promise<{ body: { posts: Array<{ anonymousId: string | null }> } }>;
    getPost: (input: Record<string, unknown>) => Promise<{
      body: { anonymousId: string | null; comments: Array<{ anonymousId: string | null }> };
    }>;
    toggleCommentReaction: (input: Record<string, unknown>) => Promise<MutationResult>;
    toggleCommentVote: (input: Record<string, unknown>) => Promise<MutationResult>;
    toggleVote: (input: Record<string, unknown>) => Promise<MutationResult>;
  };

const ACCOUNT_ROW_LOCK_SQL = 'SELECT id, deleted_at, elo, match_count, wins FROM users WHERE id = $1 FOR UPDATE';
const anonymousId = '0123456789abcdef0123456789abcdef';
const sanitizeText = (value: unknown, limit: number) => String(value || '').slice(0, limit);
const postRow = {
  id: 'fb_1',
  title: 'Feedback',
  description: 'Details',
  status: 'open',
  anonymous_id: anonymousId,
  vote_count: '1',
  comment_count: '1',
};
const commentRow = {
  id: 'fc_1',
  post_id: 'fb_1',
  content: 'Comment',
  anonymous_id: anonymousId,
  vote_count: '0',
};

function connectedPool(handler: (sql: string, params?: unknown[]) => Promise<QueryResult>) {
  const client = { query: vi.fn(handler), release: vi.fn() };
  return {
    client,
    pool: { query: vi.fn(), connect: vi.fn(async () => client) },
  };
}

const authenticatedMutations: Array<
  [name: string, mutate: (pool: unknown) => Promise<MutationResult>, expectedWrite: string]
> = [
  [
    'post creation',
    (pool) =>
      createPost({
        pool,
        voter: { userId: 'u_1' },
        body: { title: 'Feedback', description: 'Details' },
        sanitizeText,
        generateId: () => 'fb_new',
      }),
    'INSERT INTO feedback_posts',
  ],
  [
    'post voting',
    (pool) => toggleVote({ pool, voter: { userId: 'u_1' }, postId: 'fb_1' }),
    'INSERT INTO feedback_votes',
  ],
  [
    'comment creation',
    (pool) =>
      addComment({
        pool,
        voter: { userId: 'u_1' },
        postId: 'fb_1',
        body: { content: 'Comment' },
        sanitizeText,
        generateId: () => 'fc_new',
        isOfficial: false,
      }),
    'INSERT INTO feedback_comments',
  ],
  [
    'comment voting',
    (pool) => toggleCommentVote({ pool, voter: { userId: 'u_1' }, commentId: 'fc_1' }),
    'INSERT INTO feedback_comment_votes',
  ],
  [
    'comment reactions',
    (pool) => toggleCommentReaction({ pool, voter: { userId: 'u_1' }, commentId: 'fc_1', emoji: '\u{1F44D}' }),
    'INSERT INTO feedback_comment_reactions',
  ],
];

function liveMutationResult(sql: string, params?: unknown[]): Promise<QueryResult> {
  if (sql === ACCOUNT_ROW_LOCK_SQL) {
    return Promise.resolve({ rows: [{ id: params?.[0], deleted_at: null }], rowCount: 1 });
  }
  if (sql.startsWith('INSERT INTO feedback_posts')) {
    return Promise.resolve({ rows: [{ ...postRow, id: 'fb_new', author_user_id: 'u_1' }], rowCount: 1 });
  }
  if (sql.startsWith('INSERT INTO feedback_comments')) {
    return Promise.resolve({ rows: [{ ...commentRow, id: 'fc_new', author_user_id: 'u_1' }], rowCount: 1 });
  }
  if (sql.startsWith('SELECT id, status FROM feedback_posts')) {
    return Promise.resolve({ rows: [{ id: 'fb_1', status: 'open' }], rowCount: 1 });
  }
  if (sql.startsWith('SELECT id FROM feedback_posts')) {
    return Promise.resolve({ rows: [{ id: 'fb_1' }], rowCount: 1 });
  }
  if (sql.startsWith('SELECT id FROM feedback_comments')) {
    return Promise.resolve({ rows: [{ id: 'fc_1' }], rowCount: 1 });
  }
  return Promise.resolve({ rows: [], rowCount: 1 });
}

describe('anonymous feedback capabilities', () => {
  it('does not expose an anonymous author capability in public post lists', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [postRow] })) };
    const publicResult = await listPosts({ pool });
    expect(publicResult.body.posts[0].anonymousId).toBeNull();

    const ownerResult = await listPosts({ pool, voter: { anonymousId } });
    expect(ownerResult.body.posts[0].anonymousId).toBe(anonymousId);
  });

  it('returns post and comment capabilities only to the matching anonymous browser', async () => {
    const publicPool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [postRow] })
        .mockResolvedValueOnce({ rows: [commentRow] })
        .mockResolvedValueOnce({ rows: [] }),
    };
    const publicResult = await getPost({ pool: publicPool, postId: 'fb_1' });
    expect(publicResult.body.anonymousId).toBeNull();
    expect(publicResult.body.comments[0].anonymousId).toBeNull();

    const ownerPool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [postRow] })
        .mockResolvedValueOnce({ rows: [commentRow] })
        .mockResolvedValueOnce({ rows: [] }),
    };
    const ownerResult = await getPost({ pool: ownerPool, voter: { anonymousId }, postId: 'fb_1' });
    expect(ownerResult.body.anonymousId).toBe(anonymousId);
    expect(ownerResult.body.comments[0].anonymousId).toBe(anonymousId);
  });
});

describe('feedback account mutation fence', () => {
  it.each(authenticatedMutations)(
    'pins authenticated %s to one live-account transaction',
    async (_name, mutate, write) => {
      const { pool, client } = connectedPool(liveMutationResult);

      await expect(mutate(pool)).resolves.toMatchObject({ ok: true });

      expect(pool.query).not.toHaveBeenCalled();
      expect(client.query).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(hashtext($1))', [
        'legal-hold:account:u_1',
      ]);
      expect(client.query.mock.calls.some(([sql]) => String(sql).startsWith(write))).toBe(true);
      expect(client.query).toHaveBeenLastCalledWith('COMMIT');
      expect(client.release).toHaveBeenCalledOnce();
    },
  );

  it.each(authenticatedMutations)('rejects authenticated %s after account deletion', async (_name, mutate) => {
    const { pool, client } = connectedPool(async (sql, params) => {
      if (sql === ACCOUNT_ROW_LOCK_SQL) {
        return { rows: [{ id: params?.[0], deleted_at: '2026-07-15T00:00:00.000Z' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });

    await expect(mutate(pool)).resolves.toEqual({
      ok: false,
      status: 409,
      error: 'Account is deleted or unavailable',
    });
    expect(client.query.mock.calls.some(([sql]) => /^(?:INSERT|UPDATE|DELETE)\b/.test(String(sql)))).toBe(false);
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('keeps anonymous post creation atomic without acquiring an account lock', async () => {
    const { pool, client } = connectedPool(async (sql) => {
      if (sql.startsWith('INSERT INTO feedback_posts')) {
        return { rows: [{ ...postRow, id: 'fb_anon', anonymous_id: anonymousId }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });

    await expect(
      createPost({
        pool,
        voter: { anonymousId },
        body: { title: 'Anonymous feedback', description: 'Details' },
        sanitizeText,
        generateId: () => 'fb_anon',
      }),
    ).resolves.toMatchObject({ ok: true, body: { id: 'fb_anon', anonymousId } });

    expect(pool.query).not.toHaveBeenCalled();
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('pg_advisory_xact_lock'))).toBe(false);
    expect(client.query.mock.calls.map(([sql]) => String(sql))).toEqual([
      'BEGIN',
      expect.stringContaining('INSERT INTO feedback_posts'),
      expect.stringContaining('INSERT INTO feedback_votes'),
      'COMMIT',
    ]);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('rolls back an anonymous post when its automatic vote fails', async () => {
    const { pool, client } = connectedPool(async (sql) => {
      if (sql.startsWith('INSERT INTO feedback_posts')) {
        return { rows: [{ ...postRow, id: 'fb_anon', anonymous_id: anonymousId }], rowCount: 1 };
      }
      if (sql.startsWith('INSERT INTO feedback_votes')) throw new Error('vote failed');
      return { rows: [], rowCount: 1 };
    });

    await expect(
      createPost({
        pool,
        voter: { anonymousId },
        body: { title: 'Anonymous feedback', description: 'Details' },
        sanitizeText,
        generateId: () => 'fb_anon',
      }),
    ).rejects.toThrow('vote failed');
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledOnce();
  });
});
