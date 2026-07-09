import type { CardInstance, ChronosTime } from '../../game/types';
import { t } from '../../i18n';
import { CardSlot, type CardSlotState } from './CardSlot';

/**
 * BattleZone — 對戰區（官方：バトルゾーン）。
 * 官方語義：雙方各 1 張 Character 在此對戰；依 Chronos 晝夜取 NIGHT/DAY 攻擊力，
 * 攻擊力低者受到差值傷害；充能成本不足時攻擊力為 0。
 * 本元件在卡槽下方常駐顯示「目前生效攻擊力」讀數（晝夜著色、PW 不足警示），
 * 讓雙方戰力比較一眼可見 — 這是官方規則要求的核心資訊，不能藏進詳情面板。
 */
export interface BattleZoneAttack {
  /** 生效攻擊力（依晝夜與修飾計算後）；null = 無法得知（蓋牌等） */
  value: number | null;
  /** 充能成本不足 → 攻擊力視為 0（官方規則） */
  insufficient: boolean;
}

export interface BattleZoneProps {
  side: 'me' | 'opponent';
  card: CardInstance | null;
  /** 當前 Chronos 晝夜（攻擊力讀數著色：夜=青、晝=紅，對齊官方） */
  time: ChronosTime;
  attack: BattleZoneAttack | null;
  state?: CardSlotState;
  onActivate?: () => void;
  onInspect?: (card: CardInstance) => void;
  size?: 'md' | 'lg';
  tutId?: string;
  /** 前端動畫層用的公開 DOM 錨點，不承載規則狀態。 */
  animationZone?: string;
}

export function BattleZone({
  side,
  card,
  time,
  attack,
  state = 'idle',
  onActivate,
  onInspect,
  size = 'lg',
  tutId,
  animationZone,
}: BattleZoneProps) {
  const sideName = side === 'me' ? t('player.me') : t('player.opponent');
  return (
    <div className={`battlezone battlezone-${side}`} data-time={time} data-tut={tutId} data-anim-zone={animationZone}>
      <CardSlot
        label={t('board.battleZoneShort')}
        ariaLabel={`${sideName} ${t('board.battleZone')}`}
        card={card}
        size={size}
        state={state}
        onActivate={onActivate}
        onInspect={onInspect}
      />
      <div
        className="battlezone-attack"
        data-insufficient={attack?.insufficient ?? false}
        aria-label={
          attack
            ? `${sideName} ${t('board.attackLabel')} ${attack.insufficient ? 0 : (attack.value ?? '—')}`
            : undefined
        }
      >
        {card && attack ? (
          <>
            <span className="battlezone-attack-time" aria-hidden="true">
              {time === 'night' ? '🌙' : '☀️'}
            </span>
            <strong className="battlezone-attack-value">{attack.insufficient ? 0 : (attack.value ?? '—')}</strong>
            {attack.insufficient && (
              <span className="battlezone-attack-warn">{t('board.hpChange.insufficientPower' as never)}</span>
            )}
          </>
        ) : (
          <span className="battlezone-attack-empty" aria-hidden="true">
            —
          </span>
        )}
      </div>
    </div>
  );
}
