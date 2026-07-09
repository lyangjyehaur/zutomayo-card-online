import type { CSSProperties } from 'react';
import type { CardInstance, ChronosTime } from '../../game/types';
import { getCardDef } from '../../game/cards/loader';
import { CardImage } from '../../components/CardImage';

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
  chronosSide?: ChronosTime;
  size?: 'sm' | 'md';
  /** 點擊開啟區域摘要（deck 不提供） */
  onOpen?: () => void;
  /** ZonePanel 已提供 label 時關閉內建標籤，避免重複 */
  showLabel?: boolean;
  tutId?: string;
  className?: string;
}

export function CardStack({
  kind,
  label,
  count,
  value,
  cards,
  chronosSide,
  size = 'md',
  onOpen,
  showLabel = true,
  tutId,
  className,
}: CardStackProps) {
  const thumbs = kind === 'power' ? [...(cards ?? [])].reverse() : [];
  const backLayers = kind === 'deck' || kind === 'abyss' ? Math.min(Math.max(count, 0), 3) : 0;
  const primary = count;
  const aria = kind === 'power' ? `${label}: ${value ?? 0} (${count})` : `${label}: ${count}`;
  const cls = ['cardstack', `cardstack-${size}`, `cardstack-${kind}`, className ?? ''].filter(Boolean).join(' ');

  const thumbStyle = (index: number): CSSProperties => {
    const center = (thumbs.length - 1) / 2;
    const maxOffset = size === 'sm' ? 0.95 : 1.25;
    const preferredStep = size === 'sm' ? 0.42 : 0.56;
    const step = thumbs.length > 1 ? Math.min(preferredStep, (maxOffset * 2) / (thumbs.length - 1)) : 0;
    const x = (index - center) * step;
    return {
      '--cardstack-thumb-offset': `${x.toFixed(3)}rem`,
      '--cardstack-thumb-z': thumbs.length - index,
    } as CSSProperties;
  };

  const backLayerStyle = (index: number): CSSProperties =>
    ({
      '--cardstack-layer-left': `${index * 0.22}rem`,
      '--cardstack-layer-bottom': `${index * 0.09}rem`,
      '--cardstack-layer-z': index + 1,
    }) as CSSProperties;

  const body = (
    <>
      <span className="cardstack-well" aria-hidden="true">
        {(kind === 'deck' || kind === 'abyss') &&
          Array.from({ length: backLayers }).map((_, i) => (
            <img
              key={i}
              src="/card-back.jpg"
              alt=""
              className="cardstack-back-layer"
              style={backLayerStyle(i)}
              loading="lazy"
              decoding="async"
              draggable={false}
            />
          ))}
        {kind === 'power' &&
          thumbs.map((card, i) => {
            const def = getCardDef(card.defId);
            return def?.image ? (
              <CardImage
                key={card.instanceId}
                cardId={def.id}
                context="thumbnail"
                alt=""
                className="cardstack-thumb"
                data-index={i}
                style={thumbStyle(i)}
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            ) : (
              <span
                key={card.instanceId}
                className="cardstack-thumb cardstack-thumb-back"
                data-index={i}
                style={thumbStyle(i)}
              />
            );
          })}
        {kind === 'power' && thumbs.length === 0 && <span className="cardstack-empty" />}
        <strong className="cardstack-count">{primary}</strong>
      </span>
      {showLabel && (
        <span className="cardstack-label" aria-hidden="true">
          {label}
          {kind === 'power' ? ` · ${count}` : ''}
        </span>
      )}
    </>
  );

  if (onOpen) {
    return (
      <button
        type="button"
        className={cls}
        data-chronos-side={chronosSide}
        data-tut={tutId}
        aria-label={aria}
        onClick={onOpen}
      >
        {body}
      </button>
    );
  }
  return (
    <div className={cls} data-chronos-side={chronosSide} data-tut={tutId} role="group" aria-label={aria}>
      {body}
    </div>
  );
}
