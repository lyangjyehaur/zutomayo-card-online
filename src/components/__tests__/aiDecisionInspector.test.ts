import { describe, expect, it } from 'vitest';
import type { AIDecision } from '../../game/ai';
import { AI_DECISION_HISTORY_LIMIT, appendAIInspectorDecision, isAIInspectorDecision } from '../aiDecisionTraceHistory';

function decision(index: number): AIDecision<unknown> {
  return {
    kind: 'turnPlan',
    action: { index },
    score: index,
    reason: `decision ${index}`,
    factors: [{ label: 'score', value: index }],
    token: `decision-${index}`,
    durationMs: index,
    ...(index === 0 ? { fallback: 'budget' } : {}),
  };
}

describe('AI decision inspector history', () => {
  it('keeps the newest trace first and enforces the history limit', () => {
    const history = Array.from({ length: AI_DECISION_HISTORY_LIMIT + 5 }, (_, index) => decision(index)).reduce(
      (current, item) => appendAIInspectorDecision(current, item),
      [] as AIDecision<unknown>[],
    );

    expect(history).toHaveLength(AI_DECISION_HISTORY_LIMIT);
    expect(history[0].token).toBe(`decision-${AI_DECISION_HISTORY_LIMIT + 4}`);
    expect(history.at(-1)?.token).toBe('decision-5');
  });

  it('rejects malformed browser events while retaining trace factors and fallback', () => {
    const trace = decision(0);

    expect(isAIInspectorDecision(trace)).toBe(true);
    expect(isAIInspectorDecision({ ...trace, factors: null })).toBe(false);
    expect(isAIInspectorDecision({ reason: 'partial' })).toBe(false);
    expect(appendAIInspectorDecision([], trace)[0]).toMatchObject({
      fallback: 'budget',
      factors: [{ label: 'score', value: 0 }],
    });
  });
});
