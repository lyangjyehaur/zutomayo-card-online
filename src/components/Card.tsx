import { useEffect, useState } from 'react';
import type { CardDef, CardInstance, CardType, ChronosTime, Element } from '../game/types';
import { getCardDef } from '../game/cards/loader';
import { t } from '../i18n';

const ELEMENT_CLASS: Record<Element, string> = {
  '闇': 'dark',
  '炎': 'flame',
  '電気': 'electric',
  '風': 'wind',
  'カオス': 'chaos',
};

const ELEMENT_LABEL: Record<Element, string> = {
  '闇': t('card.element.dark'),
  '炎': t('card.element.flame'),
  '電気': t('card.element.electric'),
  '風': t('card.element.wind'),
  'カオス': t('card.element.chaos'),
};

const TYPE_LABEL: Record<CardType, string> = {
  Character: t('card.type.character'),
  Enchant: t('card.type.enchant'),
  'Area Enchant': t('card.type.areaEnchant'),
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

function cardClassName(def: CardDef | undefined, size: CardSize, options: {
  selected?: boolean;
  clickable?: boolean;
  faceDown?: boolean;
  activeTime?: ChronosTime;
  className?: string;
}): string {
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
  ].filter(Boolean).join(' ');
}

function CardPopover({ def, activeTime }: { def: CardDef; activeTime?: ChronosTime }) {
  return (
    <aside className="card-popover" aria-hidden="true">
      <strong>{def.name}</strong>
      <span className="popover-meta">{ELEMENT_LABEL[def.element]} • {TYPE_LABEL[def.type]}</span>
      <div className="popover-rule" />
      {def.attack && (
        <>
          <span className={activeTime === 'night' ? 'active-stat' : ''}>{t('card.night')}: {def.attack.night}</span>
          <span className={activeTime === 'day' ? 'active-stat' : ''}>{t('card.day')}: {def.attack.day}</span>
        </>
      )}
      <span>{t('card.energy')}: {def.powerCost}</span>
      <span>{t('card.clock')}: {def.clock}</span>
      {def.sendToPower > 0 && <span>{t('card.charge')}: {def.sendToPower}</span>}
      {def.effect && (
        <>
          <div className="popover-rule" />
          <p>{def.effect}</p>
        </>
      )}
    </aside>
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
  const resolvedSize = size ?? (small ? 'small' : 'normal');
  const focusable = !!onClick || showPopover;

  useEffect(() => {
    setImageFailed(false);
  }, [card.defId]);

  if (!card.faceUp) {
    return (
      <div
        className={cardClassName(undefined, resolvedSize, { clickable: !!onClick, faceDown: true, className })}
        onClick={onClick}
        onKeyDown={onClick ? event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onClick();
          }
        } : undefined}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
        aria-label={t('card.back')}
      >
        <div className="card-frame">
          <div className="card-back-frame">
            <div className="card-back-sigil">ZC</div>
            <div className="card-back-ring" />
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
      className={cardClassName(def, resolvedSize, { selected, clickable: !!onClick, activeTime, className })}
      onClick={onClick}
      onKeyDown={onClick ? event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      } : undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={focusable ? 0 : undefined}
      aria-label={def.name}
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
              <div className="card-cost-badge">{def.powerCost}</div>
              <div className="card-element-dot" aria-label={ELEMENT_LABEL[def.element]} />
            </>
          )}
        </div>
      </div>

      {showPopover && <CardPopover def={def} activeTime={activeTime} />}
    </div>
  );
}
