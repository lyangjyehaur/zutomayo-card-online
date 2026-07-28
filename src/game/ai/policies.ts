import { createAIKnowledgeState } from './knowledge';
import { generateTurnPlans, stablePlanToken } from './candidates';
import { scoreCard } from './evaluate';
import { isDecisionTimedOut, seededShuffle } from './rng';
import { simulateTurnPlan } from './simulator';
import type { AIDecision, AIDecisionContext, AIKnowledgeState, AISelection, AITraceFactor, AITurnPlan } from './types';

interface RankedPlan {
  selections: AISelection[];
  score: number;
  factors: AITraceFactor[];
}

function heuristicPlan(knowledge: AIKnowledgeState, selections: AISelection[]): RankedPlan {
  const totalClock = selections.reduce((sum, selection) => {
    const card = knowledge.game.players[knowledge.player].hand[selection.handIndex];
    const definition = card ? scoreCard(card, knowledge.game, knowledge.player) : null;
    const clockFactor = definition?.factors.find((factor) => factor.label === 'chronos');
    return sum + Number(clockFactor?.detail ?? 0);
  }, 0);
  const cardFactors = selections.map((selection) => {
    const card = knowledge.game.players[knowledge.player].hand[selection.handIndex];
    return card
      ? scoreCard(card, knowledge.game, knowledge.player, totalClock)
      : { score: -1000, factors: [{ label: 'missingCard', value: -1000 }] };
  });
  const cardScore = cardFactors.reduce((sum, evaluated) => sum + evaluated.score, 0);
  const planDepth = selections.length * 6;
  return {
    selections,
    score: cardScore + planDepth,
    factors: [
      { label: 'cardQuality', value: cardScore },
      { label: 'completePlan', value: planDepth, detail: `${selections.length}` },
    ],
  };
}

function bestHeuristicPlan(knowledge: AIKnowledgeState, plans: AISelection[][]): RankedPlan | null {
  let best: RankedPlan | null = null;
  for (const plan of plans) {
    const candidate = heuristicPlan(knowledge, plan);
    if (!best || candidate.score > best.score) best = candidate;
  }
  return best;
}

function projectedNextTurnValue(state: ReturnType<typeof createAIKnowledgeState>): number {
  if (state.game.step !== 'turnSet' || state.game.ready[state.player]) return 0;
  const futurePlans = generateTurnPlans(state);
  return bestHeuristicPlan(state, futurePlans)?.score ?? 0;
}

function chooseEasyPlan(
  knowledge: AIKnowledgeState,
  plans: AISelection[][],
  context: AIDecisionContext,
): RankedPlan | null {
  const ranked = plans.map((plan) => heuristicPlan(knowledge, plan)).sort((left, right) => right.score - left.score);
  if (ranked.length === 0) return null;
  const threshold = ranked[0].score - Math.max(35, Math.abs(ranked[0].score) * 0.35);
  const reasonable = ranked.filter((candidate) => candidate.score >= threshold);
  return seededShuffle(reasonable, context.rng)[0] ?? ranked[0];
}

function chooseHardPlan(
  knowledge: AIKnowledgeState,
  plans: AISelection[][],
  context: AIDecisionContext,
  fallback: RankedPlan,
): { plan: RankedPlan; fallback?: string } {
  let best: RankedPlan | null = null;
  const searchOrder = [...plans].sort((left, right) => right.length - left.length);
  for (const selections of searchOrder) {
    if (isDecisionTimedOut(context)) return { plan: best ?? fallback, fallback: 'search-budget-exhausted' };
    const heuristic = heuristicPlan(knowledge, selections);
    const simulation = simulateTurnPlan(knowledge, selections, context);
    if (!simulation) continue;
    const futureKnowledge = createAIKnowledgeState(simulation.state, knowledge.player);
    const future = simulation.completedTurn ? projectedNextTurnValue(futureKnowledge) * 0.2 : 0;
    const score = simulation.score + heuristic.score * 0.2 + future;
    const candidate: RankedPlan = {
      selections,
      score,
      factors: [
        { label: 'simulatedState', value: simulation.score },
        { label: 'immediatePlan', value: heuristic.score * 0.2 },
        { label: 'nextTurnPotential', value: future },
      ],
    };
    if (!best || candidate.score > best.score) best = candidate;
    if (simulation.timedOut) return { plan: best ?? fallback, fallback: 'simulation-budget-exhausted' };
  }
  return { plan: best ?? fallback, ...(best ? {} : { fallback: 'no-legal-simulation' }) };
}

export function chooseTurnPlan(knowledge: AIKnowledgeState, context: AIDecisionContext): AIDecision<AITurnPlan> {
  const plans = generateTurnPlans(knowledge);
  const empty: RankedPlan = { selections: [], score: -1000, factors: [{ label: 'noLegalPlan', value: -1000 }] };
  const normalFallback = bestHeuristicPlan(knowledge, plans) ?? empty;
  let selected: RankedPlan;
  let fallback: string | undefined;
  if (context.difficulty === 'easy') {
    selected = chooseEasyPlan(knowledge, plans, context) ?? normalFallback;
  } else if (context.difficulty === 'hard') {
    const hard = chooseHardPlan(knowledge, plans, context, normalFallback);
    selected = hard.plan;
    fallback = hard.fallback;
  } else {
    selected = normalFallback;
  }
  const decisionToken = stablePlanToken(knowledge, selected.selections);
  return {
    kind: 'turnPlan',
    action: { selections: selected.selections, decisionToken },
    score: selected.score,
    factors: selected.factors,
    reason:
      context.difficulty === 'hard' && !fallback
        ? 'bounded-rules-simulation'
        : context.difficulty === 'easy'
          ? 'seeded-reasonable-candidate'
          : 'effect-aware-turn-score',
    token: decisionToken,
    durationMs: context.now() - context.startedAt,
    ...(fallback ? { fallback } : {}),
  };
}
