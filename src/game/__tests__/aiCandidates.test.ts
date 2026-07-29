import { describe, expect, it } from 'vitest';
import { generatePendingChoiceCandidates } from '../ai/candidates';
import { defaultPendingChoiceOptionIds, pendingChoiceSelectionError } from '../pendingChoices';
import type { PendingChoice } from '../types';

const choices: PendingChoice[] = [
  {
    id: 'hand-bottom',
    player: 0,
    type: 'handToDeckBottomThenDraw',
    min: 1,
    max: 1,
    payload: { drawCount: 1 },
    options: [{ id: 'hand-1', label: 'hand' }],
  },
  {
    id: 'card-move',
    player: 0,
    type: 'cardMove',
    min: 1,
    max: 1,
    payload: { sourcePlayer: 0, sourceZone: 'hand', destinationPlayer: 0, destinationZone: 'abyss' },
    options: [{ id: 'move-1', label: 'move' }],
  },
  {
    id: 'optional-move',
    player: 0,
    type: 'optionalHandMoveThenDraw',
    min: 0,
    max: 1,
    payload: {
      sourcePlayer: 0,
      sourceZone: 'hand',
      destinationPlayer: 0,
      destinationZone: 'abyss',
      drawCount: 'selected',
      filter: {},
    },
    options: [{ id: 'optional-1', label: 'optional' }],
  },
  {
    id: 'abyss-bottom',
    player: 0,
    type: 'abyssToDeckBottomOrLose',
    min: 1,
    max: 1,
    payload: { faceDown: true, shuffle: true },
    options: [{ id: 'abyss-1', label: 'abyss' }],
  },
  {
    id: 'reorder',
    player: 0,
    type: 'reorderOpponentDeckTop',
    min: 2,
    max: 2,
    payload: { targetPlayer: 1, count: 2 },
    options: [
      { id: 'deck-1', label: 'one' },
      { id: 'deck-2', label: 'two' },
    ],
  },
  {
    id: 'power-swap',
    player: 0,
    type: 'opponentPowerCharacterSwap',
    min: 1,
    max: 1,
    payload: { opponentPlayer: 1 },
    options: [{ id: 'power-1', label: 'power' }],
  },
  {
    id: 'use-abyss',
    player: 0,
    type: 'useFromAbyss',
    min: 1,
    max: 1,
    payload: { sourcePlayer: 0, sourceZone: 'abyss' },
    options: [{ id: 'abyss-use-1', label: 'use' }],
  },
  {
    id: 'use-hand',
    player: 0,
    type: 'useFromHand',
    min: 1,
    max: 1,
    payload: { sourcePlayer: 0, filter: {} },
    options: [{ id: 'hand-use-1', label: 'use' }],
  },
  {
    id: 'reveal-boost',
    player: 0,
    type: 'revealHandAttackBoost',
    min: 1,
    max: 1,
    payload: { sourcePlayer: 0, boostPerCard: 10, filter: {} },
    options: [{ id: 'reveal-1', label: 'reveal' }],
  },
  {
    id: 'guess',
    player: 0,
    type: 'declareOpponentHandCardName',
    min: 1,
    max: 1,
    payload: { opponentPlayer: 1, attackBoost: 20 },
    options: [
      {
        id: 'declare:test-character-1',
        label: 'guess',
        value: 'test-character-1',
        cardDefId: 'test-character-1',
      },
    ],
  },
  {
    id: 'swap',
    player: 0,
    type: 'handAbyssSwap',
    min: 2,
    max: 2,
    payload: {},
    options: [
      { id: 'hand:hand-1', label: 'hand' },
      { id: 'abyss:abyss-1', label: 'abyss' },
    ],
  },
  {
    id: 'clock-position',
    player: 0,
    type: 'clockPosition',
    min: 1,
    max: 1,
    payload: {},
    options: [{ id: 'position-1', label: 'position', value: 6 }],
  },
  {
    id: 'clock-advance',
    player: 0,
    type: 'clockAdvance',
    min: 1,
    max: 1,
    payload: {},
    options: [{ id: 'advance-1', label: 'advance', value: 3 }],
  },
];

describe('AI PendingChoice candidates', () => {
  it.each(choices)('generates a legal strategy candidate and fallback for $type', (choice) => {
    const candidates = generatePendingChoiceCandidates(choice);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((candidate) => pendingChoiceSelectionError(choice, candidate) === null)).toBe(true);
    const fallback = defaultPendingChoiceOptionIds(choice);
    expect(fallback).not.toBeNull();
    expect(pendingChoiceSelectionError(choice, fallback!)).toBeNull();
  });

  it('includes the legal empty action for optional choices', () => {
    const optional = choices.find((choice) => choice.type === 'optionalHandMoveThenDraw')!;
    expect(generatePendingChoiceCandidates(optional)).toContainEqual([]);
  });
});
