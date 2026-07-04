import type { CardInstance } from '../../game/types';
import { getCardDef } from '../../game/cards/loader';

/**
 * CardStack — 牌組 / 深淵 / 充能區的堆疊呈現。
 * 空間有限的區域不展開卡牌，改為錯位縮圖（最多 3 張）＋計數；
 * 點擊開啟 ZoneSummarySheet 查看完整內容（牌組除外：資訊隱藏，只有張數）。
 */
export interface CardStackProps {
  kind: 'deck' | 'abyss' | 'power';
  label: string;
  count: number;
  /** power：充能總值（顯示為主數字） */
  value?: number;
  /** 可公開的堆疊內容（abyss / power），用於縮圖與摘要 */
  cards?: CardInstance[];
  size?: 'sm' | 'md';
  /** 點擊開啟區域摘要（deck 不提供） */
  onOpen?: () => void;
  tutId?: string;
  className?: string;
}

export function CardStack({ kind, label, count, value, cards, size = 'md', onOpen, tutId, className }: CardStackProps) {
  const thumbs = kind === 'deck' ? [] : (cards ?? []).slice(-3);
  const primary = kind === 'power' ? (value ?? 0) : count;
  const aria = kind === 'power' ? `${label}: ${value ?? 0} (${count})` : `${label}: ${count}`;
  const cls = ['cardstack', `cardstack-${size}`, `cardstack-${kind}`, className ?? ''].filter(Boolean).join(' ');

  const body = (
    <>
      <span className="cardstack-well" aria-hidden="true">
        {kind === 'deck' &&
          Array.from({ length: Math.min(count, 3) }).map((_, i) => (
            <img key={i} src="/card-back.jpg" alt="" className="cardstack-thumb" data-index={i} loading="lazy" />
          ))}
        {kind !== 'deck' &&
          thumbs.map((card, i) => {
            const def = getCardDef(card.defId);
            return def?.image ? (
              <img
                key={card.instanceId}
                src={def.image}
                alt=""
                className="cardstack-thumb"
                data-index={i}
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            ) : (
              <span key={card.instanceId} className="cardstack-thumb cardstack-thumb-back" data-index={i} />
            );
          })}
        {kind !== 'deck' && thumbs.length === 0 && <span className="cardstack-empty" />}
        <strong className="cardstack-count">{primary}</strong>
      </span>
      <span className="cardstack-label" aria-hidden="true">
        {label}
        {kind === 'power' ? ` · ${count}` : ''}
      </span>
    </>
  );

  if (onOpen) {
    return (
      <button type="button" className={cls} data-tut={tutId} aria-label={aria} onClick={onOpen}>
        {body}
      </button>
    );
  }
  return (
    <div className={cls} data-tut={tutId} role="group" aria-label={aria}>
      {body}
    </div>
  );
}
