import crypto from 'node:crypto';
import type { AuthContext } from '@colyseus/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authenticatePlatformClient } from '../auth';
import { InviteRoom, parseFriendInviteId } from '../InviteRoom';
import {
  configurePlatformJwtAccountStore,
  configurePlatformJwtRevocationStore,
  createPostgresPlatformJwtAccountStore,
  platformAuthTokenFromContext,
  verifyPlatformJwtUserId,
  verifyPlatformJwtUserIdAsync,
} from '../jwt';
import { QuickMatchRoom } from '../QuickMatchRoom';
import { createEmptyPlatformBlockStore } from '../../blockStore';

const originalJwtSecret = process.env.JWT_SECRET;

function base64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signToken(input: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(input).digest('base64url');
}

function createJwt(
  userId: string,
  secret: string,
  options: {
    expiresInSeconds?: number;
    typ?: string;
    issuedAt?: number;
    sessionIat?: number;
    jti?: string;
    authVersion?: number;
  } = {},
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64urlJson({ alg: 'HS256', typ: 'JWT' });
  const payload = base64urlJson({
    sub: userId,
    userId,
    iat: options.issuedAt ?? now,
    ...(options.sessionIat !== undefined ? { sessionIat: options.sessionIat } : {}),
    exp: now + (options.expiresInSeconds ?? 3600),
    ...(options.typ ? { typ: options.typ } : {}),
    ...(options.jti ? { jti: options.jti } : {}),
    ...(options.authVersion !== undefined ? { authVersion: options.authVersion } : {}),
  });
  const input = `${header}.${payload}`;
  return `${input}.${signToken(input, secret)}`;
}

function authContext(headers: Record<string, string> = {}, token?: string): AuthContext {
  return {
    headers: new Headers(headers),
    ip: '127.0.0.1',
    token,
  };
}

function cookieAuthContext(userId: string): AuthContext {
  process.env.JWT_SECRET = 'test-platform-jwt-secret-at-least-32-characters';
  const token = createJwt(userId, process.env.JWT_SECRET);
  return authContext({ cookie: `zutomayo_session=${encodeURIComponent(token)}` });
}

afterEach(() => {
  process.env.JWT_SECRET = originalJwtSecret;
  configurePlatformJwtRevocationStore(null);
  configurePlatformJwtAccountStore(null);
  QuickMatchRoom.configureBlockStore(createEmptyPlatformBlockStore());
  InviteRoom.configureBlockStore(createEmptyPlatformBlockStore());
  InviteRoom.configureFriendStore(
    {
      async listFriendUserIds() {
        return [];
      },
    },
    { enforceFriendship: false },
  );
});

describe('platform room auth', () => {
  it('extracts platform auth token only from the session cookie', () => {
    const context = authContext({
      authorization: 'Bearer bearer-token',
      cookie: 'zutomayo_session=cookie-token',
    });
    expect(platformAuthTokenFromContext(context)).toBe('cookie-token');
  });

  it('does not accept bearer or websocket query tokens as platform account identity', () => {
    expect(platformAuthTokenFromContext(authContext({ authorization: 'Bearer bearer-token' }))).toBe('');
    expect(platformAuthTokenFromContext(authContext({}, 'query-token'))).toBe('');
  });

  it('extracts auth token from the session cookie among other cookies', () => {
    const context = authContext({
      cookie: `other=1; zutomayo_session=${encodeURIComponent('cookie.token.value')}`,
    });
    expect(platformAuthTokenFromContext(context)).toBe('cookie.token.value');
  });

  it('verifies access JWT user ids and rejects refresh tokens', () => {
    const secret = 'test-platform-jwt-secret-at-least-32-characters';
    const accessToken = createJwt('u_verified', secret);
    const refreshToken = createJwt('u_verified', secret, { typ: 'refresh' });

    expect(verifyPlatformJwtUserId(accessToken, secret)).toBe('u_verified');
    expect(verifyPlatformJwtUserId(refreshToken, secret)).toBe('');
    expect(verifyPlatformJwtUserId(accessToken, 'wrong-secret')).toBe('');
  });

  it('rejects access tokens revoked by the shared blacklist or user cutoff', async () => {
    const secret = 'test-platform-jwt-secret-at-least-32-characters';
    const token = createJwt('u_revoked', secret, { issuedAt: 100, jti: 'jti-revoked' });
    const get = vi.fn(async (key: string) => {
      if (key === 'blacklist:jti-revoked') return '1';
      return null;
    });
    await expect(verifyPlatformJwtUserIdAsync(token, secret, { get })).resolves.toBe('');
    expect(get).toHaveBeenCalledWith('blacklist:jti-revoked');

    const cutoffToken = createJwt('u_cutoff', secret, { issuedAt: 100, jti: 'jti-cutoff' });
    await expect(
      verifyPlatformJwtUserIdAsync(cutoffToken, secret, {
        get: async (key) => (key === 'auth:revoked-before:u_cutoff' ? '100' : null),
      }),
    ).resolves.toBe('');

    const refreshedToken = createJwt('u_refresh_chain', secret, {
      issuedAt: 200,
      sessionIat: 90,
      jti: 'jti-refresh-chain',
    });
    await expect(
      verifyPlatformJwtUserIdAsync(refreshedToken, secret, {
        get: async (key) => (key === 'auth:revoked-before:u_refresh_chain' ? '100' : null),
      }),
    ).resolves.toBe('');
  });

  it('fails closed when the revocation store is unavailable or missing in production', async () => {
    const secret = 'test-platform-jwt-secret-at-least-32-characters';
    const token = createJwt('u_store_failure', secret);
    await expect(
      verifyPlatformJwtUserIdAsync(token, secret, {
        get: async () => {
          throw new Error('redis unavailable');
        },
      }),
    ).resolves.toBe('');

    configurePlatformJwtRevocationStore(null, { timeoutMs: 5 });
    await expect(
      verifyPlatformJwtUserIdAsync(token, secret, {
        get: () => new Promise(() => undefined),
      }),
    ).resolves.toBe('');

    const previousEnvironment = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await expect(verifyPlatformJwtUserIdAsync(token, secret, null)).resolves.toBe('');
    } finally {
      process.env.NODE_ENV = previousEnvironment;
    }
  });

  it('checks every access token against the durable account auth version', async () => {
    const secret = 'test-platform-jwt-secret-at-least-32-characters';
    const redis = { get: vi.fn(async () => null) };
    const currentAuthVersion = vi.fn(async () => 2);
    const token = createJwt('u_durable', secret, { authVersion: 2, jti: 'jti-durable' });

    await expect(verifyPlatformJwtUserIdAsync(token, secret, redis, { currentAuthVersion })).resolves.toBe('u_durable');
    expect(currentAuthVersion).toHaveBeenCalledWith('u_durable');

    await expect(
      verifyPlatformJwtUserIdAsync(createJwt('u_durable', secret, { authVersion: 1 }), secret, redis, {
        currentAuthVersion,
      }),
    ).resolves.toBe('');
  });

  it('rejects deleted, missing, and unreadable durable accounts', async () => {
    const secret = 'test-platform-jwt-secret-at-least-32-characters';
    const token = createJwt('u_deleted', secret, { authVersion: 3 });
    const redis = { get: vi.fn(async () => null) };

    await expect(
      verifyPlatformJwtUserIdAsync(token, secret, redis, { currentAuthVersion: async () => null }),
    ).resolves.toBe('');
    await expect(
      verifyPlatformJwtUserIdAsync(token, secret, redis, {
        currentAuthVersion: async () => {
          throw new Error('postgres unavailable');
        },
      }),
    ).resolves.toBe('');
  });

  it('reads auth_version and deleted_at from PostgreSQL', async () => {
    const query = vi.fn(
      async (): Promise<{
        rows: Array<{ auth_version: string; deleted_at: Date | string | null }>;
      }> => ({
        rows: [{ auth_version: '4', deleted_at: null }],
      }),
    );
    const store = createPostgresPlatformJwtAccountStore({ query } as never);

    await expect(store.currentAuthVersion('u_postgres')).resolves.toBe(4);
    expect(query).toHaveBeenCalledWith('SELECT auth_version, deleted_at FROM users WHERE id = $1', ['u_postgres']);

    query.mockResolvedValueOnce({ rows: [{ auth_version: '4', deleted_at: new Date() }] });
    await expect(store.currentAuthVersion('u_deleted')).resolves.toBeNull();
  });

  it('fails closed when the runtime requires a durable account store but none is configured', async () => {
    const secret = 'test-platform-jwt-secret-at-least-32-characters';
    configurePlatformJwtAccountStore(null, { required: true });
    await expect(
      verifyPlatformJwtUserIdAsync(createJwt('u_missing_store', secret), secret, { get: async () => null }),
    ).resolves.toBe('');
  });

  it('uses verified cookie identity instead of client supplied user id', () => {
    process.env.JWT_SECRET = 'test-platform-jwt-secret-at-least-32-characters';
    const token = createJwt('u_cookie_user', process.env.JWT_SECRET);
    const auth = authenticatePlatformClient(
      { userId: 'u_spoofed', displayName: 'Alice', role: 'player' },
      authContext({ cookie: `zutomayo_session=${encodeURIComponent(token)}` }),
    );

    expect(auth).toMatchObject({
      userId: 'u_cookie_user',
      displayName: 'Alice',
      role: 'player',
      authenticated: true,
    });
  });

  it('falls back when an unauthenticated client supplies an account-shaped user id', () => {
    process.env.JWT_SECRET = 'test-platform-jwt-secret-at-least-32-characters';
    for (const suppliedUserId of ['u_spoofed', 'user:u_spoofed', 'logto:u_spoofed', 'account:1234']) {
      const auth = authenticatePlatformClient(
        { userId: suppliedUserId, displayName: 'Mallory', role: 'player' },
        authContext(),
      );

      expect(auth.authenticated).toBe(false);
      expect(auth.userId).toMatch(/^guest:/);
      expect(auth.userId).not.toBe(suppliedUserId);
    }
  });

  it('allows guest-shaped anonymous ids without JWT', () => {
    const auth = authenticatePlatformClient(
      { userId: 'anon:1234', displayName: 'Guest', role: 'spectator' },
      authContext(),
    );

    expect(auth).toMatchObject({
      userId: 'anon:1234',
      authenticated: false,
      role: 'spectator',
    });

    expect(
      authenticatePlatformClient({ userId: 'guest:room-1234', displayName: 'Guest', role: 'spectator' }, authContext()),
    ).toMatchObject({
      userId: 'guest:room-1234',
      authenticated: false,
      role: 'spectator',
    });
  });

  it('does not accept client-reported moderator platform roles', () => {
    expect(
      authenticatePlatformClient({ userId: 'anon:1234', displayName: 'Guest Mod', role: 'moderator' }, authContext()),
    ).toMatchObject({
      userId: 'anon:1234',
      authenticated: false,
      role: 'spectator',
    });

    expect(
      authenticatePlatformClient(
        { userId: 'u_spoofed', displayName: 'Verified Mod', role: 'moderator' },
        cookieAuthContext('u_verified'),
      ),
    ).toMatchObject({
      userId: 'u_verified',
      authenticated: true,
      role: 'spectator',
    });
  });

  it('requires verified account identity for quick matchmaking and invites', async () => {
    const quickRoom = new QuickMatchRoom();
    const inviteRoom = new InviteRoom();

    await expect(
      quickRoom.onAuth({} as never, { userId: 'u_spoofed', displayName: 'Mallory' }, authContext()),
    ).rejects.toThrow('Authentication required');
    await expect(
      inviteRoom.onAuth(
        {} as never,
        { inviteId: 'invite_1', userId: 'u_spoofed', displayName: 'Mallory' },
        authContext(),
      ),
    ).rejects.toThrow('Authentication required');
  });

  it('checks revocation before reserving a quick-match identity', async () => {
    const secret = 'test-platform-jwt-secret-at-least-32-characters';
    process.env.JWT_SECRET = secret;
    const token = createJwt('u_revoked_queue', secret, { jti: 'jti-queue' });
    const context = authContext({ cookie: `zutomayo_session=${encodeURIComponent(token)}` });
    const room = new QuickMatchRoom();

    configurePlatformJwtRevocationStore({
      get: async (key) => (key === 'blacklist:jti-queue' ? '1' : null),
    });
    await expect(
      room.onAuth({} as never, { userId: 'u_revoked_queue', displayName: 'Player' }, context),
    ).rejects.toThrow('Invalid or revoked authentication');

    configurePlatformJwtRevocationStore({ get: async () => null });
    await expect(
      room.onAuth({} as never, { userId: 'u_revoked_queue', displayName: 'Player' }, context),
    ).resolves.toMatchObject({ userId: 'u_revoked_queue', authenticated: true });
  });

  it('prevents the same account from occupying both quick match seats', async () => {
    const quickRoom = new QuickMatchRoom();
    quickRoom.clients.push({
      sessionId: 'session_existing',
      userData: {
        sessionId: 'session_existing',
        userId: 'u_queued',
        displayName: 'Queued',
        role: 'player',
        joinedAt: 1000,
      },
    } as never);

    await expect(
      quickRoom.onAuth(
        {} as never,
        { userId: 'u_spoofed', displayName: 'Queued Again' },
        cookieAuthContext('u_queued'),
      ),
    ).rejects.toThrow('Already queued');

    await expect(
      quickRoom.onAuth({} as never, { userId: 'u_other', displayName: 'Other' }, cookieAuthContext('u_other')),
    ).resolves.toMatchObject({ userId: 'u_other', authenticated: true, role: 'player' });
  });

  it('rejects quick-match opponents when either account has blocked the other', async () => {
    const areUsersBlocked = vi.fn(async (firstUserId: string, secondUserId: string) =>
      [firstUserId, secondUserId].includes('u_blocked'),
    );
    QuickMatchRoom.configureBlockStore({ areUsersBlocked });
    const quickRoom = new QuickMatchRoom();

    await expect(
      quickRoom.onAuth({} as never, { displayName: 'First' }, cookieAuthContext('u_first')),
    ).resolves.toMatchObject({ userId: 'u_first' });
    await expect(
      quickRoom.onAuth({} as never, { displayName: 'Blocked' }, cookieAuthContext('u_blocked')),
    ).rejects.toThrow('Quick match is not allowed');
    expect(areUsersBlocked).toHaveBeenCalledWith('u_blocked', 'u_first');
  });

  it('prunes an expired pre-join quick-match reservation after an auth disconnect', async () => {
    const quickRoom = new QuickMatchRoom();
    await expect(
      quickRoom.onAuth(
        { sessionId: 'session_disconnected' } as never,
        { displayName: 'First' },
        cookieAuthContext('u_reconnect'),
      ),
    ).resolves.toMatchObject({ userId: 'u_reconnect' });
    const reservation = quickRoom['deckReservations'].get('u_reconnect');
    expect(reservation).toBeDefined();
    if (reservation) reservation.expiresAt = 0;

    await expect(
      quickRoom.onAuth(
        { sessionId: 'session_retry' } as never,
        { displayName: 'Retry' },
        cookieAuthContext('u_reconnect'),
      ),
    ).resolves.toMatchObject({ userId: 'u_reconnect' });
    expect(quickRoom['deckReservations'].get('u_reconnect')?.sessionId).toBe('session_retry');
  });

  it('rejects a quick-match join after its auth reservation expires', async () => {
    const quickRoom = new QuickMatchRoom();
    const client = { sessionId: 'session_expired' } as never;
    const auth = await quickRoom.onAuth(client, { displayName: 'Expired' }, cookieAuthContext('u_expired'));
    const reservation = quickRoom['deckReservations'].get('u_expired');
    expect(reservation).toBeDefined();
    if (reservation) reservation.expiresAt = Date.now() - 1;
    Object.assign(client, { auth });

    await expect(quickRoom.onJoin(client)).rejects.toThrow('Expired quick-match reservation');
    expect(quickRoom['deckReservations'].has('u_expired')).toBe(false);
    expect(quickRoom['authenticatedUserIds'].has('u_expired')).toBe(false);
  });

  it('parses directional friend invite ids', () => {
    expect(parseFriendInviteId('friend:v1:logto%3Au_1:u%202')).toEqual({
      inviterUserId: 'logto:u_1',
      targetUserId: 'u 2',
    });
    expect(parseFriendInviteId('invite_1')).toBeNull();
    expect(parseFriendInviteId('friend:v1:u_1')).toBeNull();
    expect(parseFriendInviteId('friend:v1:u_1:u_1')).toBeNull();
    expect(parseFriendInviteId('friend:v1:%E0%A4%A:u_2')).toBeNull();
  });

  it('requires directional friend invite ids for authenticated invite room joins', async () => {
    const inviteRoom = new InviteRoom();

    await expect(
      inviteRoom.onAuth(
        {} as never,
        { inviteId: 'invite_1', targetUserId: 'u_target', displayName: 'Alice' },
        cookieAuthContext('u_inviter'),
      ),
    ).rejects.toThrow('Invalid invite id');

    await expect(
      inviteRoom.onAuth(
        {} as never,
        { inviteId: 'friend:v1:u_inviter:u_inviter', targetUserId: 'u_inviter', displayName: 'Alice' },
        cookieAuthContext('u_inviter'),
      ),
    ).rejects.toThrow('Invalid invite id');
  });

  it('allows only friend invite participants to join invite rooms', async () => {
    const inviteRoom = new InviteRoom();
    const inviteId = `friend:v1:${encodeURIComponent('u_inviter')}:${encodeURIComponent('u_target')}`;

    await expect(
      inviteRoom.onAuth(
        {} as never,
        { inviteId, targetUserId: 'u_target', displayName: 'Alice' },
        cookieAuthContext('u_inviter'),
      ),
    ).resolves.toMatchObject({ userId: 'u_inviter', authenticated: true, role: 'player' });

    await expect(
      inviteRoom.onAuth(
        {} as never,
        { inviteId, targetUserId: 'u_target', displayName: 'Bob' },
        cookieAuthContext('u_target'),
      ),
    ).resolves.toMatchObject({ userId: 'u_target', authenticated: true, role: 'player' });

    await expect(
      inviteRoom.onAuth(
        {} as never,
        { inviteId, targetUserId: 'u_target', displayName: 'Mallory' },
        cookieAuthContext('u_other'),
      ),
    ).rejects.toThrow('Invite access denied');
  });

  it('binds invite joins to the invite room that was created', async () => {
    const inviteRoom = new InviteRoom();
    const inviteId = `friend:v1:${encodeURIComponent('u_inviter')}:${encodeURIComponent('u_target')}`;
    const otherInviteId = `friend:v1:${encodeURIComponent('u_inviter')}:${encodeURIComponent('u_other')}`;
    vi.spyOn(inviteRoom, 'setMatchmaking').mockResolvedValue(undefined);

    await inviteRoom.onCreate({ inviteId, targetUserId: 'u_target' });

    await expect(
      inviteRoom.onAuth(
        {} as never,
        { inviteId: otherInviteId, targetUserId: 'u_other', displayName: 'Alice' },
        cookieAuthContext('u_inviter'),
      ),
    ).rejects.toThrow('Invite access denied');

    await expect(
      inviteRoom.onAuth(
        {} as never,
        { inviteId, targetUserId: 'u_target', displayName: 'Alice' },
        cookieAuthContext('u_inviter'),
      ),
    ).resolves.toMatchObject({ userId: 'u_inviter', authenticated: true, role: 'player' });
  });

  it('authorizes opaque room-id joins from the room invite and current cookie identity', async () => {
    const inviteRoom = new InviteRoom();
    const inviteId = `friend:v1:${encodeURIComponent('u_inviter')}:${encodeURIComponent('u_target')}`;
    const listFriendUserIds = vi.fn(async (userId: string) => (userId === 'u_target' ? ['u_inviter'] : ['u_target']));
    InviteRoom.configureFriendStore({ listFriendUserIds }, { enforceFriendship: true });
    vi.spyOn(inviteRoom, 'setMatchmaking').mockResolvedValue(undefined);
    await inviteRoom.onCreate({ inviteId, targetUserId: 'u_target' });

    await expect(
      inviteRoom.onAuth({} as never, { userId: 'u_spoofed', displayName: 'Target' }, cookieAuthContext('u_target')),
    ).resolves.toMatchObject({ userId: 'u_target', authenticated: true, role: 'player' });
    expect(listFriendUserIds).toHaveBeenCalledWith('u_target');

    await expect(
      inviteRoom.onAuth({} as never, { displayName: 'Observer' }, cookieAuthContext('u_other')),
    ).rejects.toThrow('Invite access denied');

    const areUsersBlocked = vi.fn(async () => true);
    InviteRoom.configureBlockStore({ areUsersBlocked });
    await expect(
      inviteRoom.onAuth({} as never, { displayName: 'Target' }, cookieAuthContext('u_target')),
    ).rejects.toThrow('Invite blocked');
    expect(areUsersBlocked).toHaveBeenCalledWith('u_inviter', 'u_target');
  });

  it('requires configured durable friendship for production friend invite joins', async () => {
    const inviteRoom = new InviteRoom();
    const inviteId = `friend:v1:${encodeURIComponent('u_inviter')}:${encodeURIComponent('u_target')}`;
    const listFriendUserIds = vi.fn(async (userId: string) => (userId === 'u_inviter' ? ['u_target'] : []));
    InviteRoom.configureFriendStore({ listFriendUserIds }, { enforceFriendship: true });

    await expect(
      inviteRoom.onAuth(
        {} as never,
        { inviteId, targetUserId: 'u_target', displayName: 'Alice' },
        cookieAuthContext('u_inviter'),
      ),
    ).resolves.toMatchObject({ userId: 'u_inviter', authenticated: true, role: 'player' });
    expect(listFriendUserIds).toHaveBeenCalledWith('u_inviter');

    await expect(
      inviteRoom.onAuth(
        {} as never,
        { inviteId, targetUserId: 'u_target', displayName: 'Bob' },
        cookieAuthContext('u_target'),
      ),
    ).rejects.toThrow('Invite friendship required');
    expect(listFriendUserIds).toHaveBeenCalledWith('u_target');
  });

  it('rejects friend invite joins with mismatched target filters', async () => {
    const inviteRoom = new InviteRoom();
    const inviteId = `friend:v1:${encodeURIComponent('u_inviter')}:${encodeURIComponent('u_target')}`;

    await expect(
      inviteRoom.onAuth(
        {} as never,
        { inviteId, targetUserId: 'u_other', displayName: 'Alice' },
        cookieAuthContext('u_inviter'),
      ),
    ).rejects.toThrow('Invalid invite target');
  });

  it('derives friend invite room target metadata from invite id', async () => {
    const inviteRoom = new InviteRoom();
    const setMatchmaking = vi.spyOn(inviteRoom, 'setMatchmaking').mockResolvedValue(undefined);
    const inviteId = `friend:v1:${encodeURIComponent('u_inviter')}:${encodeURIComponent('u_target')}`;

    await inviteRoom.onCreate({ inviteId, targetUserId: 'u_other' });

    expect(setMatchmaking).toHaveBeenLastCalledWith({
      metadata: expect.objectContaining({
        inviteId,
        targetUserId: 'u_target',
      }),
    });
  });
});
