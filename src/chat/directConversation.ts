const DIRECT_CHAT_USER_ID_PATTERN = /^[a-zA-Z0-9:_-]{3,128}$/;

export function normalizeDirectChatUserId(value: unknown): string {
  if (typeof value !== 'string') return '';
  const userId = value.trim().slice(0, 128);
  return DIRECT_CHAT_USER_ID_PATTERN.test(userId) ? userId : '';
}

export function buildDirectConversationSubjectId(userId: unknown, peerUserId: unknown): string | null {
  const cleanUserId = normalizeDirectChatUserId(userId);
  const cleanPeerUserId = normalizeDirectChatUserId(peerUserId);
  if (!cleanUserId || !cleanPeerUserId || cleanUserId === cleanPeerUserId) return null;
  return `v1:${[cleanUserId, cleanPeerUserId].sort().map(encodeURIComponent).join(':')}`;
}

export function directConversationPeerId(subjectId: unknown, userId: unknown): string | null {
  if (typeof subjectId !== 'string') return null;
  const cleanUserId = normalizeDirectChatUserId(userId);
  if (!cleanUserId) return null;
  const participants = directConversationParticipants(subjectId);
  if (participants.length !== 2 || !participants.includes(cleanUserId)) return null;
  return participants.find((participant) => participant !== cleanUserId) ?? null;
}

function directConversationParticipants(subjectId: string): string[] {
  if (subjectId.startsWith('v1:')) {
    return subjectId
      .slice(3)
      .split(':')
      .map((value) => {
        try {
          return normalizeDirectChatUserId(decodeURIComponent(value));
        } catch {
          return '';
        }
      })
      .filter(Boolean);
  }
  return subjectId
    .split(':')
    .map((value) => normalizeDirectChatUserId(value))
    .filter(Boolean);
}
