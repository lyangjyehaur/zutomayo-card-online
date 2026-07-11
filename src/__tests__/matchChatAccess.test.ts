import { describe, expect, it } from 'vitest';
import {
  canSubmitMatchChat,
  matchChatAccessStatus,
  matchChatAuthorRole,
  matchPlatformPresenceUserId,
} from '../chat/matchChatAccess';

describe('match chat access', () => {
  it('keeps anonymous spectators in login-required state for durable chat', () => {
    expect(matchChatAccessStatus(false, null)).toBe('loading');
    expect(matchChatAccessStatus(true, null)).toBe('login_required');
    expect(matchChatAuthorRole(null, true)).toBeNull();
    expect(canSubmitMatchChat({ account: null, content: 'hello', status: 'ready' })).toBe(false);
  });

  it('assigns evidence-bearing chat roles only after account identity is loaded', () => {
    const account = { id: 'u_1' };

    expect(matchChatAccessStatus(true, account)).toBe('ready');
    expect(matchChatAuthorRole(account, true)).toBe('spectator');
    expect(matchChatAuthorRole(account, false)).toBe('player');
    expect(canSubmitMatchChat({ account, content: ' hello ', status: 'ready' })).toBe(true);
    expect(canSubmitMatchChat({ account, content: '', status: 'ready' })).toBe(false);
    expect(canSubmitMatchChat({ account, content: 'hello', status: 'loading' })).toBe(false);
    expect(canSubmitMatchChat({ account, content: 'hello', status: 'login_required' })).toBe(false);
    expect(canSubmitMatchChat({ account, content: 'hello', status: 'unavailable' })).toBe(false);
    expect(canSubmitMatchChat({ account, content: 'hello', status: 'sending' })).toBe(false);
  });

  it('aligns match-shell presence identity with durable chat identity', () => {
    expect(
      matchPlatformPresenceUserId({
        account: { id: 'u_1' },
        matchID: 'bgio-match-1',
        playerID: '0',
        spectator: false,
        anonymousToken: 'ignored',
      }),
    ).toBe('u_1');

    expect(
      matchPlatformPresenceUserId({
        account: null,
        matchID: 'bgio match/1',
        spectator: true,
        anonymousToken: 'token/value',
      }),
    ).toBe('anon:match:bgio_match_1:spectator:token_value');

    expect(
      matchPlatformPresenceUserId({
        account: null,
        matchID: 'bgio-match-1',
        playerID: '0',
        spectator: false,
        anonymousToken: 'ignored',
      }),
    ).toBe('guest:match:bgio-match-1:player:0');
  });
});
