import { getCardsRevision } from '../cards/loader';

const MAX_ENTRIES = 128;
const cache = new Map<string, number>();

export function planEvaluationCacheKey(
  visibleStateKey: string,
  planToken: string,
  seed: string | number,
  sampleCount: number,
): string {
  return `cards:${getCardsRevision()}|${visibleStateKey}|plan:${planToken}|seed:${seed}|samples:${sampleCount}`;
}

export function getCachedPlanEvaluation(key: string): number | undefined {
  const value = cache.get(key);
  if (value === undefined) return undefined;
  cache.delete(key);
  cache.set(key, value);
  return value;
}

export function setCachedPlanEvaluation(key: string, value: number): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function clearPlanEvaluationCache(): void {
  cache.clear();
}
