import type { GameState, CardInstance, CardDef } from './types';
import { getCardDef } from './cards/loader';
import { getChronosTime, getPlayerPowerExport as getPlayerPower } from './GameLogic';

export type AIDifficulty = 'easy' | 'normal' | 'hard';

// ===== Card Scoring =====

function scoreCard(card: CardInstance, G: GameState, playerIdx: number): number {
  const def = getCardDef(card.defId);
  if (!def) return -100;

  let score = 0;
  const currentTime = getChronosTime(G);
  const power = getPlayerPower(G.players[playerIdx]);

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

// ===== AI Move Selection =====

export function aiSelectCards(
  G: GameState,
  playerIdx: number,
  difficulty: AIDifficulty
): { handIndex: number; slot: 'A' | 'B' }[] {
  const player = G.players[playerIdx];
  const maxCards = G.turn === 0 ? 1 : (G.lastBattleResult.winner === playerIdx ? 1 : 2);

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
    return picks.map((p, i) => ({ handIndex: p.index, slot: i === 0 ? 'A' as const : 'B' as const }));
  }

  if (difficulty === 'normal') {
    // Normal: pick highest scored cards
    const picks = scored.slice(0, maxCards);
    return picks.map((p, i) => ({ handIndex: p.index, slot: i === 0 ? 'A' as const : 'B' as const }));
  }

  // Hard: consider opponent's likely play
  const oppBattleZone = G.players[1 - playerIdx].battleZone;
  const oppDef = oppBattleZone ? getCardDef(oppBattleZone.defId) : null;

  // If we know opponent's character, pick the best counter
  if (oppDef?.attack) {
    const oppAtk = getChronosTime(G) === 'night' ? oppDef.attack.night : oppDef.attack.day;

    // Find the cheapest card that can beat the opponent
    const beaters = scored.filter(s => {
      const def = getCardDef(s.card.defId);
      if (!def?.attack) return false;
      const myAtk = getChronosTime(G) === 'night' ? def.attack.night : def.attack.day;
      return myAtk > oppAtk;
    });

    if (beaters.length > 0) {
      // Pick the cheapest beater (save resources)
      beaters.sort((a, b) => {
        const aDef = getCardDef(a.card.defId)!;
        const bDef = getCardDef(b.card.defId)!;
        return aDef.powerCost - bDef.powerCost;
      });
      const picks = beaters.slice(0, maxCards);
      return picks.map((p, i) => ({ handIndex: p.index, slot: i === 0 ? 'A' as const : 'B' as const }));
    }
  }

  // Fallback: normal strategy
  const picks = scored.slice(0, maxCards);
  return picks.map((p, i) => ({ handIndex: p.index, slot: i === 0 ? 'A' as const : 'B' as const }));
}
