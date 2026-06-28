import { useEffect, useMemo, useState } from 'react';
import type { CardDef, CardType, Element } from '../game/types';
import { getAllCardDefs } from '../game/cards/loader';
import { Card } from './Card';
import { CUSTOM_DECK_STORAGE_KEY, loadCustomDeckIds } from '../game/cards/deckBuilder';
import { t } from '../i18n';

interface DeckEditorProps {
  onSave: (deckIds: string[]) => void | Promise<void>;
  onCancel: () => void;
  initialDeck?: string[];
  deckName?: string;
  onDeckNameChange?: (name: string) => void;
  saveLabel?: string;
  saving?: boolean;
  synced?: boolean;
  syncLabel?: string;
  errorMessage?: string;
  saveLocalDeck?: boolean;
}

const ELEMENTS: (Element | 'all')[] = ['all', '闇', '炎', '電気', '風', 'カオス'];
const TYPES: (CardType | 'all')[] = ['all', 'Character', 'Enchant', 'Area Enchant'];
const DECK_SIZE = 20;
const MAX_COPIES = 2;
const PAGE_SIZE = 12;

function elementLabel(element: Element | 'all'): string {
  if (element === 'all') return t('deckEditor.all');
  const labels: Record<Element, string> = {
    闇: t('card.element.dark'),
    炎: t('card.element.flame'),
    電気: t('card.element.electric'),
    風: t('card.element.wind'),
    カオス: t('card.element.chaos'),
  };
  return labels[element];
}

function typeLabel(type: CardType | 'all'): string {
  if (type === 'all') return t('deckEditor.all');
  const labels: Record<CardType, string> = {
    Character: t('card.type.character'),
    Enchant: t('card.type.enchant'),
    'Area Enchant': t('card.type.areaEnchant'),
  };
  return labels[type];
}

function typeShort(type: CardType): string {
  if (type === 'Character') return '角';
  if (type === 'Enchant') return '附';
  return '域';
}

export function DeckEditor({
  onSave,
  onCancel,
  initialDeck = [],
  deckName,
  onDeckNameChange,
  saveLabel,
  saving = false,
  synced = false,
  syncLabel,
  errorMessage,
  saveLocalDeck = true,
}: DeckEditorProps) {
  const allCards = useMemo(() => getAllCardDefs(), []);
  const [deck, setDeck] = useState<string[]>(() =>
    initialDeck.length > 0 ? initialDeck : (loadCustomDeckIds() ?? []),
  );
  const [filterElement, setFilterElement] = useState<Element | 'all'>('all');
  const [filterType, setFilterType] = useState<CardType | 'all'>('all');
  const [searchText, setSearchText] = useState('');
  const [sortBy, setSortBy] = useState<'cost' | 'attack' | 'name'>('cost');
  const [page, setPage] = useState(0);

  const filteredCards = useMemo(() => {
    let cards = allCards;

    if (filterElement !== 'all') cards = cards.filter((card) => card.element === filterElement);
    if (filterType !== 'all') cards = cards.filter((card) => card.type === filterType);
    if (searchText) {
      const query = searchText.toLowerCase();
      cards = cards.filter(
        (card) =>
          card.name.toLowerCase().includes(query) ||
          card.effect.toLowerCase().includes(query) ||
          card.song.toLowerCase().includes(query),
      );
    }

    return [...cards].sort((a, b) => {
      if (sortBy === 'cost') return a.powerCost - b.powerCost;
      if (sortBy === 'attack') {
        const aAttack = a.attack ? Math.max(a.attack.night, a.attack.day) : 0;
        const bAttack = b.attack ? Math.max(b.attack.night, b.attack.day) : 0;
        return bAttack - aAttack;
      }
      return a.name.localeCompare(b.name);
    });
  }, [allCards, filterElement, filterType, searchText, sortBy]);

  useEffect(() => {
    setPage(0);
  }, [filterElement, filterType, searchText, sortBy]);

  useEffect(() => {
    if (initialDeck.length > 0) setDeck(initialDeck);
  }, [initialDeck]);

  const deckCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const id of deck) counts.set(id, (counts.get(id) ?? 0) + 1);
    return counts;
  }, [deck]);

  const deckCards = useMemo(
    () => deck.map((id) => allCards.find((card) => card.id === id)).filter(Boolean) as CardDef[],
    [deck, allCards],
  );

  const characterCount = deckCards.filter((card) => card.type === 'Character').length;
  const copyLimitValid = [...deckCounts.values()].every((count) => count <= MAX_COPIES);
  const isValid =
    deck.length === DECK_SIZE &&
    deckCards.length === deck.length &&
    characterCount >= Math.ceil(DECK_SIZE * 0.5) &&
    copyLimitValid;

  const totalPages = Math.max(1, Math.ceil(filteredCards.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const visibleCards = filteredCards.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);

  const addCard = (cardId: string) => {
    const count = deckCounts.get(cardId) ?? 0;
    if (count >= MAX_COPIES || deck.length >= DECK_SIZE) return;
    setDeck((current) => [...current, cardId]);
  };

  const removeCard = (index: number) => {
    setDeck((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  const saveDeck = async () => {
    if (saveLocalDeck) localStorage.setItem(CUSTOM_DECK_STORAGE_KEY, JSON.stringify(deck));
    await onSave(deck);
  };

  return (
    <main className="min-h-screen container mx-auto flex flex-col gap-4 p-4">
      <header className="navbar rounded-box bg-base-200 shadow-xl">
        <div className="flex-1">
          <span>{t('lobby.menu')}</span>
          <h1 className="text-2xl font-bold text-primary">{t('deckEditor.title')}</h1>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {onDeckNameChange && (
            <label className="form-control w-48">
              <span>{t('deck.custom')}</span>
              <input
                className="input input-bordered input-sm"
                value={deckName ?? ''}
                aria-label={t('deck.custom')}
                onChange={(event) => onDeckNameChange(event.target.value)}
              />
            </label>
          )}
          {syncLabel && <span className={synced ? 'badge badge-success' : 'badge badge-warning'}>{syncLabel}</span>}
          <button className="btn btn-ghost" type="button" onClick={onCancel}>
            {t('common.backToLobby')}
          </button>
          <button className="btn btn-primary" type="button" disabled={!isValid || saving} onClick={saveDeck}>
            {saveLabel ?? t('deckEditor.saveDeck')}
          </button>
        </div>
      </header>

      {errorMessage && (
        <div className="alert alert-error" role="alert">
          {errorMessage}
        </div>
      )}

      <section className="stats shadow">
        <div className="stat">
          <strong className={deck.length === DECK_SIZE ? 'stat-value text-success' : 'stat-value text-warning'}>
            {deck.length}/{DECK_SIZE}
          </strong>
          <span className="stat-title">{t('deckEditor.ruleSize')}</span>
        </div>
        <div className="stat">
          <strong className={characterCount >= 10 ? 'stat-value text-success' : 'stat-value text-warning'}>
            {characterCount}
          </strong>
          <span className="stat-title">{t('deckEditor.ruleCharacters')}</span>
        </div>
        <div className="stat">
          <strong className={copyLimitValid ? 'stat-value text-success' : 'stat-value text-warning'}>
            {MAX_COPIES}
          </strong>
          <span className="stat-title">{t('deckEditor.ruleCopies')}</span>
        </div>
        <div className="stat">
          <strong className={isValid ? 'badge badge-success' : 'badge badge-warning'}>
            {isValid ? t('deckEditor.valid') : t('deckEditor.invalid')}
          </strong>
        </div>
      </section>

      <section className="deck-workspace">
        <div className="collection-panel">
          <div className="grid gap-3">
            <input
              className="input input-bordered"
              type="search"
              placeholder={t('deckEditor.search')}
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
            />
            <div className="flex flex-wrap items-center gap-2">
              <span>{t('deckEditor.filterElement')}</span>
              {ELEMENTS.map((element) => (
                <button
                  key={element}
                  className={`btn btn-sm ${filterElement === element ? 'btn-primary' : 'btn-ghost'}`}
                  type="button"
                  onClick={() => setFilterElement(element)}
                >
                  {elementLabel(element)}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span>{t('deckEditor.filterType')}</span>
              {TYPES.map((type) => (
                <button
                  key={type}
                  className={`btn btn-sm ${filterType === type ? 'btn-primary' : 'btn-ghost'}`}
                  type="button"
                  onClick={() => setFilterType(type)}
                >
                  {typeLabel(type)}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span>{t('deckEditor.sort')}</span>
              <button
                className={`btn btn-sm ${sortBy === 'cost' ? 'btn-primary' : 'btn-ghost'}`}
                type="button"
                onClick={() => setSortBy('cost')}
              >
                {t('deckEditor.sortCost')}
              </button>
              <button
                className={`btn btn-sm ${sortBy === 'attack' ? 'btn-primary' : 'btn-ghost'}`}
                type="button"
                onClick={() => setSortBy('attack')}
              >
                {t('deckEditor.sortAttack')}
              </button>
              <button
                className={`btn btn-sm ${sortBy === 'name' ? 'btn-primary' : 'btn-ghost'}`}
                type="button"
                onClick={() => setSortBy('name')}
              >
                {t('deckEditor.sortName')}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <h2>
              {t('deckEditor.cardPool')} ({filteredCards.length})
            </h2>
            <div className="join">
              <button
                className="btn btn-sm join-item"
                type="button"
                disabled={currentPage === 0}
                onClick={() => setPage((value) => Math.max(0, value - 1))}
              >
                {t('common.prev')}
              </button>
              <span className="btn btn-sm btn-disabled join-item">
                {currentPage + 1}/{totalPages} {t('common.page')}
              </span>
              <button
                className="btn btn-sm join-item"
                type="button"
                disabled={currentPage >= totalPages - 1}
                onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))}
              >
                {t('common.next')}
              </button>
            </div>
          </div>

          <div className="card-pool-grid">
            {visibleCards.map((card) => {
              const count = deckCounts.get(card.id) ?? 0;
              const canAdd = count < MAX_COPIES && deck.length < DECK_SIZE;
              return (
                <button
                  key={card.id}
                  className={`pool-card ${count > 0 ? 'in-deck' : ''}`}
                  type="button"
                  disabled={!canAdd}
                  onClick={() => addCard(card.id)}
                >
                  <Card card={{ instanceId: `pool-${card.id}`, defId: card.id, faceUp: true }} size="tiny" />
                  {count > 0 && (
                    <span className="copy-badge">
                      {t('deckEditor.copyCount')} {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <aside className="current-deck-panel">
          <div className="flex items-center justify-between gap-3">
            <h2>{t('deckEditor.currentDeck')}</h2>
            <span className="badge badge-primary">
              {deck.length}/{DECK_SIZE}
            </span>
          </div>
          <div className="deck-slot-grid">
            {Array.from({ length: DECK_SIZE }, (_, index) => {
              const card = deckCards[index];
              if (!card) {
                return (
                  <div key={`empty-${index}`} className="deck-slot empty">
                    {t('deckEditor.emptySlot')}
                  </div>
                );
              }
              return (
                <button
                  key={`${card.id}-${index}`}
                  className="deck-slot"
                  type="button"
                  onClick={() => removeCard(index)}
                >
                  <span className="deck-card-type">{typeShort(card.type)}</span>
                  <strong>{card.name}</strong>
                  <span>
                    {t('card.energy')} {card.powerCost}
                  </span>
                  <em>{t('deckEditor.removeCard')}</em>
                </button>
              );
            })}
          </div>
        </aside>
      </section>
    </main>
  );
}
