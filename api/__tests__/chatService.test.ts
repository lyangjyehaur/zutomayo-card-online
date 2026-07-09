import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

type QueryResult = { rows: Array<Record<string, unknown>>; rowCount?: number };
type PoolLike = {
  query: ReturnType<typeof vi.fn<(sql: string, params?: unknown[]) => Promise<QueryResult>>>;
};

const require = createRequire(import.meta.url);
const {
  canAccessConversation,
  conversationKey,
  listChatMessages,
  markConversationRead,
  reportChatMessage,
  sendChatMessage,
} = require('../chatService.cjs') as {
  canAccessConversation: (userId: string, type: unknown, subjectId: unknown) => boolean;
  conversationKey: (type: unknown, subjectId: unknown) => string | null;
  listChatMessages: (input: {
    pool: PoolLike;
    userId: string;
    conversationType: unknown;
    subjectId: unknown;
    limit?: unknown;
    before?: unknown;
  }) => Promise<Record<string, unknown>>;
  markConversationRead: (input: { pool: PoolLike; userId: string; body: Record<string, unknown> }) => Promise<{
    ok: boolean;
    body?: Record<string, unknown>;
  }>;
  reportChatMessage: (input: {
    pool: PoolLike;
    reporterUserId: string;
    messageId: string;
    body: Record<string, unknown>;
    sanitizeText: (value: unknown, maxLen?: number) => string;
    generateReportId: () => string;
  }) => Promise<Record<string, unknown>>;
  sendChatMessage: (input: {
    pool: PoolLike;
    authorUserId: string;
    body: Record<string, unknown>;
    sanitizeText: (value: unknown, maxLen?: number) => string;
    generateMessageId: () => string;
  }) => Promise<Record<string, unknown>>;
};

const sanitizeText = (value: unknown, maxLen = 60) =>
  (typeof value === 'string' ? value : '').slice(0, maxLen).replace(/[<>]/g, '');

function poolWithResults(results: QueryResult[]): PoolLike {
  const queue = [...results];
  return {
    query: vi.fn(async () => queue.shift() ?? { rows: [] }),
  };
}

const conversationRow = {
  id: 'match:bgio-match-1',
  type: 'match',
  subject_id: 'bgio-match-1',
  title: '',
  status: 'active',
  created_at: '2026-07-10T00:00:00.000Z',
  updated_at: '2026-07-10T00:00:00.000Z',
};

const messageRow = {
  id: 'chat_msg_1',
  conversation_id: 'match:bgio-match-1',
  author_user_id: 'u_1',
  author_display_name: 'Alice',
  author_role: 'player',
  content: 'hello',
  source_language: 'zh-tw',
  moderation_status: 'visible',
  moderation_reason: '',
  metadata: { clientMessageId: 'client-1', transport: 'api' },
  created_at: '2026-07-10T00:00:01.000Z',
  edited_at: null,
  deleted_at: null,
};

describe('chat service', () => {
  it('builds stable conversation keys for durable chat scopes', () => {
    expect(conversationKey('match', ' bgio-match-1 ')).toBe('match:bgio-match-1');
    expect(conversationKey('direct', 'u_1:u_2')).toBe('direct:u_1:u_2');
    expect(conversationKey('unknown', 'x')).toBeNull();
    expect(conversationKey('match', '')).toBeNull();
  });

  it('requires direct chat participants to include the current user', () => {
    expect(canAccessConversation('u_1', 'direct', 'u_1:u_2')).toBe(true);
    expect(canAccessConversation('u_3', 'direct', 'u_1:u_2')).toBe(false);
    expect(canAccessConversation('u_3', 'match', 'bgio-match-1')).toBe(true);
  });

  it('rejects direct chat writes from non-participants', async () => {
    const pool = poolWithResults([]);

    await expect(
      sendChatMessage({
        pool,
        authorUserId: 'u_3',
        body: {
          conversationType: 'direct',
          subjectId: 'u_1:u_2',
          content: 'hello',
        },
        sanitizeText,
        generateMessageId: () => 'chat_msg_1',
      }),
    ).resolves.toEqual({ ok: false, status: 403, error: 'Forbidden' });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('persists messages after upserting the conversation', async () => {
    const pool = poolWithResults([{ rows: [conversationRow] }, { rows: [messageRow] }, { rows: [] }]);

    await expect(
      sendChatMessage({
        pool,
        authorUserId: 'u_1',
        body: {
          conversationType: 'match',
          subjectId: 'bgio-match-1',
          content: '<hello>',
          authorDisplayName: 'Alice',
          authorRole: 'player',
          clientMessageId: 'client-1',
          sourceLanguage: 'zh-TW',
        },
        sanitizeText,
        generateMessageId: () => 'chat_msg_1',
      }),
    ).resolves.toEqual({
      ok: true,
      body: {
        conversation: expect.objectContaining({ id: 'match:bgio-match-1', type: 'match' }),
        message: expect.objectContaining({
          id: 'chat_msg_1',
          content: 'hello',
          authorRole: 'player',
          sourceLanguage: 'zh-tw',
        }),
      },
    });

    expect(pool.query).toHaveBeenNthCalledWith(1, expect.stringContaining('INSERT INTO chat_conversations'), [
      'match:bgio-match-1',
      'match',
      'bgio-match-1',
      '',
    ]);
    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO chat_messages'),
      expect.arrayContaining(['chat_msg_1', 'match:bgio-match-1', 'u_1', 'Alice', 'player', 'hello', 'zh-tw']),
    );
  });

  it('lists visible chat history in chronological order for sync', async () => {
    const pool = poolWithResults([
      {
        rows: [{ ...messageRow, id: 'chat_msg_2', created_at: '2026-07-10T00:00:02.000Z' }, messageRow],
      },
    ]);

    await expect(
      listChatMessages({
        pool,
        userId: 'u_1',
        conversationType: 'match',
        subjectId: 'bgio-match-1',
        limit: '999',
      }),
    ).resolves.toEqual({
      ok: true,
      body: {
        messages: [expect.objectContaining({ id: 'chat_msg_1' }), expect.objectContaining({ id: 'chat_msg_2' })],
      },
    });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("moderation_status IN ('visible', 'pending_review')"),
      ['match:bgio-match-1', 200],
    );
  });

  it('marks a conversation read for unread counters', async () => {
    const pool = poolWithResults([{ rows: [] }]);

    await expect(
      markConversationRead({
        pool,
        userId: 'u_1',
        body: { conversationType: 'match', subjectId: 'bgio-match-1', lastReadMessageId: 'chat_msg_1' },
      }),
    ).resolves.toEqual({ ok: true, body: { ok: true } });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO chat_read_states'), [
      'match:bgio-match-1',
      'u_1',
      'chat_msg_1',
    ]);
  });

  it('creates reports against the original message for evidence review', async () => {
    const reportRow = {
      id: 'chat_report_1',
      message_id: 'chat_msg_1',
      conversation_id: 'match:bgio-match-1',
      reporter_user_id: 'u_2',
      reason: 'spam',
      note: 'too much',
      status: 'open',
      reviewer_user_id: null,
      resolution_note: '',
      created_at: '2026-07-10T00:00:03.000Z',
      reviewed_at: null,
    };
    const pool = poolWithResults([
      { rows: [{ id: 'chat_msg_1', conversation_id: 'match:bgio-match-1' }] },
      { rows: [reportRow] },
    ]);

    await expect(
      reportChatMessage({
        pool,
        reporterUserId: 'u_2',
        messageId: 'chat_msg_1',
        body: { reason: 'spam', note: '<too much>' },
        sanitizeText,
        generateReportId: () => 'chat_report_1',
      }),
    ).resolves.toEqual({
      ok: true,
      body: {
        report: expect.objectContaining({
          id: 'chat_report_1',
          messageId: 'chat_msg_1',
          conversationId: 'match:bgio-match-1',
          note: 'too much',
        }),
      },
    });
  });
});
