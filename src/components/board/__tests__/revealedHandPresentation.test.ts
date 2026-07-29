import { describe, expect, it } from 'vitest';
import { shouldRevealCardsInOpponentHand } from '../revealedHandPresentation';

describe('revealed hand presentation', () => {
  it('uses the existing opponent hand area on desktop', () => {
    expect(shouldRevealCardsInOpponentHand('desktop', 'hand')).toBe(true);
  });

  it.each(['mobile', 'tabletPortrait'] as const)('uses a focused panel on %s', (viewportMode) => {
    expect(shouldRevealCardsInOpponentHand(viewportMode, 'hand')).toBe(false);
  });

  it('keeps deck-top reveals in a focused panel because no hand slot represents them', () => {
    expect(shouldRevealCardsInOpponentHand('desktop', 'deck')).toBe(false);
  });
});
