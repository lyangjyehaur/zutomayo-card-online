import { describe, expect, it } from 'vitest';
import { buildOnlineGameMatchShellJoinOptions } from '../onlineMatchShell';

describe('online game match shell join options', () => {
  it('joins ready player sessions as credentialed platform players', () => {
    const options = buildOnlineGameMatchShellJoinOptions({
      activeSession: {
        matchID: 'bgio-match-1',
        playerID: '1',
        playerCredentials: 'secret',
      },
      matchID: 'bgio-match-1',
      reconnectStatus: 'ready',
      spectatorMode: false,
    });

    expect(options).toEqual({
      boardgameMatchID: 'bgio-match-1',
      userId: 'match:bgio-match-1:player:1',
      displayName: expect.any(String),
      role: 'player',
      boardgamePlayerID: '1',
      hasBoardgameCredentials: true,
    });
  });

  it('does not join the platform match shell before boardgame access is ready', () => {
    expect(
      buildOnlineGameMatchShellJoinOptions({
        activeSession: {
          matchID: 'bgio-match-1',
          playerID: '0',
          playerCredentials: 'secret',
        },
        matchID: 'bgio-match-1',
        reconnectStatus: 'waiting',
        spectatorMode: false,
      }),
    ).toBeNull();
  });

  it('joins ready spectators without boardgame credentials', () => {
    expect(
      buildOnlineGameMatchShellJoinOptions({
        activeSession: null,
        matchID: 'bgio-match-1',
        reconnectStatus: 'ready',
        spectatorMode: true,
        spectatorIdentity: { baseName: 'Mayo', suffix: '1234' },
      }),
    ).toEqual({
      boardgameMatchID: 'bgio-match-1',
      userId: 'anon:1234',
      displayName: 'Mayo#1234',
      role: 'spectator',
    });
  });
});
