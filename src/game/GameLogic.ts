import type { ParsedEffect } from './effects';
import { collectTurnEffects, executeEffect, getTurnEffectPlayerOrder } from './effects/executor';
import type {
  CardInstance,
  ChronosTime,
  CombatModifiers,
  Element,
  GameState,
  JankenChoice,
  PendingEffect,
  PlayerIndex,
  PlayerState,
  SetSlot,
  TimingEvent,
  ZutomayoSetupData,
} from './types';
import { getCardDef } from './cards/loader';
import {
  buildDeck,
  CUSTOM_DECK_NAME,
  getPresetDeck,
  randomDeck,
  shuffleDeck,
  validateConstructedDeckIds,
} from './cards/deckBuilder';

const playerIndexes: PlayerIndex[] = [0, 1];

interface SetupGameOptions {
  allowBrowserCustomDeckName?: boolean;
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
  return validateSetupDeck(0, data.deck0Ids, data.deck0Name, options)
    ?? validateSetupDeck(1, data.deck1Ids, data.deck1Name, options);
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

export function emptyModifiers(): CombatModifiers {
  return {
    attack: [0, 0],
    damageReduction: [0, 0],
    swapAttack: [false, false],
    effectsDisabled: [false, false],
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

export function sendToOwnerZone(card: CardInstance, player: PlayerState): void {
  card.faceUp = true;
  const def = getCardDef(card.defId);
  if (def && def.sendToPower > 0) player.powerCharger.push(card);
  else player.abyss.push(card);
}

export function getPlayerPower(player: PlayerState): number {
  return player.powerCharger.reduce(
    (sum, card) => sum + (getCardDef(card.defId)?.sendToPower ?? 0),
    0,
  );
}

export function getChronosTime(G: GameState): ChronosTime {
  const position = ((G.chronos.position % 12) + 12) % 12;
  const distanceFromMidnight = Math.min(position, 12 - position);
  return position < 6 || distanceFromMidnight <= G.midnightRange ? 'night' : 'day';
}

export function getPriorityPlayer(G: GameState): PlayerIndex {
  return getChronosTime(G) === 'night'
    ? G.chronos.nightSidePlayer
    : ((1 - G.chronos.nightSidePlayer) as PlayerIndex);
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
  const options: SetupGameOptions = legacyNames || typeof deck1NameOrOptions === 'string'
    ? {}
    : deck1NameOrOptions;
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
    lastBattleResult: { winner: null, damage: 0, winnerAttack: 0, loserAttack: 0 },
    setCardsThisTurn: [[], []],
    pendingEffects: [[], []],
    pendingEffectPlayer: null,
    timingEvents: [],
    swappedCardsThisTurn: [[], []],
    previousTurnCharacterElements: [null, null],
    jankenChoices: [null, null],
    mulliganUsed: [false, false],
    modifiers: emptyModifiers(),
    winner: null,
    gameoverReason: null,
    log: ['Game initialized. Janken determines the night-side player.'],
  };
  G.players[0].deck = shuffleDeck(setupDeck(
    0,
    setupData.deck0Ids,
    setupData.deck0Name,
    allowBrowserCustomDeckName,
  ));
  G.players[1].deck = shuffleDeck(setupDeck(
    1,
    setupData.deck1Ids,
    setupData.deck1Name,
    allowBrowserCustomDeckName,
  ));
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
    rock: 'scissors', paper: 'rock', scissors: 'paper',
  };
  if (choice0 === choice1) {
    G.jankenChoices = [null, null];
    G.log.push('Janken draw. Choose again.');
    return { winner: null };
  }
  const winner: PlayerIndex = beats[choice0] === choice1 ? 0 : 1;
  G.chronos.nightSidePlayer = winner;
  G.step = 'mulligan';
  G.ready = [false, false];
  G.log.push(`Player ${winner} wins janken and takes the night side.`);
  return { winner };
}

export function chooseJanken(G: GameState, player: PlayerIndex, choice: JankenChoice): boolean {
  if (G.step !== 'janken' || G.jankenChoices[player] !== null) return false;
  G.jankenChoices[player] = choice;
  if (G.jankenChoices[0] && G.jankenChoices[1]) {
    resolveJanken(G, G.jankenChoices[0], G.jankenChoices[1]);
  }
  return true;
}

export function finishMulligan(G: GameState, player: PlayerIndex, indices: number[]): boolean {
  if (G.step !== 'mulligan' || G.mulliganUsed[player]) return false;
  const state = G.players[player];
  const unique = [...new Set(indices)].filter(i => Number.isInteger(i) && i >= 0 && i < state.hand.length);
  unique.sort((a, b) => b - a);
  const aside = unique.map(index => state.hand.splice(index, 1)[0]);
  if (state.deck.length < aside.length) return false;
  drawUnchecked(state, aside.length);
  state.deck = shuffleDeck([...state.deck, ...aside]);
  G.mulliganUsed[player] = true;
  G.ready[player] = true;
  G.log.push(`Player ${player} ${aside.length ? `redraws ${aside.length}` : 'keeps their hand'}.`);
  if (G.ready[0] && G.ready[1]) {
    G.step = 'initialSet';
    G.ready = [false, false];
    G.log.push('Both players choose an initial battle-zone card.');
  }
  return true;
}

export function getRequiredSetCount(G: GameState, player: PlayerIndex): number {
  if (G.step === 'initialSet' || G.turnNumber === 1) return 1;
  if (G.lastBattleResult.winner === null) return 1;
  return G.lastBattleResult.winner === player ? 1 : 2;
}

function setCard(G: GameState, player: PlayerIndex, handIndex: number, slot: SetSlot): boolean {
  const state = G.players[player];
  if (G.ready[player] || handIndex < 0 || handIndex >= state.hand.length) return false;
  if (slot === 'B' && G.step === 'initialSet') return false;
  if (state.cardsSetThisTurn >= getRequiredSetCount(G, player)) return false;
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
  return G.step === 'initialSet' && setCard(G, player, handIndex, 'A');
}

export function setTurnCard(
  G: GameState,
  player: PlayerIndex,
  handIndex: number,
  slot: SetSlot,
): boolean {
  return G.step === 'turnSet' && setCard(G, player, handIndex, slot);
}

export function undoSetCard(G: GameState, player: PlayerIndex, slot: SetSlot): boolean {
  if (!['initialSet', 'turnSet'].includes(G.step) || G.ready[player]) return false;
  const state = G.players[player];
  const zone = slot === 'A' ? 'setZoneA' : 'setZoneB';
  const card = state[zone];
  if (!card) return false;
  card.faceUp = true;
  state.hand.push(card);
  state[zone] = null;
  state.cardsSetThisTurn--;
  G.setCardsThisTurn[player] = G.setCardsThisTurn[player].filter(c => c.instanceId !== card.instanceId);
  return true;
}

export function confirmReady(
  G: GameState,
  player: PlayerIndex,
  parsedEffects: Map<string, ParsedEffect[]>,
): boolean {
  if (!['initialSet', 'turnSet'].includes(G.step) || G.ready[player]) return false;
  if (G.players[player].cardsSetThisTurn !== getRequiredSetCount(G, player)) return false;
  G.ready[player] = true;
  if (G.ready[0] && G.ready[1]) resolveTurn(G, parsedEffects);
  return true;
}

export function revealCards(G: GameState): void {
  G.log.push('「嫌（やぁ）」— cards revealed simultaneously.');
  for (const player of G.players) {
    if (player.setZoneA) player.setZoneA.faceUp = true;
    if (player.setZoneB) player.setZoneB.faceUp = true;
  }
}

export function advanceChronos(G: GameState): void {
  const total = G.setCardsThisTurn.flat().reduce(
    (sum, card) => sum + (getCardDef(card.defId)?.clock ?? 0),
    0,
  );
  const before = G.chronos.position;
  G.chronos.position = (before + total) % 12;
  G.log.push(`Chronos +${total} (${before}→${G.chronos.position}).`);
}

function hasOptionalSwapEffect(
  G: GameState,
  player: PlayerIndex,
  parsedEffects: Map<string, ParsedEffect[]> | null,
): boolean {
  if (!parsedEffects || !G.players[player].battleZone) return false;
  return G.setCardsThisTurn[player].some(card => {
    const def = getCardDef(card.defId);
    if (!def || getPlayerPower(G.players[player]) < def.powerCost) return false;
    return (parsedEffects.get(card.defId) ?? []).some(effect => (
      effect.action.type === 'addSettableCard' && effect.action.params.optional
    ));
  });
}

function replaceDestination(
  G: GameState,
  playerIndex: PlayerIndex,
  cards: CardInstance[],
  destination: 'battleZone' | 'setZoneC',
  skipBattleSwap = false,
): void {
  if (cards.length === 0) return;
  const player = G.players[playerIndex];
  if (destination === 'battleZone' && skipBattleSwap && player.battleZone) {
    for (const card of cards) sendToOwnerZone(card, player);
    return;
  }
  const selected = cards[0];
  const old = player[destination];
  player[destination] = selected;
  if (destination === 'battleZone' && old) G.swappedCardsThisTurn[playerIndex].push(selected);
  if (old) sendToOwnerZone(old, player);
  for (const extra of cards.slice(1)) sendToOwnerZone(extra, player);
}

export function placeRevealedCards(
  G: GameState,
  initial: boolean,
  parsedEffects: Map<string, ParsedEffect[]> | null = null,
): void {
  for (const index of playerIndexes) {
    const player = G.players[index];
    const slots = [player.setZoneA, player.setZoneB].filter((card): card is CardInstance => card !== null);
    if (initial) {
      const characters = slots.filter(card => getCardDef(card.defId)?.type === 'Character');
      replaceDestination(G, index, characters, 'battleZone');
      for (const card of slots.filter(card => getCardDef(card.defId)?.type !== 'Character')) {
        sendToOwnerZone(card, player);
      }
      player.setZoneA = null;
      player.setZoneB = null;
      continue;
    }
    const characters = slots.filter(card => getCardDef(card.defId)?.type === 'Character');
    const areas = slots.filter(card => getCardDef(card.defId)?.type === 'Area Enchant');
    replaceDestination(G, index, characters, 'battleZone', hasOptionalSwapEffect(G, index, parsedEffects));
    replaceDestination(G, index, areas, 'setZoneC');
    for (const zone of ['setZoneA', 'setZoneB'] as const) {
      const card = player[zone];
      const type = card && getCardDef(card.defId)?.type;
      if (type === 'Character' || type === 'Area Enchant') player[zone] = null;
    }
  }
}

export function getEffectiveAttack(card: CardInstance, G: GameState, player: number): number {
  const index = player as PlayerIndex;
  const def = getCardDef(card.defId);
  if (!def?.attack || getPlayerPower(G.players[index]) < def.powerCost) return 0;
  const time = getChronosTime(G);
  const attackTime = G.modifiers.swapAttack[index] ? (time === 'night' ? 'day' : 'night') : time;
  return Math.max(0, def.attack[attackTime] + G.modifiers.attack[index]);
}

function emptyParsedEffects(): Map<string, ParsedEffect[]> {
  return new Map<string, ParsedEffect[]>();
}

function timingTrigger(event: TimingEvent): ParsedEffect['trigger'] | null {
  if (event.type === 'turnStart') return 'onTurnStart';
  if (event.type === 'turnEnd') return 'onTurnEnd';
  if (event.type === 'damageReceived') return 'onDamageReceived';
  return null;
}

function timingCandidateCards(G: GameState, player: PlayerIndex): CardInstance[] {
  return [G.players[player].battleZone, G.players[player].setZoneC]
    .filter((card): card is CardInstance => card !== null)
    .filter((card, index, all) => all.findIndex(other => other.instanceId === card.instanceId) === index);
}

export function resolveTimingEvent(
  G: GameState,
  parsedEffects: Map<string, ParsedEffect[]> = emptyParsedEffects(),
  event: TimingEvent,
): void {
  const trigger = timingTrigger(event);
  G.timingEvents.push(event);
  G.log.push(`Timing ${event.type}.`);
  if (!trigger || G.step === 'gameOver') return;

  const players: PlayerIndex[] = event.type === 'damageReceived'
    ? (event.player === 0 || event.player === 1 ? [event.player] : [])
    : getTurnEffectPlayerOrder(G);

  for (const player of players) {
    if (G.modifiers.effectsDisabled[player]) continue;
    for (const card of timingCandidateCards(G, player)) {
      const definition = getCardDef(card.defId);
      if (!definition || getPlayerPower(G.players[player]) < definition.powerCost) continue;
      for (const effect of parsedEffects.get(card.defId) ?? []) {
        if (effect.trigger !== trigger) continue;
        const result = executeEffect(effect, G, player);
        if (result.success) G.log.push(`Player ${player}: ${result.message}.`);
        if ((G.step as GameState['step']) === 'gameOver') return;
      }
    }
  }
}

export function resolveBattle(G: GameState, parsedEffects: Map<string, ParsedEffect[]> = emptyParsedEffects()): void {
  const attacks = playerIndexes.map(index => {
    const card = G.players[index].battleZone;
    return card ? getEffectiveAttack(card, G, index) : 0;
  }) as [number, number];
  G.players[0].rawAttack = attacks[0];
  G.players[1].rawAttack = attacks[1];
  if (attacks[0] === attacks[1]) {
    G.lastBattleResult = { winner: null, damage: 0, winnerAttack: attacks[0], loserAttack: attacks[1] };
    G.log.push(`Battle ${attacks[0]}–${attacks[1]}: draw.`);
    return;
  }
  const winner: PlayerIndex = attacks[0] > attacks[1] ? 0 : 1;
  const loser = (1 - winner) as PlayerIndex;
  const rawDamage = attacks[winner] - attacks[loser];
  const damage = G.modifiers.unreduceableDamage[winner]
    ? rawDamage
    : Math.max(0, rawDamage - G.modifiers.damageReduction[loser]);
  G.players[loser].hp = Math.max(0, G.players[loser].hp - damage);
  G.lastBattleResult = { winner, damage, winnerAttack: attacks[winner], loserAttack: attacks[loser] };
  G.log.push(`Battle ${attacks[0]}–${attacks[1]}: Player ${winner} deals ${damage}.`);
  if (damage > 0) {
    resolveTimingEvent(G, parsedEffects, { type: 'damageReceived', player: loser, amount: damage });
  }
}

export function endGame(G: GameState, winner: PlayerIndex | null, reason: string): void {
  G.step = 'gameOver';
  G.winner = winner;
  G.gameoverReason = reason;
  G.ready = [true, true];
  clearPendingEffects(G);
  G.log.push(reason);
}

function characterElementPlayedThisTurn(G: GameState, player: PlayerIndex): Element | null {
  for (const card of G.setCardsThisTurn[player]) {
    const def = getCardDef(card.defId);
    if (def?.type === 'Character') return def.element;
  }
  return null;
}

function recordPreviousTurnCharacterElements(G: GameState): void {
  G.previousTurnCharacterElements = [
    characterElementPlayedThisTurn(G, 0),
    characterElementPlayedThisTurn(G, 1),
  ];
}

function emptyPendingEffects(): [PendingEffect[], PendingEffect[]] {
  return [[], []];
}

function clearPendingEffects(G: GameState): void {
  G.pendingEffects = emptyPendingEffects();
  G.pendingEffectPlayer = null;
}

function finishTurn(G: GameState, parsedEffects: Map<string, ParsedEffect[]> = emptyParsedEffects()): void {
  resolveTimingEvent(G, parsedEffects, { type: 'turnEnd' });
  if (G.step === 'gameOver') return;
  for (const player of G.players) {
    for (const zone of ['setZoneA', 'setZoneB'] as const) {
      if (player[zone]) sendToOwnerZone(player[zone]!, player);
      player[zone] = null;
    }
  }
  const cannotDraw = playerIndexes.filter(index => G.players[index].deck.length < G.players[index].cardsSetThisTurn);
  if (cannotDraw.length > 0) {
    const winner = cannotDraw.length === 2 ? null : ((1 - cannotDraw[0]) as PlayerIndex);
    endGame(G, winner, cannotDraw.length === 2 ? 'Both players lose by simultaneous overdraw.' : `Player ${cannotDraw[0]} loses: not enough cards to draw.`);
    return;
  }
  for (const index of playerIndexes) drawUnchecked(G.players[index], G.players[index].cardsSetThisTurn);
  for (const player of G.players) {
    player.cardsSetThisTurn = 0;
    player.rawAttack = 0;
  }
  G.setCardsThisTurn = [[], []];
  clearPendingEffects(G);
  G.swappedCardsThisTurn = [[], []];
  G.modifiers = emptyModifiers();
  G.turnNumber++;
  G.step = 'turnSet';
  G.ready = [false, false];
  G.log.push(`Turn ${G.turnNumber}: set cards.`);
  resolveTimingEvent(G, parsedEffects, { type: 'turnStart' });
}

function continueAfterTurnEffects(G: GameState, parsedEffects: Map<string, ParsedEffect[]> = emptyParsedEffects()): void {
  const initial = G.turnNumber === 1;
  if (G.step === 'gameOver') return;
  if (G.players[0].hp <= 0 || G.players[1].hp <= 0) {
    const winner = G.players[0].hp <= 0 && G.players[1].hp <= 0 ? null : (G.players[0].hp <= 0 ? 1 : 0);
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

function nextPendingEffectPlayer(G: GameState): PlayerIndex | null {
  if (G.pendingEffectPlayer !== null) {
    const current = G.pendingEffectPlayer;
    if (G.modifiers.effectsDisabled[current]) {
      G.pendingEffects[current] = [];
    } else if (G.pendingEffects[current].length > 0) {
      return current;
    }

    const other = (1 - current) as PlayerIndex;
    if (G.modifiers.effectsDisabled[other]) {
      G.pendingEffects[other] = [];
    } else if (G.pendingEffects[other].length > 0) {
      return other;
    }
    return null;
  }

  for (const player of getTurnEffectPlayerOrder(G)) {
    if (G.modifiers.effectsDisabled[player]) {
      G.pendingEffects[player] = [];
      continue;
    }
    if (G.pendingEffects[player].length > 0) return player;
  }
  return null;
}

function advancePendingEffectWindow(G: GameState, parsedEffects: Map<string, ParsedEffect[]> = emptyParsedEffects()): boolean {
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
  G.pendingEffects[player].splice(index, 1);

  const result = executeEffect(pendingEffect.effect, G, player);
  if (result.success) G.log.push(`Player ${player}: ${result.message}.`);
  if ((G.step as GameState['step']) === 'gameOver') {
    clearPendingEffects(G);
    return true;
  }

  advancePendingEffectWindow(G, parsedEffects);
  return true;
}

export function resolveTurn(G: GameState, parsedEffects: Map<string, ParsedEffect[]>): void {
  const initial = G.step === 'initialSet' || G.turnNumber === 1;
  G.modifiers = emptyModifiers();
  clearPendingEffects(G);
  G.chronosAtTurnStart = G.chronos.position;
  revealCards(G);
  if (initial) {
    // Initial non-Characters leave immediately after reveal, but their entries
    // remain in setCardsThisTurn and therefore still advance Chronos.
    placeRevealedCards(G, true, parsedEffects);
    advanceChronos(G);
  } else {
    advanceChronos(G);
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
