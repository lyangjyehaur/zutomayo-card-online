import { afterEach, describe, expect, it } from 'vitest';
import { matchMaker } from '@colyseus/core';
import { createPlatformRuntime } from '../runtime';
import { CustomRoom, InviteRoom, LobbyRoom, MatchShellRoom, QuickMatchRoom } from '../rooms';

const PLATFORM_ENV_KEYS = [
  'NODE_ENV',
  'PLATFORM_PORT',
  'PLATFORM_REDIS_MODE',
  'PLATFORM_FRIEND_STORE',
  'PLATFORM_MATCH_PARTICIPANT_STORE',
  'PLATFORM_CHAT_PREVIEW_STORE',
] as const;

const originalEnv = new Map<string, string | undefined>(
  PLATFORM_ENV_KEYS.map((key) => [key, process.env[key]] as const),
);

function setLocalPlatformEnv() {
  process.env.NODE_ENV = 'test';
  delete process.env.PLATFORM_PORT;
  process.env.PLATFORM_REDIS_MODE = 'memory';
  process.env.PLATFORM_FRIEND_STORE = 'none';
  process.env.PLATFORM_MATCH_PARTICIPANT_STORE = 'none';
  process.env.PLATFORM_CHAT_PREVIEW_STORE = 'none';
}

afterEach(() => {
  for (const roomName of ['lobby', 'match_shell', 'quick_match', 'custom_room', 'invite']) {
    matchMaker.removeRoomType(roomName);
  }
  for (const key of PLATFORM_ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('platform runtime', () => {
  it('constructs the documented Colyseus platform shell in local memory mode', async () => {
    setLocalPlatformEnv();

    const platform = createPlatformRuntime({ gracefullyShutdown: false });

    expect(platform.port).toBe(3002);
    expect(platform.redisMode).toBe('memory');
    expect(platform.friendStoreMode).toBe('none');
    expect(platform.matchParticipantStoreMode).toBe('none');
    expect(platform.chatPreviewStoreMode).toBe('none');
    expect(platform.gameServer.options.presence).toBeUndefined();
    expect(platform.gameServer.options.driver).toBeUndefined();
    expect(platform.gameServer.options.greet).toBe(false);

    const roomDefinitions = [
      ['lobby', LobbyRoom, []],
      ['match_shell', MatchShellRoom, ['boardgameMatchID', 'status']],
      ['quick_match', QuickMatchRoom, ['status']],
      ['custom_room', CustomRoom, ['roomCode', 'status']],
      ['invite', InviteRoom, ['inviteId', 'status', 'targetUserId']],
    ] as const;

    for (const [roomName, roomClass, filterOptions] of roomDefinitions) {
      const handler = matchMaker.getHandler(roomName);
      expect(handler.klass).toBe(roomClass);
      expect(handler.filterOptions).toEqual(filterOptions);
    }

    await platform.closeStores();
  });
});
