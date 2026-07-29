import { t } from '../../i18n';

/**
 * PlayerStatus — 玩家/對手狀態列：名稱、HP bar、關鍵計數。
 * HP bar 高度 4px；<=50 警示、<=25 危險（HP 變化語義由引擎決定，此處僅顯示）。
 */
export interface PlayerStatusProps {
  side: 'me' | 'opponent';
  name: string;
  hp: number;
  /** 右側附加計數（手牌 / 牌組等），由呼叫端組字串以保留 i18n 彈性 */
  meta?: string;
  damageAmount?: number;
  tutId?: string;
  className?: string;
  /** 前端結算動畫定位用，不承載規則狀態。 */
  animationZone?: string;
  statuses?: Array<{ label: string; value?: string; tone?: 'neutral' | 'warning' }>;
}

function hpLevel(hp: number): 'healthy' | 'warning' | 'danger' {
  if (hp <= 25) return 'danger';
  if (hp <= 50) return 'warning';
  return 'healthy';
}

export function PlayerStatus({
  side,
  name,
  hp,
  meta,
  damageAmount,
  tutId,
  className,
  animationZone,
  statuses = [],
}: PlayerStatusProps) {
  const percent = Math.max(0, Math.min(100, hp));
  return (
    <div
      className={['playerstatus', `playerstatus-${side}`, className ?? ''].filter(Boolean).join(' ')}
      data-hp={hpLevel(hp)}
      data-hit={damageAmount ? 'true' : undefined}
      data-tut={tutId}
      data-anim-zone={animationZone}
      aria-label={`${name} · ${t('board.hp')} ${hp}/100`}
    >
      <div className="playerstatus-head">
        <span className="playerstatus-name">{name}</span>
        <span className="playerstatus-head-values">
          {damageAmount ? (
            <span className="playerstatus-damage" key={`${side}-${damageAmount}`} aria-hidden="true">
              -{damageAmount}
            </span>
          ) : null}
          <span className="playerstatus-hp-readout" aria-hidden="true">
            <span className="playerstatus-hp-label">{t('board.hp')}</span>
            <strong>{hp}</strong>
            <span>/100</span>
          </span>
        </span>
      </div>
      <div className="playerstatus-bar" aria-hidden="true">
        <span className="playerstatus-bar-fill" style={{ width: `${percent}%` }} />
        <span className="playerstatus-bar-ticks" />
      </div>
      {meta && (
        <div className="playerstatus-meta" aria-hidden="true">
          <span>{meta}</span>
        </div>
      )}
      {statuses.length > 0 && (
        <div className="playerstatus-effects" aria-label={t('board.status.active' as never)}>
          {statuses.map((status, index) => (
            <span data-tone={status.tone} key={`${status.label}-${status.value ?? ''}-${index}`}>
              {status.label}
              {status.value && <strong>{status.value}</strong>}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
