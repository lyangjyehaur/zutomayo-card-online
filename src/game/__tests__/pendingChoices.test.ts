import { describe, expect, it } from 'vitest';
import { pendingChoiceSelectionError } from '../pendingChoices';
import type { PendingChoice } from '../types';

function handAbyssChoice(): Extract<PendingChoice, { type: 'handAbyssSwap' }> {
  return {
    id: 'swap-1',
    player: 0,
    type: 'handAbyssSwap',
    min: 2,
    max: 2,
    payload: {},
    options: [
      { id: 'hand:h1', label: 'Hand 1' },
      { id: 'hand:h2', label: 'Hand 2' },
      { id: 'abyss:a1', label: 'Abyss 1' },
    ],
  };
}

describe('pendingChoiceSelectionError', () => {
  it('accepts one hand card and one abyss card for handAbyssSwap', () => {
    expect(pendingChoiceSelectionError(handAbyssChoice(), ['hand:h1', 'abyss:a1'])).toBeNull();
  });

  it('rejects a same-zone pair before submitting the move', () => {
    expect(pendingChoiceSelectionError(handAbyssChoice(), ['hand:h1', 'hand:h2'])).toBe('handAbyssPair');
  });

  it('rejects duplicate and unknown options', () => {
    expect(pendingChoiceSelectionError(handAbyssChoice(), ['hand:h1', 'hand:h1'])).toBe('duplicate');
    expect(pendingChoiceSelectionError(handAbyssChoice(), ['hand:h1', 'abyss:missing'])).toBe('unknownOption');
  });
});
