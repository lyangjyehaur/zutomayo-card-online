import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { createAdapter } from '@socket.io/redis-adapter';
import { ZutomayoCard, ZutomayoOnlineCard, resetParsedEffects } from '../src/game/Game';
import { initCards } from '../src/game/cards/loader';
import { getPresetDeck, validateConstructedDeckIds } from '../src/game/cards/deckBuilder';
import { PostgresAdapter } from '../src/server/db/postgres-adapter';
import { RedisPubSub } from '../src/server/transport/redis-pubsub';
import type { CardInstance, GameState, ZutomayoSetupData } from '../src/game/types';
import { APP_VERSION_INFO, isCompatibleVersion } from '../src/version';
import { createOnlineStateSnapshot } from '../src/onlineStateGuard';
import { loadCardsForScript } from './cardSource';

const require = createRequire(import.meta.url);
const { Server, SocketIO: ServerSocketIO } = require('boardgame.io/server') as typeof import('boardgame.io/server');
const { Client } = require('boardgame.io/client') as typeof import('boardgame.io/client');
const { SocketIO } = require('boardgame.io/multiplayer') as typeof import('boardgame.io/multiplayer');

// 水平擴展基礎建設：online-smoke 用真實 PG + Redis 驗證 PostgresAdapter + RedisPubSub
// 在完整 client-server 流程中正確運作（lobby createMatch → setState → client sync），
// 而不僅是 SQL 層測試。PG/Redis 透過 docker-compose up postgres redis 提供。
process.env.PG_HOST = process.env.PG_HOST || 'localhost';
process.env.PG_PORT = process.env.PG_PORT || '5432';
process.env.PG_USER = process.env.PG_USER || 'zutomayo';
process.env.PG_PASSWORD = process.env.PG_PASSWORD || 'zutomayo_dev';
process.env.PG_DATABASE = process.env.PG_DATABASE || 'zutomayo';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.REDIS_DB = process.env.REDIS_DB || '0';

const REDIS_URL = process.env.REDIS_URL;
const REDIS_DB = Number(process.env.REDIS_DB) || 0;
// 雙 Redis 連線設計（同 src/server.ts）：publish 共用 + 兩條 subscribe 專屬。
const redisPubClient = new Redis(REDIS_URL, { db: REDIS_DB });
const redisAdapterSubClient = redisPubClient.duplicate();
const redisPubSubSubClient = redisPubClient.duplicate();
const socketIoAdapter = createAdapter(redisPubClient, redisAdapterSubClient);
const redisPubSub = new RedisPubSub<unknown>({
  pubClient: redisPubClient,
  subClient: redisPubSubSubClient,
});
const db = new PostgresAdapter();

// 直接 PG 連線用於測試前清空 bjg_matches（避免舊 match 干擾）。
const cleanupPool = new Pool({
  host: process.env.PG_HOST,
  port: Number(process.env.PG_PORT),
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
});

const port = 4199;
const baseUrl = `http://127.0.0.1:${port}`;
const smokeMode = process.env.ONLINE_SMOKE_MODE ?? 'all';

type ClientState = { G: GameState; ctx?: unknown; _stateID?: number } | null | undefined;
type StoredState = { G: GameState; ctx: unknown; _stateID: number };

interface BoardgameClient {
  start: () => void;
  stop: () => void;
  getState: () => ClientState;
  moves: Record<string, (...args: unknown[]) => void>;
}

function createBoardgameClient(matchID: string, playerID: '0' | '1', credentials: string): BoardgameClient {
  return Client({
    game: ZutomayoCard,
    numPlayers: 2,
    multiplayer: SocketIO({ server: baseUrl }),
    playerID,
    matchID,
    credentials,
  }) as BoardgameClient;
}

function stopClient(client: BoardgameClient): void {
  try {
    client.stop();
  } catch (err) {
    if (!(err instanceof TypeError && String(err.message).includes('close'))) throw err;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function waitForSyncedStateID(
  label: string,
  client0: BoardgameClient,
  client1: BoardgameClient,
): Promise<number> {
  const [state0] = await waitForStates(label, client0, client1, (next0, next1) => {
    const id0 = stateID(next0);
    const id1 = stateID(next1);
    return id0 >= 0 && id0 === id1;
  });
  return stateID(state0);
}

function stateSnapshot(state: NonNullable<ClientState>) {
  assert.equal(typeof state._stateID, 'number', 'client state should have _stateID');
  return createOnlineStateSnapshot({
    stateID: state._stateID,
    G: state.G,
    ctx: state.ctx ?? {},
  });
}

async function fetchStoredState(matchID: string): Promise<StoredState> {
  const { rows } = await cleanupPool.query<{ state: StoredState }>(
    'SELECT state FROM bjg_matches WHERE match_id = $1',
    [matchID],
  );
  assert.equal(rows.length, 1, `stored match ${matchID} should exist`);
  return rows[0].state;
}

async function waitForAuthoritativeConsistency(
  label: string,
  matchID: string,
  client0: BoardgameClient,
  client1: BoardgameClient,
): Promise<StoredState> {
  const started = Date.now();
  let lastError: unknown;
  let lastDebug = '';
  while (Date.now() - started < 5000) {
    try {
      const [state0, state1] = await waitForStates(`${label} clients synced`, client0, client1, (next0, next1) => {
        const id0 = stateID(next0);
        const id1 = stateID(next1);
        return id0 >= 0 && id0 === id1;
      });
      const stored = await fetchStoredState(matchID);
      lastDebug = `${label}: client0=${stateID(state0)}/${state0.G.step}, client1=${stateID(state1)}/${state1.G.step}, db=${stored._stateID}/${stored.G.step}`;
      if (stored._stateID !== stateID(state0)) {
        await delay(50);
        continue;
      }

      const expected0 = ZutomayoCard.playerView?.({ G: stored.G, ctx: stored.ctx as never, playerID: '0' }) ?? stored.G;
      const expected1 = ZutomayoCard.playerView?.({ G: stored.G, ctx: stored.ctx as never, playerID: '1' }) ?? stored.G;
      const expectedSnapshot0 = createOnlineStateSnapshot({
        stateID: stored._stateID,
        G: expected0,
        ctx: stored.ctx,
      });
      const expectedSnapshot1 = createOnlineStateSnapshot({
        stateID: stored._stateID,
        G: expected1,
        ctx: stored.ctx,
      });

      assert.deepEqual(stateSnapshot(state0), expectedSnapshot0, `${label}: player0 view should match DB playerView`);
      assert.deepEqual(stateSnapshot(state1), expectedSnapshot1, `${label}: player1 view should match DB playerView`);
      return stored;
    } catch (err) {
      lastError = err;
      await delay(50);
    }
  }
  if (lastError instanceof Error) {
    lastError.message = `${lastError.message} (${lastDebug})`;
    throw lastError;
  }
  throw new Error(`Timed out waiting for ${label} consistency (${lastDebug})`);
}

async function performOnlineMove(
  label: string,
  client0: BoardgameClient,
  client1: BoardgameClient,
  move: () => void,
): Promise<void> {
  const previousStateID = await waitForSyncedStateID(`${label} ready`, client0, client1);
  move();
  await waitForStates(
    `${label} update`,
    client0,
    client1,
    (next0, next1) => stateID(next0) > previousStateID && stateID(next1) > previousStateID,
  );
}

async function performConcurrentOnlineMoves(
  label: string,
  matchID: string,
  client0: BoardgameClient,
  client1: BoardgameClient,
  move0: () => void,
  move1: () => void,
): Promise<StoredState> {
  const previousStateID = await waitForSyncedStateID(`${label} ready`, client0, client1);
  move0();
  move1();
  await waitForStates(
    `${label} accepted update`,
    client0,
    client1,
    (next0, next1) => stateID(next0) > previousStateID && stateID(next0) === stateID(next1),
  );
  return waitForAuthoritativeConsistency(label, matchID, client0, client1);
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
    await performOnlineMove(`player${pendingPlayer} resolvePendingEffect`, client0, client1, () =>
      (pendingPlayer === 0 ? client0 : client1).moves.resolvePendingEffect(0),
    );
  }

  throw new Error('Timed out resolving pending effects');
}

async function createOnlineMatch(setupData: ZutomayoSetupData): Promise<string> {
  const { matchID } = await postJson<{ matchID: string }>('/games/zutomayo-card/create', {
    numPlayers: 2,
    setupData: { ...setupData, clientVersion: APP_VERSION_INFO },
  });
  return matchID;
}

async function joinOnlineMatch(matchID: string, playerID: '0' | '1'): Promise<{ playerCredentials: string }> {
  return postJson<{ playerCredentials: string }>(`/games/zutomayo-card/${matchID}/join`, {
    playerID,
    playerName: `Player ${playerID}`,
    data: { clientVersion: APP_VERSION_INFO },
  });
}

async function startJoinedClients(setupData: ZutomayoSetupData): Promise<{
  matchID: string;
  client0: BoardgameClient;
  client1: BoardgameClient;
  credentials0: string;
  credentials1: string;
  state0: NonNullable<ClientState>;
  state1: NonNullable<ClientState>;
}> {
  const matchID = await createOnlineMatch(setupData);
  const player0 = await joinOnlineMatch(matchID, '0');
  const player1 = await joinOnlineMatch(matchID, '1');

  const client0 = createBoardgameClient(matchID, '0', player0.playerCredentials);
  const client1 = createBoardgameClient(matchID, '1', player1.playerCredentials);
  clients.push(client0, client1);

  client0.start();
  client1.start();
  const [state0, state1] = await waitForStates(
    'janken',
    client0,
    client1,
    (next0, next1) => next0?.G?.step === 'janken' && next1?.G?.step === 'janken',
  );
  return {
    matchID,
    client0,
    client1,
    credentials0: player0.playerCredentials,
    credentials1: player1.playerCredentials,
    state0,
    state1,
  };
}

async function playToTurnSet(client0: BoardgameClient, client1: BoardgameClient): Promise<NonNullable<ClientState>> {
  await performOnlineMove('player0 janken', client0, client1, () => client0.moves.janken('rock'));
  await performOnlineMove('player1 janken', client0, client1, () => client1.moves.janken('scissors'));
  await waitForStates(
    'mulligan',
    client0,
    client1,
    (state0, state1) => state0?.G?.step === 'mulligan' && state1?.G?.step === 'mulligan',
  );

  await performOnlineMove('player0 keepHand', client0, client1, () => client0.moves.keepHand());
  await performOnlineMove('player1 keepHand', client0, client1, () => client1.moves.keepHand());
  await waitForStates(
    'initialSet',
    client0,
    client1,
    (state0, state1) => state0?.G?.step === 'initialSet' && state1?.G?.step === 'initialSet',
  );

  await performOnlineMove('player0 setInitialCard', client0, client1, () => client0.moves.setInitialCard(0));
  await performOnlineMove('player1 setInitialCard', client0, client1, () => client1.moves.setInitialCard(0));
  await performOnlineMove('player0 confirmReady', client0, client1, () => client0.moves.confirmReady());
  await performOnlineMove('player1 confirmReady', client0, client1, () => client1.moves.confirmReady());
  await drainPendingEffects(client0, client1);
  const [state0] = await waitForStates(
    'turnSet',
    client0,
    client1,
    (next0, next1) => next0?.G?.step === 'turnSet' && next1?.G?.step === 'turnSet',
  );
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
  const actualIds = [...viewerState.G.players[player].hand, ...viewerState.G.players[player].deck]
    .map((card: CardInstance) => card.defId)
    .sort();
  assert.deepEqual(actualIds, [...expectedIds].sort());
}

async function runOnlineConsistencyScenario(): Promise<void> {
  const match = await startJoinedClients({ deck0Name: 'dark', deck1Name: 'flame' });
  const resyncClients = async (label: string) => {
    stopClient(match.client0);
    stopClient(match.client1);
    match.client0 = createBoardgameClient(match.matchID, '0', match.credentials0);
    match.client1 = createBoardgameClient(match.matchID, '1', match.credentials1);
    clients.push(match.client0, match.client1);
    match.client0.start();
    match.client1.start();
    await waitForAuthoritativeConsistency(label, match.matchID, match.client0, match.client1);
  };

  let stored = await performConcurrentOnlineMoves(
    'race janken',
    match.matchID,
    match.client0,
    match.client1,
    () => match.client0.moves.janken('rock'),
    () => match.client1.moves.janken('scissors'),
  );
  if (stored.G.step === 'janken') {
    await resyncClients('resync after race janken');
    stored = await fetchStoredState(match.matchID);
    if (stored.G.jankenChoices[0] === null) {
      await performOnlineMove('repair player0 janken', match.client0, match.client1, () =>
        match.client0.moves.janken('rock'),
      );
    }
    stored = await fetchStoredState(match.matchID);
    if (stored.G.jankenChoices[1] === null) {
      await performOnlineMove('repair player1 janken', match.client0, match.client1, () =>
        match.client1.moves.janken('scissors'),
      );
    }
  }
  await waitForAuthoritativeConsistency('post-janken', match.matchID, match.client0, match.client1);
  await waitForStates(
    'mulligan after race janken',
    match.client0,
    match.client1,
    (state0, state1) => state0?.G?.step === 'mulligan' && state1?.G?.step === 'mulligan',
  );

  stored = await performConcurrentOnlineMoves(
    'race mulligan',
    match.matchID,
    match.client0,
    match.client1,
    () => match.client0.moves.keepHand(),
    () => match.client1.moves.keepHand(),
  );
  if (stored.G.step === 'mulligan') {
    await resyncClients('resync after race mulligan');
    stored = await fetchStoredState(match.matchID);
    if (!stored.G.mulliganUsed[0]) {
      await performOnlineMove('repair player0 keepHand', match.client0, match.client1, () =>
        match.client0.moves.keepHand(),
      );
    }
    stored = await fetchStoredState(match.matchID);
    if (!stored.G.mulliganUsed[1]) {
      await performOnlineMove('repair player1 keepHand', match.client0, match.client1, () =>
        match.client1.moves.keepHand(),
      );
    }
  }
  await waitForAuthoritativeConsistency('post-mulligan', match.matchID, match.client0, match.client1);
  await waitForStates(
    'initialSet after race mulligan',
    match.client0,
    match.client1,
    (state0, state1) => state0?.G?.step === 'initialSet' && state1?.G?.step === 'initialSet',
  );

  stored = await performConcurrentOnlineMoves(
    'race initial set',
    match.matchID,
    match.client0,
    match.client1,
    () => match.client0.moves.setInitialCard(0),
    () => match.client1.moves.setInitialCard(0),
  );
  if (!stored.G.players[0].battleZone || !stored.G.players[1].battleZone) {
    await resyncClients('resync after race initial set');
    stored = await fetchStoredState(match.matchID);
  }
  if (!stored.G.players[0].battleZone) {
    await performOnlineMove('repair player0 initial set', match.client0, match.client1, () =>
      match.client0.moves.setInitialCard(0),
    );
  }
  stored = await fetchStoredState(match.matchID);
  if (!stored.G.players[1].battleZone) {
    await performOnlineMove('repair player1 initial set', match.client0, match.client1, () =>
      match.client1.moves.setInitialCard(0),
    );
  }

  stored = await performConcurrentOnlineMoves(
    'race initial confirm',
    match.matchID,
    match.client0,
    match.client1,
    () => match.client0.moves.confirmReady(),
    () => match.client1.moves.confirmReady(),
  );
  if (stored.G.step === 'initialSet') {
    await resyncClients('resync after race initial confirm');
    stored = await fetchStoredState(match.matchID);
    if (!stored.G.ready[0]) {
      await performOnlineMove('repair player0 initial confirm', match.client0, match.client1, () =>
        match.client0.moves.confirmReady(),
      );
    }
    stored = await fetchStoredState(match.matchID);
    if (!stored.G.ready[1]) {
      await performOnlineMove('repair player1 initial confirm', match.client0, match.client1, () =>
        match.client1.moves.confirmReady(),
      );
    }
  }
  await drainPendingEffects(match.client0, match.client1);
  await waitForStates(
    'turnSet after race initial turn',
    match.client0,
    match.client1,
    (state0, state1) => state0?.G?.step === 'turnSet' && state1?.G?.step === 'turnSet',
  );
  await waitForAuthoritativeConsistency('final consistency', match.matchID, match.client0, match.client1);
}

// Duck-type 斷言注入（同 src/server.ts）：PostgresAdapter / RedisPubSub 因不繼承
// boardgame.io 內部抽象類別 / 泛型不公開，TS 無法自動判定相容。
type ServerOpts = NonNullable<Parameters<typeof Server>[0]>;
type SocketOpts = NonNullable<ConstructorParameters<typeof ServerSocketIO>[0]>;
const transport = new ServerSocketIO({
  socketAdapter: socketIoAdapter,
  pubSub: redisPubSub,
} as SocketOpts);

// 初始化卡牌數據（供 server-side 遊戲邏輯使用）
initCards(await loadCardsForScript());
resetParsedEffects();

function presetDeckIds(name: string): string[] {
  return getPresetDeck(name).map((card) => card.defId);
}

const server = Server({
  games: [ZutomayoOnlineCard],
  db: db as unknown as NonNullable<ServerOpts['db']>,
  transport,
  origins: [/localhost:\d+/, /127\.0\.0\.1:\d+/],
  authenticateCredentials: (
    credentials: string,
    playerMetadata?: { credentials?: string; data?: { clientVersion?: unknown } },
  ) =>
    Boolean(
      credentials &&
      playerMetadata?.credentials === credentials &&
      isCompatibleVersion(playerMetadata.data?.clientVersion),
    ),
});
let runResult: Awaited<ReturnType<typeof server.run>> | undefined;
const clients: BoardgameClient[] = [];

try {
  runResult = await server.run(port);
  // 等 PostgresAdapter 建立 schema（CREATE TABLE IF NOT EXISTS bjg_matches），
  // 再 TRUNCATE 確保測試隔離（lobby createMatch 會 INSERT 此 table）。
  await db.connect();
  await cleanupPool.query('TRUNCATE TABLE bjg_matches RESTART IDENTITY CASCADE');

  if (smokeMode === 'consistency') {
    await runOnlineConsistencyScenario();
  } else {
    const presetMatch = await startJoinedClients({ deck0Name: 'dark', deck1Name: 'flame' });
    const presetTurnSet = await playToTurnSet(presetMatch.client0, presetMatch.client1);
    assertHiddenOpponentInfo(presetTurnSet, 1);
    assert.ok(
      presetTurnSet.G.players[0].hand.some((card: CardInstance) => card.defId !== '__hidden__'),
      'player0 hand should be visible to player0',
    );

    const customDeck0Ids = presetDeckIds('electric');
    const customDeck1Ids = presetDeckIds('wind');
    assert.equal(validateConstructedDeckIds(customDeck0Ids), null);
    assert.equal(validateConstructedDeckIds(customDeck1Ids), null);
    const customMatch = await startJoinedClients({ deck0Ids: customDeck0Ids, deck1Ids: customDeck1Ids });
    assertVisibleDeckMatchesIds(customMatch.state0, 0, customDeck0Ids);
    assertVisibleDeckMatchesIds(customMatch.state1, 1, customDeck1Ids);
    assertHiddenOpponentInfo(customMatch.state0, 1);
    assertHiddenOpponentInfo(customMatch.state1, 0);
    const customTurnSet = await playToTurnSet(customMatch.client0, customMatch.client1);
    assertHiddenOpponentInfo(customTurnSet, 1);

    await runOnlineConsistencyScenario();

    const invalidDeckIds = [...customDeck0Ids];
    invalidDeckIds[0] = 'missing_card';
    const invalidResponse = await postJsonResponse('/games/zutomayo-card/create', {
      numPlayers: 2,
      setupData: { deck0Ids: invalidDeckIds, deck1Ids: customDeck1Ids, clientVersion: APP_VERSION_INFO },
    });
    assert.equal(invalidResponse.ok, false, 'invalid custom deck payload should be rejected');
  }

  console.log('online smoke: all assertions passed');
} finally {
  for (const client of clients) stopClient(client);
  if (runResult) await server.kill(runResult);
  // boardgame.io Master 在 socket disconnect 時 async 呼叫 db.fetch()
  // （onConnectionChange）。client.stop()/server.kill() 觸發 disconnect 後，
  // 仍有 pending 的 disconnect handlers 在事件迴圈中。等 500ms 讓它們完成，
  // 避免 db.close() 的 pool.end() 與進行中的 fetch() 競爭。
  // （PostgresAdapter.close() 後的方法已加 closed flag no-op，這裡的 delay
  //  是為了讓 close() 「之前」已啟動的 fetch 完成。）
  await delay(500);
  // 關閉 PG/Redis 連線，避免測試結束後連線洩漏。
  await Promise.allSettled([
    db.close(),
    redisPubSub.close(),
    redisPubClient.quit(),
    redisAdapterSubClient.quit(),
    cleanupPool.end(),
  ]);
}
