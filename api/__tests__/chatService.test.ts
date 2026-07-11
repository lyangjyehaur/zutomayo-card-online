import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

type QueryResult = { rows: Array<Record<string, unknown>>; rowCount?: number };
type PoolLike = {
  query: ReturnType<typeof vi.fn<(sql: string, params?: unknown[]) => Promise<QueryResult>>>;
};

const require = createRequire(import.meta.url);
const {
  canAccessConversation,
  canAccessConversationWithPolicy,
  conversationKey,
  createChatUserSanction,
  evaluateChatModeration,
  getActiveChatSanction,
  listChatEvidenceMessages,
  listChatMessages,
  listChatReports,
  listUnreadChat,
  markConversationRead,
  reportChatMessage,
  requestChatTranslation,
  reviewChatMessageModeration,
  revokeChatUserSanction,
  sendChatMessage,
} = require('../chatService.cjs') as {
  canAccessConversation: (userId: string, type: unknown, subjectId: unknown) => boolean;
  canAccessConversationWithPolicy: (input: {
    pool: PoolLike;
    userId: string;
    type: unknown;
    subjectId: unknown;
    enforceDirectFriendship?: boolean;
    enforceMatchParticipation?: boolean;
    enforceRoomParticipation?: boolean;
  }) => Promise<boolean>;
  conversationKey: (type: unknown, subjectId: unknown) => string | null;
  createChatUserSanction: (input: {
    pool: PoolLike;
    targetUserId: string;
    body: Record<string, unknown>;
    reviewerUserId: string;
    sanitizeText: (value: unknown, maxLen?: number) => string;
    generateSanctionId: () => string;
  }) => Promise<Record<string, unknown>>;
  evaluateChatModeration: (
    content: string,
    rules?: { blockedWords?: string[]; reviewWords?: string[] },
  ) => { status: string; action: string; reason: string; matchedWords: string[] };
  getActiveChatSanction: (input: { pool: PoolLike; userId: string }) => Promise<Record<string, unknown> | null>;
  listChatMessages: (input: {
    pool: PoolLike;
    userId: string;
    conversationType: unknown;
    subjectId: unknown;
    limit?: unknown;
    before?: unknown;
    enforceDirectFriendship?: boolean;
    enforceMatchParticipation?: boolean;
    enforceRoomParticipation?: boolean;
  }) => Promise<Record<string, unknown>>;
  listChatEvidenceMessages: (input: {
    pool: PoolLike;
    conversationId: unknown;
    limit?: unknown;
    before?: unknown;
  }) => Promise<Record<string, unknown>>;
  listChatReports: (input: { pool: PoolLike; status?: unknown; limit?: unknown }) => Promise<Record<string, unknown>>;
  listUnreadChat: (input: {
    pool: PoolLike;
    userId: string;
    limit?: unknown;
    enforceDirectFriendship?: boolean;
    enforceMatchParticipation?: boolean;
    enforceRoomParticipation?: boolean;
  }) => Promise<Record<string, unknown>>;
  markConversationRead: (input: {
    pool: PoolLike;
    userId: string;
    body: Record<string, unknown>;
    enforceDirectFriendship?: boolean;
    enforceMatchParticipation?: boolean;
    enforceRoomParticipation?: boolean;
  }) => Promise<{
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
    enforceDirectFriendship?: boolean;
    enforceMatchParticipation?: boolean;
    enforceRoomParticipation?: boolean;
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
    enforceDirectFriendship?: boolean;
    enforceMatchParticipation?: boolean;
    enforceRoomParticipation?: boolean;
  }) => Promise<Record<string, unknown>>;
  reviewChatMessageModeration: (input: {
    pool: PoolLike;
    messageId: string;
    body: Record<string, unknown>;
    reviewerUserId: string;
    sanitizeText: (value: unknown, maxLen?: number) => string;
    generateModerationEventId?: () => string;
  }) => Promise<Record<string, unknown>>;
  revokeChatUserSanction: (input: {
    pool: PoolLike;
    sanctionId: string;
    reviewerUserId: string;
    body?: Record<string, unknown>;
    sanitizeText: (value: unknown, maxLen?: number) => string;
  }) => Promise<Record<string, unknown>>;
  sendChatMessage: (input: {
    pool: PoolLike;
    authorUserId: string;
    body: Record<string, unknown>;
    sanitizeText: (value: unknown, maxLen?: number) => string;
    generateMessageId: () => string;
    generateModerationEventId?: () => string;
    moderationRules?: { blockedWords?: string[]; reviewWords?: string[] };
    enforceDirectFriendship?: boolean;
    enforceMatchParticipation?: boolean;
    enforceRoomParticipation?: boolean;
    allowedAuthorRoles?: string[];
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

const sanctionRow = {
  id: 'chat_sanction_1',
  target_user_id: 'u_1',
  type: 'chat_mute',
  status: 'active',
  reason: 'chat_report:abuse',
  source_report_id: 'chat_report_1',
  source_message_id: 'chat_msg_1',
  conversation_id: 'match:bgio-match-1',
  created_by_user_id: 'admin',
  created_at: '2026-07-10T00:00:03.000Z',
  expires_at: '2026-07-11T00:00:03.000Z',
  revoked_at: null,
  revoked_by_user_id: null,
  revocation_reason: '',
};

describe('chat service', () => {
  it('builds stable conversation keys for durable chat scopes', () => {
    expect(conversationKey('match', ' bgio-match-1 ')).toBe('match:bgio-match-1');
    expect(conversationKey('global', ' online-lobby ')).toBe('global:online-lobby');
    expect(conversationKey('global', 'staff-room')).toBeNull();
    expect(conversationKey('direct', 'u_1:u_2')).toBe('direct:u_1:u_2');
    expect(conversationKey('direct', 'u_2:u_1')).toBe('direct:u_1:u_2');
    expect(conversationKey('direct', 'v1:logto%3Au_1:u_2')).toBe('direct:v1:logto%3Au_1:u_2');
    expect(conversationKey('direct', 'v1:u_2:logto%3Au_1')).toBe('direct:v1:logto%3Au_1:u_2');
    expect(conversationKey('direct', 'u_1:u_1')).toBeNull();
    expect(conversationKey('direct', 'u_1:u_2:u_3')).toBeNull();
    expect(conversationKey('unknown', 'x')).toBeNull();
    expect(conversationKey('match', '')).toBeNull();
  });

  it('requires direct chat participants to include the current user', () => {
    expect(canAccessConversation('u_1', 'direct', 'u_1:u_2')).toBe(true);
    expect(canAccessConversation('logto:u_1', 'direct', 'v1:logto%3Au_1:u_2')).toBe(true);
    expect(canAccessConversation('u_3', 'direct', 'u_1:u_2')).toBe(false);
    expect(canAccessConversation('u_1', 'direct', 'u_1:u_1')).toBe(false);
    expect(canAccessConversation('u_1', 'direct', 'u_1:u_2:u_3')).toBe(false);
    expect(canAccessConversation('u_1', 'global', 'online-lobby')).toBe(true);
    expect(canAccessConversation('u_1', 'global', 'staff-room')).toBe(false);
    expect(canAccessConversation('u_3', 'match', 'bgio-match-1')).toBe(true);
  });

  it('can require durable friendship for direct chat access', async () => {
    const friendPool = poolWithResults([{ rows: [{ exists: 1 }] }]);
    await expect(
      canAccessConversationWithPolicy({
        pool: friendPool,
        userId: 'u_1',
        type: 'direct',
        subjectId: 'v1:u_1:u_2',
        enforceDirectFriendship: true,
      }),
    ).resolves.toBe(true);
    expect(friendPool.query).toHaveBeenCalledWith(expect.stringContaining('FROM user_friends'), ['u_1', 'u_2']);

    const strangerPool = poolWithResults([{ rows: [] }]);
    await expect(
      canAccessConversationWithPolicy({
        pool: strangerPool,
        userId: 'u_1',
        type: 'direct',
        subjectId: 'v1:u_1:u_2',
        enforceDirectFriendship: true,
      }),
    ).resolves.toBe(false);
  });

  it('can require durable match participation for match chat access', async () => {
    const participantPool = poolWithResults([{ rows: [{ exists: 1 }] }]);
    await expect(
      canAccessConversationWithPolicy({
        pool: participantPool,
        userId: 'u_1',
        type: 'match',
        subjectId: 'bgio-match-1',
        enforceMatchParticipation: true,
      }),
    ).resolves.toBe(true);
    expect(participantPool.query).toHaveBeenCalledWith(expect.stringContaining('platform_match_participants'), [
      'bgio-match-1',
      'u_1',
    ]);

    const strangerPool = poolWithResults([{ rows: [] }]);
    await expect(
      canAccessConversationWithPolicy({
        pool: strangerPool,
        userId: 'u_3',
        type: 'match',
        subjectId: 'bgio-match-1',
        enforceMatchParticipation: true,
      }),
    ).resolves.toBe(false);
  });

  it('rejects match chat writes from accounts without durable participation when enforced', async () => {
    const pool = poolWithResults([{ rows: [] }]);
    await expect(
      sendChatMessage({
        pool,
        authorUserId: 'u_stranger',
        body: {
          conversationType: 'match',
          subjectId: 'bgio-match-1',
          content: 'hello',
          authorRole: 'spectator',
        },
        sanitizeText,
        generateMessageId: () => 'chat_msg_1',
        enforceMatchParticipation: true,
      }),
    ).resolves.toMatchObject({ ok: false, status: 403, error: 'Forbidden' });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('can require durable custom-room participation for room chat access', async () => {
    const participantPool = poolWithResults([{ rows: [{ exists: 1 }] }]);
    await expect(
      canAccessConversationWithPolicy({
        pool: participantPool,
        userId: 'u_1',
        type: 'room',
        subjectId: 'ROOM42',
        enforceRoomParticipation: true,
      }),
    ).resolves.toBe(true);
    expect(participantPool.query).toHaveBeenCalledWith(expect.stringContaining('platform_room_participants'), [
      'ROOM42',
      'u_1',
    ]);

    const strangerPool = poolWithResults([{ rows: [] }]);
    await expect(
      canAccessConversationWithPolicy({
        pool: strangerPool,
        userId: 'u_3',
        type: 'room',
        subjectId: 'ROOM42',
        enforceRoomParticipation: true,
      }),
    ).resolves.toBe(false);
  });

  it('rejects room chat writes from accounts without durable participation when enforced', async () => {
    const pool = poolWithResults([{ rows: [] }]);
    await expect(
      sendChatMessage({
        pool,
        authorUserId: 'u_stranger',
        body: {
          conversationType: 'room',
          subjectId: 'ROOM42',
          content: 'hello',
          authorRole: 'spectator',
        },
        sanitizeText,
        generateMessageId: () => 'chat_msg_1',
        enforceRoomParticipation: true,
      }),
    ).resolves.toMatchObject({ ok: false, status: 403, error: 'Forbidden' });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('requires durable match participation for match history, reads, translations, and reports when enforced', async () => {
    const messageWithConversation = {
      ...messageRow,
      type: 'match',
      subject_id: 'bgio-match-1',
      conversation_type: 'match',
      conversation_subject_id: 'bgio-match-1',
    };

    const historyPool = poolWithResults([{ rows: [] }]);
    await expect(
      listChatMessages({
        pool: historyPool,
        userId: 'u_stranger',
        conversationType: 'match',
        subjectId: 'bgio-match-1',
        enforceMatchParticipation: true,
      }),
    ).resolves.toEqual({ ok: false, status: 403, error: 'Forbidden' });
    expect(historyPool.query).toHaveBeenCalledWith(expect.stringContaining('platform_match_participants'), [
      'bgio-match-1',
      'u_stranger',
    ]);

    const readPool = poolWithResults([{ rows: [] }]);
    await expect(
      markConversationRead({
        pool: readPool,
        userId: 'u_stranger',
        body: { conversationType: 'match', subjectId: 'bgio-match-1', lastReadMessageId: 'chat_msg_1' },
        enforceMatchParticipation: true,
      }),
    ).resolves.toEqual({ ok: false, status: 403, error: 'Forbidden' });
    expect(readPool.query).toHaveBeenCalledWith(expect.stringContaining('platform_match_participants'), [
      'bgio-match-1',
      'u_stranger',
    ]);

    const translationPool = poolWithResults([{ rows: [messageWithConversation] }, { rows: [] }]);
    await expect(
      requestChatTranslation({
        pool: translationPool,
        userId: 'u_stranger',
        messageId: 'chat_msg_1',
        body: { targetLanguage: 'en' },
        sanitizeText,
        enforceMatchParticipation: true,
      }),
    ).resolves.toEqual({ ok: false, status: 403, error: 'Forbidden' });
    expect(translationPool.query).toHaveBeenNthCalledWith(2, expect.stringContaining('platform_match_participants'), [
      'bgio-match-1',
      'u_stranger',
    ]);

    const reportPool = poolWithResults([{ rows: [messageWithConversation] }, { rows: [] }]);
    await expect(
      reportChatMessage({
        pool: reportPool,
        reporterUserId: 'u_stranger',
        messageId: 'chat_msg_1',
        body: { reason: 'spam' },
        sanitizeText,
        generateReportId: () => 'chat_report_1',
        enforceMatchParticipation: true,
      }),
    ).resolves.toEqual({ ok: false, status: 403, error: 'Forbidden' });
    expect(reportPool.query).toHaveBeenNthCalledWith(2, expect.stringContaining('platform_match_participants'), [
      'bgio-match-1',
      'u_stranger',
    ]);
  });

  it('requires durable room participation for room history, reads, translations, and reports when enforced', async () => {
    const roomMessageWithConversation = {
      ...messageRow,
      conversation_id: 'room:ROOM42',
      type: 'room',
      subject_id: 'ROOM42',
      conversation_type: 'room',
      conversation_subject_id: 'ROOM42',
    };

    const historyPool = poolWithResults([{ rows: [] }]);
    await expect(
      listChatMessages({
        pool: historyPool,
        userId: 'u_stranger',
        conversationType: 'room',
        subjectId: 'ROOM42',
        enforceRoomParticipation: true,
      }),
    ).resolves.toEqual({ ok: false, status: 403, error: 'Forbidden' });
    expect(historyPool.query).toHaveBeenCalledWith(expect.stringContaining('platform_room_participants'), [
      'ROOM42',
      'u_stranger',
    ]);

    const readPool = poolWithResults([{ rows: [] }]);
    await expect(
      markConversationRead({
        pool: readPool,
        userId: 'u_stranger',
        body: { conversationType: 'room', subjectId: 'ROOM42', lastReadMessageId: 'chat_msg_1' },
        enforceRoomParticipation: true,
      }),
    ).resolves.toEqual({ ok: false, status: 403, error: 'Forbidden' });
    expect(readPool.query).toHaveBeenCalledWith(expect.stringContaining('platform_room_participants'), [
      'ROOM42',
      'u_stranger',
    ]);

    const translationPool = poolWithResults([{ rows: [roomMessageWithConversation] }, { rows: [] }]);
    await expect(
      requestChatTranslation({
        pool: translationPool,
        userId: 'u_stranger',
        messageId: 'chat_msg_1',
        body: { targetLanguage: 'en' },
        sanitizeText,
        enforceRoomParticipation: true,
      }),
    ).resolves.toEqual({ ok: false, status: 403, error: 'Forbidden' });
    expect(translationPool.query).toHaveBeenNthCalledWith(2, expect.stringContaining('platform_room_participants'), [
      'ROOM42',
      'u_stranger',
    ]);

    const reportPool = poolWithResults([{ rows: [roomMessageWithConversation] }, { rows: [] }]);
    await expect(
      reportChatMessage({
        pool: reportPool,
        reporterUserId: 'u_stranger',
        messageId: 'chat_msg_1',
        body: { reason: 'spam' },
        sanitizeText,
        generateReportId: () => 'chat_report_1',
        enforceRoomParticipation: true,
      }),
    ).resolves.toEqual({ ok: false, status: 403, error: 'Forbidden' });
    expect(reportPool.query).toHaveBeenNthCalledWith(2, expect.stringContaining('platform_room_participants'), [
      'ROOM42',
      'u_stranger',
    ]);
  });

  it('rejects direct chat writes from non-participants or invalid direct subjects', async () => {
    const cases = [
      { authorUserId: 'u_3', subjectId: 'u_1:u_2', error: 'Forbidden' },
      { authorUserId: 'u_1', subjectId: 'u_1:u_1', error: 'Invalid conversation' },
      { authorUserId: 'u_1', subjectId: 'u_1:u_2:u_3', error: 'Invalid conversation' },
    ];

    for (const testCase of cases) {
      const pool = poolWithResults([]);

      await expect(
        sendChatMessage({
          pool,
          authorUserId: testCase.authorUserId,
          body: {
            conversationType: 'direct',
            subjectId: testCase.subjectId,
            content: 'hello',
          },
          sanitizeText,
          generateMessageId: () => 'chat_msg_1',
        }),
      ).resolves.toEqual({
        ok: false,
        status: testCase.error === 'Forbidden' ? 403 : 400,
        error: testCase.error,
      });
      expect(pool.query).not.toHaveBeenCalled();
    }
  });

  it('canonicalizes direct chat subjects before persistence', async () => {
    const pool = poolWithResults([
      { rows: [] },
      {
        rows: [
          {
            ...conversationRow,
            id: 'direct:v1:u_1:u_2',
            type: 'direct',
            subject_id: 'v1:u_1:u_2',
          },
        ],
      },
      {
        rows: [
          {
            ...messageRow,
            id: 'chat_msg_direct',
            conversation_id: 'direct:v1:u_1:u_2',
            author_user_id: 'u_2',
            content: 'hello',
          },
        ],
      },
      { rows: [] },
    ]);

    await expect(
      sendChatMessage({
        pool,
        authorUserId: 'u_2',
        body: {
          conversationType: 'direct',
          subjectId: 'v1:u_2:u_1',
          content: 'hello',
        },
        sanitizeText,
        generateMessageId: () => 'chat_msg_direct',
      }),
    ).resolves.toEqual({
      ok: true,
      body: {
        conversation: expect.objectContaining({
          id: 'direct:v1:u_1:u_2',
          type: 'direct',
          subjectId: 'v1:u_1:u_2',
        }),
        message: expect.objectContaining({
          id: 'chat_msg_direct',
          conversationId: 'direct:v1:u_1:u_2',
        }),
      },
    });

    expect(pool.query).toHaveBeenNthCalledWith(2, expect.stringContaining('INSERT INTO chat_conversations'), [
      'direct:v1:u_1:u_2',
      'direct',
      'v1:u_1:u_2',
      '',
    ]);
  });

  it('rejects direct chat writes to non-friends when friendship enforcement is enabled', async () => {
    const pool = poolWithResults([{ rows: [] }]);

    await expect(
      sendChatMessage({
        pool,
        authorUserId: 'u_1',
        body: {
          conversationType: 'direct',
          subjectId: 'v1:u_1:u_2',
          content: 'hello',
        },
        sanitizeText,
        generateMessageId: () => 'chat_msg_1',
        enforceDirectFriendship: true,
      }),
    ).resolves.toEqual({ ok: false, status: 403, error: 'Forbidden' });
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('FROM user_friends'), ['u_1', 'u_2']);
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
    const pool = poolWithResults([{ rows: [] }, { rows: [conversationRow] }, { rows: [messageRow] }, { rows: [] }]);

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

    expect(pool.query).toHaveBeenNthCalledWith(1, expect.stringContaining('FROM chat_user_sanctions'), ['u_1']);
    expect(pool.query).toHaveBeenNthCalledWith(2, expect.stringContaining('INSERT INTO chat_conversations'), [
      'match:bgio-match-1',
      'match',
      'bgio-match-1',
      '',
    ]);
    expect(pool.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('INSERT INTO chat_messages'),
      expect.arrayContaining(['chat_msg_1', 'match:bgio-match-1', 'u_1', 'Alice', 'player', 'hello', 'zh-tw']),
    );
  });

  it('rejects disallowed public author roles before querying persistence', async () => {
    const pool = poolWithResults([]);

    await expect(
      sendChatMessage({
        pool,
        authorUserId: 'u_1',
        body: {
          conversationType: 'match',
          subjectId: 'bgio-match-1',
          content: 'hello',
          authorRole: 'moderator',
        },
        sanitizeText,
        generateMessageId: () => 'chat_msg_1',
        allowedAuthorRoles: ['player', 'spectator'],
      }),
    ).resolves.toEqual({ ok: false, status: 403, error: 'Forbidden' });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('defaults chat writes to public player and spectator roles only', async () => {
    const pool = poolWithResults([]);

    await expect(
      sendChatMessage({
        pool,
        authorUserId: 'u_1',
        body: {
          conversationType: 'global',
          subjectId: 'online-lobby',
          content: 'hello',
          authorRole: 'moderator',
        },
        sanitizeText,
        generateMessageId: () => 'chat_msg_1',
      }),
    ).resolves.toEqual({ ok: false, status: 403, error: 'Forbidden' });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('rejects muted users before persisting any durable conversation type', async () => {
    const cases = [
      { conversationType: 'match', subjectId: 'bgio-match-1' },
      { conversationType: 'room', subjectId: 'ROOM42' },
      { conversationType: 'global', subjectId: 'online-lobby' },
      { conversationType: 'direct', subjectId: 'v1:u_1:u_friend' },
    ];

    for (const testCase of cases) {
      const pool = poolWithResults([{ rows: [sanctionRow] }]);

      await expect(
        sendChatMessage({
          pool,
          authorUserId: 'u_1',
          body: {
            ...testCase,
            content: 'hello',
          },
          sanitizeText,
          generateMessageId: () => `chat_msg_${testCase.conversationType}`,
        }),
      ).resolves.toEqual({
        ok: false,
        status: 403,
        error: 'Chat muted until 2026-07-11T00:00:03.000Z',
        body: {
          sanction: expect.objectContaining({
            id: 'chat_sanction_1',
            targetUserId: 'u_1',
            type: 'chat_mute',
          }),
        },
      });
      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('FROM chat_user_sanctions'), ['u_1']);
    }
  });

  it('loads the latest active chat mute sanction for enforcement', async () => {
    const pool = poolWithResults([{ rows: [sanctionRow] }]);

    await expect(getActiveChatSanction({ pool, userId: 'u_1' })).resolves.toEqual(
      expect.objectContaining({
        id: 'chat_sanction_1',
        targetUserId: 'u_1',
        type: 'chat_mute',
      }),
    );
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('FROM chat_user_sanctions'), ['u_1']);
  });

  it('stores blocked messages with a moderation event for evidence', async () => {
    const blockedRow = {
      ...messageRow,
      content: 'bad text',
      moderation_status: 'blocked',
      moderation_reason: 'blocked_keyword',
    };
    const pool = poolWithResults([
      { rows: [] },
      { rows: [conversationRow] },
      { rows: [blockedRow] },
      { rows: [] },
      { rows: [] },
    ]);

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
      4,
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
            latest_message_id: 'chat_msg_match_latest',
          },
          {
            ...conversationRow,
            id: 'direct:v1:logto%3Au_2:u_4',
            type: 'direct',
            subject_id: 'v1:logto%3Au_2:u_4',
            unread_count: '1',
            latest_message_at: '2026-07-10T00:00:05.000Z',
            latest_message_id: 'chat_msg_direct_latest',
          },
        ],
      },
    ]);

    await expect(listUnreadChat({ pool, userId: 'logto:u_2', limit: '999' })).resolves.toEqual({
      ok: true,
      body: {
        conversations: [
          expect.objectContaining({
            id: 'match:bgio-match-1',
            unreadCount: 3,
            latestMessageAt: '2026-07-10T00:00:04.000Z',
            latestMessageId: 'chat_msg_match_latest',
          }),
          expect.objectContaining({
            id: 'direct:v1:logto%3Au_2:u_4',
            unreadCount: 1,
            latestMessageAt: '2026-07-10T00:00:05.000Z',
            latestMessageId: 'chat_msg_direct_latest',
          }),
        ],
      },
    });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("c.type <> 'global' OR c.subject_id = 'online-lobby'"),
      ['logto:u_2', 200, 'logto%3Au_2', false, [], false, false],
    );
  });

  it('pushes unread chat ACLs into the database query before applying the limit', async () => {
    const pool = poolWithResults([
      { rows: [{ friend_user_id: 'u_friend' }] },
      {
        rows: [
          {
            ...conversationRow,
            id: 'direct:v1:u_friend:u_reader',
            type: 'direct',
            subject_id: 'v1:u_friend:u_reader',
            unread_count: '1',
            latest_message_at: '2026-07-10T00:00:05.000Z',
            latest_message_id: 'chat_msg_direct_latest',
          },
        ],
      },
    ]);

    await expect(
      listUnreadChat({
        pool,
        userId: 'u_reader',
        enforceDirectFriendship: true,
        enforceMatchParticipation: true,
        enforceRoomParticipation: true,
      }),
    ).resolves.toEqual({
      ok: true,
      body: {
        conversations: [
          expect.objectContaining({
            id: 'direct:v1:u_friend:u_reader',
            unreadCount: 1,
            latestMessageAt: '2026-07-10T00:00:05.000Z',
            latestMessageId: 'chat_msg_direct_latest',
          }),
        ],
      },
    });
    expect(pool.query).toHaveBeenNthCalledWith(1, expect.stringContaining('FROM user_friends'), ['u_reader']);
    expect(pool.query).toHaveBeenNthCalledWith(2, expect.stringContaining('FROM platform_match_participants'), [
      'u_reader',
      50,
      'u_reader',
      true,
      ['v1:u_friend:u_reader'],
      true,
      true,
    ]);
    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('FROM platform_room_participants'),
      expect.any(Array),
    );
  });

  it('keeps unread summaries for messages whose author account was tombstoned', async () => {
    const pool = poolWithResults([
      {
        rows: [
          {
            ...conversationRow,
            unread_count: '2',
            latest_message_at: '2026-07-10T00:00:06.000Z',
            latest_message_id: 'chat_msg_tombstone_latest',
          },
        ],
      },
    ]);

    await expect(listUnreadChat({ pool, userId: 'u_2', limit: 20 })).resolves.toEqual({
      ok: true,
      body: {
        conversations: [
          expect.objectContaining({
            id: 'match:bgio-match-1',
            unreadCount: 2,
            latestMessageAt: '2026-07-10T00:00:06.000Z',
            latestMessageId: 'chat_msg_tombstone_latest',
          }),
        ],
      },
    });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('m.author_user_id IS DISTINCT FROM $1'), [
      'u_2',
      20,
      'u_2',
      false,
      [],
      false,
      false,
    ]);
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
      reported_message_content: 'reported text',
      reported_message_author_user_id: 'u_1',
      reported_message_author_display_name: 'Alice',
      reported_message_author_role: 'player',
      reported_message_moderation_status: 'visible',
      reported_message_created_at: '2026-07-10T00:00:01.000Z',
      status: 'open',
      reviewer_user_id: null,
      resolution_note: '',
      created_at: '2026-07-10T00:00:03.000Z',
      reviewed_at: null,
    };
    const pool = poolWithResults([
      {
        rows: [
          {
            id: 'chat_msg_1',
            conversation_id: 'match:bgio-match-1',
            author_user_id: 'u_1',
            author_display_name: 'Alice',
            author_role: 'player',
            content: 'reported text',
            moderation_status: 'visible',
            created_at: '2026-07-10T00:00:01.000Z',
            conversation_type: 'match',
            conversation_subject_id: 'bgio-match-1',
          },
        ],
      },
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
          message: expect.objectContaining({
            content: 'reported text',
            authorUserId: 'u_1',
            authorDisplayName: 'Alice',
            authorRole: 'player',
          }),
        }),
      },
    });
    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('reported_message_content'),
      expect.arrayContaining([
        'chat_report_1',
        'chat_msg_1',
        'match:bgio-match-1',
        'u_2',
        'spam',
        'too much',
        'reported text',
        'u_1',
        'Alice',
        'player',
        'visible',
        '2026-07-10T00:00:01.000Z',
      ]),
    );
  });

  it('rejects reports for direct conversations the reporter cannot access', async () => {
    const pool = poolWithResults([
      {
        rows: [
          {
            id: 'chat_msg_1',
            conversation_id: 'direct:v1:u_1:u_2',
            author_user_id: 'u_1',
            author_display_name: 'Alice',
            author_role: 'player',
            content: 'private text',
            moderation_status: 'visible',
            created_at: '2026-07-10T00:00:01.000Z',
            conversation_type: 'direct',
            conversation_subject_id: 'v1:u_1:u_2',
          },
        ],
      },
    ]);

    await expect(
      reportChatMessage({
        pool,
        reporterUserId: 'u_3',
        messageId: 'chat_msg_1',
        body: { reason: 'spam' },
        sanitizeText,
        generateReportId: () => 'chat_report_1',
      }),
    ).resolves.toEqual({ ok: false, status: 403, error: 'Forbidden' });
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('JOIN chat_conversations'), ['chat_msg_1']);
  });

  it('lists reports with snapshotted message evidence for admin review', async () => {
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
            reported_message_content: 'snapshotted text',
            reported_message_author_user_id: 'u_1',
            reported_message_author_display_name: 'Alice at report time',
            reported_message_author_role: 'player',
            reported_message_moderation_status: 'pending_review',
            reported_message_created_at: '2026-07-10T00:00:01.000Z',
            message_content: 'edited later',
            message_author_user_id: 'u_9',
            message_author_display_name: 'Changed',
            message_author_role: 'spectator',
            message_moderation_status: 'visible',
            message_created_at: '2026-07-10T00:00:09.000Z',
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
              content: 'snapshotted text',
              authorUserId: 'u_1',
              authorDisplayName: 'Alice at report time',
              authorRole: 'player',
              moderationStatus: 'pending_review',
              createdAt: '2026-07-10T00:00:01.000Z',
            }),
          }),
        ],
      },
    });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('LEFT JOIN chat_messages'), ['open', 10]);
  });

  it('includes active chat sanctions on report evidence for admin actions', async () => {
    const pool = poolWithResults([
      {
        rows: [
          {
            id: 'chat_report_1',
            message_id: 'chat_msg_1',
            conversation_id: 'match:bgio-match-1',
            reporter_user_id: 'u_2',
            reason: 'abuse',
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
            sanction_id: 'chat_sanction_1',
            sanction_target_user_id: 'u_1',
            sanction_type: 'chat_mute',
            sanction_status: 'active',
            sanction_reason: 'chat_report:abuse',
            sanction_source_report_id: 'chat_report_1',
            sanction_source_message_id: 'chat_msg_1',
            sanction_conversation_id: 'match:bgio-match-1',
            sanction_created_by_user_id: 'admin',
            sanction_created_at: '2026-07-10T00:00:03.000Z',
            sanction_expires_at: '2026-07-11T00:00:03.000Z',
            sanction_revoked_at: null,
            sanction_revoked_by_user_id: null,
            sanction_revocation_reason: '',
          },
        ],
      },
    ]);

    await expect(listChatReports({ pool, status: 'open', limit: 10 })).resolves.toEqual({
      ok: true,
      body: {
        reports: [
          expect.objectContaining({
            message: expect.objectContaining({
              authorUserId: 'u_1',
              activeSanction: expect.objectContaining({
                id: 'chat_sanction_1',
                targetUserId: 'u_1',
                expiresAt: '2026-07-11T00:00:03.000Z',
              }),
            }),
          }),
        ],
      },
    });
  });

  it('creates durable chat mute sanctions and supersedes previous active mutes', async () => {
    const pool = poolWithResults([
      {
        rows: [
          {
            report_id: 'chat_report_1',
            report_message_id: 'chat_msg_1',
            report_conversation_id: 'match:bgio-match-1',
            reported_message_author_user_id: 'u_1',
            message_id: 'chat_msg_1',
            message_conversation_id: 'match:bgio-match-1',
            message_author_user_id: 'u_1',
          },
        ],
      },
      { rows: [] },
      { rows: [{ ...sanctionRow, reason: 'abuse' }] },
    ]);

    await expect(
      createChatUserSanction({
        pool,
        targetUserId: 'u_1',
        body: {
          type: 'chat_mute',
          durationMinutes: 60,
          reason: '<abuse>',
          sourceReportId: 'chat_report_1',
          sourceMessageId: 'chat_msg_1',
          conversationId: 'match:bgio-match-1',
        },
        reviewerUserId: 'admin',
        sanitizeText,
        generateSanctionId: () => 'chat_sanction_1',
      }),
    ).resolves.toEqual({
      ok: true,
      body: {
        sanction: expect.objectContaining({
          id: 'chat_sanction_1',
          targetUserId: 'u_1',
          reason: 'abuse',
        }),
      },
    });
    expect(pool.query).toHaveBeenNthCalledWith(1, expect.stringContaining('FROM chat_reports'), [
      'chat_report_1',
      'chat_msg_1',
    ]);
    expect(pool.query).toHaveBeenNthCalledWith(2, expect.stringContaining('UPDATE chat_user_sanctions'), [
      'u_1',
      'admin',
      'chat_mute',
    ]);
    expect(pool.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('INSERT INTO chat_user_sanctions'),
      expect.arrayContaining([
        'chat_sanction_1',
        'u_1',
        'chat_mute',
        'abuse',
        'chat_report_1',
        'chat_msg_1',
        'match:bgio-match-1',
        'admin',
        expect.any(String),
      ]),
    );
  });

  it('rejects report-backed sanctions when the target does not match the snapshotted author', async () => {
    const pool = poolWithResults([
      {
        rows: [
          {
            report_id: 'chat_report_1',
            report_message_id: 'chat_msg_1',
            report_conversation_id: 'match:bgio-match-1',
            reported_message_author_user_id: 'u_author',
            message_id: 'chat_msg_1',
            message_conversation_id: 'match:bgio-match-1',
            message_author_user_id: 'u_author',
          },
        ],
      },
    ]);

    await expect(
      createChatUserSanction({
        pool,
        targetUserId: 'u_other',
        body: {
          type: 'chat_mute',
          sourceReportId: 'chat_report_1',
          sourceMessageId: 'chat_msg_1',
          conversationId: 'match:bgio-match-1',
        },
        reviewerUserId: 'admin',
        sanitizeText,
        generateSanctionId: () => 'chat_sanction_1',
      }),
    ).resolves.toEqual({ ok: false, status: 400, error: 'Report target mismatch' });
    expect(pool.query).toHaveBeenCalledOnce();
  });

  it('revokes active chat mute sanctions', async () => {
    const pool = poolWithResults([
      {
        rows: [
          {
            ...sanctionRow,
            status: 'revoked',
            revoked_at: '2026-07-10T01:00:00Z',
            revocation_reason: 'manual',
          },
        ],
      },
    ]);

    await expect(
      revokeChatUserSanction({
        pool,
        sanctionId: 'chat_sanction_1',
        reviewerUserId: 'admin',
        body: { reason: '<manual>' },
        sanitizeText,
      }),
    ).resolves.toEqual({
      ok: true,
      body: {
        sanction: expect.objectContaining({
          id: 'chat_sanction_1',
          status: 'revoked',
          revocationReason: 'manual',
        }),
      },
    });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE chat_user_sanctions'), [
      'chat_sanction_1',
      'admin',
      'manual',
    ]);
  });

  it('lists full conversation context for admin evidence including hidden moderation states', async () => {
    const pool = poolWithResults([
      {
        rows: [
          {
            id: 'match:bgio-match-1',
            type: 'match',
            subject_id: 'bgio-match-1',
            title: 'Ranked match',
            status: 'active',
            created_at: '2026-07-10T00:00:00.000Z',
            updated_at: '2026-07-10T00:00:05.000Z',
          },
        ],
      },
      {
        rows: [
          {
            id: 'chat_msg_deleted',
            conversation_id: 'match:bgio-match-1',
            author_user_id: 'u_3',
            author_display_name: 'Carol',
            author_role: 'spectator',
            content: 'deleted evidence',
            source_language: '',
            moderation_status: 'deleted',
            moderation_reason: 'manual_remove',
            metadata: {},
            created_at: '2026-07-10T00:00:03.000Z',
            edited_at: null,
            deleted_at: '2026-07-10T00:00:04.000Z',
          },
          {
            id: 'chat_msg_blocked',
            conversation_id: 'match:bgio-match-1',
            author_user_id: 'u_1',
            author_display_name: 'Alice',
            author_role: 'player',
            content: 'blocked evidence',
            source_language: '',
            moderation_status: 'blocked',
            moderation_reason: 'blocked_keyword',
            metadata: {},
            created_at: '2026-07-10T00:00:01.000Z',
            edited_at: null,
            deleted_at: null,
          },
        ],
      },
    ]);

    await expect(listChatEvidenceMessages({ pool, conversationId: 'match:bgio-match-1', limit: 20 })).resolves.toEqual({
      ok: true,
      body: {
        conversation: expect.objectContaining({
          id: 'match:bgio-match-1',
          subjectId: 'bgio-match-1',
        }),
        messages: [
          expect.objectContaining({ id: 'chat_msg_blocked', moderationStatus: 'blocked' }),
          expect.objectContaining({ id: 'chat_msg_deleted', moderationStatus: 'deleted' }),
        ],
      },
    });
    expect(pool.query).toHaveBeenNthCalledWith(1, 'SELECT * FROM chat_conversations WHERE id = $1', [
      'match:bgio-match-1',
    ]);
    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      expect.not.stringContaining("moderation_status IN ('visible', 'pending_review')"),
      ['match:bgio-match-1', 20],
    );
  });

  it('reviews chat message moderation and records an admin moderation event', async () => {
    const pool = poolWithResults([
      {
        rows: [
          {
            ...messageRow,
            id: 'chat_msg_pending',
            moderation_status: 'visible',
            moderation_reason: 'manual visible',
            deleted_at: null,
          },
        ],
      },
      { rows: [] },
    ]);

    await expect(
      reviewChatMessageModeration({
        pool,
        messageId: 'chat_msg_pending',
        body: { status: 'visible', reason: '<manual visible>' },
        reviewerUserId: 'admin',
        sanitizeText,
        generateModerationEventId: () => 'chat_mod_admin_1',
      }),
    ).resolves.toEqual({
      ok: true,
      body: {
        message: expect.objectContaining({
          id: 'chat_msg_pending',
          moderationStatus: 'visible',
          moderationReason: 'manual visible',
          deletedAt: null,
        }),
      },
    });

    expect(pool.query).toHaveBeenNthCalledWith(1, expect.stringContaining('UPDATE chat_messages'), [
      'chat_msg_pending',
      'visible',
      'manual visible',
    ]);
    expect(pool.query).toHaveBeenNthCalledWith(2, expect.stringContaining('INSERT INTO chat_moderation_events'), [
      'chat_mod_admin_1',
      'chat_msg_pending',
      'match:bgio-match-1',
      'admin',
      'admin',
      'visible',
      'manual visible',
      { status: 'visible' },
    ]);
  });

  it('marks deleted chat messages with deleted_at through moderation review', async () => {
    const pool = poolWithResults([
      {
        rows: [
          {
            ...messageRow,
            id: 'chat_msg_delete',
            moderation_status: 'deleted',
            moderation_reason: 'manual_deleted',
            deleted_at: '2026-07-10T00:10:00.000Z',
          },
        ],
      },
    ]);

    await expect(
      reviewChatMessageModeration({
        pool,
        messageId: 'chat_msg_delete',
        body: { status: 'deleted' },
        reviewerUserId: 'admin',
        sanitizeText,
      }),
    ).resolves.toEqual({
      ok: true,
      body: {
        message: expect.objectContaining({
          id: 'chat_msg_delete',
          moderationStatus: 'deleted',
          moderationReason: 'manual_deleted',
          deletedAt: '2026-07-10T00:10:00.000Z',
        }),
      },
    });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("WHEN $2 = 'deleted'"), [
      'chat_msg_delete',
      'deleted',
      'manual_deleted',
    ]);
  });
});
