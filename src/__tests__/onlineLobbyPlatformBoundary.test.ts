import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readRepoFile(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

describe('online lobby platform boundary', () => {
  it('uses Colyseus quick match without legacy REST matchmaking fallback', () => {
    const lobbySource = readRepoFile('src/pages/OnlineLobbyPage.tsx');

    expect(lobbySource).toContain('connectPlatformQuickMatch');
    expect(lobbySource).not.toMatch(/\bmatchmakingQueue\b/);
    expect(lobbySource).not.toMatch(/\bmatchmakingStatus\b/);
    expect(lobbySource).not.toMatch(/\bmatchmakingLeave\b/);
    expect(lobbySource).not.toMatch(/\bmatchmakingReportMatch\b/);
    expect(lobbySource).not.toContain('/matchmaking/');
    expect(lobbySource).not.toContain('realMatchId');
  });

  it('keeps legacy REST matchmaking isolated to the API client compatibility surface', () => {
    const platformClientSource = readRepoFile('src/platformClient.ts');
    const apiClientSource = readRepoFile('src/api/client.ts');

    expect(platformClientSource).toContain("joinPlatformRoom('quick_match'");
    expect(platformClientSource).not.toContain('/matchmaking/');
    expect(platformClientSource).not.toContain('realMatchId');
    expect(apiClientSource).toContain('export async function matchmakingQueue');
  });

  it('registers hosted custom rooms in Colyseus before exposing a shareable room code', () => {
    const lobbySource = readRepoFile('src/pages/OnlineLobbyPage.tsx');
    const roomInfoSource = readRepoFile('src/components/OnlineRoomInfo.tsx');

    expect(lobbySource).toContain('createPlatformCustomRoom');
    expect(lobbySource).toContain(
      'const nextSession = await onStartOnline(undefined, effectivePlayerName, { navigate: false })',
    );
    expect(lobbySource).toContain('boardgameMatchID: nextSession.matchID');
    expect(lobbySource).toContain('platformCustomRoomRef.current = room');
    expect(lobbySource.indexOf('await createPlatformCustomRoom')).toBeLessThan(
      lobbySource.indexOf('setCreatedMatchID(nextSession.matchID)'),
    );
    expect(lobbySource).toContain('onBoardgameMatchReady: (message) =>');
    expect(lobbySource).toContain('isPlatformBoardgameRelayAcknowledged(nextSession.matchID, message)');
    expect(lobbySource).toContain('navigateToOnlineSession(nextSession)');
    expect(lobbySource).toContain("new URLSearchParams(location.search).get('room')");
    expect(roomInfoSource).toContain('return `/online?room=${encodeURIComponent(matchID)}`');
  });

  it('redirects legacy player room links back through the Colyseus custom-room relay', () => {
    const appSource = readRepoFile('src/App.tsx');
    const onlineGamePageSource = readRepoFile('src/pages/OnlineGamePage.tsx');

    expect(onlineGamePageSource).toContain(
      'navigate(`/online?room=${encodeURIComponent(matchID)}`, { replace: true })',
    );
    expect(onlineGamePageSource).not.toContain('onJoinSharedRoom(matchID)');
    expect(appSource).not.toContain('joinSharedOnlineRoom');
  });

  it('does not expose game-page waiting room share links before Colyseus registration succeeds', () => {
    const onlineGamePageSource = readRepoFile('src/pages/OnlineGamePage.tsx');

    expect(onlineGamePageSource).toContain(
      'const [platformCustomRoomReady, setPlatformCustomRoomReady] = useState(false)',
    );
    expect(onlineGamePageSource).toContain('setPlatformCustomRoomReady(true)');
    expect(onlineGamePageSource).toContain("setReconnectStatus('connectionFailed')");
    expect(onlineGamePageSource).toContain('platformCustomRoomReady ||');
    expect(onlineGamePageSource.indexOf('const canShowRoomInfo')).toBeLessThan(
      onlineGamePageSource.indexOf('const showRoomInfo'),
    );
  });

  it('persists stable platform identity for Colyseus participant evidence', () => {
    const appSource = readRepoFile('src/App.tsx');
    const onlineSessionSource = readRepoFile('src/onlineSession.ts');
    const onlineGamePageSource = readRepoFile('src/pages/OnlineGamePage.tsx');
    const onlineGameSource = readRepoFile('src/components/OnlineGame.tsx');

    expect(onlineSessionSource).toContain('platformUserId?: string');
    expect(onlineSessionSource).toContain('platformDisplayName?: string');
    expect(appSource).toContain('platformUserId: account?.platformUserId');
    expect(appSource).toContain('platformDisplayName: playerName');
    expect(onlineGamePageSource).toContain('resolvePlatformSessionIdentity(activeSession)');
    expect(onlineGamePageSource).toContain('userId: identity.userId');
    expect(onlineGameSource).toContain('platformUserId && !spectator');
    expect(onlineGamePageSource).not.toContain('match:${activeSession.matchID}:player');
  });

  it('opens unread match chats through durable history chat instead of live spectator fallback', () => {
    const lobbySource = readRepoFile('src/pages/OnlineLobbyPage.tsx');
    const historyPageSource = readRepoFile('src/pages/MatchHistoryPage.tsx');
    const historySource = readRepoFile('src/components/MatchHistory.tsx');

    expect(lobbySource).toContain('buildMatchHistoryChatPath(action.subjectId)');
    expect(lobbySource).not.toContain('navigate(buildOnlineSpectatorPath(action.subjectId))');
    expect(historyPageSource).toContain("new URLSearchParams(location.search).get('chat')");
    expect(historySource).toContain('initialChatSourceMatchId');
    expect(historySource).toContain('historyChatRecordFromSourceMatchId(sourceMatchId)');
  });

  it('reopens non-match unread chats through durable lobby chat surfaces', () => {
    const lobbySource = readRepoFile('src/pages/OnlineLobbyPage.tsx');
    const openUnreadStart = lobbySource.indexOf('const openUnreadConversation =');
    const openUnreadEnd = lobbySource.indexOf('const openFriendChat =');
    const openUnreadSource = lobbySource.slice(openUnreadStart, openUnreadEnd);

    expect(openUnreadStart).toBeGreaterThan(-1);
    expect(openUnreadEnd).toBeGreaterThan(openUnreadStart);
    expect(openUnreadSource).toContain("if (action.kind === 'room')");
    expect(openUnreadSource).toContain('setRoomChatSubjectOverride(action.subjectId)');
    expect(openUnreadSource).toContain('setMatchID(action.subjectId)');
    expect(openUnreadSource).toContain('scrollToPanel(customRoomPanelRef)');
    expect(openUnreadSource).toContain("if (action.kind === 'global')");
    expect(openUnreadSource).toContain("conversationType: 'global'");
    expect(openUnreadSource).toContain('lastReadMessageId: unreadConversationLatestMessageId(conversation)');
    expect(openUnreadSource).toContain("if (action.kind === 'direct')");
    expect(openUnreadSource).toContain('setDirectChat({ subjectId: action.subjectId');
    expect(openUnreadSource).toContain('scrollToPanel(directChatPanelRef)');
  });

  it('emits match chat previews only after durable REST persistence and without message content', () => {
    const onlineGameSource = readRepoFile('src/components/OnlineGame.tsx');
    const sendIndex = onlineGameSource.indexOf('const result = await sendChatMessage({');
    const previewIndex = onlineGameSource.indexOf("platformRoomRef.current?.send('chatPreview', {");
    const previewSnippet = onlineGameSource.slice(previewIndex, previewIndex + 260);

    expect(sendIndex).toBeGreaterThan(-1);
    expect(previewIndex).toBeGreaterThan(sendIndex);
    expect(previewSnippet).toContain('conversationId: result.conversation.id');
    expect(previewSnippet).toContain('messageId: result.message.id');
    expect(previewSnippet).not.toContain('content');
    expect(previewSnippet).not.toContain('sender');
    expect(previewSnippet).not.toContain('authorUserId');
    expect(previewSnippet).not.toContain('authorDisplayName');
    expect(previewSnippet).not.toContain('authorRole');
  });
});
