import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { PRESET_DECKS } from '../src/game/cards/presetDecks';
import type { ActionLogEntry, ActionLogResult } from '../src/game/types';

// Mock HTTP request：模擬 server.cjs handleRequest 接收的 req 物件。
interface MockRequest extends EventEmitter {
  method: string;
  url: string;
  headers: Record<string, string | undefined>;
  socket: { remoteAddress: string };
}

interface ApiResponse<T> {
  status: number;
  body: T;
}

interface AuthResponse {
  token: string;
  user: {
    id: string;
    email: string;
    nickname: string;
    elo: number;
  };
}

interface ProfileResponse {
  id: string;
  email: string;
  nickname: string;
  elo: number;
  matchCount: number;
  wins: number;
  winRate: number;
}

interface DeckResponse {
  id: string;
  name: string;
  cardIds: string[];
}

interface MatchResponse {
  matchId: string;
  winnerEloChange: number;
  loserEloChange: number;
  winnerNewElo: number;
  loserNewElo: number;
}

interface LeaderboardEntry {
  id: string;
  nickname: string;
  elo: number;
  matchCount: number;
  wins: number;
  winRate: number;
}

interface MatchHistoryEntry {
  id: string;
  winnerId: string | null;
  loserId: string | null;
  winnerNickname: string | null;
  loserNickname: string | null;
  winnerEloChange: number;
  loserEloChange: number;
  turns: number;
  duration: number;
  createdAt: string;
}

type ApiServerModule = {
  handleRequest: (req: IncomingMessage, res: ServerResponse) => void;
  closeDatabase: () => void;
};

const tmp = mkdtempSync(join(tmpdir(), 'zutomayo-api-smoke-'));
const port = 3900 + Math.floor(Math.random() * 1000);
const baseUrl = `http://127.0.0.1:${port}`;

process.env.API_PORT = String(port);
process.env.DB_PATH = join(tmp, 'smoke.db');
process.env.JWT_SECRET = 'api-smoke-secret';

// This smoke uses the real API request handler in-process so it works in
// sandboxes/CI where opening a local listening socket is forbidden. The DB is
// still an isolated, disposable SQLite file and `node api/server.cjs` remains
// the production way to start the HTTP service.
const require = createRequire(import.meta.url);
const apiServer = require('../api/server.cjs') as ApiServerModule;

function normalizeHeaders(headers: HeadersInit | undefined): Record<string, string> {
  const normalized: Record<string, string> = { 'content-type': 'application/json' };
  if (!headers) return normalized;
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      normalized[key.toLowerCase()] = value;
    });
    return normalized;
  }
  if (Array.isArray(headers)) {
    for (const [key, value] of headers) normalized[key.toLowerCase()] = value;
    return normalized;
  }
  for (const [key, value] of Object.entries(headers)) normalized[key.toLowerCase()] = String(value);
  return normalized;
}

async function api<T>(
  _baseUrl: string,
  path: string,
  options: RequestInit = {},
): Promise<ApiResponse<T>> {
  return new Promise((resolve, reject) => {
    const req = new EventEmitter() as MockRequest;
    req.method = options.method ?? 'GET';
    req.url = path;
    req.headers = normalizeHeaders(options.headers);
    // server.cjs rate limiting reads req.socket.remoteAddress; provide a stub.
    req.socket = { remoteAddress: '127.0.0.1' };
    let status = 200;

    const res = {
      setHeader: () => undefined,
      writeHead: (nextStatus: number) => {
        status = nextStatus;
      },
      end: (chunk: unknown = '') => {
        const text = Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk ?? '');
        let body: unknown = {};
        if (text) {
          try {
            body = JSON.parse(text);
          } catch {
            body = text;
          }
        }
        resolve({ status, body: body as T });
      },
    };

    try {
      apiServer.handleRequest(req, res);
    } catch (error) {
      reject(error);
      return;
    }

    queueMicrotask(() => {
      if (options.body) req.emit('data', options.body);
      req.emit('end');
    });
  });
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

try {
  const stamp = Date.now();
  const emailA = `smoke-a-${stamp}@example.test`;
  const emailB = `smoke-b-${stamp}@example.test`;
  const password = 'secret123';
  const validDeckIds = PRESET_DECKS.dark.ids;
  assert.equal(validDeckIds.length, 20);

  const registeredA = await api<AuthResponse>(baseUrl, '/api/register', {
    method: 'POST',
    body: JSON.stringify({ email: emailA, password, nickname: 'Smoke One' }),
  });
  assert.equal(registeredA.status, 200);
  assert.ok(registeredA.body.token);
  assert.equal(registeredA.body.user.email, emailA);
  assert.equal(registeredA.body.user.elo, 1000);

  const registeredB = await api<AuthResponse>(baseUrl, '/api/register', {
    method: 'POST',
    body: JSON.stringify({
      email: emailB,
      password,
      nickname: 'Smoke Two',
    }),
  });
  assert.equal(registeredB.status, 200);
  assert.ok(registeredB.body.token);
  assert.equal(registeredB.body.user.email, emailB);

  const loginA = await api<AuthResponse>(baseUrl, '/api/login', {
    method: 'POST',
    body: JSON.stringify({ email: emailA, password }),
  });
  assert.equal(loginA.status, 200);
  assert.equal(loginA.body.user.id, registeredA.body.user.id);

  const loginB = await api<AuthResponse>(baseUrl, '/api/login', {
    method: 'POST',
    body: JSON.stringify({ email: emailB, password }),
  });
  assert.equal(loginB.status, 200);
  assert.equal(loginB.body.user.id, registeredB.body.user.id);

  const profileA = await api<ProfileResponse>(baseUrl, '/api/profile', {
    headers: authHeaders(loginA.body.token),
  });
  assert.equal(profileA.status, 200);
  assert.equal(profileA.body.id, registeredA.body.user.id);
  assert.equal(profileA.body.matchCount, 0);
  assert.equal(profileA.body.wins, 0);
  assert.equal(profileA.body.elo, 1000);

  const profileB = await api<ProfileResponse>(baseUrl, '/api/profile', {
    headers: authHeaders(loginB.body.token),
  });
  assert.equal(profileB.status, 200);
  assert.equal(profileB.body.id, registeredB.body.user.id);
  assert.equal(profileB.body.matchCount, 0);
  assert.equal(profileB.body.wins, 0);
  assert.equal(profileB.body.elo, 1000);

  const tamperedToken = `${loginA.body.token.slice(0, -1)}x`;
  const tamperedProfile = await api(baseUrl, '/api/profile', {
    headers: authHeaders(tamperedToken),
  });
  assert.equal(tamperedProfile.status, 401);

  const createdDeck = await api<DeckResponse>(baseUrl, '/api/decks', {
    method: 'POST',
    headers: authHeaders(loginA.body.token),
    body: JSON.stringify({ name: 'Smoke Deck', cardIds: validDeckIds }),
  });
  assert.equal(createdDeck.status, 200);
  assert.ok(createdDeck.body.id.startsWith('d_'));
  assert.deepEqual(createdDeck.body.cardIds, validDeckIds);

  const listedDecks = await api<{ decks: DeckResponse[] }>(baseUrl, '/api/decks', {
    headers: authHeaders(loginA.body.token),
  });
  assert.equal(listedDecks.status, 200);
  const roundtrippedDeck = listedDecks.body.decks.find(deck => deck.id === createdDeck.body.id);
  assert.ok(roundtrippedDeck);
  assert.equal(roundtrippedDeck.name, 'Smoke Deck');
  assert.deepEqual(roundtrippedDeck.cardIds, validDeckIds);

  const actionLog: ActionLogEntry[] = [
    {
      turn: 1,
      step: 'janken',
      player: 0,
      action: 'janken',
      timestamp: stamp,
      payload: { choice: 'rock', hiddenHand: ['1st_1'], deckOrder: ['1st_2'] },
    },
    {
      turn: 1,
      step: 'mulligan',
      player: 1,
      action: 'mulligan',
      timestamp: stamp + 1,
      payload: { redrawnCount: 2, cardIds: ['1st_3', '1st_4'] },
    },
    {
      turn: 2,
      step: 'turnSet',
      player: 0,
      action: 'setTurnCard',
      timestamp: stamp + 2,
      payload: { slot: 'B', cardDefId: '1st_9' },
    },
    {
      id: 4,
      turn: 2,
      step: 'effectOrder',
      player: 0,
      action: 'resolvePendingEffect',
      timestamp: stamp + 3,
      chronosPosition: 4,
      hp: [100, 93],
      pendingEffectCardDefId: '1st_9',
      result: { ok: true, message: 'Resolved direct damage', secret: 'strip-me' } as ActionLogResult & { secret: string },
      payload: { index: 0, effectId: 'effect-1', cardDefId: '1st_9', source: 'played', trigger: 'onUse', actionType: 'directDamage', rawText: 'hidden raw text' },
      unsafeNested: { deckOrder: ['1st_1'] } as Record<string, unknown>,
    },
    {
      id: 5,
      turn: 2,
      step: 'effectOrder',
      player: 0,
      action: 'submitPendingChoice',
      timestamp: stamp + 4,
      pendingChoiceType: 'handToDeckBottomThenDraw' as string,
      payload: { choiceId: 'choice-1', choiceType: 'handToDeckBottomThenDraw', selectedCount: 2, min: 2, max: 2, destinationZone: 'deck', destinationPosition: 'bottom', drawCount: 2, selectedCardIds: ['hidden'] },
    },
  ];

  // P0-2：POST /api/matches 無 token 回 401。
  const matchNoToken = await api(baseUrl, '/api/matches', {
    method: 'POST',
    body: JSON.stringify({
      winnerId: registeredA.body.user.id,
      loserId: registeredB.body.user.id,
      turns: 1,
      duration: 10,
      actionLog: [],
    }),
  });
  assert.equal(matchNoToken.status, 401);

  // P0-2：winnerId 不符認證使用者回 403（以 B 的 token 宣稱 A 贏）。
  const matchForbidden = await api(baseUrl, '/api/matches', {
    method: 'POST',
    headers: authHeaders(loginB.body.token),
    body: JSON.stringify({
      winnerId: registeredA.body.user.id,
      loserId: registeredB.body.user.id,
      turns: 1,
      duration: 10,
      actionLog: [],
    }),
  });
  assert.equal(matchForbidden.status, 403);

  const match = await api<MatchResponse>(baseUrl, '/api/matches', {
    method: 'POST',
    headers: authHeaders(loginA.body.token),
    body: JSON.stringify({
      winnerId: registeredA.body.user.id,
      loserId: registeredB.body.user.id,
      turns: 7,
      duration: 180,
      actionLog,
    }),
  });
  assert.equal(match.status, 200);
  assert.ok(match.body.matchId.startsWith('m_'));
  assert.ok(match.body.winnerEloChange > 0);
  assert.ok(match.body.loserEloChange < 0);
  assert.ok(match.body.winnerNewElo > 1000);
  assert.ok(match.body.loserNewElo < 1000);

  const afterMatchProfileA = await api<ProfileResponse>(baseUrl, '/api/profile', {
    headers: authHeaders(loginA.body.token),
  });
  assert.equal(afterMatchProfileA.status, 200);
  assert.equal(afterMatchProfileA.body.matchCount, 1);
  assert.equal(afterMatchProfileA.body.wins, 1);
  assert.equal(afterMatchProfileA.body.winRate, 100);
  assert.equal(afterMatchProfileA.body.elo, match.body.winnerNewElo);

  const afterMatchProfileB = await api<ProfileResponse>(baseUrl, '/api/profile', {
    headers: authHeaders(loginB.body.token),
  });
  assert.equal(afterMatchProfileB.status, 200);
  assert.equal(afterMatchProfileB.body.matchCount, 1);
  assert.equal(afterMatchProfileB.body.wins, 0);
  assert.equal(afterMatchProfileB.body.winRate, 0);
  assert.equal(afterMatchProfileB.body.elo, match.body.loserNewElo);

  const leaderboard = await api<{ leaderboard: LeaderboardEntry[] }>(
    baseUrl,
    '/api/leaderboard?limit=10',
  );
  assert.equal(leaderboard.status, 200);
  const entryA = leaderboard.body.leaderboard.find(entry => entry.id === registeredA.body.user.id);
  const entryB = leaderboard.body.leaderboard.find(entry => entry.id === registeredB.body.user.id);
  assert.ok(entryA);
  assert.ok(entryB);
  assert.equal(entryA.matchCount, 1);
  assert.equal(entryA.wins, 1);
  assert.equal(entryA.winRate, 100);
  assert.equal(entryA.elo, match.body.winnerNewElo);
  assert.equal(entryB.matchCount, 1);
  assert.equal(entryB.wins, 0);
  assert.equal(entryB.winRate, 0);
  assert.equal(entryB.elo, match.body.loserNewElo);

  const matchLog = await api<{ matchId: string; actionLog: ActionLogEntry[] }>(
    baseUrl,
    `/api/matches/${match.body.matchId}/log`,
  );
  assert.equal(matchLog.status, 200);
  assert.equal(matchLog.body.matchId, match.body.matchId);
  assert.equal(matchLog.body.actionLog.length, actionLog.length);
  assert.deepEqual(matchLog.body.actionLog[0].payload, { choice: 'rock' });
  assert.deepEqual(matchLog.body.actionLog[1].payload, { redrawnCount: 2 });
  assert.deepEqual(matchLog.body.actionLog[2].payload, { slot: 'B', faceDown: true });
  assert.deepEqual(matchLog.body.actionLog[3].payload, {
    index: 0,
    effectId: 'effect-1',
    cardDefId: '1st_9',
    source: 'played',
    trigger: 'onUse',
    actionType: 'directDamage',
  });
  assert.equal(matchLog.body.actionLog[3].id, 4);
  assert.equal(matchLog.body.actionLog[3].chronosPosition, 4);
  assert.deepEqual(matchLog.body.actionLog[3].hp, [100, 93]);
  assert.equal(matchLog.body.actionLog[3].pendingEffectCardDefId, '1st_9');
  assert.deepEqual(matchLog.body.actionLog[3].result, { ok: true, message: 'Resolved direct damage' });
  assert.deepEqual(matchLog.body.actionLog[4].payload, {
    selectedCount: 2,
    min: 2,
    max: 2,
    choiceId: 'choice-1',
    choiceType: 'handToDeckBottomThenDraw',
    destinationZone: 'deck',
    destinationPosition: 'bottom',
    drawCount: 2,
  });
  assert.equal(matchLog.body.actionLog[4].pendingChoiceType, 'handToDeckBottomThenDraw');
  assert.equal(JSON.stringify(matchLog.body.actionLog).includes('hiddenHand'), false);
  assert.equal(JSON.stringify(matchLog.body.actionLog).includes('deckOrder'), false);
  assert.equal(JSON.stringify(matchLog.body.actionLog).includes('rawText'), false);
  assert.equal(JSON.stringify(matchLog.body.actionLog).includes('selectedCardIds'), false);
  assert.equal(JSON.stringify(matchLog.body.actionLog).includes('unsafeNested'), false);
  assert.equal(JSON.stringify(matchLog.body.actionLog).includes('strip-me'), false);

  const guestPlaceholderMatch = await api<MatchResponse>(baseUrl, '/api/matches', {
    method: 'POST',
    headers: authHeaders(loginA.body.token),
    body: JSON.stringify({
      winnerId: registeredA.body.user.id,
      loserId: 'guest-player-1',
      turns: 1,
      duration: 30,
      actionLog: [
        { turn: 1, step: 'turnSet', player: 0, action: 'confirmReady', timestamp: stamp + 4, payload: { cardIds: ['1st_9'] } },
      ],
    }),
  });
  assert.equal(guestPlaceholderMatch.status, 200);
  assert.equal(guestPlaceholderMatch.body.winnerEloChange, 0);
  assert.equal(guestPlaceholderMatch.body.loserEloChange, 0);

  const afterGuestProfileA = await api<ProfileResponse>(baseUrl, '/api/profile', {
    headers: authHeaders(loginA.body.token),
  });
  assert.equal(afterGuestProfileA.status, 200);
  assert.equal(afterGuestProfileA.body.matchCount, 1);
  assert.equal(afterGuestProfileA.body.wins, 1);
  assert.equal(afterGuestProfileA.body.elo, match.body.winnerNewElo);

  // P2-10：GET /api/matches 回傳使用者對戰歷史。
  const historyA = await api<{ matches: MatchHistoryEntry[] }>(baseUrl, '/api/matches', {
    headers: authHeaders(loginA.body.token),
  });
  assert.equal(historyA.status, 200);
  assert.equal(historyA.body.matches.length, 2);
  const historyAIds = historyA.body.matches.map(entry => entry.id);
  assert.ok(historyAIds.includes(match.body.matchId));
  assert.ok(historyAIds.includes(guestPlaceholderMatch.body.matchId));

  const historyB = await api<{ matches: MatchHistoryEntry[] }>(baseUrl, '/api/matches', {
    headers: authHeaders(loginB.body.token),
  });
  assert.equal(historyB.status, 200);
  assert.equal(historyB.body.matches.length, 1);
  assert.equal(historyB.body.matches[0].id, match.body.matchId);
  assert.equal(historyB.body.matches[0].winnerNickname, 'Smoke One');
  assert.equal(historyB.body.matches[0].loserNickname, 'Smoke Two');

  // PUT /api/profile 修改暱稱。
  const updatedProfile = await api<ProfileResponse>(baseUrl, '/api/profile', {
    method: 'PUT',
    headers: authHeaders(loginA.body.token),
    body: JSON.stringify({ nickname: 'Smoke One Updated' }),
  });
  assert.equal(updatedProfile.status, 200);
  assert.equal(updatedProfile.body.id, registeredA.body.user.id);
  assert.equal(updatedProfile.body.nickname, 'Smoke One Updated');

  // 驗證暱稱已持久化。
  const refetchedProfileA = await api<ProfileResponse>(baseUrl, '/api/profile', {
    headers: authHeaders(loginA.body.token),
  });
  assert.equal(refetchedProfileA.status, 200);
  assert.equal(refetchedProfileA.body.nickname, 'Smoke One Updated');

  const deletedDeck = await api<{ deleted: boolean }>(baseUrl, `/api/decks/${createdDeck.body.id}`, {
    method: 'DELETE',
    headers: authHeaders(loginA.body.token),
  });
  assert.equal(deletedDeck.status, 200);
  assert.equal(deletedDeck.body.deleted, true);

  const decksAfterDelete = await api<{ decks: DeckResponse[] }>(baseUrl, '/api/decks', {
    headers: authHeaders(loginA.body.token),
  });
  assert.equal(decksAfterDelete.status, 200);
  assert.equal(decksAfterDelete.body.decks.some(deck => deck.id === createdDeck.body.id), false);

  console.log('api smoke: all assertions passed');
} finally {
  apiServer.closeDatabase();
  rmSync(tmp, { recursive: true, force: true });
}
