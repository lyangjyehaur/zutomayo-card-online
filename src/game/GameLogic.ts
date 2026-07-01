import type { ParsedEffect } from './effects';
import {
  areEffectsDisabledForCard,
  collectTurnEffects,
  executeEffect,
  getTurnEffectPlayerOrder,
} from './effects/executor';
import type {
  ActionLogEntry,
  CardInstance,
  ChronosTime,
  CombatModifiers,
  Element,
  GameState,
  HpChangeBreakdown,
  HpChangeBreakdownLine,
  JankenChoice,
  PendingChoice,
  PendingEffect,
  PlayerIndex,
  PlayerState,
  SetSlot,
  TimingEvent,
  ZutomayoSetupData,
} from './types';
import { applyPendingChoice, choiceActionPayload, shouldPreserveChoiceSelectionCount } from './pendingChoices';
import { getChronosTimeForPosition, normalizeChronosPosition } from './chronos';
import { getCardDef } from './cards/loader';
import {
  buildDeck,
  buildCounterDeck,
  CUSTOM_DECK_NAME,
  COUNTER_DECK_NAME,
  getPresetDeck,
  randomDeck,
  shuffleDeck,
  validateConstructedDeckIds,
} from './cards/deckBuilder';
import { pushHpChange } from './hpChange';
import { pushGameNotice } from './gameNotices';
import { recordAction } from './actionLog';
import { APP_VERSION_INFO, isCompatibleVersion } from '../version';

const playerIndexes: PlayerIndex[] = [0, 1];

// P3-16：伺服器權威回合時限（毫秒）。與 Board.tsx 的 TURN_TIMER_SECONDS 一致。
export const TURN_TIMER_MS = 60_000;

interface SetupGameOptions {
  allowBrowserCustomDeckName?: boolean;
  requireClientVersion?: boolean;
  /** 允許 setupData.skipShuffle=true。僅本地 AI 對戰/教學模式應啟用；
   *  線上對戰預設不允許，防止惡意客戶端固定牌序作弊。 */
  allowSkipShuffle?: boolean;
}

function validateSetupDeck(
  player: PlayerIndex,
  ids: unknown,
  name: string | undefined,
  options: SetupGameOptions,
): string | undefined {
  if (ids !== undefined) {
    const validationError = validateConstructedDeckIds(ids);
    return validationError ? `Player ${player} custom deck invalid: ${validationError}` : undefined;
  }
  if (name === CUSTOM_DECK_NAME && !options.allowBrowserCustomDeckName) {
    return `Player ${player} custom deck requires deck IDs in setupData`;
  }
  return undefined;
}

export function validateZutomayoSetupData(
  setupData: ZutomayoSetupData | undefined,
  options: SetupGameOptions = {},
): string | undefined {
  const data = setupData || {};
  if (options.requireClientVersion === true && !isCompatibleVersion(data.clientVersion, APP_VERSION_INFO)) {
    return 'Client version does not match server game version';
  }
  // 線上對戰不允許 skipShuffle，防止惡意客戶端固定牌序作弊
  if (options.allowSkipShuffle !== true && data.skipShuffle === true) {
    return 'skipShuffle is not allowed in this game mode';
  }
  return (
    validateSetupDeck(0, data.deck0Ids, data.deck0Name, options) ??
    validateSetupDeck(1, data.deck1Ids, data.deck1Name, options)
  );
}

function setupDeck(
  player: PlayerIndex,
  ids: unknown,
  name: string | undefined,
  allowBrowserCustomDeckName: boolean,
): CardInstance[] {
  const validationError = validateSetupDeck(player, ids, name, { allowBrowserCustomDeckName });
  if (validationError) throw new Error(validationError);

  if (ids !== undefined) {
    return buildDeck(ids as string[]);
  }
  if (name) {
    return getPresetDeck(name);
  }
  return randomDeck();
}

function effectActionSummary(effect: ParsedEffect): { trigger: ParsedEffect['trigger']; actionType: string } {
  return {
    trigger: effect.trigger,
    actionType: effect.action.type,
  };
}

function recordPendingChoiceAction(
  G: GameState,
  player: PlayerIndex,
  choice: PendingChoice,
  selectedCount: number,
  result: ActionLogEntry['result'] = { ok: true, message: 'Choice submitted' },
): void {
  recordAction(G, player, 'submitPendingChoice', choiceActionPayload(choice, selectedCount), {
    result,
    context: { pendingChoiceType: choice.type },
  });
}

function hasGameOverTrace(G: GameState): boolean {
  return (G.actionLog ?? []).some((entry) => entry.action === 'gameOver');
}

function recordGameOverTrace(G: GameState): void {
  if (G.step !== 'gameOver' || hasGameOverTrace(G)) return;
  const player = G.winner ?? 0;
  recordAction(
    G,
    player,
    'gameOver',
    {
      winner: G.winner,
      draw: G.winner === null,
      reason: G.gameoverReason ?? undefined,
    },
    {
      result: { ok: true, message: G.gameoverReason ?? undefined },
    },
  );
}

export function emptyModifiers(): CombatModifiers {
  return {
    attack: [0, 0],
    attackSetTo: [null, null],
    attackTimeOverride: [null, null],
    cardClockSetTo: null,
    damageReduction: [0, 0],
    elementOverride: [null, null],
    handSize: [0, 0],
    clockContributionDisabled: [false, false],
    powerCostReduction: [0, 0],
    extraSettableCards: [0, 0],
    sendToPower: [0, 0],
    swapAttack: [false, false],
    effectsDisabled: [false, false],
    enchantEffectsDisabled: [false, false],
    unreduceableDamage: [false, false],
  };
}

function drawUnchecked(player: PlayerState, count: number): void {
  for (let i = 0; i < count; i++) {
    const card = player.deck.shift()!;
    card.faceUp = true;
    player.hand.push(card);
  }
}

function shuffleSelectedCards<T>(cards: T[]): T[] {
  const result = [...cards];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function sendToOwnerZone(
  card: CardInstance,
  player: PlayerState,
  G?: GameState,
  playerIndex?: PlayerIndex,
  parsedEffects: Map<string, ParsedEffect[]> = emptyParsedEffects(),
): void {
  card.faceUp = true;
  const def = getCardDef(card.defId);
  const zone = def && def.sendToPower > 0 ? 'powerCharger' : 'abyss';
  if (zone === 'powerCharger') player.powerCharger.push(card);
  else player.abyss.push(card);
  if (G && playerIndex !== undefined) {
    resolveTimingEvent(G, parsedEffects, { type: 'zoneEntered', player: playerIndex, zone, cardDefId: card.defId });
    // 記錄到 actionLog，讓 log 時間軸能看到卡牌進入充能區/深淵。
    recordAction(G, playerIndex, 'zoneEntered', { zone, cardDefId: card.defId, sendToPower: def?.sendToPower ?? 0 });
  }
}

export function getPlayerPower(player: PlayerState, G?: GameState, playerIndex?: PlayerIndex): number {
  const base = player.powerCharger.reduce((sum, card) => sum + (getCardDef(card.defId)?.sendToPower ?? 0), 0);
  const modifier = G && playerIndex !== undefined ? (G.modifiers.sendToPower?.[playerIndex] ?? 0) : 0;
  return Math.max(0, base + modifier);
}

function getEffectivePowerCost(card: CardInstance, G: GameState, player: PlayerIndex): number {
  const def = getCardDef(card.defId);
  if (!def) return Number.POSITIVE_INFINITY;
  const reduction = def.type === 'Character' ? (G.modifiers.powerCostReduction?.[player] ?? 0) : 0;
  return Math.max(0, def.powerCost - reduction);
}

function chronosTimeAt(position: number, midnightRange: number): ChronosTime {
  return getChronosTimeForPosition(position, midnightRange);
}

export function getChronosTime(G: GameState): ChronosTime {
  return chronosTimeAt(G.chronos.position, G.midnightRange);
}

export function getPriorityPlayer(G: GameState): PlayerIndex {
  return getChronosTime(G) === 'night' ? G.chronos.nightSidePlayer : ((1 - G.chronos.nightSidePlayer) as PlayerIndex);
}

function setChronosPosition(
  G: GameState,
  position: number,
  parsedEffects: Map<string, ParsedEffect[]> = emptyParsedEffects(),
  logMessage?: string,
  source?: { kind: 'turnAdvance' | 'cardEffect'; cardDefId?: string },
  breakdown?: HpChangeBreakdown,
): void {
  const before = G.chronos.position;
  const beforeTime = chronosTimeAt(before, G.midnightRange);
  G.chronos.position = normalizeChronosPosition(position);
  if (logMessage) G.log.push(logMessage);
  const afterTime = getChronosTime(G);
  if (before !== G.chronos.position) {
    // 官方 QA Q18/Q21：クロノス推進可能跨夜→晝→夜，需記錄路徑上的所有時間轉換。
    // 中間轉換事件僅記錄到 timingEvents 供 chronosTimeChanged 條件檢查，
    // 不觸發 onChronosChanged 效果（避免重複觸發）；效果僅在最終位置觸發一次。
    const transitions = chronosTransitionsOnPath(before, position, G.midnightRange);
    for (const t of transitions) {
      if (t.from === beforeTime && t.to === afterTime) continue;
      G.timingEvents.push({
        type: 'chronosChanged',
        fromChronos: before,
        toChronos: t.atPosition,
        fromChronosTime: t.from,
        toChronosTime: t.to,
      });
      G.log.push(`Timing chronosChanged (path: ${t.from}→${t.to}).`);
    }
    resolveTimingEvent(G, parsedEffects, {
      type: 'chronosChanged',
      fromChronos: before,
      toChronos: G.chronos.position,
      fromChronosTime: beforeTime,
      toChronosTime: afterTime,
    });
    // 推一筆 chronosChange GameNotice，僅提示最終 from→to 淨結果（中間轉換不逐一提示）。
    // 來源歸因：回合推進 vs 卡牌效果（附卡名 + 來源玩家），讓 UI 說明「時鐘為何變化」。
    // chronosDelta 取最短路徑（|delta| <= 6），正數前進、負數後退。
    let chronosDelta = G.chronos.position - before;
    if (chronosDelta > 6) chronosDelta -= 12;
    if (chronosDelta < -6) chronosDelta += 12;
    const sourcePlayer = source?.kind === 'cardEffect' ? G.pendingEffectPlayer : undefined;
    pushGameNotice(G, {
      kind: 'chronosChange',
      tone: 'phase',
      titleKey: source?.kind === 'cardEffect' ? 'board.notice.chronosCardEffect' : 'board.notice.chronosTurnAdvance',
      chronosFrom: before,
      chronosTo: G.chronos.position,
      chronosDelta,
      chronosFromTime: beforeTime,
      chronosToTime: afterTime,
      ...(source ? { chronosSourceKind: source.kind } : {}),
      ...(source?.cardDefId ? { chronosSourceCardDefId: source.cardDefId } : {}),
      ...(sourcePlayer !== null && sourcePlayer !== undefined ? { player: sourcePlayer } : {}),
      ...(breakdown ? { breakdown } : {}),
    });
  }
}

// 計算從 before 到 after 的路徑上的所有時間轉換點。
function chronosTransitionsOnPath(
  before: number,
  after: number,
  midnightRange: number,
): { from: ChronosTime; to: ChronosTime; atPosition: number }[] {
  const transitions: { from: ChronosTime; to: ChronosTime; atPosition: number }[] = [];
  const normalizedAfter = normalizeChronosPosition(after);
  let current = normalizeChronosPosition(before);
  let currentTime = chronosTimeAt(current, midnightRange);
  while (current !== normalizedAfter) {
    const next = normalizeChronosPosition(current + 1);
    const nextTime = chronosTimeAt(next, midnightRange);
    if (currentTime !== nextTime) {
      transitions.push({ from: currentTime, to: nextTime, atPosition: next });
    }
    current = next;
    currentTime = nextTime;
  }
  return transitions;
}

export function setupGame(deck0Name?: string, deck1Name?: string): GameState;
export function setupGame(setupData?: ZutomayoSetupData, options?: SetupGameOptions): GameState;
export function setupGame(
  setupDataOrDeck0Name: ZutomayoSetupData | string = {},
  deck1NameOrOptions: string | SetupGameOptions = {},
): GameState {
  const legacyNames = typeof setupDataOrDeck0Name === 'string' || typeof deck1NameOrOptions === 'string';
  const setupData: ZutomayoSetupData = legacyNames
    ? {
        deck0Name: typeof setupDataOrDeck0Name === 'string' ? setupDataOrDeck0Name : undefined,
        deck1Name: typeof deck1NameOrOptions === 'string' ? deck1NameOrOptions : undefined,
      }
    : setupDataOrDeck0Name || {};
  const options: SetupGameOptions = legacyNames || typeof deck1NameOrOptions === 'string' ? {} : deck1NameOrOptions;
  const allowBrowserCustomDeckName = options.allowBrowserCustomDeckName ?? false;
  const makePlayer = (): PlayerState => ({
    hp: 100,
    deck: [],
    hand: [],
    battleZone: null,
    setZoneA: null,
    setZoneB: null,
    setZoneC: null,
    powerCharger: [],
    abyss: [],
    cardsSetThisTurn: 0,
    rawAttack: 0,
  });
  const G: GameState = {
    players: [makePlayer(), makePlayer()],
    step: 'janken',
    ready: [false, false],
    chronos: { position: 0, nightSidePlayer: 0 },
    midnightRange: 0,
    chronosAtTurnStart: 0,
    turnNumber: 1,
    turnStartTime: Date.now(),
    lastBattleResult: { winner: null, damage: 0, winnerAttack: 0, loserAttack: 0 },
    setCardsThisTurn: [[], []],
    pendingEffects: [[], []],
    pendingEffectPlayer: null,
    delayedEffects: [],
    pendingChoice: null,
    lastChoiceSelectionCount: [null, null],
    timingEvents: [],
    revealedHandCardIds: [[], []],
    swappedCardsThisTurn: [[], []],
    suppressedEffectCardIdsThisTurn: [],
    drawEffectCardIdsThisTurn: [],
    drawOccurredThisEffect: [false, false],
    previousTurnCharacterElements: [null, null],
    handSizeModifier: [0, 0],
    areaEnchantSetLocked: [false, false],
    damageReducedThisTurn: [0, 0],
    jankenChoices: [null, null],
    jankenDrawCount: 0,
    mulliganUsed: [false, false],
    modifiers: emptyModifiers(),
    winner: null,
    gameoverReason: null,
    log: ['Game initialized. Janken determines the night-side player.'],
    actionLog: [],
    recentHpChanges: [],
    recentGameNotices: [],
  };
  // 先組玩家牌組（deck0），再組 AI/對手牌組（deck1）。
  // 若 deck1 指定克制牌組（COUNTER_DECK_NAME），需參考 deck0 內容來組克制牌組。
  const player0Deck = setupDeck(0, setupData.deck0Ids, setupData.deck0Name, allowBrowserCustomDeckName);
  // 教學模式：跳過洗牌，讓固定牌組依陣列順序進入牌庫，確保劇本可預測。
  const skipShuffle = setupData.skipShuffle === true;
  G.tutorialSkipShuffle = skipShuffle;
  G.players[0].deck = skipShuffle ? player0Deck : shuffleDeck(player0Deck);
  const isCounterDeck1 = !setupData.deck1Ids && setupData.deck1Name === COUNTER_DECK_NAME;
  const player1Deck = isCounterDeck1
    ? buildCounterDeck(player0Deck)
    : setupDeck(1, setupData.deck1Ids, setupData.deck1Name, allowBrowserCustomDeckName);
  G.players[1].deck = skipShuffle ? player1Deck : shuffleDeck(player1Deck);
  drawUnchecked(G.players[0], 5);
  drawUnchecked(G.players[1], 5);
  return G;
}

export function resolveJanken(
  G: GameState,
  choice0: JankenChoice,
  choice1: JankenChoice,
): { winner: PlayerIndex | null } {
  const beats: Record<JankenChoice, JankenChoice> = {
    rock: 'scissors',
    paper: 'rock',
    scissors: 'paper',
  };
  if (choice0 === choice1) {
    G.jankenChoices = [null, null];
    G.jankenDrawCount = (G.jankenDrawCount ?? 0) + 1;
    G.log.push('Janken draw. Choose again.');
    recordAction(G, 0, 'jankenResult', { draw: true, choice0, choice1 });
    return { winner: null };
  }
  const winner: PlayerIndex = beats[choice0] === choice1 ? 0 : 1;
  G.chronos.nightSidePlayer = winner;
  G.step = 'mulligan';
  G.ready = [false, false];
  G.log.push(`Player ${winner} wins janken and takes the night side.`);
  recordAction(G, winner, 'jankenResult', { draw: false, winner, choice0, choice1 });
  return { winner };
}

export function chooseJanken(G: GameState, player: PlayerIndex, choice: JankenChoice): boolean {
  if (G.step !== 'janken' || G.jankenChoices[player] !== null) return false;
  G.jankenChoices[player] = choice;
  recordAction(G, player, 'janken', { choice });
  if (G.jankenChoices[0] && G.jankenChoices[1]) {
    resolveJanken(G, G.jankenChoices[0], G.jankenChoices[1]);
  }
  return true;
}

export function finishMulligan(G: GameState, player: PlayerIndex, indices: number[]): boolean {
  if (G.step !== 'mulligan' || G.mulliganUsed[player]) return false;
  const state = G.players[player];
  const unique = [...new Set(indices)].filter((i) => Number.isInteger(i) && i >= 0 && i < state.hand.length);
  unique.sort((a, b) => b - a);
  const aside = unique.map((index) => state.hand.splice(index, 1)[0]);
  if (state.deck.length < aside.length) return false;
  drawUnchecked(state, aside.length);
  // mulligan 伏示牌回牌庫前重設 faceUp，保持牌庫狀態衛生（官方牌庫為裡向）。
  for (const card of aside) card.faceUp = false;
  const combined = [...state.deck, ...aside];
  state.deck = G.tutorialSkipShuffle ? combined : shuffleDeck(combined);
  G.mulliganUsed[player] = true;
  G.ready[player] = true;
  recordAction(G, player, 'mulligan', { redrawnCount: aside.length });
  G.log.push(`Player ${player} ${aside.length ? `redraws ${aside.length}` : 'keeps their hand'}.`);
  if (G.ready[0] && G.ready[1]) {
    G.step = 'initialSet';
    G.ready = [false, false];
    G.log.push('Both players choose an initial battle-zone card.');
  }
  return true;
}

// 官方 QA Q5：敗者「最低 1 枚，最多 2 枚，可選 1 枚」。
// 所有玩家最低都是 1 枚；敗者的「最多 2 枚」由 getRequiredSetCount 處理。
export function getMinimumSetCount(_G: GameState, _player: PlayerIndex): number {
  return 1;
}

export function getRequiredSetCount(G: GameState, player: PlayerIndex): number {
  // 敗者最多 2 枚，勝者 1 枚，加上 extraSettableCards 修飾器。
  let max = 1;
  if (G.step !== 'initialSet' && G.turnNumber !== 1 && G.lastBattleResult.winner !== null) {
    max = G.lastBattleResult.winner === player ? 1 : 2;
  }
  return max + (G.modifiers.extraSettableCards?.[player] ?? 0);
}

function setCard(G: GameState, player: PlayerIndex, handIndex: number, slot: SetSlot): boolean {
  const state = G.players[player];
  if (G.ready[player] || handIndex < 0 || handIndex >= state.hand.length) return false;
  if (slot === 'B' && G.step === 'initialSet') return false;
  if (slot === 'C') return false;
  if (state.cardsSetThisTurn >= getRequiredSetCount(G, player)) return false;
  const def = getCardDef(state.hand[handIndex].defId);
  if (def?.type === 'Area Enchant' && G.areaEnchantSetLocked?.[player]) return false;
  // Area Enchant 從手牌打出時先放入 setZoneA 或 setZoneB（覆蓋狀態），
  // 翻開發動效果時才由 placeRevealedCards 移動到 setZoneC（官方規則）。
  const zone = slot === 'A' ? 'setZoneA' : 'setZoneB';
  if (state[zone]) return false;
  const card = state.hand.splice(handIndex, 1)[0];
  card.faceUp = false;
  state[zone] = card;
  state.cardsSetThisTurn++;
  G.setCardsThisTurn[player].push(card);
  return true;
}

export function setInitialCard(G: GameState, player: PlayerIndex, handIndex: number): boolean {
  if (G.step !== 'initialSet') return false;
  const state = G.players[player];
  if (G.ready[player] || handIndex < 0 || handIndex >= state.hand.length) return false;
  if (state.battleZone || state.cardsSetThisTurn >= getRequiredSetCount(G, player)) return false;
  const card = state.hand.splice(handIndex, 1)[0];
  card.faceUp = false;
  state.battleZone = card;
  state.cardsSetThisTurn++;
  G.setCardsThisTurn[player].push(card);
  return true;
}

export function setTurnCard(G: GameState, player: PlayerIndex, handIndex: number, slot: SetSlot): boolean {
  return G.step === 'turnSet' && setCard(G, player, handIndex, slot);
}

export function undoSetCard(G: GameState, player: PlayerIndex, slot: SetSlot): boolean {
  if (!['initialSet', 'turnSet'].includes(G.step) || G.ready[player]) return false;
  const state = G.players[player];
  if (G.step === 'initialSet') {
    const card = state.battleZone;
    if (!card) return false;
    card.faceUp = true;
    state.hand.push(card);
    state.battleZone = null;
    state.cardsSetThisTurn--;
    G.setCardsThisTurn[player] = G.setCardsThisTurn[player].filter((c) => c.instanceId !== card.instanceId);
    return true;
  }
  const zone = slot === 'C' ? 'setZoneC' : slot === 'A' ? 'setZoneA' : 'setZoneB';
  const card = state[zone];
  if (!card) return false;
  card.faceUp = true;
  state.hand.push(card);
  state[zone] = null;
  state.cardsSetThisTurn--;
  G.setCardsThisTurn[player] = G.setCardsThisTurn[player].filter((c) => c.instanceId !== card.instanceId);
  return true;
}

function confirmedSetCardPayloads(
  G: GameState,
  player: PlayerIndex,
): { action: 'setInitialCard' | 'setTurnCard'; payload: ActionLogEntry['payload'] }[] {
  const state = G.players[player];
  const playedIds = new Set(G.setCardsThisTurn[player].map((card) => card.instanceId));
  if (G.step === 'initialSet') {
    if (state.battleZone && playedIds.has(state.battleZone.instanceId)) {
      return [
        {
          action: 'setInitialCard',
          payload: { zone: 'battleZone', faceDown: true, cardDefId: state.battleZone.defId },
        },
      ];
    }
    return [];
  }
  const payloads: { action: 'setTurnCard'; payload: ActionLogEntry['payload'] }[] = [];
  for (const [slot, card] of [
    ['A', state.setZoneA],
    ['B', state.setZoneB],
    ['C', state.setZoneC],
  ] as const) {
    if (!card || !playedIds.has(card.instanceId)) continue;
    payloads.push({ action: 'setTurnCard', payload: { slot, faceDown: true, cardDefId: card.defId } });
  }
  return payloads;
}

function recordConfirmedSetCards(G: GameState, player: PlayerIndex): void {
  for (const entry of confirmedSetCardPayloads(G, player)) {
    recordAction(G, player, entry.action, entry.payload);
  }
}

export function confirmReady(G: GameState, player: PlayerIndex, parsedEffects: Map<string, ParsedEffect[]>): boolean {
  if (!['initialSet', 'turnSet'].includes(G.step) || G.ready[player]) return false;
  const cardsSet = G.players[player].cardsSetThisTurn;
  if (cardsSet < getMinimumSetCount(G, player) || cardsSet > getRequiredSetCount(G, player)) return false;
  recordConfirmedSetCards(G, player);
  G.ready[player] = true;
  if (G.ready[0] && G.ready[1]) resolveTurn(G, parsedEffects);
  return true;
}

// P3-16：線上回合超時處理。當伺服器時間已超過 TURN_TIMER_MS 且該玩家尚未 confirmReady 時，
// 強制將該玩家設為 ready 並推進回合，避免未達最低出牌數時卡死。
// 不像 confirmReady 會檢查最低出牌數，timeoutSkip 允許空手跳過。
export function timeoutSkip(G: GameState, player: PlayerIndex, parsedEffects: Map<string, ParsedEffect[]>): boolean {
  if (G.step !== 'turnSet' || G.ready[player]) return false;
  // 伺服器權威超時檢查：Date.now() 在 boardgame.io server/master 執行，為權威時間。
  if (typeof G.turnStartTime !== 'number' || Date.now() - G.turnStartTime < TURN_TIMER_MS) return false;
  recordConfirmedSetCards(G, player);
  G.ready[player] = true;
  recordAction(G, player, 'timeoutSkip', { confirmed: true });
  if (G.ready[0] && G.ready[1]) resolveTurn(G, parsedEffects);
  return true;
}

export function revealCards(G: GameState): void {
  G.log.push('「嫌（やぁ）」— cards revealed simultaneously.');
  for (const player of G.players) {
    if (player.battleZone) player.battleZone.faceUp = true;
    if (player.setZoneA) player.setZoneA.faceUp = true;
    if (player.setZoneB) player.setZoneB.faceUp = true;
    if (player.setZoneC) player.setZoneC.faceUp = true;
  }
}

export function advanceChronos(G: GameState, parsedEffects: Map<string, ParsedEffect[]> = emptyParsedEffects()): void {
  const clockLines: HpChangeBreakdownLine[] = [];
  const participantIds: string[] = [];
  let total = 0;
  for (const player of playerIndexes) {
    for (const card of G.setCardsThisTurn[player]) {
      const def = getCardDef(card.defId);
      if (def?.type === 'Character' && G.modifiers.clockContributionDisabled?.[player]) {
        // 被無效化的卡仍列出（clock 0）讓玩家理解為何沒貢獻。
        clockLines.push({
          label: `board.hpChange.clockContribution`,
          value: 'board.hpChange.nullified',
          cardDefId: card.defId,
        });
        participantIds.push(card.defId);
        continue;
      }
      const clock = G.modifiers.cardClockSetTo ?? def?.clock ?? 0;
      total += clock;
      clockLines.push({
        label: `board.hpChange.clockContribution`,
        value: `+${clock}`,
        cardDefId: card.defId,
      });
      participantIds.push(card.defId);
    }
  }
  clockLines.push({ label: 'board.hpChange.clockTotal', value: `+${total}` });
  const chronosBreakdown: HpChangeBreakdown = {
    title: 'board.hpChange.clockCalc',
    lines: clockLines,
    participantCardDefIds: participantIds,
  };
  const before = G.chronos.position;
  setChronosPosition(
    G,
    before + total,
    parsedEffects,
    `Chronos +${total} (${before}→${normalizeChronosPosition(before + total)}).`,
    { kind: 'turnAdvance' },
    chronosBreakdown,
  );
}

function uniqueCards(cards: CardInstance[]): CardInstance[] {
  return cards.filter((card, index, all) => all.findIndex((other) => other.instanceId === card.instanceId) === index);
}

function applyPreChronosModifiers(G: GameState, parsedEffects: Map<string, ParsedEffect[]>): void {
  // 預處理影響クロノス推進計算的無條件 onUse/onEnter 效果。
  //
  // 官方 QA Q31/Q63 規定此類效果「次のターンから」發動，故只處理 setZoneC
  // （前回合進入的 Area Enchant），不處理 setCardsThisTurn（當回合新設定的卡）。
  //
  // 歷史背景：
  // - 早期版本處理 setCardsThisTurn 導致效果當回合生效，與 QA 衝突。
  // - commit 567102e 為修復 setAllCardClocks 當回合失效 bug，加入 setCardsThisTurn 掃描，
  //   但 QA Q31 明確規定「次のターンより発動します」，故該修復方向與 QA 衝突。
  // - B1 修復（クロノス跨時間事件記錄）後，chronosChanged 事件連鎖問題已解決，
  //   nullifyOpponentClock 不再需要預處理當回合新卡來避免連鎖。
  for (const player of getTurnEffectPlayerOrder(G)) {
    for (const card of uniqueCards(
      [G.players[player].setZoneC].filter((item): item is CardInstance => item !== null),
    )) {
      if (areEffectsDisabledForCard(G, player, card.defId)) continue;
      const definition = getCardDef(card.defId);
      if (!definition || getPlayerPower(G.players[player], G, player) < definition.powerCost) continue;
      const effects = parsedEffects.get(card.defId) ?? [];
      for (const effect of effects) {
        if (effect.trigger !== 'onUse' && effect.trigger !== 'onEnter') continue;
        if (effect.conditions.length !== 0) continue;
        if (effect.action.type === 'nullifyOpponentClock') {
          if (!G.modifiers.clockContributionDisabled) G.modifiers.clockContributionDisabled = [false, false];
          G.modifiers.clockContributionDisabled[(1 - player) as PlayerIndex] = true;
        } else if (effect.action.type === 'setAllCardClocks') {
          G.modifiers.cardClockSetTo = Number(effect.action.params.value ?? 0);
        }
      }
    }
  }
}

function hasOptionalSwapEffect(
  G: GameState,
  player: PlayerIndex,
  parsedEffects: Map<string, ParsedEffect[]> | null,
): boolean {
  if (!parsedEffects || !G.players[player].battleZone) return false;
  return G.setCardsThisTurn[player].some((card) => {
    const def = getCardDef(card.defId);
    if (!def || getPlayerPower(G.players[player], G, player) < def.powerCost) return false;
    return (parsedEffects.get(card.defId) ?? []).some(
      (effect) => effect.action.type === 'addSettableCard' && effect.action.params.optional,
    );
  });
}

function replaceDestination(
  G: GameState,
  playerIndex: PlayerIndex,
  cards: CardInstance[],
  destination: 'battleZone' | 'setZoneC',
  skipBattleSwap = false,
  parsedEffects: Map<string, ParsedEffect[]> = emptyParsedEffects(),
): void {
  if (cards.length === 0) return;
  const player = G.players[playerIndex];
  if (destination === 'battleZone' && skipBattleSwap && player.battleZone) {
    for (const card of cards) sendToOwnerZone(card, player, G, playerIndex, parsedEffects);
    return;
  }
  const selected = cards[0];
  const old = player[destination];
  player[destination] = selected;
  resolveTimingEvent(G, parsedEffects, {
    type: 'zoneEntered',
    player: playerIndex,
    zone: destination,
    cardDefId: selected.defId,
  });
  if (destination === 'battleZone' && old) {
    G.swappedCardsThisTurn[playerIndex].push(selected);
    G.timingEvents.push({
      type: 'characterReplaced',
      player: playerIndex,
      zone: destination,
      cardDefId: selected.defId,
      replacedCardDefId: old.defId,
    });
  }
  if (old) sendToOwnerZone(old, player, G, playerIndex, parsedEffects);
  for (const extra of cards.slice(1)) sendToOwnerZone(extra, player, G, playerIndex, parsedEffects);
}

export function placeRevealedCards(
  G: GameState,
  initial: boolean,
  parsedEffects: Map<string, ParsedEffect[]> | null = null,
): void {
  // 官方 QA Q80：檢查 AE 是否有「HPがX以下になったらすぐにYに置く」效果。
  // 此類效果解析為 onDamageReceived + hpLessOrEqual + moveSelfAreaEnchant，
  // Q80 規定設置時若 HP 已≤X，則不進 setZoneC，直接送 destination 且效果不発動。
  const getImmediateMoveOnSetHpCondition = (
    card: CardInstance,
    effects: Map<string, ParsedEffect[]>,
  ): { hpThreshold: number; destination: 'abyss' | 'powerCharger' } | null => {
    const parsed = effects.get(card.defId) ?? [];
    for (const effect of parsed) {
      if (effect.trigger !== 'onDamageReceived') continue;
      if (effect.action.type !== 'moveSelfAreaEnchant') continue;
      const hpCond = effect.conditions?.find((c) => c.type === 'hpLessOrEqual');
      if (!hpCond) continue;
      const threshold = Number(hpCond.value);
      if (!Number.isFinite(threshold)) continue;
      const destination = effect.action.params.destination === 'powerCharger' ? 'powerCharger' : 'abyss';
      return { hpThreshold: threshold, destination };
    }
    return null;
  };

  const timingEffects = initial ? emptyParsedEffects() : (parsedEffects ?? emptyParsedEffects());
  for (const index of playerIndexes) {
    const player = G.players[index];
    const slots = [player.setZoneA, player.setZoneB].filter((card): card is CardInstance => card !== null);
    if (initial) {
      // 官方 QA Q42：1 ターン目所有卡（含非角色卡）都先進 battleZone。
      // Q1：非角色卡進 battleZone 後立即送 ownerZone（效果不發動，攻撃力0）。
      const preparedBattleCard = player.battleZone;
      replaceDestination(G, index, slots, 'battleZone', false, timingEffects);
      const battleCard = player.battleZone;
      if (battleCard && preparedBattleCard?.instanceId === battleCard.instanceId) {
        resolveTimingEvent(G, timingEffects, {
          type: 'zoneEntered',
          player: index,
          zone: 'battleZone',
          cardDefId: battleCard.defId,
        });
      }
      if (battleCard && getCardDef(battleCard.defId)?.type !== 'Character') {
        player.battleZone = null;
        sendToOwnerZone(battleCard, player, G, index, timingEffects);
      }
      player.setZoneA = null;
      player.setZoneB = null;
      continue;
    }
    const characters = slots.filter((card) => getCardDef(card.defId)?.type === 'Character');
    // Area Enchant 從手牌打出時先放 setZoneA/B，翻開後才移到 setZoneC（官方規則）。
    const areas = slots.filter((card) => getCardDef(card.defId)?.type === 'Area Enchant');
    // 官方 QA Q11/Q13：只進第一張卡到 destination，多餘的卡保留在 setZoneB，
    // 由 finishTurn 在回合結束時送 ownerZone（QA 規定「ターンの終了時に」送）。
    if (characters.length > 0) {
      replaceDestination(
        G,
        index,
        [characters[0]],
        'battleZone',
        hasOptionalSwapEffect(G, index, parsedEffects),
        timingEffects,
      );
    }
    if (areas.length > 0) {
      // 官方 QA Q80：AE 有「HPがX以下になったらすぐにYに置く」效果時，
      // 若設置時自身 HP 已≤X，則不進 setZoneC，直接送 destination 且 onUse 效果不発動。
      // QA 規定「ターンの終了時」指定がないため「すぐに」移動，且效果不発動。
      const immediateMove = getImmediateMoveOnSetHpCondition(areas[0], timingEffects);
      if (immediateMove && G.players[index].hp <= immediateMove.hpThreshold) {
        sendToOwnerZone(areas[0], G.players[index], G, index, timingEffects);
        if (!G.suppressedEffectCardIdsThisTurn) G.suppressedEffectCardIdsThisTurn = [];
        if (!G.suppressedEffectCardIdsThisTurn.includes(areas[0].instanceId)) {
          G.suppressedEffectCardIdsThisTurn.push(areas[0].instanceId);
        }
        G.log.push(
          `Player ${index}: ${areas[0].defId} HP<=${immediateMove.hpThreshold} at set, immediate move to ${immediateMove.destination}.`,
        );
      } else {
        replaceDestination(G, index, [areas[0]], 'setZoneC', false, timingEffects);
      }
    }
    // 清空已進入 destination 或被送走的卡的來源 zone；多餘卡保留在 setZoneB 並 suppress 效果。
    const enteredIds = new Set<string>();
    if (player.battleZone) enteredIds.add(player.battleZone.instanceId);
    if (player.setZoneC) enteredIds.add(player.setZoneC.instanceId);
    if (characters.length > 0) enteredIds.add(characters[0].instanceId);
    if (areas.length > 0) enteredIds.add(areas[0].instanceId);
    for (const zone of ['setZoneA', 'setZoneB'] as const) {
      const card = player[zone];
      if (!card) continue;
      if (enteredIds.has(card.instanceId)) {
        player[zone] = null;
      } else {
        // QA Q11/Q13：只 suppress Character/AE 的多餘卡（效果不發動，時計仍參照）。
        // Enchant 卡留在 setZoneA/setZoneB，效果正常觸發。
        const type = getCardDef(card.defId)?.type;
        if (type === 'Character' || type === 'Area Enchant') {
          if (!G.suppressedEffectCardIdsThisTurn) G.suppressedEffectCardIdsThisTurn = [];
          if (!G.suppressedEffectCardIdsThisTurn.includes(card.instanceId)) {
            G.suppressedEffectCardIdsThisTurn.push(card.instanceId);
          }
        }
      }
    }
  }
}

export function getEffectiveAttack(card: CardInstance, G: GameState, player: number): number {
  const index = player as PlayerIndex;
  const def = getCardDef(card.defId);
  if (!def?.attack || getPlayerPower(G.players[index], G, index) < getEffectivePowerCost(card, G, index)) return 0;
  const time = getChronosTime(G);
  const effectiveTime = G.modifiers.attackTimeOverride?.[index] ?? time;
  const attackTime = G.modifiers.swapAttack[index] ? (effectiveTime === 'night' ? 'day' : 'night') : effectiveTime;
  const baseAttack = G.modifiers.attackSetTo?.[index] ?? def.attack[attackTime];
  return Math.max(0, baseAttack + G.modifiers.attack[index]);
}

/**
 * 計算「原始攻擊力」基準：套用時段 / swapAttack / attackTimeOverride / attackSetTo，
 * 但不含累加修飾器（G.modifiers.attack）且不檢查能量。
 *
 * 用於 breakdown 與 UI 顯示「原始 vs 實際」對比，讓玩家理解攻擊力為何變化
 * （附魔增益、能量不足歸零等）。
 */
export function getBaseAttack(card: CardInstance, G: GameState, player: number): number | null {
  const index = player as PlayerIndex;
  const def = getCardDef(card.defId);
  if (!def?.attack) return null;
  const time = getChronosTime(G);
  const effectiveTime = G.modifiers.attackTimeOverride?.[index] ?? time;
  const attackTime = G.modifiers.swapAttack[index] ? (effectiveTime === 'night' ? 'day' : 'night') : effectiveTime;
  return G.modifiers.attackSetTo?.[index] ?? def.attack[attackTime];
}

/**
 * 判斷 battleZone 卡牌是否因能量不足而攻擊力歸零。
 */
export function isAttackPowerInsufficient(card: CardInstance, G: GameState, player: number): boolean {
  const index = player as PlayerIndex;
  const def = getCardDef(card.defId);
  if (!def?.attack) return false;
  return getPlayerPower(G.players[index], G, index) < getEffectivePowerCost(card, G, index);
}

export function getEffectiveElement(card: CardInstance, G: GameState, player: number): Element | null {
  const index = player as PlayerIndex;
  return G.modifiers.elementOverride?.[index] ?? getCardDef(card.defId)?.element ?? null;
}

function emptyParsedEffects(): Map<string, ParsedEffect[]> {
  return new Map<string, ParsedEffect[]>();
}

function timingTrigger(event: TimingEvent): ParsedEffect['trigger'] | null {
  if (event.type === 'turnStart') return 'onTurnStart';
  if (event.type === 'turnEnd') return 'onTurnEnd';
  if (event.type === 'damageReceived') return 'onDamageReceived';
  if (event.type === 'chronosChanged') return 'onChronosChanged';
  if (event.type === 'zoneEntered') return 'onZoneEntered';
  if (event.type === 'battle') return 'onBattle';
  return null;
}

function timingCandidateCards(G: GameState, player: PlayerIndex): CardInstance[] {
  return [
    G.players[player].battleZone,
    G.players[player].setZoneC,
    G.players[player].setZoneA,
    G.players[player].setZoneB,
  ]
    .filter((card): card is CardInstance => card !== null)
    .filter((card) => !(G.suppressedEffectCardIdsThisTurn ?? []).includes(card.instanceId))
    .filter((card, index, all) => all.findIndex((other) => other.instanceId === card.instanceId) === index);
}

export function resolveTimingEvent(
  G: GameState,
  parsedEffects: Map<string, ParsedEffect[]> = emptyParsedEffects(),
  event: TimingEvent,
  options: {
    effectFilter?: (effect: ParsedEffect) => boolean;
    recordEvent?: boolean;
    onEffectExecuted?: (info: {
      cardDefId: string;
      effect: ParsedEffect;
      player: PlayerIndex;
      success: boolean;
    }) => void;
  } = {},
): void {
  const trigger = timingTrigger(event);
  if (options.recordEvent ?? true) {
    G.timingEvents.push(event);
    G.log.push(`Timing ${event.type}.`);
  }
  if (!trigger || G.step === 'gameOver') return;

  if (event.type === 'turnEnd' && G.delayedEffects?.length) {
    const delayed = G.delayedEffects;
    G.delayedEffects = [];
    for (const pendingEffect of delayed) {
      if (areEffectsDisabledForCard(G, pendingEffect.player, pendingEffect.cardDefId)) continue;
      const result = executeEffect(pendingEffect.effect, G, pendingEffect.player, {
        cardInstanceId: pendingEffect.cardInstanceId,
        cardDefId: pendingEffect.cardDefId,
        onTimingEvent: (nestedEvent) => resolveTimingEvent(G, parsedEffects, nestedEvent),
      });
      if (result.success) G.log.push(`Player ${pendingEffect.player}: ${result.message}.`);
      options.onEffectExecuted?.({
        cardDefId: pendingEffect.cardDefId,
        effect: pendingEffect.effect,
        player: pendingEffect.player,
        success: result.success,
      });
      if ((G.step as GameState['step']) === 'gameOver') {
        recordGameOverTrace(G);
        return;
      }
    }
  }

  const players: PlayerIndex[] =
    event.type === 'damageReceived'
      ? event.player === 0 || event.player === 1
        ? [event.player]
        : []
      : getTurnEffectPlayerOrder(G);

  for (const player of players) {
    for (const card of timingCandidateCards(G, player)) {
      if (areEffectsDisabledForCard(G, player, card.defId)) continue;
      const definition = getCardDef(card.defId);
      for (const effect of parsedEffects.get(card.defId) ?? []) {
        if (effect.trigger !== trigger) continue;
        if (options.effectFilter && !options.effectFilter(effect)) continue;
        // 官方 QA Q80：「HPがX以下になったらすぐにYに置く」效果（onDamageReceived
        // + hpLessOrEqual + moveSelfAreaEnchant）是條件觸發的自動移動，非效果発動，
        // 無視 power cost 檢查。其他效果仍需檢查 power cost。
        const isImmediateHpMove =
          effect.trigger === 'onDamageReceived' &&
          effect.action.type === 'moveSelfAreaEnchant' &&
          effect.conditions?.some((c) => c.type === 'hpLessOrEqual');
        if (!definition || (!isImmediateHpMove && getPlayerPower(G.players[player], G, player) < definition.powerCost))
          continue;
        const result = executeEffect(effect, G, player, {
          cardInstanceId: card.instanceId,
          cardDefId: card.defId,
          onTimingEvent: (nestedEvent) => resolveTimingEvent(G, parsedEffects, nestedEvent),
        });
        if (result.success) G.log.push(`Player ${player}: ${result.message}.`);
        options.onEffectExecuted?.({ cardDefId: card.defId, effect, player, success: result.success });
        if ((G.step as GameState['step']) === 'gameOver') {
          recordGameOverTrace(G);
          return;
        }
      }
    }
  }
}

export function resolveBattle(G: GameState, parsedEffects: Map<string, ParsedEffect[]> = emptyParsedEffects()): void {
  const attacks = playerIndexes.map((index) => {
    const card = G.players[index].battleZone;
    return card ? getEffectiveAttack(card, G, index) : 0;
  }) as [number, number];
  G.players[0].rawAttack = attacks[0];
  G.players[1].rawAttack = attacks[1];
  if (attacks[0] === attacks[1]) {
    G.lastBattleResult = { winner: null, damage: 0, winnerAttack: attacks[0], loserAttack: attacks[1] };
    G.log.push(`Battle ${attacks[0]}–${attacks[1]}: draw.`);
    // 平手（攻擊力相等）無 HP 變化，仍推 battleResult notice 讓 UI 提示「勢均力敵」。
    // 平手 breakdown 精簡為「各玩家實際攻擊力」一行，原始攻擊力僅在與實際不同時才顯示。
    // 與戰鬥 breakdown 同風格，避免固定 4 行的冗餘。
    const p0Card = G.players[0].battleZone;
    const p1Card = G.players[1].battleZone;
    const p0Base = p0Card ? getBaseAttack(p0Card, G, 0) : null;
    const p1Base = p1Card ? getBaseAttack(p1Card, G, 1) : null;
    const p0Insufficient = p0Card ? isAttackPowerInsufficient(p0Card, G, 0) : false;
    const p1Insufficient = p1Card ? isAttackPowerInsufficient(p1Card, G, 1) : false;
    const p0AttackText = p0Insufficient ? 'board.hpChange.insufficientPower' : `${attacks[0]}`;
    const p1AttackText = p1Insufficient ? 'board.hpChange.insufficientPower' : `${attacks[1]}`;
    const p0ShowBase = !p0Insufficient && p0Base !== null && p0Base !== attacks[0];
    const p1ShowBase = !p1Insufficient && p1Base !== null && p1Base !== attacks[1];
    const drawLines: HpChangeBreakdownLine[] = [
      {
        label: 'board.hpChange.p0Attack',
        value: p0AttackText,
        ...(p0Card ? { cardDefId: p0Card.defId } : {}),
      },
    ];
    if (p0ShowBase) {
      drawLines.push({ label: 'board.hpChange.p0RawAttack', value: `${p0Base}` });
    }
    drawLines.push({
      label: 'board.hpChange.p1Attack',
      value: p1AttackText,
      ...(p1Card ? { cardDefId: p1Card.defId } : {}),
    });
    if (p1ShowBase) {
      drawLines.push({ label: 'board.hpChange.p1RawAttack', value: `${p1Base}` });
    }
    const drawBreakdown: HpChangeBreakdown = {
      title: 'board.notice.battleDraw',
      lines: drawLines,
      participantCardDefIds: [...(p0Card ? [p0Card.defId] : []), ...(p1Card ? [p1Card.defId] : [])],
    };
    pushGameNotice(G, {
      kind: 'battleResult',
      tone: 'neutral',
      titleKey: 'board.notice.battleDraw',
      winner: null,
      winnerAttack: attacks[0],
      loserAttack: attacks[1],
      damage: 0,
      breakdown: drawBreakdown,
    });
    // 平手無 HP 變化，但記錄到 actionLog 讓玩家能回溯戰鬥攻擊力比較。
    recordAction(G, 0, 'battleDraw', {
      p0Attack: attacks[0],
      p1Attack: attacks[1],
      p0CardDefId: G.players[0].battleZone?.defId,
      p1CardDefId: G.players[1].battleZone?.defId,
      breakdown: drawBreakdown,
    });
    return;
  }
  const winner: PlayerIndex = attacks[0] > attacks[1] ? 0 : 1;
  const loser = (1 - winner) as PlayerIndex;
  const rawDamage = attacks[winner] - attacks[loser];
  const damageReceivedEvent: TimingEvent = { type: 'damageReceived', player: loser, amount: rawDamage };
  // 收集實際參與減傷計算的卡（含附魔卡），供 HP 變化 breakdown 顯示。
  const damageReduceParticipants: { cardDefId: string; value: number }[] = [];
  const reductionBefore = G.modifiers.damageReduction[loser] ?? 0;
  resolveTimingEvent(G, parsedEffects, damageReceivedEvent, {
    effectFilter: (effect) => effect.action.type === 'damageReduce',
    onEffectExecuted: ({ cardDefId, effect, success }) => {
      if (success && effect.action.type === 'damageReduce') {
        const v = Number(effect.action.params.value ?? 0);
        damageReduceParticipants.push({ cardDefId, value: v });
      }
    },
  });
  if (G.step === 'gameOver') return;
  const reductionApplied = (G.modifiers.damageReduction[loser] ?? 0) - reductionBefore;
  const unreduceable = Boolean(G.modifiers.unreduceableDamage[winner]);
  const damage = unreduceable ? rawDamage : Math.max(0, rawDamage - G.modifiers.damageReduction[loser]);
  if (!unreduceable) {
    if (!G.damageReducedThisTurn) G.damageReducedThisTurn = [0, 0];
    G.damageReducedThisTurn[loser] += Math.min(rawDamage, G.modifiers.damageReduction[loser]);
  }
  const loserHpBefore = G.players[loser].hp;
  G.players[loser].hp = Math.max(0, loserHpBefore - damage);
  // 組裝戰鬥 HP 變化 breakdown：精簡為「勝者攻擊 / 敗者攻擊 / 最終傷害」三行。
  // 原始攻擊力僅在與實際不同時才顯示（能量不足或附魔增減），避免無謂重複。
  // label 存 i18n key 字串，由 UI 層翻譯（引擎層不依賴 i18n）。
  const winnerCard = G.players[winner].battleZone;
  const loserCard = G.players[loser].battleZone;
  const winnerBase = winnerCard ? getBaseAttack(winnerCard, G, winner) : null;
  const loserBase = loserCard ? getBaseAttack(loserCard, G, loser) : null;
  const winnerInsufficient = winnerCard ? isAttackPowerInsufficient(winnerCard, G, winner) : false;
  const loserInsufficient = loserCard ? isAttackPowerInsufficient(loserCard, G, loser) : false;
  const winnerAttackText = winnerInsufficient ? 'board.hpChange.insufficientPower' : `${attacks[winner]}`;
  const loserAttackText = loserInsufficient ? 'board.hpChange.insufficientPower' : `${attacks[loser]}`;
  const winnerShowBase = !winnerInsufficient && winnerBase !== null && winnerBase !== attacks[winner];
  const loserShowBase = !loserInsufficient && loserBase !== null && loserBase !== attacks[loser];
  const battleLines: HpChangeBreakdownLine[] = [
    {
      label: 'board.hpChange.winnerAttack',
      value: winnerAttackText,
      ...(winnerCard ? { cardDefId: winnerCard.defId } : {}),
    },
  ];
  if (winnerShowBase) {
    battleLines.push({ label: 'board.hpChange.winnerRawAttack', value: `${winnerBase}` });
  }
  battleLines.push({
    label: 'board.hpChange.loserAttack',
    value: loserAttackText,
    ...(loserCard ? { cardDefId: loserCard.defId } : {}),
  });
  if (loserShowBase) {
    battleLines.push({ label: 'board.hpChange.loserRawAttack', value: `${loserBase}` });
  }
  // 最終傷害行：若無減傷直接顯示 damage；有減傷則附 (原始 -減傷) 明細。
  const damageText =
    reductionApplied > 0
      ? `${damage} (${rawDamage}-${reductionApplied})`
      : unreduceable
        ? `${damage} (board.hpChange.unreduceable)`
        : `${damage}`;
  battleLines.push({ label: 'board.hpChange.finalDamage', value: damageText });
  const battleBreakdown: HpChangeBreakdown = {
    title: 'board.hpChange.battleCalc',
    lines: battleLines,
    participantCardDefIds: [
      ...(winnerCard ? [winnerCard.defId] : []),
      ...(loserCard ? [loserCard.defId] : []),
      ...damageReduceParticipants.map((p) => p.cardDefId),
    ],
  };
  pushHpChange(G, loser, G.players[loser].hp - loserHpBefore, 'battle', undefined, battleBreakdown);
  // 傷害被完全減免（damage=0）時 pushHpChange 因 delta=0 不會推 notice，
  // 這裡補一筆 battleResult notice，讓 UI 提示「傷害全減免」並顯示減傷明細。
  if (damage === 0) {
    pushGameNotice(G, {
      kind: 'battleResult',
      tone: 'neutral',
      titleKey: 'board.notice.battleNoDamage',
      player: loser,
      winner,
      winnerAttack: attacks[winner],
      loserAttack: attacks[loser],
      damage: 0,
      breakdown: battleBreakdown,
    });
  }
  G.lastBattleResult = { winner, damage, winnerAttack: attacks[winner], loserAttack: attacks[loser] };
  G.log.push(`Battle ${attacks[0]}–${attacks[1]}: Player ${winner} deals ${damage}.`);
  resolveTimingEvent(G, parsedEffects, { type: 'battle' });
  if ((G.step as GameState['step']) === 'gameOver') return;
  if (G.players[loser].hp <= 0) {
    endGame(G, winner, `Player ${loser} loses at 0 HP.`);
    return;
  }
  if (damage > 0) {
    resolveTimingEvent(
      G,
      parsedEffects,
      { ...damageReceivedEvent, amount: damage },
      {
        effectFilter: (effect) => effect.action.type !== 'damageReduce',
      },
    );
  }
}

export function endGame(G: GameState, winner: PlayerIndex | null, reason: string): void {
  G.step = 'gameOver';
  G.winner = winner;
  G.gameoverReason = reason;
  G.ready = [true, true];
  clearPendingEffects(G);
  G.delayedEffects = [];
  clearPendingChoice(G);
  G.log.push(reason);
  recordGameOverTrace(G);
}

function characterElementPlayedThisTurn(G: GameState, player: PlayerIndex): Element | null {
  for (const card of G.setCardsThisTurn[player]) {
    const def = getCardDef(card.defId);
    // 官方 QA Q81：記錄卡牌原始屬性而非 overridden 屬性，避免工場見学等卡參照到被覆蓋的屬性。
    if (def?.type === 'Character') return def.element;
  }
  return null;
}

function recordPreviousTurnCharacterElements(G: GameState): void {
  G.previousTurnCharacterElements = [characterElementPlayedThisTurn(G, 0), characterElementPlayedThisTurn(G, 1)];
}

function emptyPendingEffects(): [PendingEffect[], PendingEffect[]] {
  return [[], []];
}

function clearPendingEffects(G: GameState): void {
  G.pendingEffects = emptyPendingEffects();
  G.pendingEffectPlayer = null;
  G.lastChoiceSelectionCount = [null, null];
}

function clearPendingChoice(G: GameState): void {
  G.pendingChoice = null;
}

export function endOfTurnDrawCount(G: GameState, player: PlayerIndex): number {
  // battle duration（G.modifiers.handSize）+ game duration（G.handSizeModifier）皆計入抽牌數。
  // 「手札の数は…増える」語義為保證手札淨 +N，透過額外抽牌實現而非增加セット上限。
  return Math.max(
    0,
    G.players[player].cardsSetThisTurn + (G.modifiers.handSize?.[player] ?? 0) + (G.handSizeModifier?.[player] ?? 0),
  );
}

function suppressEffectCardForTurn(G: GameState, cardInstanceId: string): void {
  if (!G.suppressedEffectCardIdsThisTurn) G.suppressedEffectCardIdsThisTurn = [];
  if (!G.suppressedEffectCardIdsThisTurn.includes(cardInstanceId)) {
    G.suppressedEffectCardIdsThisTurn.push(cardInstanceId);
  }
  for (const index of playerIndexes) {
    G.pendingEffects[index] = G.pendingEffects[index].filter((effect) => effect.cardInstanceId !== cardInstanceId);
  }
}

function finishTurn(G: GameState, parsedEffects: Map<string, ParsedEffect[]> = emptyParsedEffects()): void {
  resolveTimingEvent(G, parsedEffects, { type: 'turnEnd' });
  if (G.step === 'gameOver') return;
  for (const index of playerIndexes) {
    const player = G.players[index];
    for (const zone of ['setZoneA', 'setZoneB'] as const) {
      if (player[zone]) sendToOwnerZone(player[zone]!, player, G, index, parsedEffects);
      player[zone] = null;
    }
  }
  const drawCounts: [number, number] = [endOfTurnDrawCount(G, 0), endOfTurnDrawCount(G, 1)];
  const cannotDraw = playerIndexes.filter((index) => G.players[index].deck.length < drawCounts[index]);
  if (cannotDraw.length > 0) {
    const winner = cannotDraw.length === 2 ? null : ((1 - cannotDraw[0]) as PlayerIndex);
    endGame(
      G,
      winner,
      cannotDraw.length === 2
        ? 'Both players lose by simultaneous overdraw.'
        : `Player ${cannotDraw[0]} loses: not enough cards to draw.`,
    );
    return;
  }
  for (const index of playerIndexes) drawUnchecked(G.players[index], drawCounts[index]);
  for (const player of G.players) {
    player.cardsSetThisTurn = 0;
    player.rawAttack = 0;
  }
  G.setCardsThisTurn = [[], []];
  clearPendingEffects(G);
  clearPendingChoice(G);
  G.swappedCardsThisTurn = [[], []];
  G.suppressedEffectCardIdsThisTurn = [];
  G.drawEffectCardIdsThisTurn = [];
  G.drawOccurredThisEffect = [false, false];
  G.damageReducedThisTurn = [0, 0];
  G.delayedEffects = [];
  G.modifiers = emptyModifiers();
  // 官方 QA Q28：適当ラリーもう終わり的 areaEnchantSetLocked 效果僅持續到該卡
  // 從 setZoneC 移除為止（終止條件之一為「相手がアビスにカードを置いたターンの終了時」），
  // 故回合結束時必須重設，避免對手被永久禁止設定 Area Enchant。
  G.areaEnchantSetLocked = [false, false];
  G.timingEvents = [];
  G.turnNumber++;
  G.step = 'turnSet';
  G.ready = [false, false];
  // P3-16：回合開始時記錄伺服器時間，作為客戶端計時與超時判斷的權威基準。
  G.turnStartTime = Date.now();
  G.log.push(`Turn ${G.turnNumber}: set cards.`);
  // 推 turnStart notice，讓 UI 提示「進入第 N 回合」。
  pushGameNotice(G, {
    kind: 'turnStart',
    tone: 'phase',
    titleKey: 'board.notice.turnStart',
    turn: G.turnNumber,
  });
  resolveTimingEvent(G, parsedEffects, { type: 'turnStart' });
}

function continueAfterTurnEffects(
  G: GameState,
  parsedEffects: Map<string, ParsedEffect[]> = emptyParsedEffects(),
): void {
  const initial = G.turnNumber === 1;
  if (G.step === 'gameOver') return;
  if (G.players[0].hp <= 0 || G.players[1].hp <= 0) {
    const winner = G.players[0].hp <= 0 && G.players[1].hp <= 0 ? null : G.players[0].hp <= 0 ? 1 : 0;
    endGame(G, winner, 'A player reached 0 HP during effect resolution.');
    return;
  }
  resolveBattle(G, parsedEffects);
  if (G.players[0].hp <= 0 || G.players[1].hp <= 0) {
    const winner = G.players[0].hp <= 0 ? 1 : 0;
    endGame(G, winner, `Player ${1 - winner} loses at 0 HP.`);
    return;
  }
  if (!initial) recordPreviousTurnCharacterElements(G);
  finishTurn(G, parsedEffects);
}

function pendingEffectCount(pendingEffects: [PendingEffect[], PendingEffect[]]): number {
  return pendingEffects[0].length + pendingEffects[1].length;
}

function pendingEffectPriority(effect: PendingEffect): 'normal' | 'late' {
  return effect.effect.priority === 'late' ? 'late' : 'normal';
}

function pendingEffectPhase(G: GameState): 'normal' | 'late' {
  return G.pendingEffects.some((effects) => effects.some((effect) => pendingEffectPriority(effect) === 'normal'))
    ? 'normal'
    : 'late';
}

function playerHasPendingEffectInPhase(G: GameState, player: PlayerIndex, phase: 'normal' | 'late'): boolean {
  return G.pendingEffects[player].some((effect) => pendingEffectPriority(effect) === phase);
}

function pruneDisabledPendingEffects(G: GameState, player: PlayerIndex): void {
  G.pendingEffects[player] = G.pendingEffects[player].filter((pendingEffect) => {
    if (areEffectsDisabledForCard(G, player, pendingEffect.cardDefId)) return false;
    // 官方規則指南 B：效果在「処理する時点」のパワー総数 >= パワーコスト 時才發動。
    // 執行前重新檢查パワーコスト，避免效果處理途中パワー下降後仍發動。
    // 合成效果（如 follow-up-draw）無對應 cardDef，不套用パワーコスト檢查。
    const def = getCardDef(pendingEffect.cardDefId);
    if (!def) return true;
    const reduction = def.type === 'Character' ? (G.modifiers.powerCostReduction?.[player] ?? 0) : 0;
    const cost = Math.max(0, def.powerCost - reduction);
    if (getPlayerPower(G.players[player], G, player) < cost) return false;
    return true;
  });
}

function nextPendingEffectPlayer(G: GameState): PlayerIndex | null {
  for (const player of playerIndexes) pruneDisabledPendingEffects(G, player);
  const phase = pendingEffectPhase(G);
  if (G.pendingEffectPlayer !== null) {
    const current = G.pendingEffectPlayer;
    if (playerHasPendingEffectInPhase(G, current, phase)) {
      return current;
    }

    const other = (1 - current) as PlayerIndex;
    if (playerHasPendingEffectInPhase(G, other, phase)) {
      return other;
    }
    return null;
  }

  for (const player of getTurnEffectPlayerOrder(G)) {
    if (playerHasPendingEffectInPhase(G, player, phase)) return player;
  }
  return null;
}

function advancePendingEffectWindow(
  G: GameState,
  parsedEffects: Map<string, ParsedEffect[]> = emptyParsedEffects(),
): boolean {
  const nextPlayer = nextPendingEffectPlayer(G);
  if (nextPlayer !== null) {
    G.pendingEffectPlayer = nextPlayer;
    G.step = 'effectOrder';
    G.ready = [true, true];
    return true;
  }
  clearPendingEffects(G);
  continueAfterTurnEffects(G, parsedEffects);
  return false;
}

export function resolvePendingEffect(
  G: GameState,
  player: PlayerIndex,
  index: number,
  parsedEffects: Map<string, ParsedEffect[]> = emptyParsedEffects(),
): boolean {
  if (G.step !== 'effectOrder' || G.pendingEffectPlayer !== player) return false;
  if (!Number.isInteger(index) || index < 0 || index >= G.pendingEffects[player].length) return false;
  const pendingEffect = G.pendingEffects[player][index];
  if (!pendingEffect || pendingEffect.player !== player) return false;
  if (
    G.pendingEffects[player].slice(0, index).some((effect) => effect.cardInstanceId === pendingEffect.cardInstanceId)
  ) {
    return false;
  }
  if (pendingEffectPhase(G) === 'normal' && pendingEffectPriority(pendingEffect) === 'late') return false;
  recordAction(G, player, 'chooseEffectOrder', {
    index,
    effectId: pendingEffect.id,
    cardDefId: pendingEffect.cardDefId,
    source: pendingEffect.source,
  });
  G.pendingEffects[player].splice(index, 1);

  const beforeChronos = G.chronos.position;
  const result = executeEffect(pendingEffect.effect, G, player, {
    cardInstanceId: pendingEffect.cardInstanceId,
    cardDefId: pendingEffect.cardDefId,
    onTimingEvent: (event) => resolveTimingEvent(G, parsedEffects, event),
  });
  if (G.chronos.position !== beforeChronos) {
    const afterChronos = G.chronos.position;
    G.chronos.position = beforeChronos;
    setChronosPosition(G, afterChronos, parsedEffects, undefined, {
      kind: 'cardEffect',
      cardDefId: pendingEffect.cardDefId,
    });
  }
  recordAction(
    G,
    player,
    'resolvePendingEffect',
    {
      effectId: pendingEffect.id,
      cardDefId: pendingEffect.cardDefId,
      source: pendingEffect.source,
      ...effectActionSummary(pendingEffect.effect),
    },
    {
      result: { ok: result.success, message: result.message },
      context: {
        pendingEffectCardDefId: pendingEffect.cardDefId,
        pendingChoiceType: G.pendingChoice?.type,
      },
    },
  );
  if (result.success) G.log.push(`Player ${player}: ${result.message}.`);
  if ((G.step as GameState['step']) === 'gameOver') {
    recordGameOverTrace(G);
    clearPendingEffects(G);
    return true;
  }
  if (G.pendingChoice) return true;

  advancePendingEffectWindow(G, parsedEffects);
  return true;
}

export function submitPendingChoice(
  G: GameState,
  player: PlayerIndex,
  optionIds: string[],
  parsedEffects: Map<string, ParsedEffect[]> = emptyParsedEffects(),
): boolean {
  const choice = G.pendingChoice;
  if (!choice || choice.player !== player) return false;
  if (!Array.isArray(optionIds) || optionIds.length < choice.min || optionIds.length > choice.max) return false;
  if (new Set(optionIds).size !== optionIds.length) return false;
  const legal = new Set(choice.options.map((option) => option.id));
  if (!optionIds.every((id) => legal.has(id))) return false;

  const playerState = G.players[player];
  const result = applyPendingChoice(
    { G, player, choice, optionIds, playerState, parsedEffects },
    {
      drawUnchecked,
      endGame,
      getPlayerPower,
      recordPendingChoiceAction,
      resolveTimingEvent,
      sendToOwnerZone,
      setChronosPosition,
      shuffleSelectedCards,
      suppressEffectCardForTurn,
    },
  );

  if (result.status === 'invalid') return false;
  if (result.status === 'endedGame') return true;

  if (!shouldPreserveChoiceSelectionCount(choice)) G.lastChoiceSelectionCount[player] = null;
  recordPendingChoiceAction(G, player, choice, optionIds.length);
  clearPendingChoice(G);
  if (result.nextChoice) {
    G.pendingChoice = result.nextChoice;
    return true;
  }
  advancePendingEffectWindow(G, parsedEffects);
  return true;
}

export function resolveTurn(G: GameState, parsedEffects: Map<string, ParsedEffect[]>): void {
  const initial = G.step === 'initialSet' || G.turnNumber === 1;
  clearPendingEffects(G);
  G.chronosAtTurnStart = G.chronos.position;
  revealCards(G);
  if (initial) {
    // Initial non-Characters leave immediately after reveal, but their entries
    // remain in setCardsThisTurn and therefore still advance Chronos.
    placeRevealedCards(G, true, parsedEffects);
    advanceChronos(G, parsedEffects);
  } else {
    applyPreChronosModifiers(G, parsedEffects);
    advanceChronos(G, parsedEffects);
    placeRevealedCards(G, false, parsedEffects);
  }
  const pendingEffects = collectTurnEffects(G, parsedEffects, G.setCardsThisTurn);
  if (pendingEffectCount(pendingEffects) > 0) {
    G.pendingEffects = pendingEffects;
    advancePendingEffectWindow(G, parsedEffects);
    return;
  }
  continueAfterTurnEffects(G, parsedEffects);
}
