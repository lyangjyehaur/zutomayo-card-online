import type { ChatUnreadConversation, FriendProfile } from '../api/client';
import { directConversationPeerId } from './directConversation';

export type UnreadConversationAction =
  | { kind: 'match'; subjectId: string }
  | { kind: 'room'; subjectId: string }
  | { kind: 'global'; subjectId: string }
  | { kind: 'direct'; subjectId: string; peerUserId: string; friend?: FriendProfile };

interface ResolveUnreadConversationActionOptions {
  profileId?: string | null;
  friends?: FriendProfile[];
}

function normalizedSubjectId(subjectId: string): string | null {
  const normalized = subjectId.trim();
  return normalized || null;
}

export function resolveUnreadConversationAction(
  conversation: ChatUnreadConversation,
  { profileId = null, friends = [] }: ResolveUnreadConversationActionOptions = {},
): UnreadConversationAction | null {
  const subjectId = normalizedSubjectId(conversation.subjectId);
  if (!subjectId) return null;

  if (conversation.type === 'match') {
    return { kind: 'match', subjectId };
  }

  if (conversation.type === 'room') {
    return { kind: 'room', subjectId };
  }

  if (conversation.type === 'global') {
    return { kind: 'global', subjectId };
  }

  if (conversation.type === 'direct') {
    const peerUserId = directConversationPeerId(subjectId, profileId);
    if (!peerUserId) return null;
    const friend = friends.find((item) => item.userId === peerUserId);
    return friend
      ? { kind: 'direct', subjectId, peerUserId, friend }
      : { kind: 'direct', subjectId, peerUserId };
  }

  return null;
}
