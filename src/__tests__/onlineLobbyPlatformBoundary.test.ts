import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readRepoFile(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

describe('online lobby platform boundary', () => {
  it('uses the shared icon-button primitive for fixed-size icon controls', () => {
    const lobbySource = readRepoFile('src/pages/OnlineLobbyPage.tsx');
    const buttonSource = readRepoFile('src/ui/primitives/Button.tsx');

    expect(lobbySource).toContain('IconButton');
    expect(lobbySource).not.toMatch(/className="size-(?:7|11|touch)[^"]*\bp-0\b/);
    expect(buttonSource).toContain('variant?: ButtonVariant;');
  });

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

  it('keeps quick matchmaking entirely on the platform client', () => {
    const platformClientSource = readRepoFile('src/platformClient.ts');
    const apiClientSource = readRepoFile('src/api/client.ts');

    expect(platformClientSource).toContain("joinPlatformRoom('quick_match'");
    expect(platformClientSource).not.toContain('/matchmaking/');
    expect(platformClientSource).not.toContain('realMatchId');
    expect(apiClientSource).not.toContain('/matchmaking/');
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

  it('keeps account-only moderation controls hidden from guest match chat', () => {
    const onlineGameSource = readRepoFile('src/components/OnlineGame.tsx');

    expect(onlineGameSource).toContain('chatAccount && message.persisted && !message.self');
  });

  it('opens unread match chats through durable history chat instead of live spectator fallback', () => {
    const communitySource = readRepoFile('src/pages/CommunityPage.tsx');
    const historyPageSource = readRepoFile('src/pages/MatchHistoryPage.tsx');
    const historySource = readRepoFile('src/components/MatchHistory.tsx');

    expect(communitySource).toContain('buildMatchHistoryChatPath(action.subjectId)');
    expect(communitySource).not.toContain('navigate(buildOnlineSpectatorPath(action.subjectId))');
    expect(historyPageSource).toContain("new URLSearchParams(location.search).get('chat')");
    expect(historySource).toContain('initialChatSourceMatchId');
    expect(historySource).toContain('resolveInitialHistoryChatRecord');
    expect(historySource).toContain('resolveInitialHistoryChatRecord(records, initialChatSourceMatchId)');
  });

  it('moves durable social chat and unread navigation out of the matchmaking page', () => {
    const lobbySource = readRepoFile('src/pages/OnlineLobbyPage.tsx');
    const communitySource = readRepoFile('src/pages/CommunityPage.tsx');
    const openUnreadStart = communitySource.indexOf('const openUnreadConversation =');
    const openUnreadEnd = communitySource.indexOf('const handleSend =');
    const openUnreadSource = communitySource.slice(openUnreadStart, openUnreadEnd);

    expect(openUnreadStart).toBeGreaterThan(-1);
    expect(openUnreadEnd).toBeGreaterThan(openUnreadStart);
    expect(openUnreadSource).toContain("if (action.kind === 'room')");
    expect(openUnreadSource).toContain('navigate(`/online?room=${encodeURIComponent(action.subjectId)}`)');
    expect(openUnreadSource).toContain("if (action.kind === 'global')");
    expect(openUnreadSource).toContain("setView('global')");
    expect(openUnreadSource).toContain("setView('direct')");
    expect(communitySource).toContain("const conversationType = view === 'global' ? 'global' : 'direct'");
    expect(lobbySource).not.toContain("conversationType: 'global'");
    expect(lobbySource).not.toContain("conversationType: 'direct'");
  });

  it('emits match chat previews only after durable REST persistence and without message content', () => {
    const onlineGameSource = readRepoFile('src/components/OnlineGame.tsx');
    const sendIndex = onlineGameSource.indexOf('const result = await sendChatMessage(');
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

  it('resumes accepted outgoing invite rooms from Colyseus snapshots', () => {
    const lobbySource = readRepoFile('src/pages/OnlineLobbyPage.tsx');
    const inviteStartIndex = lobbySource.indexOf('const startAcceptedInviteMatch =');
    const snapshotIndex = lobbySource.indexOf('onSnapshot: (snapshot) =>');
    const acceptedIndex = lobbySource.indexOf('onAccepted: (message) =>');
    const relayIndex = lobbySource.indexOf("room?.send('boardgameMatchReady'", inviteStartIndex);
    const inviteSource = lobbySource.slice(
      inviteStartIndex,
      lobbySource.indexOf('onBoardgameMatchReady:', acceptedIndex),
    );

    expect(inviteStartIndex).toBeGreaterThan(-1);
    expect(snapshotIndex).toBeGreaterThan(inviteStartIndex);
    expect(acceptedIndex).toBeGreaterThan(snapshotIndex);
    expect(relayIndex).toBeGreaterThan(inviteStartIndex);
    expect(lobbySource).toContain('let hostStartRequested = false');
    expect(inviteSource).toContain('hostStartRequested = true');
    expect(inviteSource).toContain("snapshot.status !== 'accepted'");
    expect(inviteSource).toContain('startAcceptedInviteMatch();');
    expect(inviteSource.match(/startAcceptedInviteMatch\(\);/g)?.length).toBeGreaterThanOrEqual(2);
    expect(inviteSource).toContain(
      'pendingInviteHostSessionRef.current = { inviteId, friendUserId: friend.userId, session }',
    );
    expect(inviteSource).toContain("room?.send('boardgameMatchReady'");
  });

  it('resumes explicit accepted invite joins from Colyseus snapshots', () => {
    const lobbySource = readRepoFile('src/pages/OnlineLobbyPage.tsx');
    const resumeIndex = lobbySource.indexOf('const resumeJoinedInviteMatch =');
    const acceptIndex = lobbySource.indexOf('const handleAcceptFriendInvite =');
    const scanIndex = lobbySource.indexOf('const scanIncomingInvites =');
    const acceptSource = lobbySource.slice(acceptIndex, scanIndex);

    expect(resumeIndex).toBeGreaterThan(-1);
    expect(acceptIndex).toBeGreaterThan(resumeIndex);
    expect(acceptSource).toContain('onSnapshot: (snapshot) =>');
    expect(acceptSource).toContain('resumeJoinedInviteMatch(friend, snapshot);');
    expect(acceptSource).toContain('{ includeFinished: true }');
    expect(acceptSource).toContain('joinAcceptedInviteMatch(friend, message.boardgameMatchID)');
    expect(lobbySource.slice(scanIndex)).not.toContain('resumeJoinedInviteMatch(friend, nextSnapshot)');
  });
});
