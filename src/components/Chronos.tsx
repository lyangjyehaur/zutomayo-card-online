import type { ChronosState, ChronosTime, PlayerIndex } from '../game/types';
import { t } from '../i18n';

interface ChronosProps {
  chronos: ChronosState;
  currentTime: ChronosTime;
  nightSidePlayer: PlayerIndex;
  currentPlayer: PlayerIndex;
}

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

export function Chronos({ chronos, currentTime, nightSidePlayer, currentPlayer }: ChronosProps) {
  const size = 420;
  const center = size / 2;
  const radius = 160;
  const outerRadius = 196;
  const faceRadius = 182;
  const arcRadius = 190;
  const position = ((chronos.position % 12) + 12) % 12;
  const rotation = nightSidePlayer === currentPlayer ? 0 : 180;
  const ticks = Array.from({ length: 12 }, (_, index) => {
    const angle = (index * 30 - 90) * (Math.PI / 180);
    return {
      index,
      x: center + radius * Math.cos(angle),
      y: center + radius * Math.sin(angle),
    };
  });
  const medalAngle = (position * 30 - 90) * (Math.PI / 180);
  const medalX = center + radius * Math.cos(medalAngle);
  const medalY = center + radius * Math.sin(medalAngle);
  const timeLabel = CHRONOS_LABELS[position] ?? CHRONOS_LABELS[0];
  const sideLabel = currentTime === 'night' ? t('board.night') : t('board.day');

  return (
    <div className={`chronos chronos-${currentTime}`} aria-label={t('chronos.title')}>
      <svg viewBox={`0 0 ${size} ${size}`} role="img">
        <defs>
          <radialGradient id="chronos-face" cx="50%" cy="42%" r="68%">
            <stop offset="0%" stopColor="#242839" />
            <stop offset="58%" stopColor="#111827" />
            <stop offset="100%" stopColor="#07090f" />
          </radialGradient>
          <radialGradient id="chronos-medal-fill" cx="35%" cy="28%" r="70%">
            <stop offset="0%" stopColor="#fff3a6" />
            <stop offset="48%" stopColor="#d9a93d" />
            <stop offset="100%" stopColor="#7c5417" />
          </radialGradient>
          <filter id="chronos-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <circle className="chronos-outer" cx={center} cy={center} r={outerRadius} />
        <circle className="chronos-face" cx={center} cy={center} r={faceRadius} />

        <g
          className="chronos-face-group"
          style={{ transform: `rotate(${rotation}deg)`, transformOrigin: `${center}px ${center}px` }}
        >
          <path className="chronos-night-arc" d={topSemiCircle(center, arcRadius)} />
          <path className="chronos-day-arc" d={bottomSemiCircle(center, arcRadius)} />
          <line className="chronos-divider" x1={center} y1="26" x2={center} y2="66" />
          <line className="chronos-divider" x1={center} y1={size - 26} x2={center} y2={size - 66} />

          {ticks.map(({ index, x, y }) => (
            <g key={index} className={position === index ? 'chronos-tick active' : 'chronos-tick'}>
              <circle className={index < 6 ? 'tick-night' : 'tick-day'} cx={x} cy={y} r={index % 3 === 0 ? 12 : 8} />
              <text x={x} y={y + 4} textAnchor="middle">
                {index}
              </text>
            </g>
          ))}

          <line className="chronos-hand" x1={center} y1={center} x2={medalX} y2={medalY} />
          <g
            className="chronos-medal-group"
            style={{ transform: `translate(${medalX}px, ${medalY}px)` }}
            filter="url(#chronos-glow)"
          >
            <circle className="chronos-medal-shadow" r="19" />
            <circle className="chronos-medal" r="16" />
            <circle className="chronos-medal-core" r="7" />
          </g>
        </g>

        <text className="chronos-title" x={center} y={center - 22} textAnchor="middle">
          CHRONOS
        </text>
        <text className="chronos-time-label" x={center} y={center + 8} textAnchor="middle">
          {timeLabel}
        </text>
        <text className="chronos-subtitle" x={center} y={center + 36} textAnchor="middle">
          {sideLabel} • {position}/12
        </text>
      </svg>
    </div>
  );
}

function topSemiCircle(center: number, radius: number): string {
  return `M ${center - radius} ${center} A ${radius} ${radius} 0 0 1 ${center + radius} ${center}`;
}

function bottomSemiCircle(center: number, radius: number): string {
  return `M ${center - radius} ${center} A ${radius} ${radius} 0 0 0 ${center + radius} ${center}`;
}
