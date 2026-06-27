import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { ZutomayoCard } from '../src/game/Game';
import { validateConstructedDeckIds } from '../src/game/cards/deckBuilder';
import { PRESET_DECKS } from '../src/game/cards/presetDecks';
import type { CardInstance, GameState, ZutomayoSetupData } from '../src/game/types';

const require = createRequire(import.meta.url);
const { Server } = require('boardgame.io/server') as typeof import('boardgame.io/server');
const { Client } = require('boardgame.io/client') as typeof import('boardgame.io/client');
const { SocketIO } = require('boardgame.io/multiplayer') as typeof import('boardgame.io/multiplayer');

const port = 4199;
const baseUrl = `http://127.0.0.1:${port}`;

type ClientState = { G: GameState; _stateID?: number } | null | undefined;

interface BoardgameClient {
  start: () => void;
  stop: () => void;
  getState: () => ClientState;
  moves: Record<string, (...args: unknown[]) => void>;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await postJsonResponse(path, body);
  if (!response.ok) {
    throw new Error(`${path} failed ${response.status}: ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}

async function postJsonResponse(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function waitForStates(
  label: string,
  client0: BoardgameClient,
  client1: BoardgameClient,
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

async function waitForSyncedStateID(label: string, client0: BoardgameClient, client1: BoardgameClient): Promise<number> {
  const [state0] = await waitForStates(label, client0, client1, (next0, next1) => {
    const id0 = stateID(next0);
    const id1 = stateID(next1);
    return id0 >= 0 && id0 === id1;
  });
  return stateID(state0);
}

async function performOnlineMove(
  label: string,
  client0: BoardgameClient,
  client1: BoardgameClient,
  move: () => void,
): Promise<void> {
  const previousStateID = await waitForSyncedStateID(`${label} ready`, client0, client1);
  move();
  await waitForStates(`${label} update`, client0, client1, (next0, next1) => (
    stateID(next0) > previousStateID && stateID(next1) > previousStateID
  ));
}

async function drainPendingEffects(client0: BoardgameClient, client1: BoardgameClient): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const [state0, state1] = await waitForStates('post-confirm step', client0, client1, (next0, next1) => {
      const id0 = stateID(next0);
      const id1 = stateID(next1);
      const step0 = next0?.G?.step;
      const step1 = next1?.G?.step;
      return id0 >= 0 && id0 === id1 && step0 === step1 && (step0 === 'effectOrder' || step0 === 'turnSet');
    });

    if (state0.G.step !== 'effectOrder' || state1.G.step !== 'effectOrder') return;

    const pendingPlayer = state0.G.pendingEffectPlayer;
    assert.ok(pendingPlayer === 0 || pendingPlayer === 1, 'pending effect should have an owning player');
    await performOnlineMove(`player${pendingPlayer} resolvePendingEffect`, client0, client1, () => (
      pendingPlayer === 0 ? client0 : client1
    ).moves.resolvePendingEffect(0));
  }

  throw new Error('Timed out resolving pending effects');
}

async function createOnlineMatch(setupData: ZutomayoSetupData): Promise<string> {
  const { matchID } = await postJson<{ matchID: string }>('/games/zutomayo-card/create', {
    numPlayers: 2,
    setupData,
  });
  return matchID;
}

async function joinOnlineMatch(matchID: string, playerID: '0' | '1'): Promise<{ playerCredentials: string }> {
  return postJson<{ playerCredentials: string }>(`/games/zutomayo-card/${matchID}/join`, {
    playerID,
    playerName: `Player ${playerID}`,
  });
}

async function startJoinedClients(setupData: ZutomayoSetupData): Promise<{
  client0: BoardgameClient;
  client1: BoardgameClient;
  state0: NonNullable<ClientState>;
  state1: NonNullable<ClientState>;
}> {
  const matchID = await createOnlineMatch(setupData);
  const player0 = await joinOnlineMatch(matchID, '0');
  const player1 = await joinOnlineMatch(matchID, '1');

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
  const [state0, state1] = await waitForStates('janken', client0, client1, (next0, next1) => (
    next0?.G?.step === 'janken' && next1?.G?.step === 'janken'
  ));
  return { client0, client1, state0, state1 };
}

async function playToTurnSet(client0: BoardgameClient, client1: BoardgameClient): Promise<NonNullable<ClientState>> {
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
  await drainPendingEffects(client0, client1);
  const [state0] = await waitForStates('turnSet', client0, client1, (next0, next1) => (
    next0?.G?.step === 'turnSet' && next1?.G?.step === 'turnSet'
  ));
  return state0;
}

function assertHiddenOpponentInfo(viewerState: NonNullable<ClientState>, opponent: 0 | 1): void {
  assert.ok(viewerState.G.players[opponent].hand.length > 0, `player${opponent} hand should have cards`);
  assert.ok(viewerState.G.players[opponent].deck.length > 0, `player${opponent} deck should have cards`);
  assert.ok(
    viewerState.G.players[opponent].hand.every((card: CardInstance) => card.defId === '__hidden__'),
    `opponent player${opponent} hand should be hidden`,
  );
  assert.ok(
    viewerState.G.players[opponent].deck.every((card: CardInstance) => card.defId === '__hidden__'),
    `opponent player${opponent} deck should be hidden`,
  );
}

function assertVisibleDeckMatchesIds(
  viewerState: NonNullable<ClientState>,
  player: 0 | 1,
  expectedIds: string[],
): void {
  const actualIds = [
    ...viewerState.G.players[player].hand,
    ...viewerState.G.players[player].deck,
  ].map((card: CardInstance) => card.defId).sort();
  assert.deepEqual(actualIds, [...expectedIds].sort());
}

const server = Server({
  games: [ZutomayoCard],
  origins: [/localhost:\d+/, /127\.0\.0\.1:\d+/],
});
let runResult: Awaited<ReturnType<typeof server.run>> | undefined;
const clients: BoardgameClient[] = [];

try {
  runResult = await server.run(port);

  const presetMatch = await startJoinedClients({ deck0Name: 'dark', deck1Name: 'flame' });
  const presetTurnSet = await playToTurnSet(presetMatch.client0, presetMatch.client1);
  assertHiddenOpponentInfo(presetTurnSet, 1);
  assert.ok(
    presetTurnSet.G.players[0].hand.some((card: CardInstance) => card.defId !== '__hidden__'),
    'player0 hand should be visible to player0',
  );

  const customDeck0Ids = [...PRESET_DECKS.electric.ids];
  const customDeck1Ids = [...PRESET_DECKS.wind.ids];
  assert.equal(validateConstructedDeckIds(customDeck0Ids), null);
  assert.equal(validateConstructedDeckIds(customDeck1Ids), null);
  const customMatch = await startJoinedClients({ deck0Ids: customDeck0Ids, deck1Ids: customDeck1Ids });
  assertVisibleDeckMatchesIds(customMatch.state0, 0, customDeck0Ids);
  assertVisibleDeckMatchesIds(customMatch.state1, 1, customDeck1Ids);
  assertHiddenOpponentInfo(customMatch.state0, 1);
  assertHiddenOpponentInfo(customMatch.state1, 0);
  const customTurnSet = await playToTurnSet(customMatch.client0, customMatch.client1);
  assertHiddenOpponentInfo(customTurnSet, 1);

  const invalidDeckIds = [...customDeck0Ids];
  invalidDeckIds[0] = 'missing_card';
  const invalidResponse = await postJsonResponse('/games/zutomayo-card/create', {
    numPlayers: 2,
    setupData: { deck0Ids: invalidDeckIds, deck1Ids: customDeck1Ids },
  });
  assert.equal(invalidResponse.ok, false, 'invalid custom deck payload should be rejected');

  console.log('online smoke: all assertions passed');
} finally {
  for (const client of clients) client.stop();
  if (runResult) await server.kill(runResult);
}
