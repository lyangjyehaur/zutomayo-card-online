import {
  confirmReady,
  getMinimumSetCount,
  getResolvablePendingEffectIndexes,
  resolvePendingEffect,
  setInitialCard,
  setTurnCard,
  submitPendingChoice,
} from '../GameLogic';
import { defaultPendingChoiceOptionIds } from '../pendingChoices';
import type { GameState, PlayerIndex } from '../types';
import { generatePendingChoiceCandidates } from './candidates';
import { choiceOptionHeuristic, effectValue, evaluateState, getAIParsedEffects } from './evaluate';
import { isDecisionTimedOut } from './rng';
import type { AIDecisionContext, AIKnowledgeState, AISelection } from './types';

export interface SimulatedPlanResult {
  state: GameState;
  score: number;
  completedTurn: boolean;
  timedOut: boolean;
}

function bestChoiceFallback(G: GameState, player: PlayerIndex): string[] | null {
  const choice = G.pendingChoice;
  if (!choice || choice.player !== player) return null;
  const candidates = generatePendingChoiceCandidates(choice, 96);
  let best = defaultPendingChoiceOptionIds(choice);
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    const score = choiceOptionHeuristic(choice, candidate, G);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function bestEffectIndex(G: GameState, player: PlayerIndex): number | undefined {
  const legal = getResolvablePendingEffectIndexes(G, player);
  let best: { index: number; score: number } | undefined;
  for (const index of legal) {
    const pending = G.pendingEffects[player][index];
    const score = pending ? effectValue(pending.effect, G, player) : Number.NEGATIVE_INFINITY;
    if (!best || score > best.score) best = { index, score };
  }
  return best?.index;
}

function settleTurn(G: GameState, context: AIDecisionContext): boolean {
  const parsedEffects = getAIParsedEffects();
  for (let iterations = 0; iterations < 80; iterations++) {
    if (G.step === 'gameOver' || G.step === 'turnSet') return true;
    if (isDecisionTimedOut(context)) return false;
    if (G.pendingChoice) {
      const choice = G.pendingChoice;
      const optionIds = bestChoiceFallback(G, choice.player) ?? defaultPendingChoiceOptionIds(choice);
      if (!optionIds || !submitPendingChoice(G, choice.player, optionIds, parsedEffects)) return false;
      continue;
    }
    if (G.step === 'effectOrder' && G.pendingEffectPlayer !== null) {
      const player = G.pendingEffectPlayer;
      const index = bestEffectIndex(G, player);
      if (index === undefined || !resolvePendingEffect(G, player, index, parsedEffects)) return false;
      continue;
    }
    return true;
  }
  return false;
}

function applyPlan(G: GameState, player: PlayerIndex, selections: readonly AISelection[]): boolean {
  const ordered = [...selections].sort((left, right) => {
    if (left.slot !== right.slot) return left.slot === 'A' ? -1 : 1;
    return left.handIndex - right.handIndex;
  });
  for (const selection of ordered) {
    const handIndex = G.players[player].hand.findIndex((card) => card.instanceId === selection.cardInstanceId);
    if (handIndex < 0) return false;
    const placed =
      G.step === 'initialSet'
        ? setInitialCard(G, player, handIndex)
        : setTurnCard(G, player, handIndex, selection.slot);
    if (!placed) return false;
  }
  return true;
}

export function simulateTurnPlan(
  knowledge: AIKnowledgeState,
  selections: readonly AISelection[],
  context: AIDecisionContext,
): SimulatedPlanResult | null {
  const G = structuredClone(knowledge.game) as GameState;
  const { player, opponent } = knowledge;
  const turnBefore = G.turnNumber;
  if (!applyPlan(G, player, selections)) return null;

  // A visible committed opponent plan can be resolved. If they have not yet
  // placed the legal minimum, keep the simulation at the current public state.
  if (!G.ready[opponent] && G.players[opponent].cardsSetThisTurn >= getMinimumSetCount(G, opponent)) {
    G.ready[opponent] = true;
  }
  if (!confirmReady(G, player, getAIParsedEffects())) return null;
  const settled = G.ready[opponent] ? settleTurn(G, context) : true;
  return {
    state: G,
    score: evaluateState(G, player),
    completedTurn: G.turnNumber > turnBefore || G.step === 'gameOver',
    timedOut: !settled && isDecisionTimedOut(context),
  };
}
