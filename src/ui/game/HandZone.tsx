import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CardInstance } from '../../game/types';
import { getCardDef } from '../../game/cards/loader';
import { t } from '../../i18n';
import { CardCostTag, CardView, type CardViewState } from './CardView';

/**
 * HandZone — 玩家手牌。
 * - fan（桌面）：扇形排列，hover 抬起；click 先選中，再由行動列確認。
 * - strip（觸控/行動端）：橫向滑動列，不重疊、每張 >=44px 觸控目標；
 *   tap = 選中（Board 顯示行動列），不依賴 hover。
 * data-zone="hand" 為佈局/測試錨點、data-tut-card 為教學錨點。
 */
export interface HandZoneProps {
  cards: CardInstance[];
  variant: 'fan' | 'strip';
  /** 已選中（inspected）的手牌 index */
  selectedIndex: number | null;
  /** 全手牌是否可操作（非 ready、未達出牌上限）；false 時仍可 tap 查看 */
  canAct: boolean;
  /** 教學劇本可操作的卡牌定義；未提供時所有合法手牌皆可操作。 */
  allowedCardDefIds?: string[];
  /** 用於標示目前 Power 不足；標籤數字仍顯示卡面原始 cost。 */
  availablePower?: number;
  powerCostReduction?: number;
  tutId?: string;
  onCardTap?: (index: number) => void;
  onCardHover?: (index: number | null) => void;
}

export function HandZone({
  cards,
  variant,
  selectedIndex,
  canAct,
  allowedCardDefIds,
  availablePower,
  powerCostReduction = 0,
  tutId,
  onCardTap,
  onCardHover,
}: HandZoneProps) {
  const center = (cards.length - 1) / 2;
  const zoneRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [costPopover, setCostPopover] = useState<{ host: Element; left: number; top: number } | null>(null);
  const activeCostIndex = hoveredIndex ?? focusedIndex ?? selectedIndex;
  const activeCard = activeCostIndex === null ? undefined : cards[activeCostIndex];
  const activeCardInstanceId = activeCard?.instanceId;

  useLayoutEffect(() => {
    if (variant !== 'strip' || activeCostIndex === null || !activeCardInstanceId) {
      setCostPopover(null);
      return;
    }

    const zone = zoneRef.current;
    const anchor = cardRefs.current[activeCostIndex];
    const host = zone?.closest('.bf-player');
    if (!anchor || !host) return;

    const updatePosition = () => {
      const rect = anchor.getBoundingClientRect();
      setCostPopover({ host, left: rect.left + rect.width / 2, top: rect.top });
    };

    updatePosition();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updatePosition);
    observer?.observe(anchor);
    zone?.addEventListener('scroll', updatePosition, { passive: true });
    window.addEventListener('resize', updatePosition);

    return () => {
      observer?.disconnect();
      zone?.removeEventListener('scroll', updatePosition);
      window.removeEventListener('resize', updatePosition);
    };
  }, [activeCardInstanceId, activeCostIndex, variant]);

  const activeDef = activeCard ? getCardDef(activeCard.defId) : undefined;
  const activeEffectiveCost = activeDef
    ? Math.max(0, activeDef.powerCost - (activeDef.type === 'Character' ? powerCostReduction : 0))
    : Number.POSITIVE_INFINITY;
  const activeCostInsufficient = availablePower !== undefined && availablePower < activeEffectiveCost;

  return (
    <div
      ref={zoneRef}
      className={`handzone handzone-${variant}`}
      data-zone="hand"
      data-tut={tutId}
      role="group"
      aria-label={`${t('board.hand')} (${cards.length})`}
    >
      {cards.map((card, index) => {
        const isAllowed = !allowedCardDefIds || allowedCardDefIds.includes(card.defId);
        const def = getCardDef(card.defId);
        const effectiveCost = def
          ? Math.max(0, def.powerCost - (def.type === 'Character' ? powerCostReduction : 0))
          : Number.POSITIVE_INFINITY;
        const insufficient = availablePower !== undefined && availablePower < effectiveCost;
        const state: CardViewState = selectedIndex === index ? 'selected' : canAct && isAllowed ? 'playable' : 'idle';
        const fanStyle =
          variant === 'fan'
            ? {
                '--hand-rotate': `${(index - center) * 4}deg`,
                '--hand-counter-rotate': `${(center - index) * 4}deg`,
                '--hand-y': `${Math.abs(index - center) * 6}px`,
              }
            : undefined;
        return (
          <div
            ref={(element) => {
              cardRefs.current[index] = element;
            }}
            key={card.instanceId}
            className="handzone-card"
            style={fanStyle as React.CSSProperties | undefined}
            onMouseEnter={() => {
              setHoveredIndex(index);
              onCardHover?.(index);
            }}
            onMouseLeave={() => {
              setHoveredIndex((current) => (current === index ? null : current));
              onCardHover?.(null);
            }}
            onFocus={() => setFocusedIndex(index)}
            onBlur={() => setFocusedIndex((current) => (current === index ? null : current))}
          >
            <CardView
              card={card}
              size={variant === 'fan' ? 'lg' : 'md'}
              imageContext={variant === 'fan' ? 'hand' : 'thumbnail'}
              state={state}
              onActivate={onCardTap ? () => onCardTap(index) : undefined}
              tutId={card.defId}
            />
            {activeCostIndex === index && (variant === 'fan' || !costPopover) ? (
              <CardCostTag card={card} insufficient={insufficient} />
            ) : null}
          </div>
        );
      })}
      {cards.length === 0 && <span className="handzone-empty">—</span>}
      {variant === 'strip' && activeCard && costPopover
        ? createPortal(
            <CardCostTag
              card={activeCard}
              insufficient={activeCostInsufficient}
              className="handzone-cost-popover"
              style={{ left: costPopover.left, top: costPopover.top }}
            />,
            costPopover.host,
          )
        : null}
    </div>
  );
}
