import type { ChatPublicAuthorRole } from '../api/client';

export type MatchChatAccount = { id: string } | null | undefined;
export type MatchChatAccessStatus = 'loading' | 'ready' | 'login_required';

export function matchChatAccessStatus(
  accountLoaded: boolean,
  account: MatchChatAccount,
  hasPlayerSeat: boolean,
): MatchChatAccessStatus {
  if (!accountLoaded) return 'loading';
  return account || hasPlayerSeat ? 'ready' : 'login_required';
}

export function matchChatAuthorRole(
  account: MatchChatAccount,
  spectator: boolean,
  hasPlayerSeat: boolean,
): ChatPublicAuthorRole | null {
  if (!account && !hasPlayerSeat) return null;
  return spectator ? 'spectator' : 'player';
}

export function canSubmitMatchChat({
  account,
  hasPlayerSeat,
  content,
  status,
}: {
  account: MatchChatAccount;
  hasPlayerSeat: boolean;
  content: string;
  status: string;
}): boolean {
  return Boolean((account || hasPlayerSeat) && content.trim() && status === 'ready');
}

function sanitizePresenceIdPart(value: string, maxLength: number): string {
  return (
    value
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, maxLength) || 'unknown'
  );
}

export function matchPlatformPresenceUserId({
  account,
  matchID,
  playerID,
  spectator,
  anonymousToken,
}: {
  account: MatchChatAccount;
  matchID: string;
  playerID?: string;
  spectator: boolean;
  anonymousToken: string;
}): string {
  if (account?.id) return account.id;
  const cleanMatchID = sanitizePresenceIdPart(matchID, 80);
  const cleanToken = sanitizePresenceIdPart(anonymousToken, 24);
  if (spectator) return `anon:match:${cleanMatchID}:spectator:${cleanToken}`;
  return `guest:match:${cleanMatchID}:player:${sanitizePresenceIdPart(playerID ?? 'unknown', 16)}`;
}
