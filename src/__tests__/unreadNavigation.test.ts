import { describe, expect, it } from 'vitest';
import type { ChatUnreadConversation, FriendProfile } from '../api/client';
import { resolveUnreadConversationAction } from '../chat/unreadNavigation';

const baseConversation: ChatUnreadConversation = {
  id: 'conversation_1',
  type: 'match',
  subjectId: 'bgio-match-1',
  title: '',
  status: 'active',
  createdAt: '2026-07-10T00:00:00.000Z',
  updatedAt: '2026-07-10T00:00:01.000Z',
  unreadCount: 1,
  latestMessageAt: '2026-07-10T00:00:01.000Z',
};

function unreadConversation(
  type: ChatUnreadConversation['type'],
  subjectId: string,
): ChatUnreadConversation {
  return {
    ...baseConversation,
    id: `${type}:${subjectId}`,
    type,
    subjectId,
  };
}

describe('unread conversation navigation', () => {
  it('resolves every durable unread conversation type to an open action', () => {
    const friend: FriendProfile = {
      userId: 'u_friend',
      nickname: 'Friend',
      elo: 1000,
      matchCount: 3,
      wins: 2,
      createdAt: '2026-07-10T00:00:00.000Z',
    };

    expect(resolveUnreadConversationAction(unreadConversation('match', ' bgio-match-1 '))).toEqual({
      kind: 'match',
      subjectId: 'bgio-match-1',
    });
    expect(resolveUnreadConversationAction(unreadConversation('room', ' ROOM42 '))).toEqual({
      kind: 'room',
      subjectId: 'ROOM42',
    });
    expect(resolveUnreadConversationAction(unreadConversation('global', ' online-lobby '))).toEqual({
      kind: 'global',
      subjectId: 'online-lobby',
    });
    expect(
      resolveUnreadConversationAction(unreadConversation('direct', 'v1:u_friend:u_me'), {
        profileId: 'u_me',
        friends: [friend],
      }),
    ).toEqual({
      kind: 'direct',
      subjectId: 'v1:u_friend:u_me',
      peerUserId: 'u_friend',
      friend,
    });
  });

  it('rejects unread conversations that cannot be opened safely', () => {
    expect(resolveUnreadConversationAction(unreadConversation('match', '   '))).toBeNull();
    expect(resolveUnreadConversationAction(unreadConversation('direct', 'v1:u_friend:u_me'))).toBeNull();
    expect(
      resolveUnreadConversationAction(unreadConversation('direct', 'v1:u_friend:u_me'), {
        profileId: 'u_other',
      }),
    ).toBeNull();
  });
});
