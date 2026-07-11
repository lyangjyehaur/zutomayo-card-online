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
