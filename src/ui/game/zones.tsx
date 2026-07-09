import type { CardInstance, ChronosTime } from '../../game/types';
import { t } from '../../i18n';
import { CardSlot, type CardSlotState } from './CardSlot';
import { CardStack } from './CardStack';
import { ZonePanel } from './ZonePanel';

/**
 * SetZone — 設置區（官方：セットゾーン A / B / C）。
 * 三個槽位的官方語義各不相同，UI 必須可區分，不做泛用卡槽：
 *   A：本回合設置的第 1 張（雙方每回合必有）
 *   B：本回合設置的第 2 張（僅上回合敗者可用）
 *   C：生效中的エリアエンチャント（跨回合持續；非本回合出牌槽）
 */
export interface SetZoneProps {
  slot: 'A' | 'B' | 'C';
  side: 'me' | 'opponent';
  card: CardInstance | null;
  chronosSide?: ChronosTime;
  size?: 'sm' | 'md';
  state?: CardSlotState;
  onActivate?: () => void;
  onInspect?: (card: CardInstance) => void;
}

export function SetZone({
  slot,
  side,
  card,
  chronosSide,
  size = 'md',
  state = 'idle',
  onActivate,
  onInspect,
}: SetZoneProps) {
  const visibleZoneName = slot === 'C' ? t('board.areaEnchant') : t('board.setZoneCompact' as never);
  const ariaZoneName = slot === 'C' ? t('board.areaEnchant') : slot === 'A' ? t('board.setZoneA') : t('board.setZoneB');
  const sideName = side === 'me' ? t('player.me') : t('player.opponent');
  return (
    <div
      className={`setzone setzone-${slot.toLowerCase()} setzone-${side}`}
      data-slot={slot}
      data-chronos-side={chronosSide}
    >
      <CardSlot
        label={slot}
        ariaLabel={`${sideName} ${ariaZoneName}`}
        card={card}
        size={size}
        state={state}
        onActivate={onActivate}
        onInspect={onInspect}
      />
      <span className="setzone-hint" aria-hidden="true">
        <span className="setzone-hint-full">{visibleZoneName}</span>
        <span className="setzone-hint-compact">{visibleZoneName}</span>
      </span>
    </div>
  );
}

/**
 * ChargeZone — 充能區（官方：パワーチャージャー）。
 * 官方語義：離場且有 SEND TO POWER 的卡牌置於此；全部 SEND TO POWER
 * 總和 = 玩家總パワー（發動效果/攻擊力的資源門檻）。
 * 總パワー是主數字；卡牌堆疊為來源，點擊開摘要檢視每張的貢獻。
 */
export interface ChargeZoneProps {
  side: 'me' | 'opponent';
  cards: CardInstance[];
  totalPower: number;
  chronosSide?: ChronosTime;
  size?: 'sm' | 'md';
  onOpen?: () => void;
  tutId?: string;
}

export function ChargeZone({ side, cards, totalPower, chronosSide, size = 'md', onOpen, tutId }: ChargeZoneProps) {
  return (
    <ZonePanel label={t('board.powerCharger')} side={side} tutId={tutId} className="chargezone">
      <span className="chargezone-total" aria-hidden="true">
        {t('board.powerTotal')} {totalPower}
      </span>
      <CardStack
        kind="power"
        size={size}
        label={t('board.powerCharger')}
        count={cards.length}
        value={totalPower}
        cards={cards}
        chronosSide={chronosSide}
        onOpen={onOpen}
        showLabel={false}
      />
    </ZonePanel>
  );
}

/**
 * AbyssZone — 深淵（官方：アビス）。
 * 官方語義：離場且「無」SEND TO POWER 的卡牌置於此（不產生資源）。
 * 內容公開，點擊開摘要。
 */
export interface AbyssZoneProps {
  side: 'me' | 'opponent';
  cards: CardInstance[];
  chronosSide?: ChronosTime;
  size?: 'sm' | 'md';
  onOpen?: () => void;
  tutId?: string;
}

export function AbyssZone({ side, cards, chronosSide, size = 'md', onOpen, tutId }: AbyssZoneProps) {
  return (
    <ZonePanel label={t('board.abyss')} side={side} tutId={tutId} className="abysszone">
      <CardStack
        kind="abyss"
        size={size}
        label={t('board.abyss')}
        count={cards.length}
        cards={cards}
        chronosSide={chronosSide}
        onOpen={onOpen}
        showLabel={false}
      />
    </ZonePanel>
  );
}

/**
 * DeckZone — 牌組區（官方：デッキゾーン）。
 * 官方語義：20 張、背面朝上；回合結束抽本回合出牌數；抽不到牌即敗北 —
 * 剩餘張數是勝負攸關資訊，必須常駐可見。內容因資訊隱藏不可檢視。
 */
export interface DeckZoneProps {
  side: 'me' | 'opponent';
  count: number;
  chronosSide?: ChronosTime;
  size?: 'sm' | 'md';
  tutId?: string;
}

export function DeckZone({ side, count, chronosSide, size = 'md', tutId }: DeckZoneProps) {
  return (
    <ZonePanel label={t('board.deck')} side={side} tutId={tutId} className="deckzone">
      <CardStack
        kind="deck"
        size={size}
        label={t('board.deck')}
        count={count}
        chronosSide={chronosSide}
        showLabel={false}
      />
    </ZonePanel>
  );
}
