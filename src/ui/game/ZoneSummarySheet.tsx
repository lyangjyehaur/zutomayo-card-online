import type { CardInstance } from '../../game/types';
import { getCardDef } from '../../game/cards/loader';
import { Sheet } from '../ui';
import { CardView } from './CardView';
import { t } from '../../i18n';

/**
 * ZoneSummarySheet — 深淵 / 充能區內容摘要（bottom sheet）。
 * 這兩區規則上公開可見，但戰場空間只放堆疊+計數；點擊堆疊開啟本 sheet
 * 檢視完整清單。牌組因資訊隱藏不提供內容，只在觸發端顯示張數。
 */
export interface ZoneSummarySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** power：顯示充能總值 */
  totalValue?: number;
  cards: CardInstance[];
  onInspectCard?: (card: CardInstance) => void;
}

export function ZoneSummarySheet({ open, onOpenChange, title, totalValue, cards, onInspectCard }: ZoneSummarySheetProps) {
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={
        totalValue !== undefined
          ? `${t('board.powerCharger')} ${totalValue} · ${cards.length} ${t('board.cardsUnit')}`
          : `${cards.length} ${t('board.cardsUnit')}`
      }
      closeLabel={t('common.close')}
    >
      {cards.length === 0 ? (
        <p className="zonesummary-empty">—</p>
      ) : (
        <ul className="zonesummary-grid">
          {cards.map((card) => {
            const def = getCardDef(card.defId);
            return (
              <li key={card.instanceId} className="zonesummary-item">
                <CardView
                  card={card}
                  size="md"
                  state="idle"
                  onActivate={onInspectCard ? () => onInspectCard(card) : undefined}
                  ariaLabel={def?.name}
                />
                <span className="zonesummary-name">{def?.name ?? t('card.back')}</span>
                {def && (
                  <span className="zonesummary-meta">
                    ⚡{def.powerCost} · STP {def.sendToPower ?? 0}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}
