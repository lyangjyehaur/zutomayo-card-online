import type { ChronosState } from '../game/types';

interface ChronosProps {
  chronos: ChronosState;
  currentTime: 'night' | 'day';
}

export function Chronos({ chronos, currentTime }: ChronosProps) {
  const size = 200;
  const center = size / 2;
  const radius = 80;

  // Generate hour positions
  const hours = Array.from({ length: 12 }, (_, i) => {
    const angle = (i * 30 - 90) * (Math.PI / 180); // -90 to start from top
    const x = center + radius * Math.cos(angle);
    const y = center + radius * Math.sin(angle);
    return { i, x, y };
  });

  const medalAngle = (chronos.position * 30 - 90) * (Math.PI / 180);
  const medalX = center + radius * Math.cos(medalAngle);
  const medalY = center + radius * Math.sin(medalAngle);

  return (
    <div className="chronos">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Clock face */}
        <circle cx={center} cy={center} r={radius + 10} fill="none" stroke="#333" strokeWidth={2} />

        {/* Night zone (top half, 0-5) */}
        <path
          d={describeArc(center, center, radius + 8, -90, 90)}
          fill="none"
          stroke="#4a6fa5"
          strokeWidth={6}
          opacity={0.6}
        />
        {/* Day zone (bottom half, 6-11) */}
        <path
          d={describeArc(center, center, radius + 8, 90, 270)}
          fill="none"
          stroke="#e63946"
          strokeWidth={6}
          opacity={0.6}
        />

        {/* Hour marks */}
        {hours.map(({ i, x, y }) => (
          <g key={i}>
            <circle
              cx={x}
              cy={y}
              r={i % 3 === 0 ? 12 : 8}
              fill={i < 6 ? '#4a6fa5' : '#e63946'}
              opacity={chronos.position === i ? 1 : 0.3}
            />
            <text x={x} y={y + 4} textAnchor="middle" fill="white" fontSize={10} fontWeight="bold">
              {i}
            </text>
          </g>
        ))}

        {/* Medal (current position) */}
        <circle cx={medalX} cy={medalY} r={14} fill="gold" stroke="#b8860b" strokeWidth={2} />
        <text x={medalX} y={medalY + 5} textAnchor="middle" fill="#333" fontSize={12} fontWeight="bold">
          M
        </text>

        {/* Center label */}
        <text x={center} y={center - 10} textAnchor="middle" fill="white" fontSize={14} fontWeight="bold">
          {currentTime === 'night' ? '🌙 夜' : '☀️ 昼'}
        </text>
        <text x={center} y={center + 10} textAnchor="middle" fill="#aaa" fontSize={11}>
          {chronos.position}/12
        </text>
      </svg>
    </div>
  );
}

// Helper to draw SVG arcs
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
