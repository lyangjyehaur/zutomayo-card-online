import { describe, expect, it } from 'vitest';
import {
  buildPlatformFriendInviteId,
  isPlatformBoardgameRelayAcknowledged,
  normalizeSeatReservation,
  platformBoardgameMatchReadyFromMessage,
  platformChatPreviewFromMessage,
  platformCustomRoomSnapshotFromMessage,
  platformInviteAcceptedFromMessage,
  platformInviteCancelledFromMessage,
  platformInviteDeclinedFromMessage,
  platformInviteSnapshotFromMessage,
  platformOnlineCountFromMessage,
  platformPresenceFromMatchShellMessage,
  platformQuickMatchMatchedFromMessage,
  platformQuickMatchSnapshotFromMessage,
  resolvePlatformEndpoint,
  shouldLinkPlatformMatchShell,
} from '../platformClient';

describe('platform client helpers', () => {
  it('uses explicit platform endpoint when configured', () => {
    expect(
      resolvePlatformEndpoint('wss://platform.example.test', {
        protocol: 'https:',
        hostname: 'example.test',
        port: '',
      }),
    ).toBe('wss://platform.example.test');
  });

  it('derives the local platform port from the app origin', () => {
    expect(
      resolvePlatformEndpoint('', {
        protocol: 'http:',
        hostname: 'localhost',
        port: '3000',
      }),
    ).toBe('ws://localhost:3002');

    expect(
      resolvePlatformEndpoint('', {
        protocol: 'http:',
        hostname: '127.0.0.1',
        port: '5173',
      }),
    ).toBe('ws://127.0.0.1:3002');
  });

  it('keeps production host when no explicit platform endpoint is configured', () => {
    expect(
      resolvePlatformEndpoint(undefined, {
        protocol: 'https:',
        hostname: 'battle.example.test',
        port: '',
      }),
    ).toBe('wss://battle.example.test');
  });

  it('reads lobby online count from platform messages', () => {
    expect(platformOnlineCountFromMessage({ onlineCount: 4.9 })).toBe(4);
    expect(platformOnlineCountFromMessage({ players: 2, spectators: 7 })).toBe(9);
    expect(platformOnlineCountFromMessage({ onlineCount: -2 })).toBe(0);
    expect(platformOnlineCountFromMessage({})).toBeNull();
  });

  it('reads match shell presence from platform messages', () => {
    expect(platformPresenceFromMatchShellMessage({ players: 2.8, spectators: 4.2 })).toEqual({
      players: 2,
      spectators: 4,
    });
    expect(platformPresenceFromMatchShellMessage({ players: -1, spectators: 1 })).toEqual({
      players: 0,
      spectators: 1,
    });
    expect(platformPresenceFromMatchShellMessage({ players: 2 })).toBeNull();
  });

  it('only links match shells from credentialed boardgame players', () => {
    const base = {
      boardgameMatchID: 'bgio-match-1',
      userId: 'u_1',
      displayName: 'Alice',
    };

    expect(shouldLinkPlatformMatchShell({ ...base, role: 'spectator', hasBoardgameCredentials: true })).toBe(false);
    expect(shouldLinkPlatformMatchShell({ ...base, role: 'player' })).toBe(false);
    expect(shouldLinkPlatformMatchShell({ ...base, role: 'player', hasBoardgameCredentials: true })).toBe(false);
    expect(
      shouldLinkPlatformMatchShell({
        ...base,
        role: 'player',
        hasBoardgameCredentials: true,
        platformSeatToken: 'seat-token',
      }),
    ).toBe(true);
  });

  it('reads match shell chat preview messages defensively', () => {
    expect(
      platformChatPreviewFromMessage({
        conversationId: 'match:bgio-match-1',
        sender: {
          sessionId: 's_1',
          userId: 'u_1',
          displayName: 'Alice',
          role: 'player',
          joinedAt: 1000,
        },
        messageId: ' chat_msg_1 ',
        createdAt: 2000.9,
      }),
    ).toEqual({
      conversationId: 'match:bgio-match-1',
      sender: {
        sessionId: 's_1',
        userId: 'u_1',
        displayName: 'Alice',
        role: 'player',
        joinedAt: 1000,
      },
      messageId: 'chat_msg_1',
      createdAt: 2000,
    });
    expect(platformChatPreviewFromMessage({ messageId: 'chat_msg_1' })).toBeNull();
    expect(platformChatPreviewFromMessage({ sender: { sessionId: 's_1', userId: 'u_1' }, messageId: '' })).toBeNull();
  });

  it('reads quick match lifecycle messages defensively', () => {
    expect(
      platformQuickMatchSnapshotFromMessage({
        roomId: 'room_1',
        status: 'matched',
        players: [
          {
            sessionId: 's_1',
            userId: 'u_1',
            displayName: 'Alice',
            role: 'player',
            joinedAt: 1000,
          },
        ],
        hostSessionId: 's_1',
        boardgameMatchID: 'bgio-match-1',
      }),
    ).toEqual({
      roomId: 'room_1',
      status: 'matched',
      players: [
        {
          sessionId: 's_1',
          userId: 'u_1',
          displayName: 'Alice',
          role: 'player',
          joinedAt: 1000,
        },
      ],
      hostSessionId: 's_1',
      boardgameMatchID: 'bgio-match-1',
    });
    expect(platformQuickMatchSnapshotFromMessage({ roomId: 'room_1', status: 'unknown' })).toBeNull();
    expect(platformQuickMatchMatchedFromMessage({ roomId: 'room_1', role: 'host' })).toEqual({
      roomId: 'room_1',
      role: 'host',
      opponent: undefined,
    });
    expect(platformQuickMatchMatchedFromMessage({ roomId: 'room_1', role: 'observer' })).toBeNull();
    expect(platformBoardgameMatchReadyFromMessage({ boardgameMatchID: ' bgio-match-1 ' })).toEqual({
      boardgameMatchID: 'bgio-match-1',
    });
    expect(platformBoardgameMatchReadyFromMessage({})).toBeNull();
    expect(isPlatformBoardgameRelayAcknowledged(' bgio-match-1 ', { boardgameMatchID: 'bgio-match-1' })).toBe(true);
    expect(isPlatformBoardgameRelayAcknowledged('bgio-match-1', { boardgameMatchID: 'bgio-match-2' })).toBe(false);
    expect(isPlatformBoardgameRelayAcknowledged('', { boardgameMatchID: 'bgio-match-1' })).toBe(false);
  });

  it('reads custom room snapshots defensively', () => {
    expect(
      platformCustomRoomSnapshotFromMessage({
        roomId: 'platform_room_1',
        roomCode: 'bgio-match-1',
        status: 'ready',
        host: {
          sessionId: 's_1',
          userId: 'u_1',
          displayName: 'Alice',
          role: 'player',
          joinedAt: 1000,
        },
        players: [
          {
            sessionId: 's_2',
            userId: 'u_2',
            displayName: 'Bob',
            role: 'player',
            joinedAt: 2000,
          },
        ],
        boardgameMatchID: 'bgio-match-1',
      }),
    ).toEqual({
      roomId: 'platform_room_1',
      roomCode: 'bgio-match-1',
      status: 'ready',
      host: {
        sessionId: 's_1',
        userId: 'u_1',
        displayName: 'Alice',
        role: 'player',
        joinedAt: 1000,
      },
      players: [
        {
          sessionId: 's_2',
          userId: 'u_2',
          displayName: 'Bob',
          role: 'player',
          joinedAt: 2000,
        },
      ],
      boardgameMatchID: 'bgio-match-1',
    });
    expect(platformCustomRoomSnapshotFromMessage({ roomId: 'room_1', roomCode: 'code', status: 'gone' })).toBeNull();
    expect(platformCustomRoomSnapshotFromMessage({ roomId: 'room_1', status: 'ready' })).toBeNull();
  });

  it('reads invite lifecycle messages defensively', () => {
    const profile = {
      sessionId: 's_1',
      userId: 'u_1',
      displayName: 'Alice',
      role: 'player',
      joinedAt: 1000,
    };
    expect(
      platformInviteSnapshotFromMessage({
        roomId: 'invite_room_1',
        inviteId: 'invite_1',
        status: 'pending',
        inviter: profile,
        targetUserId: 'u_2',
        roomCode: 'room_1',
        boardgameMatchID: 'bgio-match-1',
        createdAt: 1000.9,
        expiresAt: 2000.9,
      }),
    ).toEqual({
      roomId: 'invite_room_1',
      inviteId: 'invite_1',
      status: 'pending',
      inviter: profile,
      targetUserId: 'u_2',
      roomCode: 'room_1',
      boardgameMatchID: 'bgio-match-1',
      createdAt: 1000,
      expiresAt: 2000,
    });
    expect(
      platformInviteSnapshotFromMessage({ roomId: 'invite_room_1', inviteId: 'invite_1', status: 'unknown' }),
    ).toBeNull();
    expect(platformInviteAcceptedFromMessage({ inviteId: 'invite_1', acceptedBy: profile })).toEqual({
      inviteId: 'invite_1',
      acceptedBy: profile,
      roomCode: undefined,
      boardgameMatchID: undefined,
    });
    expect(platformInviteAcceptedFromMessage({ inviteId: 'invite_1' })).toBeNull();
    expect(platformInviteDeclinedFromMessage({ inviteId: 'invite_1', reason: 'busy' })).toEqual({
      inviteId: 'invite_1',
      declinedBy: undefined,
      reason: 'busy',
    });
    expect(platformInviteCancelledFromMessage({ inviteId: 'invite_1' })).toEqual({
      inviteId: 'invite_1',
      reason: 'cancelled',
    });
  });

  it('builds stable directional friend invite ids', () => {
    expect(buildPlatformFriendInviteId('logto:u_1', 'u 2')).toBe('friend:v1:logto%3Au_1:u%202');
  });

  it('adapts Colyseus 0.17 flat seat reservations for the browser SDK', () => {
    expect(
      normalizeSeatReservation({
        name: 'lobby',
        roomId: 'room_1',
        sessionId: 'session_1',
        processId: 'process_1',
      }),
    ).toEqual({
      sessionId: 'session_1',
      room: {
        name: 'lobby',
        roomId: 'room_1',
        processId: 'process_1',
        clients: 0,
        maxClients: 0,
      },
    });
  });
});
