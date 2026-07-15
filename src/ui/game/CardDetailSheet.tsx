import type { GameState } from '../../game/types';
import { getCardDef } from '../../game/cards/loader';
import { getLocalizedCardName } from '../../game/cards/i18n';
import { Sheet } from '../primitives';
import { t, useLocale } from '../../i18n';
import { CardDetailBody, type FocusedCard } from './CardDetail';

/**
 * CardDetailSheet — 觸控端卡牌詳情 bottom sheet。
 * 與桌面 CardDetailPanel 共用 CardDetailBody，內容完全一致；
 * 行動端所有「查看卡牌」入口一律開這個 sheet，禁止另做 popover。
 */
export interface CardDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  focus: FocusedCard;
  G: GameState;
  ownerName?: string;
}

export function CardDetailSheet({ open, onOpenChange, focus, G, ownerName }: CardDetailSheetProps) {
  const locale = useLocale();
  const def =
    focus && focus.card.faceUp && focus.card.defId !== '__hidden__' ? getCardDef(focus.card.defId) : undefined;
  const title =
    focus && focus.card.faceUp && focus.card.defId !== '__hidden__'
      ? def
        ? getLocalizedCardName(def, locale)
        : t('card.unknown')
      : t('card.back');
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title} closeLabel={t('common.close')}>
      <CardDetailBody focus={focus} G={G} ownerName={ownerName} />
    </Sheet>
  );
}
