import { createPortal } from 'react-dom';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type { CardDef, CardInstance, CardType, ChronosTime, Element } from '../game/types';
import { getCardDef } from '../game/cards/loader';
import { t, useLocale, type TranslationKey } from '../i18n';
import { getTranslatedEffect } from '../game/cards/i18n';

const ELEMENT_CLASS: Record<Element, string> = {
  闇: 'dark',
  炎: 'flame',
  電気: 'electric',
  風: 'wind',
  カオス: 'chaos',
};

const ELEMENT_LABEL_KEY: Record<Element, TranslationKey> = {
  闇: 'card.element.dark',
  炎: 'card.element.flame',
  電気: 'card.element.electric',
  風: 'card.element.wind',
  カオス: 'card.element.chaos',
};

const TYPE_LABEL_KEY: Record<CardType, TranslationKey> = {
  Character: 'card.type.character',
  Enchant: 'card.type.enchant',
  'Area Enchant': 'card.type.areaEnchant',
};

export type CardSize = 'normal' | 'small' | 'tiny' | 'micro';

interface CardProps {
  card: CardInstance;
  onClick?: () => void;
  selected?: boolean;
  small?: boolean;
  size?: CardSize;
  activeTime?: ChronosTime;
  className?: string;
  showBadges?: boolean;
  showPopover?: boolean;
}

export type PopoverPlacement = 'right' | 'left' | 'top' | 'bottom';

export type PopoverPosition = {
  top: number;
  left: number;
  placement: PopoverPlacement;
};

/**
 * 根據錨點元素的 DOMRect 計算 popover 顯示位置。
 * 抽成獨立函數供 Card 元件與 log 卡牌 chip 共用，避免重複實作定位邏輯。
 */
export function computePopoverPosition(rect: DOMRect): PopoverPosition {
  const popoverWidth = Math.min(Math.max(window.innerWidth * 0.16, 184), 248);
  const popoverHeight = Math.min(Math.max(window.innerHeight * 0.2, 220), 288);
  const gap = 12;
  const margin = 8;
  const centerY = rect.top + rect.height / 2;
  const centerX = rect.left + rect.width / 2;

  let placement: PopoverPlacement = 'right';
  let top = centerY;
  let left = rect.right + gap;

  if (left + popoverWidth > window.innerWidth - margin) {
    placement = 'left';
    left = rect.left - gap;
  }

  if (placement === 'right' || placement === 'left') {
    top = Math.min(Math.max(centerY, margin + popoverHeight / 2), window.innerHeight - margin - popoverHeight / 2);
  }

  if (placement === 'left' && left - popoverWidth < margin) {
    placement = 'bottom';
    left = Math.min(Math.max(centerX, margin + popoverWidth / 2), window.innerWidth - margin - popoverWidth / 2);
    top = rect.bottom + gap;
    if (top + popoverHeight > window.innerHeight - margin) {
      placement = 'top';
      top = rect.top - gap;
      if (top - popoverHeight < margin) {
        placement = 'bottom';
        top = rect.bottom + gap;
      }
    }
  }

  return { top, left, placement };
}

function cardClassName(
  def: CardDef | undefined,
  size: CardSize,
  options: {
    selected?: boolean;
    clickable?: boolean;
    faceDown?: boolean;
    activeTime?: ChronosTime;
    className?: string;
  },
): string {
  return [
    'card',
    'game-card',
    `card-${size}`,
    def ? `element-${ELEMENT_CLASS[def.element]}` : '',
    options.selected ? 'card-selected' : '',
    options.clickable ? 'card-clickable' : '',
    options.faceDown ? 'card-back' : '',
    options.activeTime ? `card-active-${options.activeTime}` : '',
    options.className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
}

function elementLabel(element: Element): string {
  return t(ELEMENT_LABEL_KEY[element]);
}

function typeLabel(type: CardType): string {
  return t(TYPE_LABEL_KEY[type]);
}

export function CardPopover({
  def,
  activeTime,
  position,
}: {
  def: CardDef;
  activeTime?: ChronosTime;
  position: PopoverPosition;
}) {
  const locale = useLocale();
  const translatedEffect = getTranslatedEffect(def.id, locale);
  const style: CSSProperties = {
    top: `${position.top}px`,
    left: `${position.left}px`,
  };

  return createPortal(
    <aside className={`card-popover popover-${position.placement}`} style={style} aria-hidden="true">
      <strong>{def.name}</strong>
      <span className="popover-meta">
        {elementLabel(def.element)} • {typeLabel(def.type)}
      </span>
      <div className="popover-rule" />
      {def.attack && (
        <>
          <span className={activeTime === 'night' ? 'active-stat' : ''}>
            {t('card.night')}: {def.attack.night}
          </span>
          <span className={activeTime === 'day' ? 'active-stat' : ''}>
            {t('card.day')}: {def.attack.day}
          </span>
        </>
      )}
      <span>
        {t('card.energy')}: {def.powerCost}
      </span>
      <span>
        {t('card.clock')}: {def.clock}
      </span>
      {def.sendToPower > 0 && (
        <span>
          {t('card.charge')}: {def.sendToPower}
        </span>
      )}
      {def.effect && (
        <>
          <div className="popover-rule" />
          <p className="popover-effect">{translatedEffect || def.effect}</p>
        </>
      )}
    </aside>,
    document.body,
  );
}

export function Card({
  card,
  onClick,
  selected,
  small,
  size,
  activeTime,
  className,
  showBadges = true,
  showPopover = false,
}: CardProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState<PopoverPosition | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [tappedOpen, setTappedOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const resolvedSize = size ?? (small ? 'small' : 'normal');
  const focusable = !!onClick || showPopover;
  const popoverVisible = showPopover && (hovered || focused || tappedOpen);

  useEffect(() => {
    setImageFailed(false);
  }, [card.defId]);

  const calculatePopoverPosition = useCallback((): PopoverPosition | null => {
    const element = cardRef.current;
    if (!element) return null;
    return computePopoverPosition(element.getBoundingClientRect());
  }, []);

  const updateCardPopoverPosition = useCallback(() => {
    const next = calculatePopoverPosition();
    if (!next) return;
    setPopoverPosition((current) => {
      if (
        current &&
        Math.abs(current.top - next.top) < 0.5 &&
        Math.abs(current.left - next.left) < 0.5 &&
        current.placement === next.placement
      ) {
        return current;
      }
      return next;
    });
  }, [calculatePopoverPosition]);

  useEffect(() => {
    if (!popoverVisible) {
      setPopoverPosition(null);
      return;
    }
    updateCardPopoverPosition();
    window.addEventListener('resize', updateCardPopoverPosition);
    window.addEventListener('scroll', updateCardPopoverPosition, true);
    return () => {
      window.removeEventListener('resize', updateCardPopoverPosition);
      window.removeEventListener('scroll', updateCardPopoverPosition, true);
    };
  }, [popoverVisible, card.instanceId, activeTime, updateCardPopoverPosition]);

  useEffect(() => {
    if (!tappedOpen) return;
    const handleDocumentDown = (event: MouseEvent | TouchEvent) => {
      if (cardRef.current && !cardRef.current.contains(event.target as Node)) {
        setTappedOpen(false);
      }
    };
    document.addEventListener('mousedown', handleDocumentDown);
    document.addEventListener('touchstart', handleDocumentDown);
    return () => {
      document.removeEventListener('mousedown', handleDocumentDown);
      document.removeEventListener('touchstart', handleDocumentDown);
    };
  }, [tappedOpen]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (showPopover && event.pointerType === 'touch') {
      setTappedOpen((prev) => !prev);
    }
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    if (showPopover) {
      setTappedOpen((prev) => !prev);
    }
    onClick?.();
  };

  if (!card.faceUp) {
    return (
      <div
        className={cardClassName(undefined, resolvedSize, { clickable: !!onClick, faceDown: true, className })}
        onClick={onClick}
        onKeyDown={
          onClick
            ? (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onClick();
                }
              }
            : undefined
        }
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
        aria-label={t('card.back')}
      >
        <div className="card-frame">
          <div className="card-back-frame">
            <img src="/card-back.jpg" alt="" className="h-full w-full object-cover" loading="lazy" />
          </div>
        </div>
      </div>
    );
  }

  const def = getCardDef(card.defId);

  if (!def) {
    return (
      <div className={cardClassName(undefined, resolvedSize, { className })}>
        <div className="card-frame">
          <div className="card-unknown">{t('card.unknown')}</div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={cardRef}
      className={cardClassName(def, resolvedSize, { selected, clickable: !!onClick, activeTime, className })}
      onClick={onClick}
      onPointerDown={showPopover ? handlePointerDown : undefined}
      onKeyDown={onClick || showPopover ? handleKeyDown : undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={focusable ? 0 : undefined}
      aria-label={def.name}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      <div className="card-frame">
        <div className="card-art">
          {imageFailed ? (
            <div className="card-art-fallback">{def.name}</div>
          ) : (
            <img
              src={def.image}
              alt={def.name}
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => setImageFailed(true)}
            />
          )}
          {showBadges && (
            <>
              <div className="card-cost-chip">{def.powerCost}</div>
              <div className="card-element-dot" aria-label={elementLabel(def.element)} />
            </>
          )}
        </div>
      </div>

      {popoverVisible && popoverPosition && (
        <CardPopover def={def} activeTime={activeTime} position={popoverPosition} />
      )}
    </div>
  );
}
