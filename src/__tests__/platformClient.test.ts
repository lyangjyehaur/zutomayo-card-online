import { describe, expect, it } from 'vitest';
import {
  normalizeSeatReservation,
  platformBoardgameMatchReadyFromMessage,
  platformChatPreviewFromMessage,
  platformCustomRoomSnapshotFromMessage,
  platformOnlineCountFromMessage,
  platformPresenceFromMatchShellMessage,
  platformQuickMatchMatchedFromMessage,
  platformQuickMatchSnapshotFromMessage,
  resolvePlatformEndpoint,
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
        text: ' hello ',
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
      text: 'hello',
      createdAt: 2000,
    });
    expect(platformChatPreviewFromMessage({ text: 'hello' })).toBeNull();
    expect(platformChatPreviewFromMessage({ sender: { sessionId: 's_1', userId: 'u_1' }, text: '' })).toBeNull();
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
