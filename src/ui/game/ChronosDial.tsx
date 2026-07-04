import { CHRONOS_MAPPING, type ChronosState, type ChronosTime, type PlayerIndex } from '../../game/types';
import { normalizeChronosPosition } from '../../game/chronos';
import { t } from '../../i18n';

/**
 * ChronosDial — Chronos 的全新呈現（取代舊版擬真時鐘）。
 *
 * 設計：分段環（segment ring）。官方場地墊共 18 刻度，夜位（青）與晝位（紅）
 * 各 9 段平分；非當前位置為暗段、當前位置滿亮＋光暈；環心只放三件事：
 * 當前時段大字（夜/晝）、位置讀數 n/18、時刻名。
 * 沒有錶面、指針、獎章、羅馬刻度 — 它是狀態儀表，不是擬真時鐘。
 *
 * 段數/夜晝歸屬完全由 CHRONOS_MAPPING 推導，改 mapping 不需改此元件。
 * 語義保留：位置 0=真夜中 在 12 點方向、順時針推進、
 * 夜側玩家視角旋轉 180°（夜半永遠朝向夜側玩家）。
 */
const POSITIONS = CHRONOS_MAPPING.positions;
const STEP = 360 / POSITIONS;

/** 時刻名：僅標注官方語義錨點（真夜中/正午），其餘位置顯示夜/晝深淺描述 */
function positionName(position: number, isNight: boolean): string {
  if (position === CHRONOS_MAPPING.midnight) return '真夜中';
  if (position === CHRONOS_MAPPING.noon) return '正午';
  return isNight ? '夜' : '昼';
}

const SIZE = 200;
const C = SIZE / 2;
const RING_R = 82;
const SEGMENT_SPAN = STEP * 0.72; // 每段弧度（度），段間留 28% 空隙
const MARKER_R = 66;

function polar(angleDeg: number, radius: number): [number, number] {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return [C + radius * Math.cos(rad), C + radius * Math.sin(rad)];
}

function segmentPath(index: number): string {
  const centerAngle = index * STEP;
  const a0 = centerAngle - SEGMENT_SPAN / 2;
  const a1 = centerAngle + SEGMENT_SPAN / 2;
  const [x0, y0] = polar(a0, RING_R);
  const [x1, y1] = polar(a1, RING_R);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${RING_R} ${RING_R} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

export interface ChronosDialProps {
  chronos: ChronosState;
  currentTime: ChronosTime;
  currentPlayer: PlayerIndex;
}

export function ChronosDial({ chronos, currentTime, currentPlayer }: ChronosDialProps) {
  const position = normalizeChronosPosition(chronos.position);
  const nightPositions: readonly number[] = CHRONOS_MAPPING.nightPositions;
  // 夜側玩家視角：夜半朝向自己（與官方場地擺放一致）
  const rotation = chronos.nightSidePlayer === currentPlayer ? 180 : 0;
  const [markerX, markerY] = polar(position * STEP, MARKER_R);
  const timeLabel = currentTime === 'night' ? t('board.night') : t('board.day');

  return (
    <div className="chronosdial" data-time={currentTime} aria-label={`${t('chronos.title')} ${position}/${POSITIONS} · ${timeLabel}`}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-hidden="true">
        <g className="chronosdial-ring" style={{ transform: `rotate(${rotation}deg)` }}>
          {Array.from({ length: POSITIONS }, (_, index) => (
            <path
              key={index}
              className="chronosdial-segment"
              data-time={nightPositions.includes(index) ? 'night' : 'day'}
              data-active={index === position}
              d={segmentPath(index)}
            />
          ))}
          {/* 起點記號（真夜中）：12 點方向的小三角 */}
          <path
            className="chronosdial-origin"
            d={`M ${C - 4} ${C - RING_R - 12} L ${C + 4} ${C - RING_R - 12} L ${C} ${C - RING_R - 5} Z`}
          />
          {/* 當前位置游標 */}
          <circle className="chronosdial-marker" cx={markerX} cy={markerY} r={4.5} />
        </g>
      </svg>
      <div className="chronosdial-core" aria-hidden="true">
        <strong className="chronosdial-time">{timeLabel}</strong>
        <span className="chronosdial-position">
          {position}
          <span className="chronosdial-position-total">/{POSITIONS}</span>
        </span>
        <span className="chronosdial-name">{positionName(position, nightPositions.includes(position))}</span>
      </div>
    </div>
  );
}
