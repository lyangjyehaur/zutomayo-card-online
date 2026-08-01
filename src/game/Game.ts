import type { Game, Move, MoveFn } from 'boardgame.io';
import type {
  ActionLogEntry,
  CardInstance,
  GameState,
  JankenChoice,
  PlayerIndex,
  PlayerState,
  ReplayMoveName,
  SetSlot,
  ZutomayoSetupData,
} from './types';
import { getAllCardDefs, isCardsInitialized } from './cards/loader';
import { parseAllEffects } from './effects';
import {
  chooseJanken,
  confirmReady,
  finishMulligan,
  resolvePendingEffect as resolvePendingEffectChoice,
  setInitialCard,
  setTurnCard,
  setupGame,
  surrenderGame,
  submitPendingChoice,
  timeoutAdvance,
  timeoutSkip,
  undoSetCard,
  validateZutomayoSetupData,
} from './GameLogic';
import { appendReplayDecision, canonicalizeReplayArgs, createReplayRequestFingerprint } from './decisionTrace';

export type { ZutomayoSetupData } from './types';

// boardgame.io 0.50 publishes core as a CommonJS directory that Node ESM cannot
// import directly. The documented sentinel is the stable string consumed by
// its reducer, so keeping it local works in both Vite and the Node server.
const INVALID_MOVE = 'INVALID_MOVE';

let _parsedEffects: ReturnType<typeof parseAllEffects> | null = null;

function getParsedEffects(): ReturnType<typeof parseAllEffects> {
  if (!_parsedEffects) {
    if (!isCardsInitialized()) {
      // 尚未初始化 — 強制用當前 getAllCardDefs()（可能是空陣列）
      // 所有 move 第一次被呼叫時，卡片資料應該已經就緒
      // （由 server.ts initCards 或 App.tsx refreshCards 保證）
    }
    _parsedEffects = parseAllEffects(getAllCardDefs().map((card) => ({ id: card.id, effect: card.effect })));
  }
  return _parsedEffects;
}

/** 清除 parsed effects cache（測試用，或在 cards 重新載入後呼叫） */
export function resetParsedEffects(): void {
  _parsedEffects = null;
}

function playerIndex(playerID: string | null): PlayerIndex | null {
  return playerID === '0' || playerID === '1' ? (Number(playerID) as PlayerIndex) : null;
}

function applyTrackedDecision(
  G: GameState,
  playerID: string | null,
  move: ReplayMoveName,
  args: readonly unknown[],
  apply: (player: PlayerIndex, canonicalArgs: unknown[]) => boolean,
): typeof INVALID_MOVE | undefined {
  const player = playerIndex(playerID);
  if (player === null) return INVALID_MOVE;
  const canonicalArgs = canonicalizeReplayArgs(args);
  const requestFingerprint = createReplayRequestFingerprint(G, player, move, canonicalArgs);
  if (!apply(player, canonicalArgs)) return INVALID_MOVE;
  appendReplayDecision(G, player, move, canonicalArgs, requestFingerprint);
}

function concurrentServerMove(move: MoveFn<GameState>): Move<GameState> {
  return {
    move,
    client: false,
    ignoreStaleStateID: true,
  };
}

function authoritativeServerMove(move: MoveFn<GameState>): Move<GameState> {
  return {
    move,
    client: false,
  };
}

function hiddenCard(instanceId: string): CardInstance {
  return { instanceId, defId: '__hidden__', faceUp: false };
}

interface PlayerViewHiddenIds {
  id(owner: PlayerIndex, card: CardInstance): string;
}

function createPlayerViewHiddenIds(): PlayerViewHiddenIds {
  const ids: [Map<string, string>, Map<string, string>] = [new Map(), new Map()];
  const next = [0, 0];
  return {
    id(owner, card) {
      const existing = ids[owner].get(card.instanceId);
      if (existing) return existing;
      const opaque = `hidden-p${owner}-card-${next[owner]++}`;
      ids[owner].set(card.instanceId, opaque);
      return opaque;
    },
  };
}

function redactHiddenCard(
  card: CardInstance | null,
  owner: PlayerIndex,
  hiddenIds: PlayerViewHiddenIds,
  explicitlyRevealedIds: ReadonlySet<string>,
): CardInstance | null {
  if (!card) return null;
  return card.faceUp || explicitlyRevealedIds.has(card.instanceId)
    ? { ...card }
    : hiddenCard(hiddenIds.id(owner, card));
}

function redactDeckForViewer(
  player: PlayerState,
  owner: PlayerIndex,
  hiddenIds: PlayerViewHiddenIds,
  explicitlyRevealedIds: ReadonlySet<string>,
): CardInstance[] {
  return player.deck.map((card) =>
    card.faceUp || explicitlyRevealedIds.has(card.instanceId) ? { ...card } : hiddenCard(hiddenIds.id(owner, card)),
  );
}

function redactPlayerForViewer(
  G: GameState,
  owner: PlayerIndex,
  viewer: PlayerIndex | null,
  hiddenIds: PlayerViewHiddenIds,
  explicitlyRevealedIds: ReadonlySet<string>,
) {
  const player = G.players[owner];
  const isOwner = viewer === owner;
  if (isOwner) {
    return {
      ...player,
      hand: [...player.hand],
      deck: redactDeckForViewer(player, owner, hiddenIds, explicitlyRevealedIds),
      knownDeckDefIds: player.deck.map((card) => card.defId).sort(),
    };
  }
  // 暫時公開屬於對局玩家取得的私密資訊；觀戰者不可藉由 playerView 讀取。
  const revealedHandIds = new Set(viewer === null ? [] : (G.revealedHandCardIds?.[owner] ?? []));

  return {
    ...player,
    knownDeckDefIds: undefined,
    hand: player.hand.map((card) =>
      revealedHandIds.has(card.instanceId) || explicitlyRevealedIds.has(card.instanceId)
        ? { ...card }
        : hiddenCard(hiddenIds.id(owner, card)),
    ),
    deck: redactDeckForViewer(player, owner, hiddenIds, explicitlyRevealedIds),
    battleZone: redactHiddenCard(player.battleZone, owner, hiddenIds, explicitlyRevealedIds),
    setZoneA: redactHiddenCard(player.setZoneA, owner, hiddenIds, explicitlyRevealedIds),
    setZoneB: redactHiddenCard(player.setZoneB, owner, hiddenIds, explicitlyRevealedIds),
    setZoneC: redactHiddenCard(player.setZoneC, owner, hiddenIds, explicitlyRevealedIds),
    powerCharger: player.powerCharger.map((card) => redactHiddenCard(card, owner, hiddenIds, explicitlyRevealedIds)),
    abyss: player.abyss.map((card) => redactHiddenCard(card, owner, hiddenIds, explicitlyRevealedIds)),
  };
}

function redactPlayedCardsForViewer(
  G: GameState,
  owner: PlayerIndex,
  viewer: PlayerIndex | null,
  hiddenIds: PlayerViewHiddenIds,
  explicitlyRevealedIds: ReadonlySet<string>,
): CardInstance[] {
  if (viewer === owner) return G.setCardsThisTurn[owner].map((card) => ({ ...card }));
  return G.setCardsThisTurn[owner].map((card) =>
    card.faceUp || explicitlyRevealedIds.has(card.instanceId) ? { ...card } : hiddenCard(hiddenIds.id(owner, card)),
  );
}

/**
 * 判斷 setInitialCard / setTurnCard log 所對應的卡牌是否已翻開。
 * 卡牌在 resolveTurn（confirmReady 後）統一翻開，之後 step 進入 effectOrder。
 * 跨輪（entry.turn < G.turnNumber）必定已過戰鬥結算，卡牌已公開。
 */
function isSetCardRevealed(G: GameState, entry: ActionLogEntry): boolean {
  if (entry.turn < G.turnNumber) return true;
  return G.step === 'effectOrder' || G.step === 'gameOver';
}

function redactActionLogForViewer(G: GameState, viewer: PlayerIndex | null, bothChose: boolean): ActionLogEntry[] {
  return (G.actionLog ?? [])
    .filter((entry) => entry.action !== 'janken' || bothChose || entry.player === viewer)
    .map((entry) => {
      const payload = entry.payload && typeof entry.payload === 'object' ? { ...entry.payload } : entry.payload;
      // 對手在卡牌翻開前不應從 actionLog 得知 faceDown 卡的 cardDefId（資訊隱藏）。
      // setInitialCard / setTurnCard 的卡在 resolveBattle 前為 faceDown；
      // resolveTurn（進入 effectOrder/battle）後翻開，翻開後允許 log 顯示卡名供復盤。
      if (
        payload &&
        typeof payload === 'object' &&
        (entry.action === 'setInitialCard' || entry.action === 'setTurnCard') &&
        entry.player !== viewer &&
        !isSetCardRevealed(G, entry)
      ) {
        delete (payload as Record<string, unknown>).cardDefId;
      }
      if (viewer === null && payload && typeof payload === 'object') {
        const privatePayload = payload as Record<string, unknown>;
        if (entry.action === 'revealCards' && privatePayload.sourceZone === 'hand') {
          const cardDefIds = Array.isArray(privatePayload.cardDefIds) ? privatePayload.cardDefIds : [];
          privatePayload.cardCount = Number(privatePayload.cardCount ?? cardDefIds.length);
          delete privatePayload.cardDefIds;
          delete privatePayload.guessedCardDefId;
          delete privatePayload.matched;
        }
        if (entry.action === 'submitPendingChoice' && privatePayload.choiceType === 'selectOpponentHandCard') {
          delete privatePayload.guessedCardDefId;
        }
      }
      return { ...entry, payload };
    });
}

function playerView({ G, playerID }: { G: GameState; playerID: string | null }): GameState {
  const viewer = playerIndex(playerID);
  const hiddenIds = createPlayerViewHiddenIds();
  const explicitlyRevealedIds = new Set(
    viewer !== null && G.pendingChoice?.player === viewer
      ? G.pendingChoice.options.flatMap((option) => (option.cardInstanceId ? [option.cardInstanceId] : []))
      : [],
  );
  const bothChose = G.jankenChoices[0] !== null && G.jankenChoices[1] !== null;
  // 教學模式（skipShuffle）下 AI 需看到玩家出拳才能出會輸的拳，
  // 且 AI 非真人不存在資訊不公平。非教學模式維持原資訊隱藏邏輯。
  const revealJankenForAI = G.tutorialSkipShuffle === true && viewer === 1;
  const jankenChoices = G.jankenChoices.map((choice, index) => {
    if (bothChose || viewer === index || revealJankenForAI) return choice;
    return null;
  }) as GameState['jankenChoices'];
  let pendingChoice =
    !G.pendingChoice || G.pendingChoice.player === viewer ? G.pendingChoice : { ...G.pendingChoice, options: [] };
  if (
    viewer === null &&
    pendingChoice?.type === 'acknowledgeRevealedHand' &&
    (pendingChoice.payload.sourceZone ?? 'hand') === 'hand'
  ) {
    pendingChoice = {
      ...pendingChoice,
      payload: {
        revealedPlayer: pendingChoice.payload.revealedPlayer,
        sourceZone: 'hand',
      },
    };
  }

  return {
    ...G,
    // Seed, counter, and pre-shuffle decks are server-only while play is active.
    rng: undefined,
    replayManifest: undefined,
    decisionTrace: undefined,
    replayStatus: undefined,
    players: [
      redactPlayerForViewer(G, 0, viewer, hiddenIds, explicitlyRevealedIds),
      redactPlayerForViewer(G, 1, viewer, hiddenIds, explicitlyRevealedIds),
    ] as [PlayerState, PlayerState],
    setCardsThisTurn: [
      redactPlayedCardsForViewer(G, 0, viewer, hiddenIds, explicitlyRevealedIds),
      redactPlayedCardsForViewer(G, 1, viewer, hiddenIds, explicitlyRevealedIds),
    ] as [CardInstance[], CardInstance[]],
    // 觀戰者連暫時公開清單中的手牌 instance ID 也不應收到，避免透過
    // 重連或其他狀態快照將隱藏卡牌跨區域關聯起來。
    revealedHandCardIds: viewer === null ? [[], []] : G.revealedHandCardIds,
    jankenChoices,
    pendingChoice,
    actionLog: redactActionLogForViewer(G, viewer, bothChose),
  };
}

const moves: Record<string, Move<GameState>> = {
  janken: concurrentServerMove(({ G, playerID }, choice: JankenChoice) => {
    return applyTrackedDecision(G, playerID, 'janken', [choice], (player, args) =>
      chooseJanken(G, player, args[0] as JankenChoice),
    );
  }),
  mulligan: concurrentServerMove(({ G, playerID }, indices: number[]) => {
    return applyTrackedDecision(G, playerID, 'mulligan', [indices], (player, args) => {
      const replayIndices = args[0];
      return Array.isArray(replayIndices) && finishMulligan(G, player, replayIndices as number[]);
    });
  }),
  keepHand: concurrentServerMove(({ G, playerID }) => {
    return applyTrackedDecision(G, playerID, 'keepHand', [], (player) => finishMulligan(G, player, []));
  }),
  setInitialCard: concurrentServerMove(({ G, playerID }, handIndex: number) => {
    return applyTrackedDecision(G, playerID, 'setInitialCard', [handIndex], (player, args) =>
      setInitialCard(G, player, args[0] as number),
    );
  }),
  setTurnCard: concurrentServerMove(({ G, playerID }, handIndex: number, slot: SetSlot) => {
    return applyTrackedDecision(G, playerID, 'setTurnCard', [handIndex, slot], (player, args) =>
      setTurnCard(G, player, args[0] as number, args[1] as SetSlot),
    );
  }),
  undoSetCard: concurrentServerMove(({ G, playerID }, slot: SetSlot) => {
    return applyTrackedDecision(G, playerID, 'undoSetCard', [slot], (player, args) =>
      undoSetCard(G, player, args[0] as SetSlot),
    );
  }),
  confirmReady: concurrentServerMove(({ G, playerID }) => {
    return applyTrackedDecision(G, playerID, 'confirmReady', [], (player) =>
      confirmReady(G, player, getParsedEffects()),
    );
  }),
  // P3-16：線上回合超時由伺服器權威判斷，強制跳過該玩家回合（避免卡死）。
  timeoutSkip: concurrentServerMove(({ G, playerID }, targetPlayer?: PlayerIndex) => {
    const args = targetPlayer === undefined ? [] : [targetPlayer];
    return applyTrackedDecision(G, playerID, 'timeoutSkip', args, (caller, replayArgs) => {
      // 權威時間到後，允許仍在線的一方代為跳過斷線／無回應的玩家。
      // timeoutSkip 本身仍會驗證 turnSet、ready 與伺服器時間，不能提前強制對手結束操作。
      const target = replayArgs[0] === 0 || replayArgs[0] === 1 ? replayArgs[0] : caller;
      return timeoutSkip(G, target, getParsedEffects());
    });
  }),
  timeoutAdvance: concurrentServerMove(({ G, playerID }, targetPlayer?: PlayerIndex) => {
    const args = targetPlayer === undefined ? [] : [targetPlayer];
    return applyTrackedDecision(G, playerID, 'timeoutAdvance', args, (caller, replayArgs) => {
      const target = replayArgs[0] === 0 || replayArgs[0] === 1 ? replayArgs[0] : caller;
      return timeoutAdvance(G, target, getParsedEffects());
    });
  }),
  surrender: concurrentServerMove(({ G, playerID }) => {
    return applyTrackedDecision(G, playerID, 'surrender', [], (player) => surrenderGame(G, player));
  }),
  resolvePendingEffect: authoritativeServerMove(({ G, playerID }, index: number) => {
    return applyTrackedDecision(G, playerID, 'resolvePendingEffect', [index], (player, args) =>
      resolvePendingEffectChoice(G, player, args[0] as number, getParsedEffects()),
    );
  }),
  submitPendingChoice: authoritativeServerMove(({ G, playerID }, optionIds: string[]) => {
    return applyTrackedDecision(G, playerID, 'submitPendingChoice', [optionIds], (player, args) =>
      submitPendingChoice(G, player, args[0] as string[], getParsedEffects()),
    );
  }),
};

export const ZutomayoCard: Game<GameState, Record<string, unknown>, ZutomayoSetupData> = {
  name: 'zutomayo-card',
  validateSetupData: (setupData) => validateZutomayoSetupData(setupData),
  // Online creation sanitizes rngSeed before boardgame.io reaches setup; this
  // layer still strips skipShuffle so a client cannot choose its draw order.
  setup: (_context, setupData) => setupGame({ ...setupData, skipShuffle: false }),
  playerView,
  moves,
  turn: {
    // P3-16：boardgame.io turn.onBegin 為伺服器端 hook，於 turn 開始時記錄權威時間。
    // 本遊戲的回合推進由 finishTurn 控制（boardgame.io turn 不隨遊戲內回合切換），
    // 故每個遊戲內回合的 turnStartTime 主要由 finishTurn 更新；此處確保初始值正確。
    onBegin: ({ G }) => {
      G.turnStartTime = Date.now();
      G.interactionStartTime = G.turnStartTime;
    },
    activePlayers: { all: 'simultaneous' },
    stages: { simultaneous: { moves } },
  },
  endIf: ({ G }) => {
    if (G.step !== 'gameOver') return;
    return G.winner === null ? { draw: true } : { winner: String(G.winner) };
  },
};

export const ZutomayoOnlineCard: Game<GameState, Record<string, unknown>, ZutomayoSetupData> = {
  ...ZutomayoCard,
  validateSetupData: (setupData) => validateZutomayoSetupData(setupData, { requireClientVersion: true }),
};

export function createZutomayoCard(
  defaultSetupData: ZutomayoSetupData = {},
): Game<GameState, Record<string, unknown>, ZutomayoSetupData> {
  return {
    ...ZutomayoCard,
    validateSetupData: (setupData) =>
      validateZutomayoSetupData(
        {
          deck0Name: setupData?.deck0Name ?? defaultSetupData.deck0Name,
          deck1Name: setupData?.deck1Name ?? defaultSetupData.deck1Name,
          deck0Ids: setupData?.deck0Ids ?? defaultSetupData.deck0Ids,
          deck1Ids: setupData?.deck1Ids ?? defaultSetupData.deck1Ids,
          clientVersion: setupData?.clientVersion ?? defaultSetupData.clientVersion,
          skipShuffle: setupData?.skipShuffle ?? defaultSetupData.skipShuffle,
          rngSeed: setupData?.rngSeed ?? defaultSetupData.rngSeed,
        },
        { allowBrowserCustomDeckName: true, requireClientVersion: false, allowSkipShuffle: true },
      ),
    setup: (_context, setupData) =>
      setupGame(
        {
          deck0Name: setupData?.deck0Name ?? defaultSetupData.deck0Name,
          deck1Name: setupData?.deck1Name ?? defaultSetupData.deck1Name,
          deck0Ids: setupData?.deck0Ids ?? defaultSetupData.deck0Ids,
          deck1Ids: setupData?.deck1Ids ?? defaultSetupData.deck1Ids,
          clientVersion: setupData?.clientVersion ?? defaultSetupData.clientVersion,
          skipShuffle: setupData?.skipShuffle ?? defaultSetupData.skipShuffle,
          rngSeed: setupData?.rngSeed ?? defaultSetupData.rngSeed,
        },
        { allowBrowserCustomDeckName: true },
      ),
  };
}
