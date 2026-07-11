import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readRepoFile(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

describe('platform deployment config', () => {
  it('enables durable platform stores in production compose', () => {
    const compose = readRepoFile('docker-compose.yml');

    expect(compose).toContain("command: ['npm', 'run', 'platform']");
    expect(compose).toContain("'3002:3002'");
    expect(compose).toContain('http://localhost:3002/health');
    expect(compose).toContain('PLATFORM_REDIS_MODE=redis');
    expect(compose).toContain('PLATFORM_FRIEND_STORE=postgres');
    expect(compose).toContain('PLATFORM_MATCH_PARTICIPANT_STORE=postgres');
    expect(compose).toContain('PLATFORM_CHAT_PREVIEW_STORE=postgres');
  });

  it('keeps local platform stores dependency-light in env example', () => {
    const envExample = readRepoFile('.env.example');

    expect(envExample).toContain('PLATFORM_REDIS_MODE=memory');
    expect(envExample).toContain('PLATFORM_FRIEND_STORE=none');
    expect(envExample).toContain('PLATFORM_MATCH_PARTICIPANT_STORE=none');
    expect(envExample).toContain('PLATFORM_CHAT_PREVIEW_STORE=none');
  });

  it('wires the Colyseus runtime as a platform shell instead of durable game or chat state', () => {
    const platformServer = readRepoFile('src/platform/server.ts');

    expect(platformServer).toContain('new RedisPresence(colyseusRedisUrl)');
    expect(platformServer).toContain('new RedisDriver(colyseusRedisUrl)');
    expect(platformServer).toContain('LobbyRoom.configureFriendStore(friendStore)');
    expect(platformServer).toContain('InviteRoom.configureFriendStore(friendStore, { enforceFriendship:');
    expect(platformServer).toContain('CustomRoom.configureParticipantStore(matchParticipantStore)');
    expect(platformServer).toContain('MatchShellRoom.configureParticipantStore(matchParticipantStore)');
    expect(platformServer).toContain('MatchShellRoom.configureChatPreviewStore(chatPreviewStore)');
    expect(platformServer).toContain("gameServer.define('lobby', LobbyRoom)");
    expect(platformServer).toContain(
      "gameServer.define('match_shell', MatchShellRoom).filterBy(['boardgameMatchID', 'status'])",
    );
    expect(platformServer).toContain("gameServer.define('quick_match', QuickMatchRoom).filterBy(['status'])");
    expect(platformServer).toContain("gameServer.define('custom_room', CustomRoom).filterBy(['roomCode', 'status'])");
    expect(platformServer).toContain(
      "gameServer.define('invite', InviteRoom).filterBy(['inviteId', 'status', 'targetUserId'])",
    );
    expect(platformServer).not.toMatch(/\bapp\.(post|put|patch|delete)\(/);
    expect(platformServer).not.toContain("'/api/");
    expect(platformServer).not.toContain('"/api/');
    expect(platformServer).not.toContain('chat_messages');
    expect(platformServer).not.toContain('chat_conversations');
    expect(platformServer).not.toContain('chat_reports');
    expect(platformServer).not.toContain('chat_user_sanctions');
    expect(platformServer).not.toContain('bjg_matches');
  });
});
