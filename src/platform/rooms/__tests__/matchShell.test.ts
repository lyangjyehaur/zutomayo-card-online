import { describe, expect, it, vi } from 'vitest';
import { MatchShellRoom } from '../MatchShellRoom';
import type { ChatPreviewMessage, LinkBoardgameMatchMessage, PlatformClient, PlatformClientProfile } from '../types';

type ChatPreviewHandler = (client: PlatformClient, message: ChatPreviewMessage) => void;
type LinkBoardgameMatchHandler = (client: PlatformClient, message: LinkBoardgameMatchMessage) => void;

describe('match shell room', () => {
  it('only lets credentialed players or moderators link boardgame match ids', async () => {
    const room = new MatchShellRoom();
    const handlers = new Map<string, LinkBoardgameMatchHandler>();
    const setMatchmaking = vi.spyOn(room, 'setMatchmaking').mockResolvedValue(undefined);
    const broadcast = vi.spyOn(room, 'broadcast').mockImplementation(() => undefined as never);
    vi.spyOn(room, 'onMessage').mockImplementation(((type: string, handler: LinkBoardgameMatchHandler) => {
      handlers.set(type, handler);
      return room;
    }) as never);

    await room.onCreate({ status: 'waiting' });
    const linkBoardgameMatch = handlers.get('linkBoardgameMatch');
    expect(linkBoardgameMatch).toBeDefined();

    const spectator: PlatformClientProfile = {
      sessionId: 'session_spectator',
      userId: 'u_spectator',
      displayName: 'Spectator',
      role: 'spectator',
      joinedAt: 1000,
    };
    const uncredentialedPlayer: PlatformClientProfile = {
      sessionId: 'session_player',
      userId: 'u_player',
      displayName: 'Player',
      role: 'player',
      joinedAt: 1000,
      boardgamePlayerID: '0',
    };
    const credentialedPlayer: PlatformClientProfile = {
      ...uncredentialedPlayer,
      sessionId: 'session_host',
      userId: 'u_host',
      displayName: 'Host',
      hasBoardgameCredentials: true,
    };

    linkBoardgameMatch?.({ userData: spectator } as PlatformClient, { boardgameMatchID: 'bgio-ignored-1' });
    linkBoardgameMatch?.({ userData: uncredentialedPlayer } as PlatformClient, { boardgameMatchID: 'bgio-ignored-2' });
    expect(broadcast).not.toHaveBeenCalledWith('boardgameMatchLinked', expect.anything());

    linkBoardgameMatch?.({ userData: credentialedPlayer } as PlatformClient, { boardgameMatchID: ' bgio-match-1 ' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(broadcast).toHaveBeenCalledWith('boardgameMatchLinked', {
      boardgameMatchID: 'bgio-match-1',
      status: 'ready',
    });
    expect(setMatchmaking).toHaveBeenLastCalledWith({
      metadata: expect.objectContaining({
        boardgameMatchID: 'bgio-match-1',
        status: 'ready',
      }),
    });
  });

  it('ignores chat preview messages from unauthenticated clients', async () => {
    const room = new MatchShellRoom();
    const handlers = new Map<string, ChatPreviewHandler>();
    vi.spyOn(room, 'setMatchmaking').mockResolvedValue(undefined);
    vi.spyOn(room, 'onMessage').mockImplementation(((type: string, handler: ChatPreviewHandler) => {
      handlers.set(type, handler);
      return room;
    }) as never);
    const broadcast = vi.spyOn(room, 'broadcast').mockImplementation(() => undefined as never);
    const profile: PlatformClientProfile = {
      sessionId: 'session_1',
      userId: 'guest:session_1',
      displayName: 'Guest',
      role: 'spectator',
      joinedAt: 1000,
    };

    await room.onCreate({ boardgameMatchID: 'bgio-match-1', conversationId: 'match:bgio-match-1' });
    const chatPreview = handlers.get('chatPreview');
    expect(chatPreview).toBeDefined();

    chatPreview?.({ auth: { authenticated: false }, userData: profile } as PlatformClient, { text: 'fake' });
    expect(broadcast).not.toHaveBeenCalledWith('chatPreview', expect.anything());

    chatPreview?.(
      {
        auth: {
          userId: 'u_1',
          displayName: 'Alice',
          role: 'spectator',
          authenticated: true,
        },
        userData: { ...profile, userId: 'u_1', displayName: 'Alice' },
      } as PlatformClient,
      { text: 'persisted hello', conversationId: 'match:bgio-match-1' },
    );

    expect(broadcast).toHaveBeenCalledWith(
      'chatPreview',
      expect.objectContaining({
        conversationId: 'match:bgio-match-1',
        text: 'persisted hello',
      }),
    );
  });
});
