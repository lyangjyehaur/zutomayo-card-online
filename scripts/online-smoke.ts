import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { ZutomayoCard } from '../src/game/Game';

const require = createRequire(import.meta.url);
const { Server } = require('boardgame.io/server') as any;
const { Client } = require('boardgame.io/client') as any;
const { SocketIO } = require('boardgame.io/multiplayer') as any;

const port = 4199;
const baseUrl = `http://127.0.0.1:${port}`;

type ClientState = { G: any; _stateID?: number } | null | undefined;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${path} failed ${response.status}: ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}

async function waitForStates(
  label: string,
  client0: any,
  client1: any,
  predicate: (state0: ClientState, state1: ClientState) => boolean,
): Promise<[NonNullable<ClientState>, NonNullable<ClientState>]> {
  const started = Date.now();
  while (Date.now() - started < 5000) {
    const state0 = client0.getState();
    const state1 = client1.getState();
    if (predicate(state0, state1)) {
      return [state0, state1] as [NonNullable<ClientState>, NonNullable<ClientState>];
    }
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function stateID(state: ClientState): number {
  return typeof state?._stateID === 'number' ? state._stateID : -1;
}

async function waitForSyncedStateID(label: string, client0: any, client1: any): Promise<number> {
  const [state0] = await waitForStates(label, client0, client1, (next0, next1) => {
    const id0 = stateID(next0);
    const id1 = stateID(next1);
    return id0 >= 0 && id0 === id1;
  });
  return stateID(state0);
}

async function performOnlineMove(
  label: string,
  client0: any,
  client1: any,
  move: () => void,
): Promise<void> {
  const previousStateID = await waitForSyncedStateID(`${label} ready`, client0, client1);
  move();
  await waitForStates(`${label} update`, client0, client1, (next0, next1) => (
    stateID(next0) > previousStateID && stateID(next1) > previousStateID
  ));
}

const server = Server({
  games: [ZutomayoCard],
  origins: [/localhost:\d+/, /127\.0\.0\.1:\d+/],
});
let runResult: any;
const clients: any[] = [];

try {
  runResult = await server.run(port);

  const { matchID } = await postJson<{ matchID: string }>('/games/zutomayo-card/create', {
    numPlayers: 2,
    setupData: { deck0Name: 'dark', deck1Name: 'flame' },
  });
  const player0 = await postJson<{ playerCredentials: string }>(`/games/zutomayo-card/${matchID}/join`, {
    playerID: '0',
    playerName: 'Player 0',
  });
  const player1 = await postJson<{ playerCredentials: string }>(`/games/zutomayo-card/${matchID}/join`, {
    playerID: '1',
    playerName: 'Player 1',
  });

  const client0 = Client({
    game: ZutomayoCard,
    numPlayers: 2,
    multiplayer: SocketIO({ server: baseUrl }),
    playerID: '0',
    matchID,
    credentials: player0.playerCredentials,
  });
  const client1 = Client({
    game: ZutomayoCard,
    numPlayers: 2,
    multiplayer: SocketIO({ server: baseUrl }),
    playerID: '1',
    matchID,
    credentials: player1.playerCredentials,
  });
  clients.push(client0, client1);

  client0.start();
  client1.start();
  await waitForStates('janken', client0, client1, (state0, state1) => (
    state0?.G?.step === 'janken' && state1?.G?.step === 'janken'
  ));

  await performOnlineMove('player0 janken', client0, client1, () => client0.moves.janken('rock'));
  await performOnlineMove('player1 janken', client0, client1, () => client1.moves.janken('scissors'));
  await waitForStates('mulligan', client0, client1, (state0, state1) => (
    state0?.G?.step === 'mulligan' && state1?.G?.step === 'mulligan'
  ));

  await performOnlineMove('player0 keepHand', client0, client1, () => client0.moves.keepHand());
  await performOnlineMove('player1 keepHand', client0, client1, () => client1.moves.keepHand());
  await waitForStates('initialSet', client0, client1, (state0, state1) => (
    state0?.G?.step === 'initialSet' && state1?.G?.step === 'initialSet'
  ));

  await performOnlineMove('player0 setInitialCard', client0, client1, () => client0.moves.setInitialCard(0));
  await performOnlineMove('player1 setInitialCard', client0, client1, () => client1.moves.setInitialCard(0));
  await performOnlineMove('player0 confirmReady', client0, client1, () => client0.moves.confirmReady());
  await performOnlineMove('player1 confirmReady', client0, client1, () => client1.moves.confirmReady());
  const [state0] = await waitForStates('turnSet', client0, client1, (next0, next1) => (
    next0?.G?.step === 'turnSet' && next1?.G?.step === 'turnSet'
  ));

  assert.ok(state0.G.players[1].hand.length > 0, 'player1 hand should have cards');
  assert.ok(state0.G.players[1].deck.length > 0, 'player1 deck should have cards');
  assert.ok(
    state0.G.players[1].hand.every((card: any) => card.defId === '__hidden__'),
    'player0 view should hide player1 hand',
  );
  assert.ok(
    state0.G.players[1].deck.every((card: any) => card.defId === '__hidden__'),
    'player0 view should hide player1 deck',
  );
  assert.ok(
    state0.G.players[0].hand.some((card: any) => card.defId !== '__hidden__'),
    'player0 hand should be visible to player0',
  );

  console.log('online smoke: all assertions passed');
} finally {
  for (const client of clients) client.stop();
  if (runResult) await server.kill(runResult);
}
