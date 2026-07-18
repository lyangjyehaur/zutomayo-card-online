import { afterEach, describe, expect, it } from 'vitest';
import { createPlatformSeatToken, verifyPlatformSeatToken } from '../../seatToken';

const originalSecret = process.env.PLATFORM_SEAT_TOKEN_SECRET;

afterEach(() => {
  process.env.PLATFORM_SEAT_TOKEN_SECRET = originalSecret;
});

describe('platform seat tokens', () => {
  it('verifies a signed boardgame seat proof for the matching match and player', () => {
    process.env.PLATFORM_SEAT_TOKEN_SECRET = 'test-seat-token-secret-at-least-32-characters';
    const token = createPlatformSeatToken({
      matchID: 'bgio-match-1',
      playerID: '0',
      userId: 'u_alice',
      now: 1000,
      ttlMs: 5000,
    });

    const verify = (matchID: string, playerID: '0' | '1', now: number) =>
      verifyPlatformSeatToken({ token, matchID, playerID, userId: 'u_alice', now });
    expect(verify('bgio-match-1', '0', 2000)).toBe(true);
    expect(verify('bgio-match-2', '0', 2000)).toBe(false);
    expect(verify('bgio-match-1', '1', 2000)).toBe(false);
    expect(verify('bgio-match-1', '0', 7000)).toBe(false);
  });

  it('binds a seat proof to the server-derived account identity', () => {
    process.env.PLATFORM_SEAT_TOKEN_SECRET = 'test-seat-token-secret-at-least-32-characters';
    const token = createPlatformSeatToken({
      matchID: 'bgio-match-1',
      playerID: '0',
      userId: 'u_alice',
      now: 1000,
      ttlMs: 5000,
    });

    expect(
      verifyPlatformSeatToken({ token, matchID: 'bgio-match-1', playerID: '0', userId: 'u_alice', now: 2000 }),
    ).toBe(true);
    expect(verifyPlatformSeatToken({ token, matchID: 'bgio-match-1', playerID: '0', userId: 'u_bob', now: 2000 })).toBe(
      false,
    );
  });
});
