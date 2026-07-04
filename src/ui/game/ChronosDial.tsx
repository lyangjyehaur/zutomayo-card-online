import { CHRONOS_MAPPING, type ChronosState, type ChronosTime, type PlayerIndex } from '../../game/types';
import { normalizeChronosPosition } from '../../game/chronos';
import { t } from '../../i18n';

/**
 * ChronosDial — Chronos 的全新呈現（取代舊版擬真時鐘）。
 *
 * 設計：12 段分段環（segment ring）。夜位（青）與晝位（紅）各 6 段，
 * 非當前位置為暗段、當前位置滿亮＋光暈；環心只放三件事：
 * 當前時段大字（夜/晝）、位置讀數 n/12、時刻名。
 * 沒有錶面、指針、獎章、羅馬刻度 — 它是狀態儀表，不是擬真時鐘。
 *
 * 語義保留：位置 0=真夜中 在 12 點方向、順時針推進、
 * 夜側玩家視角旋轉 180°（夜半永遠朝向夜側玩家）。
 */
const CHRONOS_LABELS = [
  '真夜中',
  '夜更け',
  '丑三つ',
  '未明',
  '夜明け前',
  '夜明け',
  '正午',
  '午後',
  '夕暮れ',
  '黄昏',
  '宵',
  '深夜',
];

const SIZE = 200;
const C = SIZE / 2;
const RING_R = 82;
const SEGMENT_SPAN = 24; // 每段弧度（度），段間留 6° 空隙
const MARKER_R = 66;

function polar(angleDeg: number, radius: number): [number, number] {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return [C + radius * Math.cos(rad), C + radius * Math.sin(rad)];
}

function segmentPath(index: number): string {
  const centerAngle = index * 30;
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
  const [markerX, markerY] = polar(position * 30, MARKER_R);
  const timeLabel = currentTime === 'night' ? t('board.night') : t('board.day');

  return (
    <div className="chronosdial" data-time={currentTime} aria-label={`${t('chronos.title')} ${position}/${CHRONOS_MAPPING.positions} · ${timeLabel}`}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-hidden="true">
        <g className="chronosdial-ring" style={{ transform: `rotate(${rotation}deg)` }}>
          {Array.from({ length: CHRONOS_MAPPING.positions }, (_, index) => (
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
          <span className="chronosdial-position-total">/{CHRONOS_MAPPING.positions}</span>
        </span>
        <span className="chronosdial-name">{CHRONOS_LABELS[position] ?? CHRONOS_LABELS[0]}</span>
      </div>
    </div>
  );
}
