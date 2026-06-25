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

const TYPE_SHORT: Record<CardType, string> = {
  Character: '角',
  Enchant: '附',
  'Area Enchant': '域',
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

export function Card({ card, onClick, selected, small, size, activeTime, className }: CardProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const resolvedSize = size ?? (small ? 'small' : 'normal');

  useEffect(() => {
    setImageFailed(false);
  }, [card.defId]);

  if (!card.faceUp) {
    return (
      <div
        className={cardClassName(undefined, resolvedSize, { clickable: !!onClick, faceDown: true, className })}
        onClick={onClick}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
        aria-label={t('card.back')}
      >
        <div className="card-back-frame">
          <div className="card-back-sigil">ZC</div>
          <div className="card-back-ring" />
        </div>
      </div>
    );
  }

  const def = getCardDef(card.defId);

  if (!def) {
    return (
      <div className={cardClassName(undefined, resolvedSize, { className })}>
        <div className="card-unknown">{t('card.unknown')}</div>
      </div>
    );
  }

  return (
    <div
      className={cardClassName(def, resolvedSize, { selected, clickable: !!onClick, activeTime, className })}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={def.name}
    >
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
        <div className="card-cost-badge">{def.powerCost}</div>
        <div className="card-type-badge">{TYPE_SHORT[def.type]}</div>
      </div>

      <div className="card-body">
        <div className="card-title-row">
          <span className="card-name">{def.name}</span>
          <span className="card-element">{ELEMENT_LABEL[def.element]}</span>
        </div>
        <div className="card-meta-row">
          <span>{TYPE_LABEL[def.type]}</span>
          <span>{t('card.clock')} {def.clock}</span>
          {def.sendToPower > 0 && (
            <span className="card-charge">+{def.sendToPower}</span>
          )}
        </div>

        {def.type === 'Character' && def.attack && (
          <div className="card-attack-row">
            <span className={`attack-night ${activeTime === 'night' ? 'attack-active' : ''}`}>
              {t('card.night')} {def.attack.night}
            </span>
            <span className={`attack-day ${activeTime === 'day' ? 'attack-active' : ''}`}>
              {t('card.day')} {def.attack.day}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
