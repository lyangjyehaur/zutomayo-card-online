import type { CardInstance } from '../../game/types';
import { getCardDef } from '../../game/cards/loader';
import { getLocalizedCardName } from '../../game/cards/i18n';
import { Sheet } from '../primitives';
import { CardView } from './CardView';
import { t, useLocale } from '../../i18n';

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

export function ZoneSummarySheet({
  open,
  onOpenChange,
  title,
  totalValue,
  cards,
  onInspectCard,
}: ZoneSummarySheetProps) {
  const locale = useLocale();
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
            const localizedName = def ? getLocalizedCardName(def, locale) : t('card.back');
            return (
              <li key={card.instanceId} className="zonesummary-item">
                <CardView
                  card={card}
                  size="md"
                  imageContext="thumbnail"
                  state="idle"
                  onActivate={onInspectCard ? () => onInspectCard(card) : undefined}
                  ariaLabel={localizedName}
                />
                <span className="zonesummary-name">{localizedName}</span>
                {def && (
                  <span className="zonesummary-meta">
                    {t('card.energy')} {def.powerCost} · {t('card.charge')} {def.sendToPower ?? 0}
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
