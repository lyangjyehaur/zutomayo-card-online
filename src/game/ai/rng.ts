import type { AIDecisionContext, AIDecisionKind, AIDecisionOptions, AIDifficulty, AIRandom } from './types';
import type { GameState, PlayerIndex } from '../types';

function hashSeed(seed: string | number): number {
  const value = String(seed);
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createSeededRng(seed: string | number): AIRandom {
  let state = hashSeed(seed) || 0x6d2b79f5;
  return {
    next() {
      state += 0x6d2b79f5;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    },
    int(maxExclusive: number) {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) return 0;
      return Math.floor(this.next() * maxExclusive);
    },
  };
}

export function seededShuffle<T>(items: readonly T[], rng: AIRandom): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const swapIndex = rng.int(index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function decisionSeed(G: GameState, player: PlayerIndex, kind: AIDecisionKind): string {
  const own = G.players[player];
  const choiceKey = G.pendingChoice?.id ?? '';
  const effectKey = G.pendingEffects[player].map((effect) => effect.id).join(',');
  const handKey = own.hand.map((card) => card.instanceId).join(',');
  return [G.matchStartedAt, player, kind, G.turnNumber, G.step, G.jankenDrawCount, handKey, choiceKey, effectKey].join(
    '|',
  );
}

export function createDecisionContext(
  difficulty: AIDifficulty,
  fallbackSeed: string,
  options: AIDecisionOptions = {},
): AIDecisionContext {
  const now = options.now ?? (() => performance.now());
  const seed = options.seed ?? fallbackSeed;
  const defaultBudget = difficulty === 'hard' ? 300 : 50;
  return {
    difficulty,
    rng: createSeededRng(seed),
    seed,
    budgetMs: Math.max(1, options.budgetMs ?? defaultBudget),
    startedAt: now(),
    now,
  };
}

export function isDecisionTimedOut(context: AIDecisionContext): boolean {
  return context.now() - context.startedAt >= context.budgetMs;
}
