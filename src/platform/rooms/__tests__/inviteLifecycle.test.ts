import { describe, expect, it, vi } from 'vitest';
import { InviteRoom } from '../InviteRoom';
import type { BoardgameMatchReadyMessage, InviteResponseMessage, PlatformAuth, PlatformClient } from '../types';

type InviteHandler = (client: PlatformClient, message: InviteResponseMessage) => void;
type BoardgameMatchReadyHandler = (client: PlatformClient, message: BoardgameMatchReadyMessage) => void;

function client(sessionId: string, auth: PlatformAuth): PlatformClient & { send: ReturnType<typeof vi.fn> } {
  return {
    sessionId,
    auth,
    send: vi.fn(),
  } as PlatformClient & { send: ReturnType<typeof vi.fn> };
}

function inviteId(inviterUserId = 'u_inviter', targetUserId = 'u_target'): string {
  return `friend:v1:${encodeURIComponent(inviterUserId)}:${encodeURIComponent(targetUserId)}`;
}

async function flushAsyncHandlers(): Promise<void> {
  await Promise.resolve();
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
  it('lets the target accept and then lets the inviter relay the boardgame match id', async () => {
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
    expect(broadcast).toHaveBeenCalledWith('boardgameMatchReady', { boardgameMatchID: 'bgio-match-1' });
    expect(setMatchmaking).toHaveBeenLastCalledWith({
      metadata: expect.objectContaining({
        status: 'accepted',
        roomCode: 'bgio-match-1',
        boardgameMatchID: 'bgio-match-1',
      }),
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
});
