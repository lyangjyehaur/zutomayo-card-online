import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readRepoFile(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

describe('platform deployment config', () => {
  it('does not run dev-only lifecycle hooks in the production image', () => {
    const dockerfile = readRepoFile('Dockerfile');

    expect(dockerfile).toContain('npm ci --omit=dev --ignore-scripts');
  });

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
    const platformRuntime = readRepoFile('src/platform/runtime.ts');

    expect(platformServer).toContain('createPlatformRuntime()');
    expect(platformRuntime).toContain('new RedisPresence(colyseusRedisUrl)');
    expect(platformRuntime).toContain('new RedisDriver(colyseusRedisUrl)');
    expect(platformRuntime).toContain('LobbyRoom.configureFriendStore(friendStore)');
    expect(platformRuntime).toContain('InviteRoom.configureFriendStore(friendStore, { enforceFriendship:');
    expect(platformRuntime).toContain('CustomRoom.configureParticipantStore(matchParticipantStore)');
    expect(platformRuntime).toContain('MatchShellRoom.configureParticipantStore(matchParticipantStore)');
    expect(platformRuntime).toContain('MatchShellRoom.configureChatPreviewStore(chatPreviewStore)');
    expect(platformRuntime).toContain("gameServer.define('lobby', LobbyRoom)");
    expect(platformRuntime).toContain(
      "gameServer.define('match_shell', MatchShellRoom).filterBy(['boardgameMatchID', 'status'])",
    );
    expect(platformRuntime).toContain("gameServer.define('quick_match', QuickMatchRoom).filterBy(['status'])");
    expect(platformRuntime).toContain("gameServer.define('custom_room', CustomRoom).filterBy(['roomCode', 'status'])");
    expect(platformRuntime).toContain(
      "gameServer.define('invite', InviteRoom).filterBy(['inviteId', 'status', 'targetUserId'])",
    );
    expect(platformRuntime).not.toMatch(/\bapp\.(post|put|patch|delete)\(/);
    expect(platformRuntime).not.toContain("'/api/");
    expect(platformRuntime).not.toContain('"/api/');
    expect(platformRuntime).not.toContain('chat_messages');
    expect(platformRuntime).not.toContain('chat_conversations');
    expect(platformRuntime).not.toContain('chat_reports');
    expect(platformRuntime).not.toContain('chat_user_sanctions');
    expect(platformRuntime).not.toContain('bjg_matches');
  });
});
