import { describe, it, expect } from 'vitest';
import { normalizeChronosPosition, getChronosTimeForPosition } from '../chronos';
import { CHRONOS_MAPPING } from '../types';

describe('normalizeChronosPosition', () => {
  it('保留 [0, positions) 範圍內的位置不變', () => {
    for (let i = 0; i < CHRONOS_MAPPING.positions; i++) {
      expect(normalizeChronosPosition(i)).toBe(i);
    }
  });

  it('正數繞回：positions → 0, positions+1 → 1, 2×positions → 0', () => {
    const P = CHRONOS_MAPPING.positions;
    expect(normalizeChronosPosition(P)).toBe(0);
    expect(normalizeChronosPosition(P + 1)).toBe(1);
    expect(normalizeChronosPosition(2 * P)).toBe(0);
    expect(normalizeChronosPosition(2 * P + 1)).toBe(1);
  });

  it('負數繞回：-1 → positions-1, -positions → 0', () => {
    const P = CHRONOS_MAPPING.positions;
    expect(normalizeChronosPosition(-1)).toBe(P - 1);
    expect(normalizeChronosPosition(-2)).toBe(P - 2);
    expect(normalizeChronosPosition(-P)).toBe(0);
    expect(normalizeChronosPosition(-P - 1)).toBe(P - 1);
  });

  it('0 永遠正規化為 0', () => {
    expect(normalizeChronosPosition(0)).toBe(0);
  });

  it('大正數與大負數仍落在 [0, positions)', () => {
    const P = CHRONOS_MAPPING.positions;
    expect(normalizeChronosPosition(100)).toBe(100 % P);
    expect(normalizeChronosPosition(-100)).toBe(((-100 % P) + P) % P);
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

  it('位置繞回仍正確：positions → 0 (night), noon+positions → noon (day)', () => {
    const P = CHRONOS_MAPPING.positions;
    expect(getChronosTimeForPosition(P)).toBe('night'); // 0
    expect(getChronosTimeForPosition(CHRONOS_MAPPING.noon + P)).toBe('day');
    expect(getChronosTimeForPosition(-1)).toBe('night'); // P-1
    expect(getChronosTimeForPosition(-(P - CHRONOS_MAPPING.noon))).toBe('day'); // noon
  });

  it('midnightRange=0 時晝側邊界位置為 day', () => {
    const firstDay = CHRONOS_MAPPING.dayPositions[0];
    const lastDay = CHRONOS_MAPPING.dayPositions[CHRONOS_MAPPING.dayPositions.length - 1];
    expect(getChronosTimeForPosition(firstDay, 0)).toBe('day');
    expect(getChronosTimeForPosition(lastDay, 0)).toBe('day');
  });

  it('midnightRange 擴展使午夜附近的位置變成 night', () => {
    const firstDay = CHRONOS_MAPPING.dayPositions[0]; // 距午夜 = firstDay
    expect(getChronosTimeForPosition(firstDay, firstDay - 1)).toBe('day');
    expect(getChronosTimeForPosition(firstDay, firstDay)).toBe('night');
    expect(getChronosTimeForPosition(firstDay, firstDay + 1)).toBe('night');
  });

  it('midnightRange 對稱擴展（另一側）', () => {
    const P = CHRONOS_MAPPING.positions;
    const lastDay = CHRONOS_MAPPING.dayPositions[CHRONOS_MAPPING.dayPositions.length - 1];
    const dist = P - lastDay; // 距午夜（逆向）
    expect(getChronosTimeForPosition(lastDay, dist - 1)).toBe('day');
    expect(getChronosTimeForPosition(lastDay, dist)).toBe('night');
    expect(getChronosTimeForPosition(lastDay, dist + 1)).toBe('night');
  });

  it('正午不受 midnightRange 影響（除非極大範圍）', () => {
    const noon = CHRONOS_MAPPING.noon; // 距午夜 = noon
    expect(getChronosTimeForPosition(noon, 0)).toBe('day');
    expect(getChronosTimeForPosition(noon, noon - 1)).toBe('day');
    expect(getChronosTimeForPosition(noon, noon)).toBe('night');
  });

  it('預設 midnightRange 為 0', () => {
    expect(getChronosTimeForPosition(0)).toBe('night');
    expect(getChronosTimeForPosition(CHRONOS_MAPPING.noon)).toBe('day');
    expect(getChronosTimeForPosition(CHRONOS_MAPPING.dayPositions[0])).toBe('day');
  });
});
