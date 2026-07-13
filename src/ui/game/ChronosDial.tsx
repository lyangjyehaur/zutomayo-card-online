import { useEffect, useState, type CSSProperties, type SyntheticEvent } from 'react';
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
const MEDAL_STEP_MS = 120;

const SLOT_ASSET_BASE = '/battle/chronos-slots';
const CHRONOS_SLOT_ASSETS: Record<number, { src: string; mirror?: boolean }> = {
  0: { src: `${SLOT_ASSET_BASE}/00.svg` },
  1: { src: `${SLOT_ASSET_BASE}/01-17mirror.svg` },
  2: { src: `${SLOT_ASSET_BASE}/02-16mirror.svg` },
  3: { src: `${SLOT_ASSET_BASE}/03-15mirror.svg` },
  4: { src: `${SLOT_ASSET_BASE}/04-14mirror.svg` },
  5: { src: `${SLOT_ASSET_BASE}/05-13.svg` },
  6: { src: `${SLOT_ASSET_BASE}/06-12.svg` },
  7: { src: `${SLOT_ASSET_BASE}/07-11.svg` },
  8: { src: `${SLOT_ASSET_BASE}/08-10.svg` },
  9: { src: `${SLOT_ASSET_BASE}/09.svg` },
  10: { src: `${SLOT_ASSET_BASE}/08-10.svg` },
  11: { src: `${SLOT_ASSET_BASE}/07-11.svg` },
  12: { src: `${SLOT_ASSET_BASE}/06-12.svg` },
  13: { src: `${SLOT_ASSET_BASE}/05-13.svg` },
  14: { src: `${SLOT_ASSET_BASE}/04-14mirror.svg`, mirror: true },
  15: { src: `${SLOT_ASSET_BASE}/03-15mirror.svg`, mirror: true },
  16: { src: `${SLOT_ASSET_BASE}/02-16mirror.svg`, mirror: true },
  17: { src: `${SLOT_ASSET_BASE}/01-17mirror.svg`, mirror: true },
};

const CHRONOS_SLOTS = Array.from({ length: POSITIONS }, (_, position) => {
  const radians = (position / POSITIONS) * Math.PI * 2;
  const isNight = NIGHT_POSITIONS.includes(position);
  const asset = CHRONOS_SLOT_ASSETS[position];
  const baseMirror = asset.mirror ? -1 : 1;
  return {
    position,
    time: isNight ? 'night' : 'day',
    asset,
    baseMirror,
    style: {
      '--slot-x': `${(50 + Math.sin(radians) * SLOT_RADIUS_PERCENT).toFixed(3)}%`,
      '--slot-y': `${(50 - Math.cos(radians) * SLOT_RADIUS_PERCENT).toFixed(3)}%`,
    } as CSSProperties,
  };
});

function hideMissingAsset(event: SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.hidden = true;
}

function markAssetReady(setReady: (ready: boolean) => void) {
  return () => setReady(true);
}

function hideMissingReadyAsset(setReady: (ready: boolean) => void) {
  return (event: SyntheticEvent<HTMLImageElement>) => {
    setReady(false);
    hideMissingAsset(event);
  };
}

export interface ChronosDialProps {
  chronos: ChronosState;
  currentTime: ChronosTime;
  currentPlayer: PlayerIndex;
}

export function ChronosDial({ chronos, currentTime, currentPlayer }: ChronosDialProps) {
  const position = normalizeChronosPosition(chronos.position);
  const [medalPosition, setMedalPosition] = useState(position);
  const [hasFaceArt, setHasFaceArt] = useState(false);
  const timeLabel = currentTime === 'night' ? t('board.night') : t('board.day');
  const nightSide = chronos.nightSidePlayer === currentPlayer ? 'me' : 'opponent';
  const medalSlot = CHRONOS_SLOTS[medalPosition] ?? CHRONOS_SLOTS[0];
  const slotStyle = (slot: (typeof CHRONOS_SLOTS)[number]): CSSProperties =>
    ({
      ...slot.style,
      '--chronos-slot-mirror': slot.baseMirror * (nightSide === 'opponent' && slot.time === 'night' ? -1 : 1),
    }) as CSSProperties;

  useEffect(() => {
    if (medalPosition === position) return;
    const timeoutId = window.setTimeout(() => {
      setMedalPosition((current) => (current === position ? current : normalizeChronosPosition(current + 1)));
    }, MEDAL_STEP_MS);
    return () => window.clearTimeout(timeoutId);
  }, [medalPosition, position]);

  return (
    <div
      className="chronosdial"
      data-time={currentTime}
      data-night-side={nightSide}
      data-face-art={hasFaceArt}
      role="img"
      aria-label={`${t('chronos.title')} ${position}/${POSITIONS} · ${timeLabel}`}
    >
      <img
        className="chronosdial-face-art"
        src="/battle/chronos.svg"
        alt=""
        draggable={false}
        onLoad={markAssetReady(setHasFaceArt)}
        onError={hideMissingReadyAsset(setHasFaceArt)}
      />
      <div className="chronosdial-orbit" aria-hidden="true">
        {CHRONOS_SLOTS.map((slot) => (
          <span
            key={slot.position}
            className="chronosdial-slot"
            data-active={slot.position === position}
            data-time={slot.time}
            style={slotStyle(slot)}
          >
            <span className="chronosdial-slot-inner">
              <img
                className="chronosdial-slot-art"
                src={slot.asset.src}
                alt=""
                draggable={false}
                onError={hideMissingAsset}
              />
            </span>
          </span>
        ))}
        <span className="chronosdial-medal" data-position={medalPosition} style={medalSlot.style}>
          <img
            className="chronosdial-medal-img"
            src="/battle/medal.png"
            alt=""
            draggable={false}
            onError={hideMissingAsset}
          />
        </span>
      </div>
    </div>
  );
}
