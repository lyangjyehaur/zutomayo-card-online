import type { CardInstance } from '../../game/types';
import { CardView, type CardViewState } from './CardView';

/**
 * HandZone — 玩家手牌。
 * - fan（桌面）：扇形排列，hover 抬起；click 直接執行（由 Board 決定語義）。
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
  onCardTap: (index: number) => void;
  onCardHover?: (index: number | null) => void;
}

export function HandZone({ cards, variant, selectedIndex, canAct, onCardTap, onCardHover }: HandZoneProps) {
  const center = (cards.length - 1) / 2;
  return (
    <div className={`handzone handzone-${variant}`} data-zone="hand" role="group" aria-label={`hand (${cards.length})`}>
      {cards.map((card, index) => {
        const state: CardViewState = selectedIndex === index ? 'selected' : canAct ? 'playable' : 'idle';
        const fanStyle =
          variant === 'fan'
            ? {
                '--hand-rotate': `${(index - center) * 4}deg`,
                '--hand-y': `${Math.abs(index - center) * 6}px`,
              }
            : undefined;
        return (
          <div
            key={card.instanceId}
            className="handzone-card"
            style={fanStyle as React.CSSProperties | undefined}
            onMouseEnter={onCardHover ? () => onCardHover(index) : undefined}
            onMouseLeave={onCardHover ? () => onCardHover(null) : undefined}
          >
            <CardView
              card={card}
              size={variant === 'fan' ? 'lg' : 'md'}
              imageContext="hand"
              state={state}
              onActivate={() => onCardTap(index)}
              tutId={card.defId}
            />
          </div>
        );
      })}
      {cards.length === 0 && <span className="handzone-empty">—</span>}
    </div>
  );
}
