import type { AIDecision } from '../game/ai';

export const AI_DECISION_EVENT = 'zutomayo:ai-decision';
export const AI_DECISION_HISTORY_LIMIT = 25;

export type AIInspectorDecision = AIDecision<unknown>;

export function isAIInspectorDecision(value: unknown): value is AIInspectorDecision {
  if (!value || typeof value !== 'object') return false;
  const decision = value as Partial<AIInspectorDecision>;
  return (
    typeof decision.kind === 'string' &&
    typeof decision.reason === 'string' &&
    typeof decision.score === 'number' &&
    typeof decision.durationMs === 'number' &&
    typeof decision.token === 'string' &&
    Array.isArray(decision.factors)
  );
}

export function appendAIInspectorDecision(
  history: readonly AIInspectorDecision[],
  decision: AIInspectorDecision,
  limit = AI_DECISION_HISTORY_LIMIT,
): AIInspectorDecision[] {
  return [decision, ...history].slice(0, Math.max(1, limit));
}
