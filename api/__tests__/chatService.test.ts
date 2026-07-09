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
  evaluateChatModeration,
  listChatMessages,
  listChatReports,
  listUnreadChat,
  markConversationRead,
  reportChatMessage,
  requestChatTranslation,
  sendChatMessage,
} = require('../chatService.cjs') as {
  canAccessConversation: (userId: string, type: unknown, subjectId: unknown) => boolean;
  conversationKey: (type: unknown, subjectId: unknown) => string | null;
  evaluateChatModeration: (
    content: string,
    rules?: { blockedWords?: string[]; reviewWords?: string[] },
  ) => { status: string; action: string; reason: string; matchedWords: string[] };
  listChatMessages: (input: {
    pool: PoolLike;
    userId: string;
    conversationType: unknown;
    subjectId: unknown;
    limit?: unknown;
    before?: unknown;
  }) => Promise<Record<string, unknown>>;
  listChatReports: (input: { pool: PoolLike; status?: unknown; limit?: unknown }) => Promise<Record<string, unknown>>;
  listUnreadChat: (input: { pool: PoolLike; userId: string; limit?: unknown }) => Promise<Record<string, unknown>>;
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
  requestChatTranslation: (input: {
    pool: PoolLike;
    userId: string;
    messageId: string;
    body: Record<string, unknown>;
    sanitizeText: (value: unknown, maxLen?: number) => string;
    translateText?: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
    providerName?: string;
    modelName?: string;
  }) => Promise<Record<string, unknown>>;
  sendChatMessage: (input: {
    pool: PoolLike;
    authorUserId: string;
    body: Record<string, unknown>;
    sanitizeText: (value: unknown, maxLen?: number) => string;
    generateMessageId: () => string;
    generateModerationEventId?: () => string;
    moderationRules?: { blockedWords?: string[]; reviewWords?: string[] };
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

const translationRow = {
  message_id: 'chat_msg_1',
  target_language: 'en',
  translated_content: 'hello',
  provider: 'test-llm',
  model: 'test-model',
  status: 'ready',
  created_at: '2026-07-10T00:00:02.000Z',
  updated_at: '2026-07-10T00:00:02.000Z',
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

  it('evaluates keyword moderation rules before persistence', () => {
    expect(evaluateChatModeration('a very bad phrase', { blockedWords: ['bad'] })).toEqual({
      status: 'blocked',
      action: 'block',
      reason: 'blocked_keyword',
      matchedWords: ['bad'],
    });
    expect(evaluateChatModeration('please review this', { reviewWords: ['review'] })).toEqual({
      status: 'pending_review',
      action: 'review',
      reason: 'review_keyword',
      matchedWords: ['review'],
    });
    expect(evaluateChatModeration('hello', { blockedWords: ['bad'], reviewWords: ['review'] })).toEqual({
      status: 'visible',
      action: 'allow',
      reason: '',
      matchedWords: [],
    });
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

  it('stores blocked messages with a moderation event for evidence', async () => {
    const blockedRow = {
      ...messageRow,
      content: 'bad text',
      moderation_status: 'blocked',
      moderation_reason: 'blocked_keyword',
    };
    const pool = poolWithResults([{ rows: [conversationRow] }, { rows: [blockedRow] }, { rows: [] }, { rows: [] }]);

    await expect(
      sendChatMessage({
        pool,
        authorUserId: 'u_1',
        body: {
          conversationType: 'match',
          subjectId: 'bgio-match-1',
          content: 'bad text',
        },
        sanitizeText,
        generateMessageId: () => 'chat_msg_1',
        generateModerationEventId: () => 'chat_mod_1',
        moderationRules: { blockedWords: ['bad'] },
      }),
    ).resolves.toEqual({
      ok: true,
      body: {
        conversation: expect.objectContaining({ id: 'match:bgio-match-1' }),
        message: expect.objectContaining({
          id: 'chat_msg_1',
          moderationStatus: 'blocked',
          moderationReason: 'blocked_keyword',
        }),
      },
    });
    expect(pool.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('INSERT INTO chat_moderation_events'),
      expect.arrayContaining(['chat_mod_1', 'chat_msg_1', 'match:bgio-match-1', 'u_1', 'keyword', 'block']),
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

  it('lists unread chat summaries across conversations', async () => {
    const pool = poolWithResults([
      {
        rows: [
          {
            ...conversationRow,
            unread_count: '3',
            latest_message_at: '2026-07-10T00:00:04.000Z',
          },
        ],
      },
    ]);

    await expect(listUnreadChat({ pool, userId: 'u_2', limit: '999' })).resolves.toEqual({
      ok: true,
      body: {
        conversations: [
          expect.objectContaining({
            id: 'match:bgio-match-1',
            unreadCount: 3,
            latestMessageAt: '2026-07-10T00:00:04.000Z',
          }),
        ],
      },
    });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('COUNT(m.id) AS unread_count'), ['u_2', 200]);
  });

  it('stores ready chat translations through a provider hook', async () => {
    const pool = poolWithResults([
      { rows: [{ ...messageRow, type: 'match', subject_id: 'bgio-match-1' }] },
      { rows: [] },
      { rows: [translationRow] },
    ]);
    const translateText = vi.fn(async () => ({
      translatedContent: 'hello',
      provider: 'test-llm',
      model: 'test-model',
    }));

    await expect(
      requestChatTranslation({
        pool,
        userId: 'u_2',
        messageId: 'chat_msg_1',
        body: { targetLanguage: 'EN' },
        sanitizeText,
        translateText,
        providerName: 'fallback-provider',
        modelName: 'fallback-model',
      }),
    ).resolves.toEqual({
      ok: true,
      body: {
        cached: false,
        translation: {
          messageId: 'chat_msg_1',
          targetLanguage: 'en',
          translatedContent: 'hello',
          provider: 'test-llm',
          model: 'test-model',
          status: 'ready',
          createdAt: '2026-07-10T00:00:02.000Z',
          updatedAt: '2026-07-10T00:00:02.000Z',
        },
      },
    });
    expect(translateText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'hello', targetLanguage: 'en', messageId: 'chat_msg_1' }),
    );
    expect(pool.query).toHaveBeenLastCalledWith(expect.stringContaining('INSERT INTO chat_message_translations'), [
      'chat_msg_1',
      'en',
      'hello',
      'test-llm',
      'test-model',
      'ready',
    ]);
  });

  it('records pending chat translations when no provider is configured', async () => {
    const pendingRow = {
      ...translationRow,
      translated_content: '',
      provider: 'unconfigured',
      model: '',
      status: 'pending',
    };
    const pool = poolWithResults([
      { rows: [{ ...messageRow, type: 'match', subject_id: 'bgio-match-1' }] },
      { rows: [] },
      { rows: [pendingRow] },
    ]);

    await expect(
      requestChatTranslation({
        pool,
        userId: 'u_2',
        messageId: 'chat_msg_1',
        body: { targetLanguage: 'en' },
        sanitizeText,
      }),
    ).resolves.toEqual({
      ok: true,
      body: {
        cached: false,
        translation: expect.objectContaining({
          messageId: 'chat_msg_1',
          targetLanguage: 'en',
          translatedContent: '',
          provider: 'unconfigured',
          status: 'pending',
        }),
      },
    });
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

  it('lists reports with message evidence for admin review', async () => {
    const pool = poolWithResults([
      {
        rows: [
          {
            id: 'chat_report_1',
            message_id: 'chat_msg_1',
            conversation_id: 'match:bgio-match-1',
            reporter_user_id: 'u_2',
            reason: 'spam',
            note: '',
            status: 'open',
            reviewer_user_id: null,
            resolution_note: '',
            created_at: '2026-07-10T00:00:03.000Z',
            reviewed_at: null,
            message_content: 'reported text',
            message_author_user_id: 'u_1',
            message_author_display_name: 'Alice',
            message_author_role: 'player',
            message_moderation_status: 'visible',
            message_created_at: '2026-07-10T00:00:01.000Z',
          },
        ],
      },
    ]);

    await expect(listChatReports({ pool, status: 'open', limit: 10 })).resolves.toEqual({
      ok: true,
      body: {
        reports: [
          expect.objectContaining({
            id: 'chat_report_1',
            message: expect.objectContaining({
              content: 'reported text',
              authorDisplayName: 'Alice',
            }),
          }),
        ],
      },
    });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('LEFT JOIN chat_messages'), ['open', 10]);
  });
});
