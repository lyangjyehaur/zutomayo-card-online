import type { ChronosState, ChronosTime } from '../game/types';
import { t } from '../i18n';

interface ChronosProps {
  chronos: ChronosState;
  currentTime: ChronosTime;
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

export function Chronos({ chronos, currentTime }: ChronosProps) {
  const size = 280;
  const center = size / 2;
  const radius = 104;
  const position = ((chronos.position % 12) + 12) % 12;
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

        <circle className="chronos-outer" cx={center} cy={center} r="128" />
        <circle className="chronos-face" cx={center} cy={center} r="116" />
        <path className="chronos-night-arc" d={describeArc(center, center, 122, -105, 75)} />
        <path className="chronos-day-arc" d={describeArc(center, center, 122, 75, 255)} />
        <line className="chronos-divider" x1={center} y1="18" x2={center} y2="44" />
        <line className="chronos-divider" x1={center} y1={size - 18} x2={center} y2={size - 44} />

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

        <text className="chronos-title" x={center} y={center - 18} textAnchor="middle">
          CHRONOS
        </text>
        <text className="chronos-time-label" x={center} y={center + 7} textAnchor="middle">
          {timeLabel}
        </text>
        <text className="chronos-subtitle" x={center} y={center + 29} textAnchor="middle">
          {sideLabel} • {position}/12
        </text>
      </svg>
    </div>
  );
}

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? '0' : '1';
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}
