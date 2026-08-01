import type { GameRngState } from './types';

export const GAME_RNG_ALGORITHM = 'mulberry32-v1' as const;

const UINT32_RANGE = 0x1_0000_0000;

export function normalizeGameSeed(seed: string | number): number {
  if (typeof seed === 'number') {
    if (!Number.isFinite(seed)) throw new Error('Game RNG seed must be finite');
    return Math.trunc(seed) >>> 0;
  }
  if (!seed.length) throw new Error('Game RNG seed must not be empty');
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createGameSeed(): number {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('Cryptographic randomness is unavailable for game seed generation');
  }
  return globalThis.crypto.getRandomValues(new Uint32Array(1))[0] >>> 0;
}

export function createGameRngState(seed: string | number): GameRngState {
  return {
    algorithm: GAME_RNG_ALGORITHM,
    seed: normalizeGameSeed(seed),
    counter: 0,
  };
}

export function nextGameRandom(rng: GameRngState): number {
  if (rng.algorithm !== GAME_RNG_ALGORITHM) {
    throw new Error(`Unsupported game RNG algorithm: ${rng.algorithm}`);
  }
  rng.counter += 1;
  let value = (rng.seed + Math.imul(rng.counter, 0x6d2b79f5)) >>> 0;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / UINT32_RANGE;
}

export function gameRandomInt(rng: GameRngState, maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new Error('Random integer upper bound must be a positive integer');
  }
  return Math.floor(nextGameRandom(rng) * maxExclusive);
}

export function deriveGameSeed(seed: string | number, scope: string): number {
  return normalizeGameSeed(`${normalizeGameSeed(seed)}:${scope}`);
}

export function secureRandom(): number {
  return createGameSeed() / UINT32_RANGE;
}
