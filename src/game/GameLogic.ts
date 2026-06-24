import type { ParsedEffect } from './effects';
import { processTurnEffects } from './effects/executor';
import type {
  CardInstance,
  ChronosTime,
  CombatModifiers,
  GameState,
  JankenChoice,
  PlayerIndex,
  PlayerState,
  SetSlot,
} from './types';
import { getCardDef } from './cards/loader';
import { getPresetDeck, randomDeck, shuffleDeck } from './cards/deckBuilder';

const playerIndexes: PlayerIndex[] = [0, 1];

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
  return G.chronos.position < 6 ? 'night' : 'day';
}

export function getPriorityPlayer(G: GameState): PlayerIndex {
  return getChronosTime(G) === 'night'
    ? G.chronos.nightSidePlayer
    : ((1 - G.chronos.nightSidePlayer) as PlayerIndex);
}

export function setupGame(deck0Name?: string, deck1Name?: string): GameState {
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
    chronosAtTurnStart: 0,
    turnNumber: 1,
    lastBattleResult: { winner: null, damage: 0, winnerAttack: 0, loserAttack: 0 },
    setCardsThisTurn: [[], []],
    jankenChoices: [null, null],
    mulliganUsed: [false, false],
    modifiers: emptyModifiers(),
    winner: null,
    gameoverReason: null,
    log: ['Game initialized. Janken determines the night-side player.'],
  };
  G.players[0].deck = shuffleDeck(deck0Name ? getPresetDeck(deck0Name) : randomDeck());
  G.players[1].deck = shuffleDeck(deck1Name ? getPresetDeck(deck1Name) : randomDeck());
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

function replaceDestination(player: PlayerState, cards: CardInstance[], destination: 'battleZone' | 'setZoneC'): void {
  if (cards.length === 0) return;
  const selected = cards[0];
  const old = player[destination];
  player[destination] = selected;
  if (old) sendToOwnerZone(old, player);
  for (const extra of cards.slice(1)) sendToOwnerZone(extra, player);
}

export function placeRevealedCards(G: GameState, initial: boolean): void {
  for (const player of G.players) {
    const slots = [player.setZoneA, player.setZoneB].filter((card): card is CardInstance => card !== null);
    if (initial) {
      const characters = slots.filter(card => getCardDef(card.defId)?.type === 'Character');
      replaceDestination(player, characters, 'battleZone');
      for (const card of slots.filter(card => getCardDef(card.defId)?.type !== 'Character')) {
        sendToOwnerZone(card, player);
      }
      player.setZoneA = null;
      player.setZoneB = null;
      continue;
    }
    const characters = slots.filter(card => getCardDef(card.defId)?.type === 'Character');
    const areas = slots.filter(card => getCardDef(card.defId)?.type === 'Area Enchant');
    replaceDestination(player, characters, 'battleZone');
    replaceDestination(player, areas, 'setZoneC');
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

export function resolveBattle(G: GameState): void {
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
}

export function endGame(G: GameState, winner: PlayerIndex | null, reason: string): void {
  G.step = 'gameOver';
  G.winner = winner;
  G.gameoverReason = reason;
  G.ready = [true, true];
  G.log.push(reason);
}

function finishTurn(G: GameState): void {
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
  G.modifiers = emptyModifiers();
  G.turnNumber++;
  G.step = 'turnSet';
  G.ready = [false, false];
  G.log.push(`Turn ${G.turnNumber}: set cards.`);
}

export function resolveTurn(G: GameState, parsedEffects: Map<string, ParsedEffect[]>): void {
  const initial = G.step === 'initialSet' || G.turnNumber === 1;
  G.modifiers = emptyModifiers();
  G.chronosAtTurnStart = G.chronos.position;
  revealCards(G);
  if (initial) {
    // Initial non-Characters leave immediately after reveal, but their entries
    // remain in setCardsThisTurn and therefore still advance Chronos.
    placeRevealedCards(G, true);
    advanceChronos(G);
  } else {
    advanceChronos(G);
    placeRevealedCards(G, false);
  }
  processTurnEffects(G, parsedEffects, G.setCardsThisTurn);
  if (G.step === 'gameOver') return;
  if (G.players[0].hp <= 0 || G.players[1].hp <= 0) {
    const winner = G.players[0].hp <= 0 && G.players[1].hp <= 0 ? null : (G.players[0].hp <= 0 ? 1 : 0);
    endGame(G, winner, 'A player reached 0 HP during effect resolution.');
    return;
  }
  resolveBattle(G);
  if (G.players[0].hp <= 0 || G.players[1].hp <= 0) {
    const winner = G.players[0].hp <= 0 ? 1 : 0;
    endGame(G, winner, `Player ${1 - winner} loses at 0 HP.`);
    return;
  }
  finishTurn(G);
}
