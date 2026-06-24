import { useState, useMemo } from 'react';
import type { CardDef, Element, CardType } from '../game/types';
import { getAllCardDefs } from '../game/cards/loader';
import { Card } from './Card';
import { createInstance } from '../game/cards/loader';
import type { CardInstance } from '../game/types';

interface DeckEditorProps {
  onSave: (deckIds: string[]) => void;
  onCancel: () => void;
  initialDeck?: string[];
}

const ELEMENTS: (Element | 'all')[] = ['all', '闇', '炎', '電気', '風', 'カオス'];
const TYPES: (CardType | 'all')[] = ['all', 'Character', 'Enchant', 'Area Enchant'];
const DECK_SIZE = 20;
const MAX_COPIES = 2;

export function DeckEditor({ onSave, onCancel, initialDeck = [] }: DeckEditorProps) {
  const allCards = useMemo(() => getAllCardDefs(), []);
  const [deck, setDeck] = useState<string[]>(initialDeck);
  const [filterElement, setFilterElement] = useState<Element | 'all'>('all');
  const [filterType, setFilterType] = useState<CardType | 'all'>('all');
  const [searchText, setSearchText] = useState('');
  const [sortBy, setSortBy] = useState<'cost' | 'attack' | 'name'>('cost');

  // Filter and sort available cards
  const filteredCards = useMemo(() => {
    let cards = allCards;

    if (filterElement !== 'all') {
      cards = cards.filter(c => c.element === filterElement);
    }
    if (filterType !== 'all') {
      cards = cards.filter(c => c.type === filterType);
    }
    if (searchText) {
      const q = searchText.toLowerCase();
      cards = cards.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.effect.toLowerCase().includes(q) ||
        c.song.toLowerCase().includes(q)
      );
    }

    // Sort
    cards = [...cards].sort((a, b) => {
      if (sortBy === 'cost') return a.powerCost - b.powerCost;
      if (sortBy === 'attack') {
        const aAtk = a.attack ? Math.max(a.attack.night, a.attack.day) : 0;
        const bAtk = b.attack ? Math.max(b.attack.night, b.attack.day) : 0;
        return bAtk - aAtk;
      }
      return a.name.localeCompare(b.name);
    });

    return cards;
  }, [allCards, filterElement, filterType, searchText, sortBy]);

  // Count copies of each card in deck
  const deckCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const id of deck) {
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    return counts;
  }, [deck]);

  const addCard = (cardId: string) => {
    const count = deckCounts.get(cardId) || 0;
    if (count >= MAX_COPIES) return;
    if (deck.length >= DECK_SIZE) return;
    setDeck([...deck, cardId]);
  };

  const removeCard = (index: number) => {
    setDeck(deck.filter((_, i) => i !== index));
  };

  const deckCards = useMemo(() => {
    return deck.map(id => allCards.find(c => c.id === id)).filter(Boolean) as CardDef[];
  }, [deck, allCards]);

  const characterCount = deckCards.filter(c => c.type === 'Character').length;
  const isValid = deck.length === DECK_SIZE && characterCount >= Math.ceil(DECK_SIZE * 0.5);

  return (
    <div className="deck-editor">
      <div className="deck-editor-header">
        <h2>🃏 Deck Editor</h2>
        <div className="deck-stats">
          <span className={deck.length === DECK_SIZE ? 'valid' : 'invalid'}>
            {deck.length}/{DECK_SIZE}
          </span>
          <span className={characterCount >= 10 ? 'valid' : 'invalid'}>
            Characters: {characterCount}
          </span>
          <button className="save-btn" disabled={!isValid} onClick={() => onSave(deck)}>
            Save Deck
          </button>
          <button className="cancel-btn" onClick={onCancel}>Cancel</button>
        </div>
      </div>

      <div className="deck-editor-body">
        {/* Filters */}
        <div className="filters">
          <input
            type="text"
            placeholder="Search card name/effect..."
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            className="search-input"
          />

          <div className="filter-row">
            <label>Element:</label>
            {ELEMENTS.map(el => (
              <button
                key={el}
                className={`filter-btn ${filterElement === el ? 'active' : ''}`}
                onClick={() => setFilterElement(el)}
              >
                {el === 'all' ? 'All' : el}
              </button>
            ))}
          </div>

          <div className="filter-row">
            <label>Type:</label>
            {TYPES.map(t => (
              <button
                key={t}
                className={`filter-btn ${filterType === t ? 'active' : ''}`}
                onClick={() => setFilterType(t)}
              >
                {t === 'all' ? 'All' : t === 'Character' ? 'C' : t === 'Enchant' ? 'E' : 'AE'}
              </button>
            ))}
          </div>

          <div className="filter-row">
            <label>Sort:</label>
            <button className={`filter-btn ${sortBy === 'cost' ? 'active' : ''}`} onClick={() => setSortBy('cost')}>Cost</button>
            <button className={`filter-btn ${sortBy === 'attack' ? 'active' : ''}`} onClick={() => setSortBy('attack')}>Attack</button>
            <button className={`filter-btn ${sortBy === 'name' ? 'active' : ''}`} onClick={() => setSortBy('name')}>Name</button>
          </div>
        </div>

        <div className="deck-editor-columns">
          {/* Card pool */}
          <div className="card-pool">
            <h3>Available Cards ({filteredCards.length})</h3>
            <div className="card-grid">
              {filteredCards.map(card => {
                const count = deckCounts.get(card.id) || 0;
                const canAdd = count < MAX_COPIES && deck.length < DECK_SIZE;
                return (
                  <div
                    key={card.id}
                    className={`pool-card ${!canAdd ? 'disabled' : ''} ${count > 0 ? 'in-deck' : ''}`}
                    onClick={() => canAdd && addCard(card.id)}
                  >
                    <Card card={createInstance(card.id, true)} small />
                    {count > 0 && <div className="copy-badge">×{count}</div>}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Current deck */}
          <div className="current-deck">
            <h3>Deck ({deck.length}/{DECK_SIZE})</h3>
            <div className="deck-list">
              {deckCards.map((card, i) => (
                <div key={i} className="deck-list-item" onClick={() => removeCard(i)}>
                  <span className="deck-card-element">{card.element}</span>
                  <span className="deck-card-name">{card.name}</span>
                  <span className="deck-card-cost">⚡{card.powerCost}</span>
                  {card.type === 'Character' && card.attack && (
                    <span className="deck-card-atk">
                      🌙{card.attack.night} ☀️{card.attack.day}
                    </span>
                  )}
                  <span className="deck-card-type">
                    {card.type === 'Character' ? 'C' : card.type === 'Enchant' ? 'E' : 'AE'}
                  </span>
                  <span className="remove-btn">✕</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
