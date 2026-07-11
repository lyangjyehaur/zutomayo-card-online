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
});
