import { readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createPlatformSeatToken } from '../../seatToken';
import { CustomRoom } from '../CustomRoom';
import { InviteRoom } from '../InviteRoom';
import { MatchShellRoom } from '../MatchShellRoom';
import { QuickMatchRoom } from '../QuickMatchRoom';
import type { PlatformAuth, PlatformClient } from '../types';

const forbiddenBoardgameStateKeys = new Set([
  'G',
  'ctx',
  'gameState',
  'state',
  'deck',
  'hand',
  'discard',
  'moves',
  'actionLog',
  'secret',
  'cards',
  'effects',
  'credentials',
  'playerCredentials',
  'platformSeatToken',
  'playerView',
]);

const forbiddenDurableChatKeys = new Set([
  'content',
  'text',
  'translatedContent',
  'sourceLanguage',
  'moderationStatus',
  'moderationReason',
  'authorUserId',
  'authorDisplayName',
  'authorRole',
  'reportId',
  'translationId',
]);

const forbiddenPlatformSourcePatterns = [
  /\bfrom\s+['"]boardgame\.io(?:\/[^'"]*)?['"]/,
  /\brequire\(\s*['"]boardgame\.io(?:\/[^'"]*)?['"]\s*\)/,
  /\bfrom\s+['"][^'"]*(?:^|\/|\.\.\/)game(?:\/[^'"]*)?['"]/,
  /\bfrom\s+['"][^'"]*Game(?:Logic)?(?:\.[^'"]*)?['"]/,
  /src\/game/,
  /\/games\/zutomayo-card/,
] as const;

function platformSourceFiles(): string[] {
  const root = new URL('../../', import.meta.url);
  const files: string[] = [];

  const visit = (directory: URL) => {
    for (const entry of readdirSync(directory)) {
      if (entry === '__tests__') continue;
      const entryUrl = new URL(`${entry}${statSync(new URL(entry, directory)).isDirectory() ? '/' : ''}`, directory);
      const stats = statSync(entryUrl);
      if (stats.isDirectory()) {
        visit(entryUrl);
        continue;
      }
      if (entry.endsWith('.ts')) files.push(entryUrl.pathname);
    }
  };

  visit(root);
  return files.sort();
}

function collectForbiddenKeys(value: unknown, path = '$', found: string[] = []): string[] {
  if (!value || typeof value !== 'object') return found;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectForbiddenKeys(item, `${path}[${index}]`, found));
    return found;
  }

  for (const [key, item] of Object.entries(value)) {
    const nextPath = `${path}.${key}`;
    if (forbiddenBoardgameStateKeys.has(key)) found.push(nextPath);
    collectForbiddenKeys(item, nextPath, found);
  }
  return found;
}

function collectForbiddenDurableChatKeys(value: unknown, path = '$', found: string[] = []): string[] {
  if (!value || typeof value !== 'object') return found;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectForbiddenDurableChatKeys(item, `${path}[${index}]`, found));
    return found;
  }

  for (const [key, item] of Object.entries(value)) {
    const nextPath = `${path}.${key}`;
    if (forbiddenDurableChatKeys.has(key)) found.push(nextPath);
    collectForbiddenDurableChatKeys(item, nextPath, found);
  }
  return found;
}

function expectPlatformShellOnly(value: unknown): void {
  expect(collectForbiddenKeys(value)).toEqual([]);
  expect(collectForbiddenDurableChatKeys(value)).toEqual([]);
}

function client(sessionId: string, auth: PlatformAuth): PlatformClient & { send: ReturnType<typeof vi.fn> } {
  return {
    sessionId,
    auth,
    send: vi.fn(),
  } as PlatformClient & { send: ReturnType<typeof vi.fn> };
}

function runShortTimersOnly(handler: () => void, timeout?: number): { clear: ReturnType<typeof vi.fn> } {
  if (typeof timeout === 'number' && timeout <= 100) handler();
  return { clear: vi.fn() };
}

const poisonedBoardgamePayload = {
  G: { hand: ['hidden-card'] },
  ctx: { phase: 'main' },
  deck: ['secret-card'],
  credentials: 'raw-boardgame-credentials',
  playerCredentials: 'raw-player-credentials',
  platformSeatToken: 'raw-platform-seat-token',
  actionLog: [{ move: 'play-card' }],
  playerView: { hand: ['hidden-card'] },
};

const poisonedDurableChatPayload = {
  content: 'durable chat text must stay in ChatService',
  text: 'legacy chat text must stay in ChatService',
  translatedContent: 'translated text must stay in ChatService',
  sourceLanguage: 'ja',
  moderationStatus: 'visible',
  moderationReason: 'manual_review',
  authorUserId: 'u_author',
  authorDisplayName: 'Author',
  authorRole: 'player',
  reportId: 'chat_report_1',
  translationId: 'chat_translation_1',
};

function seatToken(): string {
  process.env.PLATFORM_SEAT_TOKEN_SECRET = 'test-seat-token-secret-at-least-32-characters';
  return createPlatformSeatToken({ matchID: 'bgio-match-1', playerID: '0' });
}

describe('platform room boundary', () => {
  it('keeps Colyseus platform sources out of the authoritative boardgame engine', () => {
    const violations = platformSourceFiles().flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return forbiddenPlatformSourcePatterns
        .filter((pattern) => pattern.test(source))
        .map((pattern) => `${file}: ${pattern}`);
    });

    expect(platformSourceFiles().length).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });

  it('keeps match shell snapshots and metadata free of boardgame state or durable chat evidence', async () => {
    const room = new MatchShellRoom();
    const setMatchmaking = vi.spyOn(room, 'setMatchmaking').mockResolvedValue(undefined);
    vi.spyOn(room, 'broadcast').mockImplementation(() => undefined as never);
    vi.spyOn(room, 'onMessage').mockImplementation((() => room) as never);

    const player = client('session_player', {
      userId: 'u_player',
      displayName: 'Player',
      role: 'player',
      authenticated: true,
    });

    await room.onCreate({
      boardgameMatchID: 'bgio-match-1',
      conversationId: 'match:bgio-match-1',
      ...poisonedBoardgamePayload,
      ...poisonedDurableChatPayload,
    });
    room.clients.push(player);
    await room.onJoin(player, {
      boardgameMatchID: 'bgio-match-1',
      boardgamePlayerID: '0',
      hasBoardgameCredentials: true,
      ...poisonedBoardgamePayload,
      ...poisonedDurableChatPayload,
      platformSeatToken: seatToken(),
    });

    expectPlatformShellOnly(player.send.mock.calls);
    expectPlatformShellOnly(setMatchmaking.mock.calls);
  });

  it('keeps quick match snapshots and metadata free of boardgame state or durable chat evidence', async () => {
    const room = new QuickMatchRoom();
    const setMatchmaking = vi.spyOn(room, 'setMatchmaking').mockResolvedValue(undefined);
    const broadcast = vi.spyOn(room, 'broadcast').mockImplementation(() => undefined as never);
    vi.spyOn(room, 'lock').mockImplementation(() => undefined as never);
    vi.spyOn(room, 'onMessage').mockImplementation((() => room) as never);
    vi.spyOn(room.clock, 'setTimeout').mockImplementation(runShortTimersOnly as never);

    const host = client('session_host', {
      userId: 'u_host',
      displayName: 'Host',
      role: 'player',
      authenticated: true,
    });
    const guest = client('session_guest', {
      userId: 'u_guest',
      displayName: 'Guest',
      role: 'player',
      authenticated: true,
    });

    await room.onCreate();
    room.clients.push(host);
    await room.onJoin(host);
    room.clients.push(guest);
    await room.onJoin(guest);

    expectPlatformShellOnly(host.send.mock.calls);
    expectPlatformShellOnly(guest.send.mock.calls);
    expectPlatformShellOnly(broadcast.mock.calls);
    expectPlatformShellOnly(setMatchmaking.mock.calls);
  });

  it('keeps custom room snapshots and metadata free of boardgame state or durable chat evidence', async () => {
    const room = new CustomRoom();
    const setMatchmaking = vi.spyOn(room, 'setMatchmaking').mockResolvedValue(undefined);
    const broadcast = vi.spyOn(room, 'broadcast').mockImplementation(() => undefined as never);
    vi.spyOn(room, 'onMessage').mockImplementation((() => room) as never);
    vi.spyOn(room.clock, 'setTimeout').mockImplementation(runShortTimersOnly as never);

    const host = client('session_host', {
      userId: 'u_host',
      displayName: 'Host',
      role: 'player',
      authenticated: true,
    });

    await room.onCreate({
      roomCode: 'ROOM42',
      boardgameMatchID: 'bgio-match-1',
      ...poisonedBoardgamePayload,
      ...poisonedDurableChatPayload,
    });
    room.clients.push(host);
    await room.onJoin(host);

    expectPlatformShellOnly(host.send.mock.calls);
    expectPlatformShellOnly(broadcast.mock.calls);
    expectPlatformShellOnly(setMatchmaking.mock.calls);
  });

  it('keeps invite snapshots and metadata free of boardgame state or durable chat evidence', async () => {
    const room = new InviteRoom();
    const setMatchmaking = vi.spyOn(room, 'setMatchmaking').mockResolvedValue(undefined);
    const broadcast = vi.spyOn(room, 'broadcast').mockImplementation(() => undefined as never);
    vi.spyOn(room, 'onMessage').mockImplementation((() => room) as never);
    vi.spyOn(room.clock, 'setTimeout').mockImplementation(runShortTimersOnly as never);

    const inviter = client('session_inviter', {
      userId: 'u_inviter',
      displayName: 'Inviter',
      role: 'player',
      authenticated: true,
    });

    await room.onCreate({
      inviteId: 'friend:v1:u_inviter:u_target',
      targetUserId: 'u_target',
      boardgameMatchID: 'bgio-match-1',
      ...poisonedBoardgamePayload,
      ...poisonedDurableChatPayload,
    });
    room.clients.push(inviter);
    await room.onJoin(inviter);

    expectPlatformShellOnly(inviter.send.mock.calls);
    expectPlatformShellOnly(broadcast.mock.calls);
    expectPlatformShellOnly(setMatchmaking.mock.calls);
  });
});
