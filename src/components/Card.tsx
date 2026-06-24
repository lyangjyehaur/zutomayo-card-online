import type { CardDef, CardInstance, Element } from '../game/types';
import { getCardDef } from '../game/cards/loader';

const ELEMENT_COLORS: Record<Element, string> = {
  '闇': '#4a4a6a',
  '炎': '#e63946',
  '電気': '#f4d35e',
  '風': '#2ec4b6',
  'カオス': '#9b5de5',
};

const ELEMENT_EMOJI: Record<Element, string> = {
  '闇': '🌑',
  '炎': '🔥',
  '電気': '⚡',
  '風': '🌪️',
  'カオス': '🌀',
};

interface CardProps {
  card: CardInstance;
  onClick?: () => void;
  selected?: boolean;
  small?: boolean;
}

export function Card({ card, onClick, selected, small }: CardProps) {
  if (!card.faceUp) {
    return (
      <div className="card card-back" onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default' }}>
        <div className="card-back-pattern">ZC</div>
      </div>
    );
  }

  const def = getCardDef(card.defId);
  if (!def) return <div className="card card-unknown">?</div>;

  const size = small ? { width: 120, height: 170 } : { width: 160, height: 225 };

  return (
    <div
      className={`card ${selected ? 'card-selected' : ''}`}
      onClick={onClick}
      style={{
        ...size,
        borderColor: ELEMENT_COLORS[def.element],
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <div className="card-header">
        <span className="card-type">{def.type === 'Character' ? 'C' : def.type === 'Enchant' ? 'E' : 'AE'}</span>
        <span className="card-name">{def.name}</span>
      </div>

      <div className="card-image">
        <img src={def.image} alt={def.name} loading="lazy" referrerPolicy="no-referrer" />
      </div>

      <div className="card-info">
        <span className="card-element">
          {ELEMENT_EMOJI[def.element]} {def.element}
        </span>
        {def.type === 'Character' && def.attack && (
          <div className="card-attack">
            <span className="night">🌙 {def.attack.night}</span>
            <span className="day">☀️ {def.attack.day}</span>
          </div>
        )}
      </div>

      <div className="card-footer">
        <span className="card-clock">⏱ {def.clock}</span>
        <span className="card-cost">⚡{def.powerCost}</span>
        {def.sendToPower > 0 && <span className="card-stp">STP:{def.sendToPower}</span>}
      </div>

      {def.effect && (
        <div className="card-effect">{def.effect.substring(0, 60)}{def.effect.length > 60 ? '...' : ''}</div>
      )}
    </div>
  );
}
