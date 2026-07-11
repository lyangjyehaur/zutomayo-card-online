import type { Game, Move } from 'boardgame.io';
import type {
  ActionLogEntry,
  CardInstance,
  GameState,
  JankenChoice,
  PlayerIndex,
  PlayerState,
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
  submitPendingChoice,
  timeoutAdvance,
  timeoutSkip,
  undoSetCard,
  validateZutomayoSetupData,
} from './GameLogic';

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

function hiddenCard(instanceId: string): CardInstance {
  return { instanceId, defId: '__hidden__', faceUp: false };
}

function redactHiddenCard(card: CardInstance | null, placeholder: string): CardInstance | null {
  if (!card) return null;
  return card.faceUp ? { ...card } : hiddenCard(placeholder);
}

function redactDeckForViewer(player: PlayerState, owner: PlayerIndex): CardInstance[] {
  return player.deck.map((card, index) => (card.faceUp ? { ...card } : hiddenCard(`hidden-p${owner}-deck-${index}`)));
}

function redactPlayerForViewer(G: GameState, owner: PlayerIndex, viewer: PlayerIndex | null) {
  const player = G.players[owner];
  const isOwner = viewer === owner;
  if (isOwner) return { ...player, hand: [...player.hand], deck: redactDeckForViewer(player, owner) };
  const revealedHandIds = new Set(G.revealedHandCardIds?.[owner] ?? []);

  return {
    ...player,
    hand: player.hand.map((card, index) =>
      revealedHandIds.has(card.instanceId) ? { ...card } : hiddenCard(`hidden-p${owner}-hand-${index}`),
    ),
    deck: redactDeckForViewer(player, owner),
    battleZone: redactHiddenCard(player.battleZone, `hidden-p${owner}-battle`),
    setZoneA: redactHiddenCard(player.setZoneA, `hidden-p${owner}-set-a`),
    setZoneB: redactHiddenCard(player.setZoneB, `hidden-p${owner}-set-b`),
  };
}

function redactPlayedCardsForViewer(G: GameState, owner: PlayerIndex, viewer: PlayerIndex | null): CardInstance[] {
  if (viewer === owner) return G.setCardsThisTurn[owner].map((card) => ({ ...card }));
  return G.setCardsThisTurn[owner].map((card, index) =>
    card.faceUp ? { ...card } : hiddenCard(`hidden-p${owner}-played-${index}`),
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
      return { ...entry, payload };
    });
}

function playerView({ G, playerID }: { G: GameState; playerID: string | null }): GameState {
  const viewer = playerIndex(playerID);
  const bothChose = G.jankenChoices[0] !== null && G.jankenChoices[1] !== null;
  // 教學模式（skipShuffle）下 AI 需看到玩家出拳才能出會輸的拳，
  // 且 AI 非真人不存在資訊不公平。非教學模式維持原資訊隱藏邏輯。
  const revealJankenForAI = G.tutorialSkipShuffle === true && viewer === 1;
  const jankenChoices = G.jankenChoices.map((choice, index) => {
    if (bothChose || viewer === index || revealJankenForAI) return choice;
    return null;
  }) as GameState['jankenChoices'];
  const pendingChoice =
    !G.pendingChoice || G.pendingChoice.player === viewer ? G.pendingChoice : { ...G.pendingChoice, options: [] };

  return {
    ...G,
    players: [redactPlayerForViewer(G, 0, viewer), redactPlayerForViewer(G, 1, viewer)] as [PlayerState, PlayerState],
    setCardsThisTurn: [redactPlayedCardsForViewer(G, 0, viewer), redactPlayedCardsForViewer(G, 1, viewer)] as [
      CardInstance[],
      CardInstance[],
    ],
    jankenChoices,
    pendingChoice,
    actionLog: redactActionLogForViewer(G, viewer, bothChose),
  };
}

const moves: Record<string, Move<GameState>> = {
  janken: ({ G, playerID }, choice: JankenChoice) => {
    const player = playerIndex(playerID);
    if (player === null || !chooseJanken(G, player, choice)) return INVALID_MOVE;
  },
  mulligan: ({ G, playerID }, indices: number[]) => {
    const player = playerIndex(playerID);
    if (player === null || !Array.isArray(indices) || !finishMulligan(G, player, indices)) return INVALID_MOVE;
  },
  keepHand: ({ G, playerID }) => {
    const player = playerIndex(playerID);
    if (player === null || !finishMulligan(G, player, [])) return INVALID_MOVE;
  },
  setInitialCard: ({ G, playerID }, handIndex: number) => {
    const player = playerIndex(playerID);
    if (player === null || !setInitialCard(G, player, handIndex)) return INVALID_MOVE;
  },
  setTurnCard: ({ G, playerID }, handIndex: number, slot: SetSlot) => {
    const player = playerIndex(playerID);
    if (player === null || !setTurnCard(G, player, handIndex, slot)) return INVALID_MOVE;
  },
  undoSetCard: ({ G, playerID }, slot: SetSlot) => {
    const player = playerIndex(playerID);
    if (player === null || !undoSetCard(G, player, slot)) return INVALID_MOVE;
  },
  confirmReady: ({ G, playerID }) => {
    const player = playerIndex(playerID);
    if (player === null || !confirmReady(G, player, getParsedEffects())) return INVALID_MOVE;
  },
  // P3-16：線上回合超時由伺服器權威判斷，強制跳過該玩家回合（避免卡死）。
  timeoutSkip: ({ G, playerID }, targetPlayer?: PlayerIndex) => {
    const caller = playerIndex(playerID);
    if (caller === null) return INVALID_MOVE;
    // 權威時間到後，允許仍在線的一方代為跳過斷線／無回應的玩家。
    // timeoutSkip 本身仍會驗證 turnSet、ready 與伺服器時間，不能提前強制對手結束操作。
    const target = targetPlayer === 0 || targetPlayer === 1 ? targetPlayer : caller;
    if (!timeoutSkip(G, target, getParsedEffects())) return INVALID_MOVE;
  },
  timeoutAdvance: ({ G, playerID }, targetPlayer?: PlayerIndex) => {
    const caller = playerIndex(playerID);
    if (caller === null) return INVALID_MOVE;
    const target = targetPlayer === 0 || targetPlayer === 1 ? targetPlayer : caller;
    if (!timeoutAdvance(G, target, getParsedEffects())) return INVALID_MOVE;
  },
  resolvePendingEffect: ({ G, playerID }, index: number) => {
    const player = playerIndex(playerID);
    if (player === null || !resolvePendingEffectChoice(G, player, index, getParsedEffects())) return INVALID_MOVE;
  },
  submitPendingChoice: ({ G, playerID }, optionIds: string[]) => {
    const player = playerIndex(playerID);
    if (player === null || !submitPendingChoice(G, player, optionIds, getParsedEffects())) return INVALID_MOVE;
  },
};

export const ZutomayoCard: Game<GameState, Record<string, unknown>, ZutomayoSetupData> = {
  name: 'zutomayo-card',
  validateSetupData: (setupData) => validateZutomayoSetupData(setupData),
  // 防禦深度：即使 validate 被繞過，setup 也強制剝離 skipShuffle，
  // 確保線上對戰牌序必定隨機、無法被惡意客戶端固定。
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
        },
        { allowBrowserCustomDeckName: true },
      ),
  };
}
