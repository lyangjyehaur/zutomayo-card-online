import { describe, expect, it } from 'vitest';
import {
  formatQuickMatchWait,
  quickMatchWaitSeconds,
  QUICK_MATCH_LONG_WAIT_MS,
  shouldOfferQuickMatchFallback,
} from '../matchmakingWait';

describe('quick match wait helpers', () => {
  it('formats elapsed queue time without negative values', () => {
    expect(quickMatchWaitSeconds(10_000, 9_000)).toBe(0);
    expect(quickMatchWaitSeconds(10_000, 75_999)).toBe(65);
    expect(formatQuickMatchWait(0)).toBe('00:00');
    expect(formatQuickMatchWait(65)).toBe('01:05');
  });

  it('offers a fallback at the long-wait decision point', () => {
    const thresholdSeconds = QUICK_MATCH_LONG_WAIT_MS / 1_000;
    expect(shouldOfferQuickMatchFallback(thresholdSeconds - 1)).toBe(false);
    expect(shouldOfferQuickMatchFallback(thresholdSeconds)).toBe(true);
  });
});
