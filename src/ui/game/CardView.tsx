import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { CardInstance, Element } from '../../game/types';
import { getCardDef } from '../../game/cards/loader';
import { getLocalizedCardName } from '../../game/cards/i18n';
import { t, useLocale } from '../../i18n';
import { CardImage } from '../../components/CardImage';
import type { CardImageContext } from '../../lib/cardImages';

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
  imageContext?: CardImageContext;
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
  imageContext,
  showCost = true,
  onActivate,
  onInspect,
  onInspectEnd,
  ariaLabel,
  className,
  tutId,
}: CardViewProps) {
  const locale = useLocale();
  const faceUp = card.faceUp && card.defId !== '__hidden__';
  const def = faceUp ? getCardDef(card.defId) : undefined;
  const interactive = Boolean(onActivate) && state !== 'disabled';
  const label = ariaLabel ?? (def ? getLocalizedCardName(def, locale) : t('card.back'));
  const resolvedImageContext: CardImageContext =
    imageContext ?? (size === 'mini' || size === 'sm' ? 'mobile-board' : size === 'xl' ? 'preview' : 'board');

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

  const front = def ? (
    <>
      <CardImage
        className="cardview-art"
        cardId={def.id}
        context={resolvedImageContext}
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
  ) : null;

  // 兩個面永遠保留在 DOM：伏牌→公開時可由 CSS 以同一張實例完成 3D 翻轉。
  // 未公開卡不渲染任何定義資料，維持線上資訊隱藏。
  const content = (
    <span className="cardview-inner" aria-hidden="true">
      <span className="cardview-face cardview-face-front">{front}</span>
      <span className="cardview-face cardview-face-back">
        <img className="cardview-art" src="/card-back.jpg" alt="" loading="lazy" decoding="async" draggable={false} />
      </span>
    </span>
  );

  if (interactive) {
    return (
      <button
        type="button"
        className={cls}
        data-state={state}
        data-face-up={faceUp ? 'true' : 'false'}
        data-anim-card={card.instanceId}
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
      data-face-up={faceUp ? 'true' : 'false'}
      data-anim-card={card.instanceId}
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
