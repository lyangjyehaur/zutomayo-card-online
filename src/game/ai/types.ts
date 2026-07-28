import type { GameState, PlayerIndex, SetSlot } from '../types';

export type AIDifficulty = 'easy' | 'normal' | 'hard';

export type AIDecisionKind = 'janken' | 'mulligan' | 'turnPlan' | 'effectOrder' | 'pendingChoice';

export interface AITraceFactor {
  label: string;
  value: number;
  detail?: string;
}

export interface AIDecision<T> {
  kind: AIDecisionKind;
  action: T;
  score: number;
  reason: string;
  factors: AITraceFactor[];
  token: string;
  durationMs: number;
  fallback?: string;
}

export interface AISelection {
  cardInstanceId: string;
  handIndex: number;
  slot: SetSlot;
}

export interface AITurnPlan {
  selections: AISelection[];
  decisionToken: string;
}

export interface AIRandom {
  next(): number;
  int(maxExclusive: number): number;
}

export interface AIDecisionOptions {
  seed?: string | number;
  budgetMs?: number;
  now?: () => number;
}

export interface AIDecisionContext {
  difficulty: AIDifficulty;
  rng: AIRandom;
  seed: string | number;
  budgetMs: number;
  startedAt: number;
  now: () => number;
}

export interface AIKnowledgeState {
  readonly game: GameState;
  readonly player: PlayerIndex;
  readonly opponent: PlayerIndex;
  /** Remaining own-deck composition. Order is deliberately destroyed. */
  readonly knownOwnDeckDefIds: readonly string[];
  readonly visibleStateKey: string;
}
