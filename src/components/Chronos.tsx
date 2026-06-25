import type { ChronosState, ChronosTime } from '../game/types';
import { t } from '../i18n';

interface ChronosProps {
  chronos: ChronosState;
  currentTime: ChronosTime;
}

export function Chronos({ chronos, currentTime }: ChronosProps) {
  const size = 240;
  const center = size / 2;
  const radius = 88;
  const ticks = Array.from({ length: 12 }, (_, index) => {
    const angle = (index * 30 - 90) * (Math.PI / 180);
    return {
      index,
      x: center + radius * Math.cos(angle),
      y: center + radius * Math.sin(angle),
    };
  });
  const medalAngle = (chronos.position * 30 - 90) * (Math.PI / 180);
  const medalX = center + radius * Math.cos(medalAngle);
  const medalY = center + radius * Math.sin(medalAngle);
  const timeLabel = currentTime === 'night' ? t('board.night') : t('board.day');

  return (
    <div className={`chronos chronos-${currentTime}`} aria-label={t('chronos.title')}>
      <svg viewBox={`0 0 ${size} ${size}`} role="img">
        <defs>
          <radialGradient id="chronos-face" cx="50%" cy="45%" r="65%">
            <stop offset="0%" stopColor="#31225c" />
            <stop offset="55%" stopColor="#101a3d" />
            <stop offset="100%" stopColor="#070a18" />
          </radialGradient>
          <filter id="chronos-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <circle className="chronos-outer" cx={center} cy={center} r="108" />
        <circle className="chronos-face" cx={center} cy={center} r="96" />
        <path className="chronos-night-arc" d={describeArc(center, center, 101, -90, 90)} />
        <path className="chronos-day-arc" d={describeArc(center, center, 101, 90, 270)} />

        {ticks.map(({ index, x, y }) => (
          <g key={index} className={chronos.position === index ? 'chronos-tick active' : 'chronos-tick'}>
            <circle className={index < 6 ? 'tick-night' : 'tick-day'} cx={x} cy={y} r={index % 3 === 0 ? 12 : 8} />
            <text x={x} y={y + 4} textAnchor="middle">
              {index}
            </text>
          </g>
        ))}

        <line className="chronos-hand" x1={center} y1={center} x2={medalX} y2={medalY} />
        <circle className="chronos-medal" cx={medalX} cy={medalY} r="15" filter="url(#chronos-glow)" />
        <text className="chronos-medal-label" x={medalX} y={medalY + 5} textAnchor="middle">刻</text>

        <text className="chronos-title" x={center} y={center - 12} textAnchor="middle">
          {timeLabel}
        </text>
        <text className="chronos-subtitle" x={center} y={center + 12} textAnchor="middle">
          {t('chronos.position')} {chronos.position}/12
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
