import type { ChatPublicAuthorRole } from '../api/client';

export type MatchChatAccount = { id: string } | null | undefined;
export type MatchChatAccessStatus = 'loading' | 'ready' | 'login_required';

export function matchChatAccessStatus(accountLoaded: boolean, account: MatchChatAccount): MatchChatAccessStatus {
  if (!accountLoaded) return 'loading';
  return account ? 'ready' : 'login_required';
}

export function matchChatAuthorRole(account: MatchChatAccount, spectator: boolean): ChatPublicAuthorRole | null {
  if (!account) return null;
  return spectator ? 'spectator' : 'player';
}

export function canSubmitMatchChat({
  account,
  content,
  status,
}: {
  account: MatchChatAccount;
  content: string;
  status: string;
}): boolean {
  return Boolean(account && content.trim() && status === 'ready');
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
