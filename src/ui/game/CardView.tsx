import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { CardInstance, Element } from '../../game/types';
import { getCardDef } from '../../game/cards/loader';
import { t } from '../../i18n';

/**
 * CardView — Design System 唯一的戰場卡牌渲染元件。
 *
 * 尺寸完全由 token 決定（--card-width-mini/sm/md/lg/xl，5:7 直向比例），
 * 互動狀態（playable / selected / targetable / disabled）由 data-state 驅動，
 * 樣式見 src/styles/battle.css。詳情展示不在此元件內：hover/tap 一律透過
 * onInspect 交給 CardDetailLayer（桌面側欄 / 觸控 bottom sheet）統一呈現。
 */
export type CardViewSize = 'mini' | 'sm' | 'md' | 'lg' | 'xl';
export type CardViewState = 'idle' | 'playable' | 'selected' | 'targetable' | 'disabled';

const ELEMENT_CLASS: Record<Element, string> = {
  闇: 'dark',
  炎: 'flame',
  電気: 'electric',
  風: 'wind',
  カオス: 'chaos',
};

export interface CardViewProps {
  card: CardInstance;
  size?: CardViewSize;
  state?: CardViewState;
  /** 顯示左上充能成本 chip（mini 尺寸一律隱藏） */
  showCost?: boolean;
  /** 點擊 / Enter / Space：執行動作（出牌、選目標、撤回…） */
  onActivate?: () => void;
  /** 滑鼠移入 / 聚焦：更新詳情層焦點卡 */
  onInspect?: () => void;
  onInspectEnd?: () => void;
  ariaLabel?: string;
  className?: string;
  /** 教學系統定位錨點（data-tut-card） */
  tutId?: string;
}

export function CardView({
  card,
  size = 'md',
  state = 'idle',
  showCost = true,
  onActivate,
  onInspect,
  onInspectEnd,
  ariaLabel,
  className,
  tutId,
}: CardViewProps) {
  const faceUp = card.faceUp && card.defId !== '__hidden__';
  const def = faceUp ? getCardDef(card.defId) : undefined;
  const interactive = Boolean(onActivate) && state !== 'disabled';
  const label = ariaLabel ?? (def ? def.name : t('card.back'));

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onActivate?.();
  };

  const cls = [
    'cardview',
    `cardview-${size}`,
    def ? `cardview-element-${ELEMENT_CLASS[def.element]}` : 'cardview-facedown',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const content = def ? (
    <>
      <img
        className="cardview-art"
        src={def.image}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        draggable={false}
      />
      {showCost && size !== 'mini' && (
        <span className="cardview-cost" aria-hidden="true">
          {def.powerCost}
        </span>
      )}
    </>
  ) : (
    <img className="cardview-art" src="/card-back.jpg" alt="" loading="lazy" draggable={false} />
  );

  if (interactive) {
    return (
      <button
        type="button"
        className={cls}
        data-state={state}
        data-tut-card={tutId}
        aria-label={label}
        onClick={onActivate}
        onKeyDown={handleKeyDown}
        onMouseEnter={onInspect}
        onMouseLeave={onInspectEnd}
        onFocus={onInspect}
        onBlur={onInspectEnd}
      >
        {content}
      </button>
    );
  }

  return (
    <div
      className={cls}
      data-state={state}
      data-tut-card={tutId}
      role="img"
      aria-label={label}
      tabIndex={onInspect ? 0 : undefined}
      onMouseEnter={onInspect}
      onMouseLeave={onInspectEnd}
      onFocus={onInspect}
      onBlur={onInspectEnd}
    >
      {content}
    </div>
  );
}
