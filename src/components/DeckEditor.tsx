import { useEffect, useMemo, useState } from 'react';
import type { CardDef, CardType, Element } from '../game/types';
import { getAllCardDefs } from '../game/cards/loader';
import { CUSTOM_DECK_STORAGE_KEY, loadCustomDeckIds } from '../game/cards/deckBuilder';
import { t } from '../i18n';
import { ArrowLeft, Search, Save, ChevronLeft, ChevronRight } from 'lucide-react';

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

  const deckEntries = useMemo(() => {
    const entries: { card: CardDef; count: number; firstIndex: number }[] = [];
    const indexMap = new Map<string, number>();
    deck.forEach((id, index) => {
      const card = allCards.find((item) => item.id === id);
      if (!card) return;
      const existing = indexMap.get(id);
      if (existing !== undefined) {
        entries[existing].count += 1;
      } else {
        indexMap.set(id, entries.length);
        entries.push({ card, count: 1, firstIndex: index });
      }
    });
    return entries;
  }, [deck, allCards]);

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

  const emptySlotCount = Math.max(0, DECK_SIZE - deck.length);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-lacquer-deep text-bone font-sans">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-40 top-0 h-[60vh] w-[60vh] rounded-full bg-gold/8 blur-[140px]" />
      </div>

      <header className="absolute inset-x-0 top-0 z-30 flex h-12 items-center justify-between border-b border-bone/5 bg-lacquer-deep/80 px-6 backdrop-blur">
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] text-bone/50 transition hover:text-bone"
        >
          <ArrowLeft className="size-3.5" /> {t('common.backToLobby')}
        </button>
        <div className="font-display text-sm italic">Deck Editor · 牌組編輯</div>
        <div className="flex items-center gap-3">
          {onDeckNameChange && (
            <input
              value={deckName ?? ''}
              aria-label={t('deck.custom')}
              placeholder={t('deck.custom')}
              onChange={(event) => onDeckNameChange(event.target.value)}
              className="w-40 border border-bone/10 bg-transparent px-3 py-1.5 text-xs text-bone placeholder:text-bone/30 focus:border-gold/40 focus:outline-none"
            />
          )}
          {syncLabel && (
            <span
              className={`font-mono text-[10px] uppercase tracking-[0.3em] ${synced ? 'text-gold' : 'text-bone/40'}`}
            >
              {syncLabel}
            </span>
          )}
          <button
            type="button"
            disabled={!isValid || saving}
            onClick={saveDeck}
            className="flex items-center gap-2 bg-bone px-4 py-1.5 text-[10px] uppercase tracking-[0.3em] text-lacquer transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100"
          >
            <Save className="size-3.5" /> {saveLabel ?? t('deckEditor.saveDeck')}
          </button>
        </div>
      </header>

      {errorMessage && (
        <div
          className="absolute inset-x-0 top-12 z-30 bg-vermilion/10 px-6 py-1.5 text-[10px] text-vermilion/80"
          role="alert"
        >
          {errorMessage}
        </div>
      )}

      <div className="relative z-10 grid h-full grid-cols-[1fr_320px] gap-4 px-6 pb-6 pt-16">
        <section className="flex min-h-0 flex-col rounded-sm bg-lacquer/60 p-5 ring-1 ring-bone/10">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <div className="text-[10px] uppercase tracking-[0.3em] text-gold/70">Archive</div>
              <h2 className="font-display text-2xl italic">Card Pool</h2>
            </div>
            <div className="flex items-center gap-2 border border-bone/10 px-3 py-1.5">
              <Search className="size-3.5 text-bone/40" />
              <input
                type="search"
                placeholder={t('deckEditor.search')}
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                className="w-56 bg-transparent text-xs text-bone placeholder:text-bone/30 focus:outline-none"
              />
            </div>
          </div>

          <div className="mb-4 space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[10px] uppercase tracking-[0.3em] text-bone/40">
                {t('deckEditor.filterElement')}
              </span>
              {ELEMENTS.map((element) => (
                <button
                  key={element}
                  type="button"
                  onClick={() => setFilterElement(element)}
                  className={`text-[10px] uppercase tracking-[0.3em] transition ${
                    filterElement === element ? 'text-gold' : 'text-bone/40 hover:text-bone'
                  }`}
                >
                  {elementLabel(element)}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[10px] uppercase tracking-[0.3em] text-bone/40">{t('deckEditor.filterType')}</span>
              {TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setFilterType(type)}
                  className={`text-[10px] uppercase tracking-[0.3em] transition ${
                    filterType === type ? 'text-gold' : 'text-bone/40 hover:text-bone'
                  }`}
                >
                  {typeLabel(type)}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[10px] uppercase tracking-[0.3em] text-bone/40">{t('deckEditor.sort')}</span>
              {(['cost', 'attack', 'name'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setSortBy(option)}
                  className={`text-[10px] uppercase tracking-[0.3em] transition ${
                    sortBy === option ? 'text-gold' : 'text-bone/40 hover:text-bone'
                  }`}
                >
                  {option === 'cost'
                    ? t('deckEditor.sortCost')
                    : option === 'attack'
                      ? t('deckEditor.sortAttack')
                      : t('deckEditor.sortName')}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-3 flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-bone/40">
              {filteredCards.length} · {currentPage + 1}/{totalPages}
            </span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={currentPage === 0}
                onClick={() => setPage((value) => Math.max(0, value - 1))}
                className="flex items-center gap-1 text-[10px] uppercase tracking-[0.3em] text-bone/40 transition hover:text-bone disabled:opacity-30 disabled:hover:text-bone/40"
              >
                <ChevronLeft className="size-3.5" /> {t('common.prev')}
              </button>
              <button
                type="button"
                disabled={currentPage >= totalPages - 1}
                onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))}
                className="flex items-center gap-1 text-[10px] uppercase tracking-[0.3em] text-bone/40 transition hover:text-bone disabled:opacity-30 disabled:hover:text-bone/40"
              >
                {t('common.next')} <ChevronRight className="size-3.5" />
              </button>
            </div>
          </div>

          <div className="deck-pool-list min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
            {visibleCards.map((card) => {
              const count = deckCounts.get(card.id) ?? 0;
              const canAdd = count < MAX_COPIES && deck.length < DECK_SIZE;
              return (
                <button
                  key={card.id}
                  type="button"
                  disabled={!canAdd}
                  onClick={() => addCard(card.id)}
                  className={`group flex w-full items-stretch gap-3 rounded-sm bg-lacquer-deep/60 p-2 text-left ring-1 transition hover:-translate-y-0.5 hover:ring-gold/40 focus:outline-none focus:ring-gold/40 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:ring-bone/10 ${
                    count > 0 ? 'ring-gold/30' : 'ring-bone/10'
                  }`}
                >
                  {/* 左：卡圖 */}
                  <div className="relative aspect-[5/7] w-14 shrink-0 overflow-hidden rounded-xs ring-1 ring-bone/10">
                    <img
                      src={card.image}
                      alt={card.name}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="absolute inset-0 size-full object-cover"
                    />
                    <span className="absolute left-0.5 top-0.5 rounded-full bg-lacquer-deep/85 px-1 py-0.5 font-mono text-[8px] leading-none text-gold">
                      {card.powerCost}
                    </span>
                    {count > 0 && (
                      <span className="absolute bottom-0.5 right-0.5 rounded-full bg-gold/30 px-1 py-0.5 font-mono text-[8px] leading-none text-gold ring-1 ring-gold/40">
                        ×{count}
                      </span>
                    )}
                  </div>
                  {/* 右：meta 資訊 */}
                  <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate font-display text-sm font-medium text-bone/90">{card.name}</span>
                      <span className="shrink-0 font-mono text-[9px] uppercase tracking-widest text-bone/40">
                        {elementLabel(card.element)} · {typeLabel(card.type)}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[9px] uppercase tracking-widest text-bone/50">
                      <span>
                        <span className="text-gold/60">COST</span> {card.powerCost}
                      </span>
                      {card.attack && (
                        <span>
                          <span className="text-gold/60">ATK</span> {card.attack.night}/{card.attack.day}
                        </span>
                      )}
                      <span>
                        <span className="text-gold/60">CLK</span> {card.clock}
                      </span>
                      {card.sendToPower > 0 && (
                        <span>
                          <span className="text-gold/60">CHG</span> {card.sendToPower}
                        </span>
                      )}
                      <span className="text-bone/30">{card.rarity}</span>
                    </div>
                    {card.effect && (
                      <p className="line-clamp-1 text-[10px] leading-snug text-bone/40">{card.effect}</p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <aside className="flex min-h-0 flex-col rounded-sm bg-lacquer p-5 ring-1 ring-bone/10">
          <div className="mb-3 flex items-end justify-between border-b border-bone/10 pb-3">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.3em] text-gold/70">Active Deck</div>
              <h2 className="truncate font-display text-2xl italic">
                {deckName?.trim() || t('deckEditor.currentDeck')}
              </h2>
            </div>
            <div className="font-mono text-xs text-bone/50">
              <span className="text-gold">{deck.length}</span> / {DECK_SIZE}
            </div>
          </div>

          <div className="mb-3 space-y-1 font-mono text-[10px] uppercase tracking-widest text-bone/40">
            <div className="flex items-center justify-between">
              <span>{t('deckEditor.ruleCharacters')}</span>
              <span className={characterCount >= Math.ceil(DECK_SIZE * 0.5) ? 'text-gold' : 'text-vermilion/70'}>
                {characterCount}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>{t('deckEditor.ruleCopies')}</span>
              <span className={copyLimitValid ? 'text-gold' : 'text-vermilion/70'}>×{MAX_COPIES}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>{t('deckEditor.ruleSize')}</span>
              <span className={deck.length === DECK_SIZE ? 'text-gold' : 'text-vermilion/70'}>
                {deck.length}/{DECK_SIZE}
              </span>
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
            {deckEntries.map(({ card, count, firstIndex }) => (
              <div
                key={`${card.id}-${firstIndex}`}
                className="flex items-center justify-between rounded-xs bg-lacquer-deep/60 px-3 py-2 ring-1 ring-bone/5 transition hover:ring-gold/30"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="font-mono text-[10px] text-gold">{card.powerCost}</span>
                  <span className="truncate font-display text-sm italic text-bone/80">{card.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-bone/40">×{count}</span>
                  <button
                    type="button"
                    onClick={() => removeCard(firstIndex)}
                    aria-label={t('deckEditor.removeCard')}
                    className="text-[10px] text-bone/30 transition hover:text-vermilion"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
            {Array.from({ length: emptySlotCount }, (_, index) => (
              <div
                key={`empty-${index}`}
                className="rounded-xs border border-dashed border-bone/10 px-3 py-2 text-[10px] text-bone/20"
              >
                {t('deckEditor.emptySlot')}
              </div>
            ))}
          </div>

          <div
            className={`mt-3 border-t border-bone/10 pt-3 font-mono text-[10px] uppercase tracking-widest ${
              isValid ? 'text-gold' : 'text-vermilion/70'
            }`}
          >
            {isValid ? t('deckEditor.valid') : t('deckEditor.invalid')} · {deck.length}/{DECK_SIZE}
          </div>
        </aside>
      </div>
    </div>
  );
}
