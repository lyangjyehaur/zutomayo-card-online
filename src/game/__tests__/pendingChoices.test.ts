import { describe, expect, it } from 'vitest';
import { defaultPendingChoiceOptionIds, pendingChoiceSelectionError } from '../pendingChoices';
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

  it('builds the minimum legal timeout selection for compound and optional choices', () => {
    expect(defaultPendingChoiceOptionIds(handAbyssChoice())).toEqual(['hand:h1', 'abyss:a1']);
    expect(
      defaultPendingChoiceOptionIds({
        id: 'optional',
        player: 0,
        type: 'cardMove',
        min: 0,
        max: 1,
        payload: {
          sourcePlayer: 0,
          sourceZone: 'hand',
          destinationPlayer: 0,
          destinationZone: 'abyss',
        },
        options: [{ id: 'card-1', label: 'Card 1' }],
      }),
    ).toEqual([]);
  });
});
