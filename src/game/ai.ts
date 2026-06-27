import type { GameState, CardInstance, PlayerIndex, SetSlot } from './types';
import type { ParsedEffect } from './effects';
import { getCardDef } from './cards/loader';
import {
  advanceChronos,
  getChronosTime,
  getPlayerPower,
  getRequiredSetCount,
  placeRevealedCards,
  resolveBattle,
  revealCards,
} from './GameLogic';

export type AIDifficulty = 'easy' | 'normal' | 'hard';

// ===== Card Scoring =====

function scoreCard(card: CardInstance, G: GameState, playerIdx: number): number {
  const def = getCardDef(card.defId);
  if (!def) return -100;

  let score = 0;
  const currentTime = getChronosTime(G);
  const power = getPlayerPower(G.players[playerIdx], G, playerIdx as PlayerIndex);

  if (def.type === 'Character' && def.attack) {
    // Prefer characters with high attack for current time
    const atk = currentTime === 'night' ? def.attack.night : def.attack.day;
    score += atk;

    // Bonus if power cost is met
    if (power >= def.powerCost) {
      score += 20;
    } else {
      // Penalty if power cost not met (attack becomes 0)
      score -= 50;
    }

    // Clock value consideration (lower is better for advancing time strategically)
    score -= def.clock * 3;
  } else {
    // Enchant/Area Enchant: prefer if we have power to use them
    if (power >= def.powerCost) {
      score += 30;
    }
    // Prefer cards with effects
    if (def.effect) score += 10;
  }

  return score;
}

// ===== Hard Lookahead =====

interface AISelection {
  handIndex: number;
  slot: SetSlot;
}

interface LookaheadResult {
  selections: AISelection[];
  differential: number;
  damageDealt: number;
  damageReceived: number;
  heuristicScore: number;
}

function combinations<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [[]];
  if (size > items.length) return [];
  const result: T[][] = [];
  const walk = (start: number, picked: T[]) => {
    if (picked.length === size) {
      result.push([...picked]);
      return;
    }
    for (let i = start; i <= items.length - (size - picked.length); i++) {
      picked.push(items[i]);
      walk(i + 1, picked);
      picked.pop();
    }
  };
  walk(0, []);
  return result;
}

function assignments(indices: number[], slots: SetSlot[]): AISelection[][] {
  if (indices.length === 0) return [[]];
  const result: AISelection[][] = [];
  const walk = (remainingIndices: number[], remainingSlots: SetSlot[], picked: AISelection[]) => {
    if (remainingIndices.length === 0) {
      result.push([...picked]);
      return;
    }
    const [handIndex, ...nextIndices] = remainingIndices;
    for (let i = 0; i < remainingSlots.length; i++) {
      const slot = remainingSlots[i];
      walk(
        nextIndices,
        remainingSlots.filter((_, slotIndex) => slotIndex !== i),
        [...picked, { handIndex, slot }],
      );
    }
  };
  walk(indices, slots, []);
  return result;
}

function sortSelectionsForPlayOrder(selections: AISelection[]): AISelection[] {
  return [...selections].sort((a, b) => {
    if (a.slot !== b.slot) return a.slot === 'A' ? -1 : 1;
    return a.handIndex - b.handIndex;
  });
}

function availableSetSlots(G: GameState, playerIdx: PlayerIndex): SetSlot[] {
  const player = G.players[playerIdx];
  if (G.step === 'initialSet') return player.setZoneA ? [] : ['A'];
  const slots: SetSlot[] = [];
  if (!player.setZoneA) slots.push('A');
  if (!player.setZoneB) slots.push('B');
  return slots;
}

function simulateBattle(
  G: GameState,
  playerIdx: PlayerIndex,
  selections: AISelection[],
): { damageDealt: number; damageReceived: number; differential: number } | null {
  const sim = structuredClone(G) as GameState;
  const player = sim.players[playerIdx];

  for (const selection of selections) {
    const zone = selection.slot === 'A' ? 'setZoneA' : 'setZoneB';
    if (player[zone]) return null;
    const card = player.hand[selection.handIndex];
    if (!card) return null;
    card.faceUp = false;
    player[zone] = card;
    sim.setCardsThisTurn[playerIdx].push(card);
  }

  for (const handIndex of [...selections].map((selection) => selection.handIndex).sort((a, b) => b - a)) {
    player.hand.splice(handIndex, 1);
  }

  const initial = sim.step === 'initialSet' || sim.turnNumber === 1;
  const emptyEffects = new Map<string, ParsedEffect[]>();
  const beforeHp = [sim.players[0].hp, sim.players[1].hp] as const;
  revealCards(sim);
  if (initial) {
    placeRevealedCards(sim, true, emptyEffects);
    advanceChronos(sim, emptyEffects);
  } else {
    advanceChronos(sim, emptyEffects);
    placeRevealedCards(sim, false, emptyEffects);
  }
  resolveBattle(sim, emptyEffects);

  const opponentIdx = (1 - playerIdx) as PlayerIndex;
  const damageDealt = beforeHp[opponentIdx] - sim.players[opponentIdx].hp;
  const damageReceived = beforeHp[playerIdx] - sim.players[playerIdx].hp;
  return {
    damageDealt,
    damageReceived,
    differential: damageDealt - damageReceived,
  };
}

function compareLookahead(a: LookaheadResult, b: LookaheadResult): number {
  if (a.differential !== b.differential) return a.differential - b.differential;
  if (a.damageDealt !== b.damageDealt) return a.damageDealt - b.damageDealt;
  if (a.damageReceived !== b.damageReceived) return b.damageReceived - a.damageReceived;
  if (a.heuristicScore !== b.heuristicScore) return a.heuristicScore - b.heuristicScore;
  const aFirst = sortSelectionsForPlayOrder(a.selections)[0];
  const bFirst = sortSelectionsForPlayOrder(b.selections)[0];
  if (aFirst.slot !== bFirst.slot) return aFirst.slot === 'A' ? 1 : -1;
  return bFirst.handIndex - aFirst.handIndex;
}

function hardLookahead(G: GameState, playerIdx: PlayerIndex): AISelection[] {
  const player = G.players[playerIdx];
  const required = getRequiredSetCount(G, playerIdx);
  const remaining = Math.max(0, required - player.cardsSetThisTurn);
  const cardsToSet = Math.min(remaining, player.hand.length);
  const slots = availableSetSlots(G, playerIdx);
  if (cardsToSet === 0 || slots.length < cardsToSet) return [];

  let best: LookaheadResult | null = null;
  const handIndices = player.hand.map((_, index) => index);
  for (const combo of combinations(handIndices, cardsToSet)) {
    for (const assignment of assignments(combo, slots)) {
      const result = simulateBattle(G, playerIdx, assignment);
      if (!result) continue;
      const candidate: LookaheadResult = {
        selections: assignment,
        ...result,
        heuristicScore: assignment.reduce(
          (sum, selection) => sum + scoreCard(player.hand[selection.handIndex], G, playerIdx),
          0,
        ),
      };
      if (!best || compareLookahead(candidate, best) > 0) best = candidate;
    }
  }

  return best ? sortSelectionsForPlayOrder(best.selections) : [];
}

// ===== AI Move Selection =====

export function aiSelectCards(
  G: GameState,
  playerIdx: number,
  difficulty: AIDifficulty,
): { handIndex: number; slot: 'A' | 'B' }[] {
  const aiPlayerIdx = playerIdx as PlayerIndex;
  const player = G.players[playerIdx];
  const maxCards = Math.max(0, getRequiredSetCount(G, aiPlayerIdx) - player.cardsSetThisTurn);
  const pickSlots = availableSetSlots(G, aiPlayerIdx);

  if (player.hand.length === 0) return [];

  // Score all cards in hand
  const scored = player.hand.map((card, index) => ({
    card,
    index,
    score: scoreCard(card, G, playerIdx),
  }));

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  if (difficulty === 'easy') {
    // Easy: random with slight preference for characters
    const shuffled = [...scored].sort(() => Math.random() - 0.5);
    const picks = shuffled.slice(0, maxCards);
    return picks.map((p, i) => ({
      handIndex: p.index,
      slot: pickSlots[i] ?? (i === 0 ? ('A' as const) : ('B' as const)),
    }));
  }

  if (difficulty === 'normal') {
    // Normal: pick highest scored cards
    const picks = scored.slice(0, maxCards);
    return picks.map((p, i) => ({
      handIndex: p.index,
      slot: pickSlots[i] ?? (i === 0 ? ('A' as const) : ('B' as const)),
    }));
  }

  const lookahead = hardLookahead(G, aiPlayerIdx);
  if (lookahead.length > 0) return lookahead;

  // Fallback: normal strategy
  const picks = scored.slice(0, maxCards);
  return picks.map((p, i) => ({
    handIndex: p.index,
    slot: pickSlots[i] ?? (i === 0 ? ('A' as const) : ('B' as const)),
  }));
}
