import { describe, expect, it } from 'vitest';
import { normalizeSeatReservation, platformOnlineCountFromMessage, resolvePlatformEndpoint } from '../platformClient';

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
