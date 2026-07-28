import type { JankenChoice, PlayerIndex, SetSlot } from './types';
import type { GameState } from './types';
import { chooseEffectOrder, choosePendingChoice } from './ai/choices';
import { createAIKnowledgeState } from './ai/knowledge';
import { chooseMulligan } from './ai/mulligan';
import { chooseTurnPlan } from './ai/policies';
import { createDecisionContext, decisionSeed } from './ai/rng';
import type { AIDecision, AIDecisionOptions, AIDifficulty, AITurnPlan } from './ai/types';

export type {
  AIDecision,
  AIDecisionKind,
  AIDecisionOptions,
  AIDifficulty,
  AIKnowledgeState,
  AISelection,
  AITraceFactor,
  AITurnPlan,
} from './ai/types';
export { createAIKnowledgeState } from './ai/knowledge';
export { createSeededRng, seededShuffle } from './ai/rng';

function playerIndex(player: number): PlayerIndex {
  return player === 0 ? 0 : 1;
}

export function aiPlanTurn(
  G: GameState,
  player: number,
  difficulty: AIDifficulty,
  options: AIDecisionOptions = {},
): AIDecision<AITurnPlan> {
  const index = playerIndex(player);
  const knowledge = createAIKnowledgeState(G, index);
  const context = createDecisionContext(difficulty, decisionSeed(knowledge.game, index, 'turnPlan'), options);
  return chooseTurnPlan(knowledge, context);
}

export function aiSelectCards(
  G: GameState,
  player: number,
  difficulty: AIDifficulty,
  options: AIDecisionOptions = {},
): { handIndex: number; slot: SetSlot }[] {
  return aiPlanTurn(G, player, difficulty, options).action.selections.map(({ handIndex, slot }) => ({
    handIndex,
    slot,
  }));
}

export function aiSelectMulligan(
  G: GameState,
  player: number,
  difficulty: AIDifficulty,
  options: AIDecisionOptions = {},
): AIDecision<number[]> {
  const index = playerIndex(player);
  const knowledge = createAIKnowledgeState(G, index);
  const context = createDecisionContext(difficulty, decisionSeed(knowledge.game, index, 'mulligan'), options);
  return chooseMulligan(knowledge, context);
}

export function aiSelectPendingChoice(
  G: GameState,
  player: number,
  difficulty: AIDifficulty,
  options: AIDecisionOptions = {},
): AIDecision<string[]> | null {
  const index = playerIndex(player);
  const knowledge = createAIKnowledgeState(G, index);
  const context = createDecisionContext(difficulty, decisionSeed(knowledge.game, index, 'pendingChoice'), options);
  return choosePendingChoice(knowledge, context);
}

export function aiSelectEffect(
  G: GameState,
  player: number,
  difficulty: AIDifficulty,
  options: AIDecisionOptions = {},
): AIDecision<number> | null {
  const index = playerIndex(player);
  const knowledge = createAIKnowledgeState(G, index);
  const context = createDecisionContext(difficulty, decisionSeed(knowledge.game, index, 'effectOrder'), options);
  return chooseEffectOrder(knowledge, context);
}

export function aiSelectJanken(
  G: GameState,
  player: number,
  difficulty: AIDifficulty,
  options: AIDecisionOptions = {},
): AIDecision<JankenChoice> {
  const index = playerIndex(player);
  const knowledge = createAIKnowledgeState(G, index);
  const context = createDecisionContext(difficulty, decisionSeed(knowledge.game, index, 'janken'), options);
  const choices: JankenChoice[] = ['rock', 'paper', 'scissors'];
  const action = choices[context.rng.int(choices.length)];
  return {
    kind: 'janken',
    action,
    score: 0,
    reason: 'seeded-hidden-simultaneous-choice',
    factors: [{ label: 'uniformChoice', value: 0 }],
    token: `janken:${G.turnNumber}:${G.jankenDrawCount}:${action}`,
    durationMs: context.now() - context.startedAt,
  };
}
