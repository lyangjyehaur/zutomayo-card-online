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

function bestChoiceFallback(G: GameState, player: PlayerIndex, context: AIDecisionContext): string[] | null {
  const choice = G.pendingChoice;
  if (!choice || choice.player !== player) return null;
  const candidates = generatePendingChoiceCandidates(choice, 96);
  let best = defaultPendingChoiceOptionIds(choice);
  let bestScore = Number.NEGATIVE_INFINITY;
  const before = evaluateState(G, player);
  for (const candidate of candidates) {
    if (isDecisionTimedOut(context)) break;
    const sim = structuredClone(G) as GameState;
    if (!submitPendingChoice(sim, player, candidate, getAIParsedEffects())) continue;
    const score = choiceOptionHeuristic(choice, candidate, G) + evaluateState(sim, player) - before;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function bestEffectIndex(G: GameState, player: PlayerIndex, context: AIDecisionContext): number | undefined {
  const legal = getResolvablePendingEffectIndexes(G, player);
  let best: { index: number; score: number } | undefined;
  const before = evaluateState(G, player);
  for (const index of legal) {
    if (isDecisionTimedOut(context)) break;
    const pending = G.pendingEffects[player][index];
    if (!pending) continue;
    const sim = structuredClone(G) as GameState;
    if (!resolvePendingEffect(sim, player, index, getAIParsedEffects())) continue;
    const score = effectValue(pending.effect, G, player) + evaluateState(sim, player) - before;
    if (!best || score > best.score) best = { index, score };
  }
  return best?.index;
}

export function settleDecisionChain(G: GameState, context: AIDecisionContext): boolean {
  const parsedEffects = getAIParsedEffects();
  for (let iterations = 0; iterations < 80; iterations++) {
    if (G.step === 'gameOver' || G.step === 'turnSet') return true;
    if (isDecisionTimedOut(context)) return false;
    if (G.pendingChoice) {
      const choice = G.pendingChoice;
      const optionIds = bestChoiceFallback(G, choice.player, context) ?? defaultPendingChoiceOptionIds(choice);
      if (!optionIds || !submitPendingChoice(G, choice.player, optionIds, parsedEffects)) return false;
      continue;
    }
    if (G.step === 'effectOrder' && G.pendingEffectPlayer !== null) {
      const player = G.pendingEffectPlayer;
      const index = bestEffectIndex(G, player, context);
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
  opponentSelections: readonly AISelection[] = [],
): SimulatedPlanResult | null {
  const G = structuredClone(knowledge.game) as GameState;
  const { player, opponent } = knowledge;
  const turnBefore = G.turnNumber;
  if (!applyPlan(G, player, selections)) return null;

  if (!G.ready[opponent] && G.players[opponent].cardsSetThisTurn < getMinimumSetCount(G, opponent)) {
    if (opponentSelections.length === 0 || !applyPlan(G, opponent, opponentSelections)) return null;
  }
  if (!G.ready[opponent] && !confirmReady(G, opponent, getAIParsedEffects())) return null;
  if (!confirmReady(G, player, getAIParsedEffects())) return null;
  const settled = settleDecisionChain(G, context);
  return {
    state: G,
    score: evaluateState(G, player),
    completedTurn: G.turnNumber > turnBefore || G.step === 'gameOver',
    timedOut: !settled && isDecisionTimedOut(context),
  };
}
