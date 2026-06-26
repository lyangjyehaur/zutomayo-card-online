import { CHRONOS_MAPPING, type ChronosTime } from './types';

export function normalizeChronosPosition(position: number): number {
  const { positions } = CHRONOS_MAPPING;
  return ((position % positions) + positions) % positions;
}

export function getChronosTimeForPosition(position: number, midnightRange = 0): ChronosTime {
  const normalized = normalizeChronosPosition(position);
  const nightPositions: readonly number[] = CHRONOS_MAPPING.nightPositions;
  if (nightPositions.includes(normalized)) return 'night';

  const distanceFromMidnight = Math.min(
    normalizeChronosPosition(normalized - CHRONOS_MAPPING.midnight),
    normalizeChronosPosition(CHRONOS_MAPPING.midnight - normalized),
  );
  return distanceFromMidnight <= midnightRange ? 'night' : 'day';
}
