import { describe, expect, it } from 'vitest';
import {
  canSubmitMatchChat,
  matchChatAccessStatus,
  matchChatAuthorRole,
  matchPlatformPresenceUserId,
} from '../chat/matchChatAccess';

describe('match chat access', () => {
  it('allows anonymous seated players but keeps anonymous spectators login-required', () => {
    expect(matchChatAccessStatus(false, null, true)).toBe('loading');
    expect(matchChatAccessStatus(true, null, false)).toBe('login_required');
    expect(matchChatAccessStatus(true, null, true)).toBe('ready');
    expect(matchChatAuthorRole(null, true, false)).toBeNull();
    expect(matchChatAuthorRole(null, false, true)).toBe('player');
    expect(canSubmitMatchChat({ account: null, hasPlayerSeat: true, content: 'hello', status: 'ready' })).toBe(true);
    expect(canSubmitMatchChat({ account: null, hasPlayerSeat: false, content: 'hello', status: 'ready' })).toBe(false);
  });

  it('assigns evidence-bearing chat roles only after account identity is loaded', () => {
    const account = { id: 'u_1' };

    expect(matchChatAccessStatus(true, account, false)).toBe('ready');
    expect(matchChatAuthorRole(account, true, false)).toBe('spectator');
    expect(matchChatAuthorRole(account, false, false)).toBe('player');
    expect(canSubmitMatchChat({ account, hasPlayerSeat: false, content: ' hello ', status: 'ready' })).toBe(true);
    expect(canSubmitMatchChat({ account, hasPlayerSeat: false, content: '', status: 'ready' })).toBe(false);
    expect(canSubmitMatchChat({ account, hasPlayerSeat: false, content: 'hello', status: 'loading' })).toBe(false);
    expect(canSubmitMatchChat({ account, hasPlayerSeat: false, content: 'hello', status: 'login_required' })).toBe(
      false,
    );
    expect(canSubmitMatchChat({ account, hasPlayerSeat: false, content: 'hello', status: 'unavailable' })).toBe(false);
    expect(canSubmitMatchChat({ account, hasPlayerSeat: false, content: 'hello', status: 'sending' })).toBe(false);
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
        matchID: 'm'.repeat(120),
        spectator: true,
        anonymousToken: 't'.repeat(120),
      }).length,
    ).toBeLessThanOrEqual(128);

    expect(
      matchPlatformPresenceUserId({
        account: null,
        matchID: 'bgio-match-1',
        playerID: '0',
        spectator: false,
        anonymousToken: 'ignored',
      }),
    ).toBe('guest:match:bgio-match-1:player:0');
    expect(
      matchPlatformPresenceUserId({
        account: null,
        matchID: 'm'.repeat(120),
        playerID: 'p'.repeat(120),
        spectator: false,
        anonymousToken: 'ignored',
      }).length,
    ).toBeLessThanOrEqual(128);
  });
});
