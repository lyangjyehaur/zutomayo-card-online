import type { CSSProperties } from 'react';
import { CHRONOS_MAPPING, type ChronosState, type ChronosTime, type PlayerIndex } from '../../game/types';
import { normalizeChronosPosition } from '../../game/chronos';
import { t } from '../../i18n';

/**
 * ChronosDial — Chronos 狀態板。
 *
 * 視覺底圖使用官方 Chronos 全圖；外圈預留 18 個素材槽位。
 */
const POSITIONS = CHRONOS_MAPPING.positions;
const NIGHT_POSITIONS: readonly number[] = CHRONOS_MAPPING.nightPositions;
const SLOT_RADIUS_PERCENT = 43.5;

const CHRONOS_SLOTS = Array.from({ length: POSITIONS }, (_, position) => {
  const radians = (position / POSITIONS) * Math.PI * 2;
  const isNight = NIGHT_POSITIONS.includes(position);
  return {
    position,
    time: isNight ? 'night' : 'day',
    style: {
      '--slot-x': `${(50 + Math.sin(radians) * SLOT_RADIUS_PERCENT).toFixed(3)}%`,
      '--slot-y': `${(50 - Math.cos(radians) * SLOT_RADIUS_PERCENT).toFixed(3)}%`,
    } as CSSProperties,
  };
});

export interface ChronosDialProps {
  chronos: ChronosState;
  currentTime: ChronosTime;
  currentPlayer: PlayerIndex;
}

export function ChronosDial({ chronos, currentTime, currentPlayer }: ChronosDialProps) {
  const position = normalizeChronosPosition(chronos.position);
  const timeLabel = currentTime === 'night' ? t('board.night') : t('board.day');
  const nightSide = chronos.nightSidePlayer === currentPlayer ? 'me' : 'opponent';

  return (
    <div
      className="chronosdial"
      data-time={currentTime}
      data-night-side={nightSide}
      aria-label={`${t('chronos.title')} ${position}/${POSITIONS} · ${timeLabel}`}
    >
      <div className="chronosdial-orbit" aria-hidden="true">
        {CHRONOS_SLOTS.map((slot) => (
          <span
            key={slot.position}
            className="chronosdial-slot"
            data-active={slot.position === position}
            data-time={slot.time}
            style={slot.style}
          >
            <span className="chronosdial-slot-inner" />
          </span>
        ))}
      </div>
    </div>
  );
}
