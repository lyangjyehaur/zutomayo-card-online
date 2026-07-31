import { describe, expect, it } from 'vitest';
import { createGameRngState, deriveGameSeed, gameRandomInt, nextGameRandom, normalizeGameSeed } from '../rng';

describe('game RNG', () => {
  it('normalizes seeds and derives stable independent streams', () => {
    expect(normalizeGameSeed('replay-seed')).toBe(normalizeGameSeed('replay-seed'));
    expect(deriveGameSeed(42, 'deck:0')).toBe(deriveGameSeed(42, 'deck:0'));
    expect(deriveGameSeed(42, 'deck:0')).not.toBe(deriveGameSeed(42, 'deck:1'));
  });

  it('resumes at the same value after JSON serialization', () => {
    const original = createGameRngState(12345);
    nextGameRandom(original);
    nextGameRandom(original);
    const restored = JSON.parse(JSON.stringify(original)) as typeof original;

    expect(Array.from({ length: 8 }, () => nextGameRandom(restored))).toEqual(
      Array.from({ length: 8 }, () => nextGameRandom(original)),
    );
    expect(restored.counter).toBe(10);
  });

  it('rejects invalid integer bounds', () => {
    expect(() => gameRandomInt(createGameRngState(1), 0)).toThrow('positive integer');
  });
});
