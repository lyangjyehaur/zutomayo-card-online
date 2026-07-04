import type { CardInstance } from '../../game/types';
import { CardView, type CardViewSize, type CardViewState } from './CardView';

/**
 * CardSlot — 戰場槽位（設置區 A/B/C、戰鬥區）。
 * 空槽顯示區名水印；佔用時渲染 CardView；undoable / targetable 狀態
 * 由 data-state 驅動（樣式見 battle.css）。槽位尺寸 = 卡牌 token + padding，
 * 永遠維持直向比例，禁止壓扁。
 */
export type CardSlotState = 'idle' | 'undoable' | 'targetable' | 'highlight';

export interface CardSlotProps {
  /** 槽位水印（A / B / C / 戰） */
  label: string;
  /** 無障礙標籤：完整區域名稱 */
  ariaLabel: string;
  card: CardInstance | null;
  size?: Extract<CardViewSize, 'sm' | 'md' | 'lg'>;
  state?: CardSlotState;
  /** 點擊槽位（撤回已設置卡 / 選擇目標） */
  onActivate?: () => void;
  onInspect?: (card: CardInstance) => void;
  onInspectEnd?: () => void;
  className?: string;
  tutId?: string;
}

function cardState(slotState: CardSlotState): CardViewState {
  if (slotState === 'undoable') return 'playable';
  if (slotState === 'targetable') return 'targetable';
  return 'idle';
}

export function CardSlot({
  label,
  ariaLabel,
  card,
  size = 'md',
  state = 'idle',
  onActivate,
  onInspect,
  onInspectEnd,
  className,
  tutId,
}: CardSlotProps) {
  const cls = ['cardslot', `cardslot-${size}`, className ?? ''].filter(Boolean).join(' ');
  const interactive = Boolean(onActivate);

  const inner = card ? (
    <CardView
      card={card}
      size={size}
      state={cardState(state)}
      onActivate={onActivate}
      onInspect={onInspect ? () => onInspect(card) : undefined}
      onInspectEnd={onInspectEnd}
      ariaLabel={`${ariaLabel}${interactive ? '' : ''}`}
    />
  ) : (
    <span className="cardslot-watermark" aria-hidden="true">
      {label}
    </span>
  );

  if (!card && interactive) {
    return (
      <button type="button" className={cls} data-state={state} data-tut={tutId} aria-label={ariaLabel} onClick={onActivate}>
        {inner}
      </button>
    );
  }

  return (
    <div className={cls} data-state={state} data-tut={tutId} role="group" aria-label={ariaLabel}>
      {inner}
    </div>
  );
}
