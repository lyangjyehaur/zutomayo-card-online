import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { PRESET_DECKS } from '../src/game/cards/presetDecks';

interface ApiResponse<T> {
  status: number;
  body: T;
}

async function api<T>(
  baseUrl: string,
  path: string,
  options: RequestInit = {},
): Promise<ApiResponse<T>> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : {},
  };
}

async function waitForServer(child: ChildProcess, baseUrl: string): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 5_000) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(`${baseUrl}/api/leaderboard`);
      if (response.ok) return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  throw new Error('API server did not start');
}

function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve();
  child.kill();
  return once(child, 'exit').then(() => undefined);
}

const tmp = mkdtempSync(join(tmpdir(), 'zutomayo-api-smoke-'));
const port = 3900 + Math.floor(Math.random() * 1000);
const baseUrl = `http://127.0.0.1:${port}`;
const output: string[] = [];
const server = spawn('node', ['server.cjs'], {
  cwd: 'api',
  env: {
    ...process.env,
    API_PORT: String(port),
    DB_PATH: join(tmp, 'smoke.db'),
    JWT_SECRET: 'api-smoke-secret',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

server.stdout?.on('data', chunk => output.push(String(chunk)));
server.stderr?.on('data', chunk => output.push(String(chunk)));

try {
  await waitForServer(server, baseUrl);

  const email = `smoke-${Date.now()}@example.test`;
  const password = 'secret123';
  const registered = await api<{ token: string; user: { id: string; email: string } }>(
    baseUrl,
    '/api/register',
    {
      method: 'POST',
      body: JSON.stringify({ email, password, nickname: 'Smoke One' }),
    },
  );
  assert.equal(registered.status, 200);
  assert.ok(registered.body.token);
  assert.equal(registered.body.user.email, email);

  const loser = await api<{ user: { id: string } }>(baseUrl, '/api/register', {
    method: 'POST',
    body: JSON.stringify({
      email: `smoke-loser-${Date.now()}@example.test`,
      password,
      nickname: 'Smoke Two',
    }),
  });
  assert.equal(loser.status, 200);

  const login = await api<{ token: string; user: { id: string } }>(baseUrl, '/api/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.id, registered.body.user.id);

  const profile = await api<{ id: string; matchCount: number }>(baseUrl, '/api/profile', {
    headers: { Authorization: `Bearer ${login.body.token}` },
  });
  assert.equal(profile.status, 200);
  assert.equal(profile.body.id, registered.body.user.id);
  assert.equal(profile.body.matchCount, 0);

  const tamperedToken = `${login.body.token.slice(0, -1)}x`;
  const tamperedProfile = await api(baseUrl, '/api/profile', {
    headers: { Authorization: `Bearer ${tamperedToken}` },
  });
  assert.equal(tamperedProfile.status, 401);

  const createdDeck = await api<{ id: string; cardIds: string[] }>(baseUrl, '/api/decks', {
    method: 'POST',
    headers: { Authorization: `Bearer ${login.body.token}` },
    body: JSON.stringify({ name: 'Smoke Deck', cardIds: PRESET_DECKS.dark.ids }),
  });
  assert.equal(createdDeck.status, 200);
  assert.equal(createdDeck.body.cardIds.length, 20);

  const listedDecks = await api<{ decks: { id: string }[] }>(baseUrl, '/api/decks', {
    headers: { Authorization: `Bearer ${login.body.token}` },
  });
  assert.equal(listedDecks.status, 200);
  assert.ok(listedDecks.body.decks.some(deck => deck.id === createdDeck.body.id));

  const deletedDeck = await api<{ deleted: boolean }>(baseUrl, `/api/decks/${createdDeck.body.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${login.body.token}` },
  });
  assert.equal(deletedDeck.status, 200);
  assert.equal(deletedDeck.body.deleted, true);

  const match = await api<{ matchId: string; winnerEloChange: number }>(baseUrl, '/api/matches', {
    method: 'POST',
    body: JSON.stringify({
      winnerId: registered.body.user.id,
      loserId: loser.body.user.id,
      turns: 7,
      duration: 180,
      actionLog: [{ turn: 1, step: 'janken', player: 0, action: 'janken', timestamp: Date.now(), payload: { choice: 'rock' } }],
    }),
  });
  assert.equal(match.status, 200);
  assert.ok(match.body.matchId.startsWith('m_'));
  assert.notEqual(match.body.winnerEloChange, 0);

  const leaderboard = await api<{ leaderboard: { id: string; matchCount: number; wins: number }[] }>(
    baseUrl,
    '/api/leaderboard?limit=10',
  );
  assert.equal(leaderboard.status, 200);
  assert.ok(leaderboard.body.leaderboard.some(entry => (
    entry.id === registered.body.user.id
    && entry.matchCount === 1
    && entry.wins === 1
  )));

  console.log('api smoke: all assertions passed');
} catch (error) {
  if (output.length > 0) console.error(output.join(''));
  throw error;
} finally {
  await stopServer(server);
  rmSync(tmp, { recursive: true, force: true });
}
