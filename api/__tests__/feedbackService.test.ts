import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { listPosts, getPost } = require('../feedbackService.cjs') as {
  listPosts: (input: Record<string, unknown>) => Promise<{ body: { posts: Array<{ anonymousId: string | null }> } }>;
  getPost: (input: Record<string, unknown>) => Promise<{
    body: { anonymousId: string | null; comments: Array<{ anonymousId: string | null }> };
  }>;
};

const anonymousId = '0123456789abcdef0123456789abcdef';
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
