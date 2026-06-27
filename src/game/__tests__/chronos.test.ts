import { describe, it, expect } from 'vitest';
import { normalizeChronosPosition, getChronosTimeForPosition } from '../chronos';
import { CHRONOS_MAPPING } from '../types';

describe('normalizeChronosPosition', () => {
  it('保留 [0, 12) 範圍內的位置不變', () => {
    for (let i = 0; i < CHRONOS_MAPPING.positions; i++) {
      expect(normalizeChronosPosition(i)).toBe(i);
    }
  });

  it('正數繞回：12 → 0, 13 → 1, 24 → 0', () => {
    expect(normalizeChronosPosition(12)).toBe(0);
    expect(normalizeChronosPosition(13)).toBe(1);
    expect(normalizeChronosPosition(24)).toBe(0);
    expect(normalizeChronosPosition(25)).toBe(1);
  });

  it('負數繞回：-1 → 11, -12 → 0, -13 → 11', () => {
    expect(normalizeChronosPosition(-1)).toBe(11);
    expect(normalizeChronosPosition(-2)).toBe(10);
    expect(normalizeChronosPosition(-12)).toBe(0);
    expect(normalizeChronosPosition(-13)).toBe(11);
  });

  it('0 永遠正規化為 0', () => {
    expect(normalizeChronosPosition(0)).toBe(0);
  });

  it('大正數與大負數仍落在 [0, 12)', () => {
    expect(normalizeChronosPosition(100)).toBe(100 % 12);
    expect(normalizeChronosPosition(-100)).toBe((((-100 % 12) + 12) % 12));
    const large = 123456;
    const result = normalizeChronosPosition(large);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThan(CHRONOS_MAPPING.positions);
    const negative = -123456;
    const negResult = normalizeChronosPosition(negative);
    expect(negResult).toBeGreaterThanOrEqual(0);
    expect(negResult).toBeLessThan(CHRONOS_MAPPING.positions);
  });
});

describe('getChronosTimeForPosition', () => {
  it('nightPositions 回傳 night', () => {
    for (const pos of CHRONOS_MAPPING.nightPositions) {
      expect(getChronosTimeForPosition(pos)).toBe('night');
    }
  });

  it('dayPositions 回傳 day', () => {
    for (const pos of CHRONOS_MAPPING.dayPositions) {
      expect(getChronosTimeForPosition(pos)).toBe('day');
    }
  });

  it('位置繞回仍正確：12 → 0 (night), 16 → 4 (day)', () => {
    expect(getChronosTimeForPosition(12)).toBe('night'); // 0
    expect(getChronosTimeForPosition(16)).toBe('day');   // 4
    expect(getChronosTimeForPosition(-1)).toBe('night'); // 11
    expect(getChronosTimeForPosition(-3)).toBe('day');   // 9
  });

  it('midnightRange=0 時邊界位置 4 與 9 為 day', () => {
    expect(getChronosTimeForPosition(4, 0)).toBe('day');
    expect(getChronosTimeForPosition(9, 0)).toBe('day');
  });

  it('midnightRange 擴展使午夜附近的位置變成 night', () => {
    // position 4 距離午夜(0) = min(4, 8) = 4
    expect(getChronosTimeForPosition(4, 3)).toBe('day');   // 4 > 3
    expect(getChronosTimeForPosition(4, 4)).toBe('night'); // 4 <= 4
    expect(getChronosTimeForPosition(4, 5)).toBe('night'); // 4 <= 5
  });

  it('midnightRange 對稱擴展（另一側）', () => {
    // position 9 距離午夜 = min(9, 3) = 3
    expect(getChronosTimeForPosition(9, 2)).toBe('day');   // 3 > 2
    expect(getChronosTimeForPosition(9, 3)).toBe('night'); // 3 <= 3
    expect(getChronosTimeForPosition(9, 4)).toBe('night'); // 3 <= 4
  });

  it('正午（position 6）不受 midnightRange 影響（除非極大範圍）', () => {
    expect(getChronosTimeForPosition(6, 0)).toBe('day');
    expect(getChronosTimeForPosition(6, 5)).toBe('day');   // 距離 = min(6, 6) = 6 > 5
    expect(getChronosTimeForPosition(6, 6)).toBe('night'); // 6 <= 6
  });

  it('預設 midnightRange 為 0', () => {
    expect(getChronosTimeForPosition(0)).toBe('night');
    expect(getChronosTimeForPosition(6)).toBe('day');
    expect(getChronosTimeForPosition(4)).toBe('day');
  });
});
