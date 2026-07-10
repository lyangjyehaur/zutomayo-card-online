import { describe, expect, it, vi } from 'vitest';
import { MatchShellRoom } from '../MatchShellRoom';
import type { ChatPreviewMessage, PlatformClient, PlatformClientProfile } from '../types';

type ChatPreviewHandler = (client: PlatformClient, message: ChatPreviewMessage) => void;

describe('match shell room', () => {
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
