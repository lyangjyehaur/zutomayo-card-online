import crypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthContext } from '@colyseus/core';
import { QuickMatchRoom } from '../QuickMatchRoom';
import { configurePlatformJwtRevocationStore } from '../jwt';
import type { PlatformClient } from '../types';

const originalJwtSecret = process.env.JWT_SECRET;

function jwtFor(userId: string): string {
  const secret = 'quick-match-test-secret-at-least-32-characters';
  process.env.JWT_SECRET = secret;
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const input = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: userId, exp: Math.floor(Date.now() / 1000) + 3600 })}`;
  return `${input}.${crypto.createHmac('sha256', secret).update(input).digest('base64url')}`;
}

function context(userId: string): AuthContext {
  return { headers: new Headers({ cookie: `zutomayo_session=${jwtFor(userId)}` }), ip: '127.0.0.1' };
}

type TestClient = PlatformClient & { send: ReturnType<typeof vi.fn> };

function client(sessionId: string, auth: PlatformClient['auth']): TestClient {
  return { sessionId, auth, send: vi.fn() } as unknown as TestClient;
}

describe('quick-match deck reservations', () => {
  afterEach(() => {
    process.env.JWT_SECRET = originalJwtSecret;
    configurePlatformJwtRevocationStore(null);
  });

  it('persists each server-supported reservation and relays the guest deck', async () => {
    const room = new QuickMatchRoom();
    vi.spyOn(room, 'broadcast').mockImplementation(() => undefined as never);
    vi.spyOn(room, 'setMatchmaking').mockResolvedValue(undefined);
    vi.spyOn(room, 'lock').mockImplementation(() => undefined as never);
    vi.spyOn(room, 'onMessage').mockImplementation((() => room) as never);
    vi.spyOn(room.clock, 'setTimeout').mockImplementation(((handler: () => void, timeout?: number) => {
      if (timeout && timeout <= 100) handler();
      return { clear: vi.fn() };
    }) as never);

    await room.onCreate();
    const hostAuth = await room.onAuth(
      {} as never,
      { userId: 'u_host', displayName: 'Host', deckName: 'dark' },
      context('u_host'),
    );
    const guestAuth = await room.onAuth(
      {} as never,
      { userId: 'u_guest', displayName: 'Guest', deckName: 'flame' },
      context('u_guest'),
    );
    const host = client('host', hostAuth);
    const guest = client('guest', guestAuth);
    room.clients.push(host);
    await room.onJoin(host, { deckName: 'dark' });
    room.clients.push(guest);
    await room.onJoin(guest, { deckName: 'flame' });

    expect(host.userData?.deckName).toBe('dark');
    expect(guest.userData?.deckName).toBe('flame');
    expect(host.send).toHaveBeenCalledWith(
      'quickMatchMatched',
      expect.objectContaining({ deckName: 'dark', opponent: expect.objectContaining({ deckName: 'flame' }) }),
    );
  });

  it('rejects unsupported or client-only deck identifiers in production', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const room = new QuickMatchRoom();
      configurePlatformJwtRevocationStore({ get: vi.fn(async () => null) });
      await expect(
        room.onAuth(
          {} as never,
          { userId: 'u_host', displayName: 'Host', deckName: 'server:other-user-deck' },
          context('u_host'),
        ),
      ).rejects.toThrow('server-supported deck');
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});
