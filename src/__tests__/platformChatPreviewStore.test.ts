import { describe, expect, it, vi } from 'vitest';
import {
  createEmptyPlatformChatPreviewStore,
  createPostgresPlatformChatPreviewStore,
  resolvePlatformChatPreviewStoreMode,
} from '../platform/chatPreviewStore';

describe('platform chat preview store', () => {
  it('rejects preview broadcasts when durable verification is disabled', async () => {
    const store = createEmptyPlatformChatPreviewStore();

    await expect(
      store.canBroadcastPreview({
        conversationId: undefined,
        boardgameMatchID: undefined,
        messageId: 'chat_msg_1',
        authorUserId: 'guest:local',
      }),
    ).resolves.toBe(false);
  });

  it('verifies preview messages against durable match chat evidence', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [{ '?column?': 1 }] })) };
    const store = createPostgresPlatformChatPreviewStore(pool);

    await expect(
      store.canBroadcastPreview({
        conversationId: ' match:bgio-match-1 ',
        boardgameMatchID: ' bgio-match-1 ',
        messageId: ' chat_msg_1 ',
        authorUserId: 'u_player',
      }),
    ).resolves.toBe(true);

    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('JOIN chat_conversations'), [
      'chat_msg_1',
      'match:bgio-match-1',
      'u_player',
      'bgio-match-1',
    ]);
  });

  it('rejects unknown or anonymous durable preview evidence', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [] })) };
    const store = createPostgresPlatformChatPreviewStore(pool);

    await expect(
      store.canBroadcastPreview({
        conversationId: 'match:bgio-match-1',
        boardgameMatchID: 'bgio-match-1',
        messageId: 'chat_msg_missing',
        authorUserId: 'u_player',
      }),
    ).resolves.toBe(false);
    await expect(
      store.canBroadcastPreview({
        conversationId: 'match:bgio-match-1',
        boardgameMatchID: 'bgio-match-1',
        messageId: 'chat_msg_guest',
        authorUserId: 'guest:session',
      }),
    ).resolves.toBe(false);

    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('defaults durable chat preview verification on with production or database env', () => {
    expect(resolvePlatformChatPreviewStoreMode({ NODE_ENV: 'development' })).toBe('none');
    expect(resolvePlatformChatPreviewStoreMode({ NODE_ENV: 'production' })).toBe('postgres');
    expect(resolvePlatformChatPreviewStoreMode({ DATABASE_URL: 'postgres://db/app' })).toBe('postgres');
    expect(resolvePlatformChatPreviewStoreMode({ PLATFORM_CHAT_PREVIEW_STORE: 'none', NODE_ENV: 'production' })).toBe(
      'none',
    );
  });
});
