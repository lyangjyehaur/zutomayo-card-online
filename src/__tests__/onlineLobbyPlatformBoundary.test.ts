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
});
