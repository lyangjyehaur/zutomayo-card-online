import { getResolvablePendingEffectIndexes, resolvePendingEffect, submitPendingChoice } from '../GameLogic';
import { defaultPendingChoiceOptionIds } from '../pendingChoices';
import type { GameState } from '../types';
import { generatePendingChoiceCandidates } from './candidates';
import { choiceOptionHeuristic, effectValue, evaluateState, getAIParsedEffects } from './evaluate';
import { isDecisionTimedOut, seededShuffle } from './rng';
import type { AIDecision, AIDecisionContext, AIKnowledgeState, AITraceFactor } from './types';

interface RankedAction<T> {
  action: T;
  score: number;
  factors: AITraceFactor[];
}

function chooseRanked<T>(ranked: RankedAction<T>[], context: AIDecisionContext): RankedAction<T> | undefined {
  if (ranked.length === 0) return undefined;
  const sorted = [...ranked].sort((left, right) => right.score - left.score);
  if (context.difficulty !== 'easy') return sorted[0];
  const reasonable = sorted.filter((candidate) => candidate.score >= sorted[0].score - 30);
  return seededShuffle(reasonable, context.rng)[0];
}

export function choosePendingChoice(
  knowledge: AIKnowledgeState,
  context: AIDecisionContext,
): AIDecision<string[]> | null {
  const choice = knowledge.game.pendingChoice;
  if (!choice || choice.player !== knowledge.player) return null;
  const fallback = defaultPendingChoiceOptionIds(choice);
  const candidates = generatePendingChoiceCandidates(choice);
  const before = evaluateState(knowledge.game, knowledge.player);
  const ranked: RankedAction<string[]>[] = [];
  let timedOut = false;
  for (const candidate of candidates) {
    if (isDecisionTimedOut(context)) {
      timedOut = true;
      break;
    }
    const heuristic = choiceOptionHeuristic(choice, candidate, knowledge.game);
    if (context.difficulty === 'easy') {
      ranked.push({ action: candidate, score: heuristic, factors: [{ label: 'choiceHeuristic', value: heuristic }] });
      continue;
    }
    const sim = structuredClone(knowledge.game) as GameState;
    if (!submitPendingChoice(sim, knowledge.player, candidate, getAIParsedEffects())) continue;
    const stateDelta = evaluateState(sim, knowledge.player) - before;
    ranked.push({
      action: candidate,
      score: heuristic + stateDelta,
      factors: [
        { label: 'choiceHeuristic', value: heuristic },
        { label: 'simulatedState', value: stateDelta },
      ],
    });
  }
  const selected = chooseRanked(ranked, context);
  const action = selected?.action ?? fallback;
  if (!action) return null;
  return {
    kind: 'pendingChoice',
    action,
    score: selected?.score ?? 0,
    factors: selected?.factors ?? [{ label: 'legalFallback', value: 0 }],
    reason: selected ? `evaluate-${choice.type}` : 'first-legal-fallback',
    token: `choice:${choice.id}:${action.join(',')}`,
    durationMs: context.now() - context.startedAt,
    ...(timedOut
      ? { fallback: 'choice-budget-exhausted' }
      : selected
        ? {}
        : { fallback: 'no-scored-choice-candidate' }),
  };
}

export function chooseEffectOrder(knowledge: AIKnowledgeState, context: AIDecisionContext): AIDecision<number> | null {
  const legal = getResolvablePendingEffectIndexes(knowledge.game, knowledge.player);
  if (legal.length === 0) return null;
  const before = evaluateState(knowledge.game, knowledge.player);
  const ranked: RankedAction<number>[] = [];
  let timedOut = false;
  for (const index of legal) {
    if (isDecisionTimedOut(context)) {
      timedOut = true;
      break;
    }
    const pending = knowledge.game.pendingEffects[knowledge.player][index];
    if (!pending) continue;
    const immediate = effectValue(pending.effect, knowledge.game, knowledge.player);
    if (context.difficulty === 'easy') {
      ranked.push({ action: index, score: immediate, factors: [{ label: 'effectValue', value: immediate }] });
      continue;
    }
    const sim = structuredClone(knowledge.game) as GameState;
    if (!resolvePendingEffect(sim, knowledge.player, index, getAIParsedEffects())) continue;
    const stateDelta = evaluateState(sim, knowledge.player) - before;
    ranked.push({
      action: index,
      score: immediate + stateDelta,
      factors: [
        { label: 'effectValue', value: immediate, detail: pending.effect.action.type },
        { label: 'simulatedState', value: stateDelta },
      ],
    });
  }
  const selected = chooseRanked(ranked, context) ?? {
    action: legal[0],
    score: 0,
    factors: [{ label: 'legalFallback', value: 0 }],
  };
  const pending = knowledge.game.pendingEffects[knowledge.player][selected.action];
  return {
    kind: 'effectOrder',
    action: selected.action,
    score: selected.score,
    factors: selected.factors,
    reason: pending ? `prioritize-${pending.effect.action.type}` : 'first-legal-fallback',
    token: `effect:${pending?.id ?? selected.action}`,
    durationMs: context.now() - context.startedAt,
    ...(timedOut ? { fallback: 'effect-budget-exhausted' } : pending ? {} : { fallback: 'missing-pending-effect' }),
  };
}
