import { getCardDef } from '../cards/loader';
import { getMinimumSetCount, getRequiredSetCount } from '../GameLogic';
import type { PendingChoice, SetSlot } from '../types';
import type { AIKnowledgeState, AISelection } from './types';
import { pendingChoiceSelectionError } from '../pendingChoices';

export function combinations<T>(items: readonly T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (size < 0 || size > items.length) return [];
  const result: T[][] = [];
  const walk = (start: number, picked: T[]) => {
    if (picked.length === size) {
      result.push([...picked]);
      return;
    }
    for (let index = start; index <= items.length - (size - picked.length); index++) {
      picked.push(items[index]);
      walk(index + 1, picked);
      picked.pop();
    }
  };
  walk(0, []);
  return result;
}

function limitedCombinations<T>(items: readonly T[], size: number, limit: number): T[][] {
  const result: T[][] = [];
  const walk = (start: number, picked: T[]) => {
    if (result.length >= limit) return;
    if (picked.length === size) {
      result.push([...picked]);
      return;
    }
    for (let index = start; index <= items.length - (size - picked.length); index++) {
      picked.push(items[index]);
      walk(index + 1, picked);
      picked.pop();
      if (result.length >= limit) return;
    }
  };
  walk(0, []);
  return result;
}

function limitedPermutations<T>(items: readonly T[], limit: number): T[][] {
  const result: T[][] = [];
  const walk = (remaining: readonly T[], picked: T[]) => {
    if (result.length >= limit) return;
    if (remaining.length === 0) {
      result.push([...picked]);
      return;
    }
    for (let index = 0; index < remaining.length; index++) {
      picked.push(remaining[index]);
      walk(
        remaining.filter((_, itemIndex) => itemIndex !== index),
        picked,
      );
      picked.pop();
      if (result.length >= limit) return;
    }
  };
  walk(items, []);
  return result;
}

export function availableSetSlots(knowledge: AIKnowledgeState): SetSlot[] {
  const { game: G, player } = knowledge;
  const state = G.players[player];
  if (G.step === 'initialSet') return state.battleZone ? [] : ['A'];
  const slots: SetSlot[] = [];
  if (!state.setZoneA) slots.push('A');
  if (!state.setZoneB) slots.push('B');
  return slots;
}

function assignSlots(indices: number[], slots: SetSlot[]): AISelection[][] {
  if (indices.length === 0) return [[]];
  const [handIndex, ...rest] = indices;
  return slots.flatMap((slot, slotIndex) =>
    assignSlots(
      rest,
      slots.filter((_, index) => index !== slotIndex),
    ).map((selections) => [{ cardInstanceId: '', handIndex, slot }, ...selections]),
  );
}

export function generateTurnPlans(knowledge: AIKnowledgeState): AISelection[][] {
  const { game: G, player } = knowledge;
  const state = G.players[player];
  const slots = availableSetSlots(knowledge);
  const legalIndices = state.hand.flatMap((card, index) => {
    const def = getCardDef(card.defId);
    if (def?.type === 'Area Enchant' && G.areaEnchantSetLocked[player]) return [];
    return [index];
  });
  const minimumRemaining = Math.max(0, getMinimumSetCount(G, player) - state.cardsSetThisTurn);
  const maximumRemaining = Math.min(
    slots.length,
    legalIndices.length,
    Math.max(0, getRequiredSetCount(G, player) - state.cardsSetThisTurn),
  );
  if (minimumRemaining > maximumRemaining) return [];

  const plans: AISelection[][] = [];
  for (let count = minimumRemaining; count <= maximumRemaining; count++) {
    for (const indices of combinations(legalIndices, count)) {
      for (const assigned of assignSlots(indices, slots)) {
        plans.push(
          assigned.map((selection) => ({
            ...selection,
            cardInstanceId: state.hand[selection.handIndex].instanceId,
          })),
        );
      }
    }
  }
  return plans;
}

export function generatePendingChoiceCandidates(choice: PendingChoice, limit = 192): string[][] {
  const ids = choice.options.map((option) => option.id);
  let candidates: string[][] = [];
  if (choice.type === 'handAbyssSwap') {
    const hands = ids.filter((id) => id.startsWith('hand:'));
    const abysses = ids.filter((id) => id.startsWith('abyss:'));
    for (const hand of hands) {
      for (const abyss of abysses) {
        candidates.push([hand, abyss]);
        if (candidates.length >= limit) break;
      }
      if (candidates.length >= limit) break;
    }
  } else if (choice.type === 'reorderOpponentDeckTop') {
    candidates = limitedPermutations(ids, limit).filter(
      (candidate) => candidate.length >= choice.min && candidate.length <= choice.max,
    );
  } else {
    for (let count = choice.min; count <= Math.min(choice.max, ids.length); count++) {
      candidates.push(...limitedCombinations(ids, count, limit - candidates.length));
      if (candidates.length >= limit) break;
    }
  }
  return candidates.filter((candidate) => !pendingChoiceSelectionError(choice, candidate)).slice(0, Math.max(1, limit));
}

export function stablePlanToken(knowledge: AIKnowledgeState, selections: readonly AISelection[]): string {
  return `${knowledge.game.turnNumber}:${knowledge.game.step}:${selections
    .map((selection) => `${selection.cardInstanceId}@${selection.slot}`)
    .join(',')}`;
}
