import { describe, expect, it } from 'vitest';
import { aiChoiceOptionIds } from '../useAIMoves';
import type { PendingChoice } from '../types';

describe('aiChoiceOptionIds', () => {
  it('consumes one matching option per scripted defId instead of selecting every duplicate', () => {
    const choice = {
      id: 'use-one',
      player: 1,
      type: 'useFromHand',
      min: 1,
      max: 1,
      payload: { sourcePlayer: 1, filter: {} },
      options: [
        { id: 'one', label: 'One', cardDefId: 'same' },
        { id: 'two', label: 'Two', cardDefId: 'same' },
      ],
    } satisfies PendingChoice;

    expect(aiChoiceOptionIds(choice, ['same'])).toEqual(['one']);
  });

  it('falls back to a legal hand/Abyss pair when a script is incomplete', () => {
    const choice = {
      id: 'swap',
      player: 1,
      type: 'handAbyssSwap',
      min: 2,
      max: 2,
      payload: {},
      options: [
        { id: 'hand:h1', label: 'Hand', cardDefId: 'hand-card' },
        { id: 'abyss:a1', label: 'Abyss', cardDefId: 'abyss-card' },
      ],
    } satisfies PendingChoice;

    expect(aiChoiceOptionIds(choice, ['hand-card'])).toEqual(['hand:h1', 'abyss:a1']);
  });
});
