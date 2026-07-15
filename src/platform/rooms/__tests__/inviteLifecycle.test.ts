import crypto from 'node:crypto';
import type { AuthContext } from '@colyseus/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyPlatformBlockStore, type PlatformBlockStore } from '../../blockStore';
import { createEmptyPlatformFriendStore } from '../../friendStore';
import { InviteRoom } from '../InviteRoom';
import type { BoardgameMatchReadyMessage, InviteResponseMessage, PlatformAuth, PlatformClient } from '../types';

type InviteHandler = (client: PlatformClient, message: InviteResponseMessage) => void;
type BoardgameMatchReadyHandler = (client: PlatformClient, message: BoardgameMatchReadyMessage) => void;
const originalJwtSecret = process.env.JWT_SECRET;

function base64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signToken(input: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(input).digest('base64url');
}

function createJwt(userId: string, secret: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64urlJson({ alg: 'HS256', typ: 'JWT' });
  const payload = base64urlJson({
    sub: userId,
    userId,
    iat: now,
    exp: now + 3600,
  });
  const input = `${header}.${payload}`;
  return `${input}.${signToken(input, secret)}`;
}

function cookieAuthContext(userId: string): AuthContext {
  process.env.JWT_SECRET = 'test-platform-jwt-secret-at-least-32-characters';
  const token = createJwt(userId, process.env.JWT_SECRET);
  return {
    headers: new Headers({ cookie: `zutomayo_session=${encodeURIComponent(token)}` }),
    ip: '127.0.0.1',
  };
}

function client(
  sessionId: string,
  auth: PlatformAuth,
): PlatformClient & { send: ReturnType<typeof vi.fn>; leave: ReturnType<typeof vi.fn> } {
  return {
    sessionId,
    auth,
    send: vi.fn(),
    leave: vi.fn(),
  } as PlatformClient & { send: ReturnType<typeof vi.fn>; leave: ReturnType<typeof vi.fn> };
}

function inviteId(inviterUserId = 'u_inviter', targetUserId = 'u_target'): string {
  return `friend:v1:${encodeURIComponent(inviterUserId)}:${encodeURIComponent(targetUserId)}`;
}

async function flushAsyncHandlers(): Promise<void> {
  await Promise.resolve();
}

function delayedCommittedBlockStore(): {
  store: PlatformBlockStore;
  fenceEntered: Promise<void>;
  commitBlock: () => void;
} {
  let resolveFenceEntered!: () => void;
  let resolveCommit!: () => void;
  let committed = false;
  const fenceEntered = new Promise<void>((resolve) => {
    resolveFenceEntered = resolve;
  });
  const commit = new Promise<void>((resolve) => {
    resolveCommit = resolve;
  });
  return {
    store: {
      areUsersBlocked: async () => false,
      async withPairTransitionFence(_firstUserId, _secondUserId, transition) {
        resolveFenceEntered();
        await commit;
        return committed ? false : transition();
      },
    },
    fenceEntered,
    commitBlock() {
      committed = true;
      resolveCommit();
    },
  };
}

async function setupInviteRoom() {
  const room = new InviteRoom();
  const inviteHandlers = new Map<string, InviteHandler>();
  const boardgameHandlers = new Map<string, BoardgameMatchReadyHandler>();
  const setMatchmaking = vi.spyOn(room, 'setMatchmaking').mockResolvedValue(undefined);
  const broadcast = vi.spyOn(room, 'broadcast').mockImplementation(() => undefined as never);
  vi.spyOn(room, 'onMessage').mockImplementation(((
    type: string,
    handler: InviteHandler | BoardgameMatchReadyHandler,
  ) => {
    if (type === 'boardgameMatchReady') boardgameHandlers.set(type, handler as BoardgameMatchReadyHandler);
    else inviteHandlers.set(type, handler as InviteHandler);
    return room;
  }) as never);
  vi.spyOn(room.clock, 'setTimeout').mockImplementation(((_handler: () => void) => ({ clear: vi.fn() })) as never);
  vi.spyOn(room, 'disconnect').mockResolvedValue(undefined);

  await room.onCreate({ inviteId: inviteId(), targetUserId: 'u_target' });

  const inviter = client('session_inviter', {
    userId: 'u_inviter',
    displayName: 'Inviter',
    role: 'player',
    authenticated: true,
  });
  const target = client('session_target', {
    userId: 'u_target',
    displayName: 'Target',
    role: 'player',
    authenticated: true,
  });
  const observer = client('session_observer', {
    userId: 'u_observer',
    displayName: 'Observer',
    role: 'player',
    authenticated: true,
  });

  room.clients.push(inviter);
  await room.onJoin(inviter);
  room.clients.push(target);
  await room.onJoin(target);

  return {
    room,
    inviteHandlers,
    boardgameHandlers,
    setMatchmaking,
    broadcast,
    inviter,
    target,
    observer,
  };
}

describe('invite room lifecycle', () => {
  afterEach(() => {
    process.env.JWT_SECRET = originalJwtSecret;
    InviteRoom.configureBlockStore(createEmptyPlatformBlockStore());
    InviteRoom.configureFriendStore(createEmptyPlatformFriendStore());
    InviteRoom.clearActiveRoomsForTests();
  });

  it('lets the target accept and then lets the inviter relay the boardgame match id once', async () => {
    const { inviteHandlers, boardgameHandlers, setMatchmaking, broadcast, inviter, target, observer } =
      await setupInviteRoom();

    inviteHandlers.get('acceptInvite')?.(observer, {});
    expect(broadcast).not.toHaveBeenCalledWith('inviteAccepted', expect.anything());

    inviteHandlers.get('acceptInvite')?.(target, {});
    expect(broadcast).toHaveBeenCalledWith(
      'inviteAccepted',
      expect.objectContaining({
        inviteId: inviteId(),
        acceptedBy: expect.objectContaining({ userId: 'u_target' }),
      }),
    );
    expect(setMatchmaking).toHaveBeenLastCalledWith({
      metadata: expect.objectContaining({
        status: 'accepted',
        boardgameMatchID: undefined,
      }),
    });

    boardgameHandlers.get('boardgameMatchReady')?.(target, { boardgameMatchID: 'bgio-ignored' });
    expect(broadcast).not.toHaveBeenCalledWith('boardgameMatchReady', { boardgameMatchID: 'bgio-ignored' });

    boardgameHandlers.get('boardgameMatchReady')?.(inviter, { boardgameMatchID: ' bgio-match-1 ' });
    await vi.waitFor(() =>
      expect(broadcast).toHaveBeenCalledWith('boardgameMatchReady', { boardgameMatchID: 'bgio-match-1' }),
    );
    expect(setMatchmaking).toHaveBeenLastCalledWith({
      metadata: expect.objectContaining({
        status: 'finished',
        roomCode: 'bgio-match-1',
        boardgameMatchID: 'bgio-match-1',
      }),
    });

    broadcast.mockClear();
    setMatchmaking.mockClear();
    boardgameHandlers.get('boardgameMatchReady')?.(inviter, { boardgameMatchID: 'bgio-match-2' });
    expect(broadcast).not.toHaveBeenCalledWith('boardgameMatchReady', expect.anything());
    expect(setMatchmaking).not.toHaveBeenCalled();
  });

  it('rejects the final invite relay when a block commits before delayed outbox delivery', async () => {
    const delayedBlock = delayedCommittedBlockStore();
    InviteRoom.configureBlockStore(delayedBlock.store);
    InviteRoom.configureFriendStore(
      {
        listFriendUserIds: async (userId) => (userId === 'u_inviter' ? ['u_target'] : ['u_inviter']),
        areUsersFriends: async () => true,
      },
      { enforceFriendship: true },
    );
    const { room, inviteHandlers, boardgameHandlers, broadcast, setMatchmaking, inviter, target } =
      await setupInviteRoom();

    inviteHandlers.get('acceptInvite')?.(target, {});
    await vi.waitFor(() => expect(room['status']).toBe('accepted'));
    broadcast.mockClear();
    setMatchmaking.mockClear();

    boardgameHandlers.get('boardgameMatchReady')?.(inviter, { boardgameMatchID: 'bgio-must-not-start' });
    await delayedBlock.fenceEntered;
    expect(broadcast).not.toHaveBeenCalledWith('boardgameMatchReady', expect.anything());
    expect(room['status']).toBe('accepted');

    // The outbox projection remains delayed; the final DB fence alone must
    // observe the committed block and revoke the relay.
    delayedBlock.commitBlock();
    await vi.waitFor(() =>
      expect(broadcast).toHaveBeenCalledWith('inviteCancelled', {
        inviteId: inviteId(),
        reason: 'relationship_changed',
      }),
    );

    expect(broadcast).not.toHaveBeenCalledWith('boardgameMatchReady', expect.anything());
    expect(room['status']).toBe('cancelled');
    expect(room['boardgameMatchID']).toBeUndefined();
    expect(setMatchmaking).toHaveBeenLastCalledWith({
      metadata: expect.objectContaining({ status: 'cancelled', boardgameMatchID: undefined }),
    });
  });

  it('fails the final invite relay closed when authoritative friendship is unavailable', async () => {
    InviteRoom.configureFriendStore(
      {
        listFriendUserIds: async (userId) => (userId === 'u_inviter' ? ['u_target'] : ['u_inviter']),
        areUsersFriends: async () => {
          throw new Error('postgres unavailable');
        },
      },
      { enforceFriendship: true },
    );
    const { room, inviteHandlers, boardgameHandlers, broadcast, inviter, target } = await setupInviteRoom();
    inviteHandlers.get('acceptInvite')?.(target, {});
    await vi.waitFor(() => expect(room['status']).toBe('accepted'));
    broadcast.mockClear();

    boardgameHandlers.get('boardgameMatchReady')?.(inviter, { boardgameMatchID: 'bgio-must-not-start' });
    await vi.waitFor(() =>
      expect(broadcast).toHaveBeenCalledWith('inviteCancelled', {
        inviteId: inviteId(),
        reason: 'relationship_check_unavailable',
      }),
    );

    expect(broadcast).not.toHaveBeenCalledWith('boardgameMatchReady', expect.anything());
    expect(room['status']).toBe('cancelled');
    expect(room['boardgameMatchID']).toBeUndefined();
  });

  it('rechecks committed friendship removal even when its outbox event is delayed', async () => {
    let friendshipCurrent = true;
    InviteRoom.configureFriendStore(
      {
        listFriendUserIds: async (userId) => (userId === 'u_inviter' ? ['u_target'] : ['u_inviter']),
        areUsersFriends: async () => friendshipCurrent,
      },
      { enforceFriendship: true },
    );
    const { room, inviteHandlers, boardgameHandlers, broadcast, inviter, target } = await setupInviteRoom();
    inviteHandlers.get('acceptInvite')?.(target, {});
    await vi.waitFor(() => expect(room['status']).toBe('accepted'));
    broadcast.mockClear();

    friendshipCurrent = false;
    boardgameHandlers.get('boardgameMatchReady')?.(inviter, { boardgameMatchID: 'bgio-must-not-start' });
    await vi.waitFor(() =>
      expect(broadcast).toHaveBeenCalledWith('inviteCancelled', {
        inviteId: inviteId(),
        reason: 'relationship_changed',
      }),
    );

    expect(broadcast).not.toHaveBeenCalledWith('boardgameMatchReady', expect.anything());
    expect(room['status']).toBe('cancelled');
  });

  it('cancels an invite when friendship is removed before acceptance', async () => {
    let allowed = true;
    InviteRoom.configureFriendStore(
      {
        listFriendUserIds: async (userId) => {
          if (!allowed) return [];
          return userId === 'u_inviter' ? ['u_target'] : ['u_inviter'];
        },
      },
      { enforceFriendship: true },
    );
    const { inviteHandlers, broadcast, target } = await setupInviteRoom();

    allowed = false;
    inviteHandlers.get('acceptInvite')?.(target, {});
    await flushAsyncHandlers();
    await flushAsyncHandlers();
    await flushAsyncHandlers();
    await flushAsyncHandlers();

    expect(broadcast).not.toHaveBeenCalledWith('inviteAccepted', expect.anything());
    expect(broadcast).toHaveBeenCalledWith('inviteCancelled', {
      inviteId: inviteId(),
      reason: 'relationship_changed',
    });
  });

  it('derives the inviter from directional invite ids instead of first join order', async () => {
    const room = new InviteRoom();
    const inviteHandlers = new Map<string, InviteHandler>();
    const setMatchmaking = vi.spyOn(room, 'setMatchmaking').mockResolvedValue(undefined);
    const broadcast = vi.spyOn(room, 'broadcast').mockImplementation(() => undefined as never);
    vi.spyOn(room, 'onMessage').mockImplementation(((type: string, handler: InviteHandler) => {
      inviteHandlers.set(type, handler);
      return room;
    }) as never);
    vi.spyOn(room.clock, 'setTimeout').mockImplementation(((_handler: () => void) => ({ clear: vi.fn() })) as never);

    const target = client('session_target', {
      userId: 'u_target',
      displayName: 'Target',
      role: 'player',
      authenticated: true,
    });
    const inviter = client('session_inviter', {
      userId: 'u_inviter',
      displayName: 'Inviter',
      role: 'player',
      authenticated: true,
    });

    await room.onCreate({ inviteId: inviteId(), targetUserId: 'u_target' });
    room.clients.push(target);
    await room.onJoin(target);

    inviteHandlers.get('acceptInvite')?.(target, {});
    inviteHandlers.get('cancelInvite')?.(target, { reason: 'target-first' });
    await flushAsyncHandlers();
    expect(broadcast).not.toHaveBeenCalledWith('inviteAccepted', expect.anything());
    expect(broadcast).not.toHaveBeenCalledWith('inviteCancelled', expect.anything());

    room.clients.push(inviter);
    await room.onJoin(inviter);

    inviteHandlers.get('acceptInvite')?.(target, {});

    expect(broadcast).toHaveBeenCalledWith(
      'inviteAccepted',
      expect.objectContaining({
        inviteId: inviteId(),
        acceptedBy: expect.objectContaining({ userId: 'u_target' }),
      }),
    );
    expect(setMatchmaking).toHaveBeenLastCalledWith({
      metadata: expect.objectContaining({ inviteId: inviteId(), status: 'accepted', targetUserId: 'u_target' }),
    });
  });

  it('transfers pending invite ownership to the same inviter reconnect session', async () => {
    const { room, inviteHandlers, setMatchmaking, broadcast, inviter } = await setupInviteRoom();
    const reconnectingInviter = client('session_inviter_new', {
      userId: 'u_inviter',
      displayName: 'Inviter',
      role: 'player',
      authenticated: true,
    });

    room.clients.push(reconnectingInviter);
    await room.onJoin(reconnectingInviter);
    broadcast.mockClear();
    setMatchmaking.mockClear();

    await room.onLeave(inviter);

    expect(broadcast).not.toHaveBeenCalledWith('inviteCancelled', expect.anything());
    expect(broadcast).toHaveBeenCalledWith(
      'inviteSnapshot',
      expect.objectContaining({
        status: 'pending',
        inviter: expect.objectContaining({ sessionId: 'session_inviter_new', userId: 'u_inviter' }),
      }),
    );
    expect(setMatchmaking).toHaveBeenLastCalledWith({
      metadata: expect.objectContaining({ status: 'pending', boardgameMatchID: undefined }),
    });

    inviteHandlers.get('cancelInvite')?.(reconnectingInviter, { reason: 'reconnected-cancel' });
    await flushAsyncHandlers();

    expect(broadcast).toHaveBeenCalledWith('inviteCancelled', {
      inviteId: inviteId(),
      reason: 'reconnected-cancel',
    });
  });

  it('lets a reconnected inviter relay the accepted invite boardgame match id', async () => {
    const { room, inviteHandlers, boardgameHandlers, setMatchmaking, broadcast, inviter, target } =
      await setupInviteRoom();
    const reconnectingInviter = client('session_inviter_new', {
      userId: 'u_inviter',
      displayName: 'Inviter',
      role: 'player',
      authenticated: true,
    });

    room.clients.push(reconnectingInviter);
    await room.onJoin(reconnectingInviter);
    inviteHandlers.get('acceptInvite')?.(target, {});
    await room.onLeave(inviter);
    broadcast.mockClear();
    setMatchmaking.mockClear();

    boardgameHandlers.get('boardgameMatchReady')?.(inviter, { boardgameMatchID: 'bgio-old-session-ignored' });
    expect(broadcast).not.toHaveBeenCalledWith('boardgameMatchReady', expect.anything());

    boardgameHandlers.get('boardgameMatchReady')?.(reconnectingInviter, { boardgameMatchID: ' bgio-match-1 ' });
    await vi.waitFor(() =>
      expect(broadcast).toHaveBeenCalledWith('boardgameMatchReady', { boardgameMatchID: 'bgio-match-1' }),
    );
    expect(setMatchmaking).toHaveBeenLastCalledWith({
      metadata: expect.objectContaining({
        status: 'finished',
        roomCode: 'bgio-match-1',
        boardgameMatchID: 'bgio-match-1',
      }),
    });
  });

  it('keeps accepted invites joinable for relay reconnects and gates finished invite recovery', async () => {
    const { room, inviteHandlers, boardgameHandlers, target, inviter } = await setupInviteRoom();

    inviteHandlers.get('acceptInvite')?.(target, {});

    await expect(
      room.onAuth(
        {} as PlatformClient,
        { inviteId: inviteId(), targetUserId: 'u_target', displayName: 'Inviter Reconnect' },
        cookieAuthContext('u_inviter'),
      ),
    ).resolves.toMatchObject({ userId: 'u_inviter', authenticated: true, role: 'player' });

    boardgameHandlers.get('boardgameMatchReady')?.(inviter, { boardgameMatchID: 'bgio-match-1' });
    await vi.waitFor(() => expect(room['status']).toBe('finished'));

    await expect(
      room.onAuth(
        {} as PlatformClient,
        { inviteId: inviteId(), targetUserId: 'u_target', displayName: 'Inviter Reconnect' },
        cookieAuthContext('u_inviter'),
      ),
    ).rejects.toThrow('Invite is not joinable');

    await expect(
      room.onAuth(
        {} as PlatformClient,
        { inviteId: inviteId(), targetUserId: 'u_target', displayName: 'Target Reconnect', status: 'finished' },
        cookieAuthContext('u_target'),
      ),
    ).resolves.toMatchObject({ userId: 'u_target', authenticated: true, role: 'player' });

    vi.mocked(room.clock.setTimeout).mockImplementation(((handler: () => void) => {
      handler();
      return { clear: vi.fn() };
    }) as never);
    const reconnectingTarget = client('session_target_reconnect', {
      userId: 'u_target',
      displayName: 'Target',
      role: 'player',
      authenticated: true,
    });
    room.clients.push(reconnectingTarget);
    await room.onJoin(reconnectingTarget);

    expect(reconnectingTarget.send).toHaveBeenCalledWith(
      'inviteSnapshot',
      expect.objectContaining({ status: 'finished', boardgameMatchID: 'bgio-match-1' }),
    );
    expect(reconnectingTarget.send).toHaveBeenCalledWith('boardgameMatchReady', {
      boardgameMatchID: 'bgio-match-1',
    });

    const declinedRoom = await setupInviteRoom();
    declinedRoom.inviteHandlers.get('declineInvite')?.(declinedRoom.target, { reason: 'busy' });

    await expect(
      declinedRoom.room.onAuth(
        {} as PlatformClient,
        { inviteId: inviteId(), targetUserId: 'u_target', displayName: 'Target Reconnect' },
        cookieAuthContext('u_target'),
      ),
    ).rejects.toThrow('Invite is not joinable');
  });

  it('lets only the target decline a pending invite', async () => {
    const { inviteHandlers, setMatchmaking, broadcast, inviter, target } = await setupInviteRoom();

    inviteHandlers.get('declineInvite')?.(inviter, { reason: 'host-cannot-decline' });
    expect(broadcast).not.toHaveBeenCalledWith('inviteDeclined', expect.anything());

    inviteHandlers.get('declineInvite')?.(target, { reason: ' busy ' });
    expect(broadcast).toHaveBeenCalledWith(
      'inviteDeclined',
      expect.objectContaining({
        inviteId: inviteId(),
        declinedBy: expect.objectContaining({ userId: 'u_target' }),
        reason: 'busy',
      }),
    );
    expect(setMatchmaking).toHaveBeenLastCalledWith({
      metadata: expect.objectContaining({ status: 'declined' }),
    });
  });

  it('cancels a pending invite immediately when friendship is removed', async () => {
    const { broadcast } = await setupInviteRoom();

    await InviteRoom.handleRelationshipChange({
      version: 1,
      eventId: 'relationship-event-invite',
      kind: 'friendship_removed',
      userIds: ['u_inviter', 'u_target'],
      occurredAt: new Date().toISOString(),
    });

    expect(broadcast).toHaveBeenCalledWith('inviteCancelled', {
      inviteId: inviteId(),
      reason: 'relationship_changed',
    });
  });

  it('lets only the inviter cancel a pending invite', async () => {
    const { inviteHandlers, setMatchmaking, broadcast, inviter, target } = await setupInviteRoom();

    inviteHandlers.get('cancelInvite')?.(target, { reason: 'target-cannot-cancel' });
    expect(broadcast).not.toHaveBeenCalledWith('inviteCancelled', expect.anything());

    inviteHandlers.get('cancelInvite')?.(inviter, { reason: ' changed plans ' });
    await flushAsyncHandlers();

    expect(broadcast).toHaveBeenCalledWith('inviteCancelled', {
      inviteId: inviteId(),
      reason: 'changed plans',
    });
    expect(setMatchmaking).toHaveBeenLastCalledWith({
      metadata: expect.objectContaining({ status: 'cancelled' }),
    });
  });

  it('clears inviter presence when inviter leave cancels the invite', async () => {
    const { room, setMatchmaking, broadcast, inviter } = await setupInviteRoom();

    broadcast.mockClear();
    setMatchmaking.mockClear();
    await room.onLeave(inviter);

    expect(broadcast).toHaveBeenCalledWith('inviteCancelled', {
      inviteId: inviteId(),
      reason: 'inviter_left',
    });
    expect(broadcast).toHaveBeenCalledWith(
      'inviteSnapshot',
      expect.objectContaining({
        status: 'cancelled',
        inviter: undefined,
      }),
    );
    expect(setMatchmaking).toHaveBeenLastCalledWith({
      metadata: expect.objectContaining({ status: 'cancelled' }),
    });
  });
});
