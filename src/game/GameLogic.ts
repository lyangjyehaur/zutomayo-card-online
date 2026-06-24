import type { GameState, PlayerState, CardInstance, ChronosTime } from './types';
import { getCardDef } from './cards/loader';
import { getPresetDeck, randomDeck, shuffleDeck } from './cards/deckBuilder';

// ===== Helpers =====

function drawCards(player: PlayerState, count: number): CardInstance[] {
  const drawn: CardInstance[] = [];
  for (let i = 0; i < count && player.deck.length > 0; i++) {
    const card = player.deck.shift()!;
    card.faceUp = true;
    player.hand.push(card);
    drawn.push(card);
  }
  return drawn;
}

function sendToZone(card: CardInstance, player: PlayerState): void {
  const def = getCardDef(card.defId);
  if (!def) return;
  if (def.sendToPower > 0) {
    player.powerCharger.push(card);
  } else {
    player.abyss.push(card);
  }
}

function getPlayerPower(player: PlayerState): number {
  return player.powerCharger.reduce((sum, c) => {
    const def = getCardDef(c.defId);
    return sum + (def?.sendToPower || 0);
  }, 0);
}

export function getChronosTime(G: GameState): ChronosTime {
  const pos = G.chronos.position % 12;
  return pos < 6 ? 'night' : 'day';
}

export function getPriorityPlayer(G: GameState): 0 | 1 {
  const time = getChronosTime(G);
  return time === 'night' ? G.chronos.nightSidePlayer : (1 - G.chronos.nightSidePlayer) as 0 | 1;
}

export function getPlayerPowerExport(player: PlayerState): number {
  return getPlayerPower(player);
}

export function getEffectiveAttack(card: CardInstance, G: GameState, playerIdx: number): number {
  const def = getCardDef(card.defId);
  if (!def || !def.attack) return 0;
  const time = getChronosTime(G);
  const rawAttack = time === 'night' ? def.attack.night : def.attack.day;
  const power = getPlayerPower(G.players[playerIdx]);
  if (power < def.powerCost) return 0;
  return rawAttack;
}

// ===== Setup Phase =====

export function setupGame(deck0Name?: string, deck1Name?: string): GameState {
  const deck0 = shuffleDeck(deck0Name ? getPresetDeck(deck0Name) : randomDeck());
  const deck1 = shuffleDeck(deck1Name ? getPresetDeck(deck1Name) : randomDeck());

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
    chronos: { position: 0, nightSidePlayer: 0 }, // Will be set by janken
    turn: 0,
    lastBattleResult: { winner: null, damage: 0, winnerAttack: 0, loserAttack: 0 },
    setCardsThisTurn: { player0: [], player1: [] },
    log: [],
    setupPhase: 'janken', // Track setup sub-phases
    mulliganUsed: [false, false],
  };

  // Step 3: Shuffle, exchange, shuffle again, exchange back
  G.players[0].deck = deck0;
  G.players[1].deck = deck1;

  // Step 5: Draw 5 cards each
  drawCards(G.players[0], 5);
  drawCards(G.players[1], 5);

  G.log.push('Game initialized. Janken to determine night side.');
  return G;
}

// ===== Janken (Rock-Paper-Scissors) =====

export type JankenChoice = 'rock' | 'paper' | 'scissors';

export function resolveJanken(G: GameState, choice0: JankenChoice, choice1: JankenChoice): { winner: 0 | 1 | null } {
  const beats: Record<JankenChoice, JankenChoice> = {
    rock: 'scissors',
    paper: 'rock',
    scissors: 'paper',
  };

  if (choice0 === choice1) {
    G.log.push(`Janken: Both chose ${choice0} — Draw!`);
    return { winner: null };
  }

  const winner = beats[choice0] === choice1 ? 0 : 1;
  G.chronos.nightSidePlayer = winner;
  G.setupPhase = 'mulligan';
  G.log.push(`Janken: ${choice0} vs ${choice1} — Player ${winner} wins and becomes night side!`);
  return { winner };
}

// ===== Mulligan =====

export function mulligan(G: GameState, playerIdx: number, indicesToRedraw: number[]): void {
  if (G.mulliganUsed?.[playerIdx]) return;

  const player = G.players[playerIdx];
  const toRedraw = indicesToRedraw
    .filter(i => i >= 0 && i < player.hand.length)
    .sort((a, b) => b - a);

  if (toRedraw.length === 0) {
    if (G.mulliganUsed) G.mulliganUsed[playerIdx] = true;
    G.log.push(`Player ${playerIdx} keeps hand.`);
    return;
  }

  const aside: CardInstance[] = [];
  for (const idx of toRedraw) {
    aside.push(player.hand.splice(idx, 1)[0]);
  }

  drawCards(player, aside.length);

  player.deck.push(...aside);
  player.deck = shuffleDeck(player.deck);

  if (G.mulliganUsed) G.mulliganUsed[playerIdx] = true;
  G.log.push(`Player ${playerIdx} redraws ${aside.length} cards.`);
}

// Check if both players have completed mulligan
export function isSetupComplete(G: GameState): boolean {
  return G.mulliganUsed?.[0] === true && G.mulliganUsed?.[1] === true;
}

// ===== Phase: Set =====

export function selectCard(G: GameState, playerIdx: number, handIndex: number, slot: 'A' | 'B'): boolean {
  const player = G.players[playerIdx];
  if (handIndex < 0 || handIndex >= player.hand.length) return false;

  const maxCards = G.turn === 0 ? 1 : getMaxSetCards(G, playerIdx);
  if (player.cardsSetThisTurn >= maxCards) return false;

  const card = player.hand.splice(handIndex, 1)[0];
  card.faceUp = false; // Face down until reveal

  if (slot === 'A' && !player.setZoneA) {
    player.setZoneA = card;
  } else if (slot === 'B' && !player.setZoneB) {
    player.setZoneB = card;
  } else {
    player.hand.splice(handIndex, 0, card);
    return false;
  }

  player.cardsSetThisTurn++;
  G.setCardsThisTurn[`player${playerIdx}` as keyof typeof G.setCardsThisTurn].push(card);
  return true;
}

export function getMaxSetCards(G: GameState, playerIdx: number): number {
  if (G.turn === 0) return 1;
  const result = G.lastBattleResult;
  if (result.winner === null) return 1;
  if (result.winner === playerIdx) return 1;
  return 2;
}

// ===== Phase: Reveal =====

export function revealCards(G: GameState): void {
  // "嫌（やぁ）" — simultaneously reveal
  G.log.push('「嫌（やぁ）」— Cards revealed!');

  for (const player of G.players) {
    if (player.setZoneA) player.setZoneA.faceUp = true;
    if (player.setZoneB) player.setZoneB.faceUp = true;
  }

  // Non-character cards go to power charger/abyss immediately
  for (const player of G.players) {
    for (const slot of ['setZoneA', 'setZoneB'] as const) {
      const card = player[slot];
      if (card) {
        const def = getCardDef(card.defId);
        if (def && def.type !== 'Character') {
          sendToZone(card, player);
          player[slot] = null;
        }
      }
    }
  }
}

// ===== Phase: Time =====

export function advanceChronos(G: GameState): void {
  let totalClock = 0;

  for (const playerIdx of [0, 1] as const) {
    const key = `player${playerIdx}` as keyof typeof G.setCardsThisTurn;
    for (const card of G.setCardsThisTurn[key]) {
      const def = getCardDef(card.defId);
      if (def) totalClock += def.clock;
    }
  }

  const oldPos = G.chronos.position;
  G.chronos.position = (G.chronos.position + totalClock) % 12;

  G.log.push(`Chronos +${totalClock} (${oldPos}→${G.chronos.position}). ${getChronosTime(G)} phase.`);
}

// ===== Phase: Swap =====

export function swapCards(G: GameState): void {
  for (const playerIdx of [0, 1] as const) {
    const player = G.players[playerIdx];

    if (player.setZoneA) {
      const oldBattle = player.battleZone;
      player.battleZone = player.setZoneA;
      player.setZoneA = null;
      if (oldBattle) sendToZone(oldBattle, player);
    }

    if (player.setZoneB) {
      const def = getCardDef(player.setZoneB.defId);
      if (def?.type === 'Area Enchant') {
        const oldC = player.setZoneC;
        player.setZoneC = player.setZoneB;
        player.setZoneB = null;
        if (oldC) sendToZone(oldC, player);
      }
    }
  }

  G.log.push('Cards swapped into battle/area zones.');
}

// ===== Phase: Battle =====

export function resolveBattle(G: GameState): void {
  const atk0 = G.players[0].battleZone
    ? getEffectiveAttack(G.players[0].battleZone, G, 0)
    : 0;
  const atk1 = G.players[1].battleZone
    ? getEffectiveAttack(G.players[1].battleZone, G, 1)
    : 0;

  G.players[0].rawAttack = atk0;
  G.players[1].rawAttack = atk1;

  const diff = Math.abs(atk0 - atk1);

  if (atk0 === atk1) {
    G.lastBattleResult = { winner: null, damage: 0, winnerAttack: atk0, loserAttack: atk1 };
    G.log.push(`Battle: ${atk0} vs ${atk1} — Draw!`);
  } else if (atk0 > atk1) {
    G.players[1].hp = Math.max(0, G.players[1].hp - diff);
    G.lastBattleResult = { winner: 0, damage: diff, winnerAttack: atk0, loserAttack: atk1 };
    G.log.push(`Battle: ${atk0} vs ${atk1} — P0 wins! ${diff} dmg. (P1 HP: ${G.players[1].hp})`);
  } else {
    G.players[0].hp = Math.max(0, G.players[0].hp - diff);
    G.lastBattleResult = { winner: 1, damage: diff, winnerAttack: atk1, loserAttack: atk0 };
    G.log.push(`Battle: ${atk0} vs ${atk1} — P1 wins! ${diff} dmg. (P0 HP: ${G.players[0].hp})`);
  }
}

// ===== Phase: End =====

export function endTurn(G: GameState): void {
  for (const player of G.players) {
    for (const slot of ['setZoneA', 'setZoneB'] as const) {
      if (player[slot]) {
        sendToZone(player[slot]!, player);
        player[slot] = null;
      }
    }
  }

  for (const playerIdx of [0, 1] as const) {
    const player = G.players[playerIdx];
    const drawCount = player.cardsSetThisTurn;
    if (drawCount > 0) {
      const drawn = drawCards(player, drawCount);
      G.log.push(`P${playerIdx} draws ${drawn.length}.`);
    }
    player.cardsSetThisTurn = 0;
    player.rawAttack = 0;
  }

  G.setCardsThisTurn = { player0: [], player1: [] };
  G.turn++;
  G.log.push(`--- Turn ${G.turn} ---`);
}

// ===== Win Check =====

export function checkGameEnd(G: GameState): string | null {
  if (G.players[0].hp <= 0) return 'Player 1 wins!';
  if (G.players[1].hp <= 0) return 'Player 0 wins!';
  if (G.players[0].deck.length === 0 && G.players[0].hand.length === 0) return 'Player 1 wins! (deck empty)';
  if (G.players[1].deck.length === 0 && G.players[1].hand.length === 0) return 'Player 0 wins! (deck empty)';
  return null;
}
