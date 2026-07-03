import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CardDef, CardType, Element } from '../game/types';
import { getAllCardDefs, isCardsInitialized, refreshCards } from '../game/cards/loader';
import { getTranslatedEffect } from '../game/cards/i18n';
import { CUSTOM_DECK_STORAGE_KEY, loadCustomDeckIds } from '../game/cards/customDeck';
import { t, useLocale } from '../i18n';
import { ChevronLeft, ChevronRight, Eye, Layers, Save, Search, SlidersHorizontal, X } from 'lucide-react';
import { BackButton, Button, Input, PageShell } from './ui';
import {
  CardBrowser,
  CardBrowserDetailPopover,
  CardBrowserDetailSheet,
  CardBrowserFilterSheet,
  CardBrowserGrid,
  CardBrowserToolbar,
} from './CardBrowser';
import { ActiveDeckPanel, ActiveDeckSheet } from './DeckBuilderWorkspace';

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
  const [allCards, setAllCards] = useState<CardDef[]>(() => getAllCardDefs());
  const locale = useLocale();
  const [deck, setDeck] = useState<string[]>(() =>
    initialDeck.length > 0 ? initialDeck : (loadCustomDeckIds() ?? []),
  );
  const [filterElement, setFilterElement] = useState<Element | 'all'>('all');
  const [filterType, setFilterType] = useState<CardType | 'all'>('all');
  const [searchText, setSearchText] = useState('');
  const [sortBy, setSortBy] = useState<'cost' | 'attack' | 'name'>('cost');
  const [page, setPage] = useState(0);
  const [previewCard, setPreviewCard] = useState<CardDef | null>(null);
  const [detailSheetCard, setDetailSheetCard] = useState<CardDef | null>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [deckSheetOpen, setDeckSheetOpen] = useState(false);
  const hoveredRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const syncCards = () => {
      if (!cancelled) setAllCards(getAllCardDefs());
    };

    if (isCardsInitialized()) {
      syncCards();
      return;
    }

    void refreshCards().finally(syncCards);
    return () => {
      cancelled = true;
    };
  }, []);

  // hover/focus 時計算浮層位置：優先顯示在卡牌右側，空間不足時顯示左側
  const updatePopoverPosition = () => {
    const el = hoveredRef.current;
    if (!el) {
      setPopoverPos(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    const popoverWidth = 320;
    const popoverHeight = 240;
    const gap = 12;
    const margin = 8;
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    let left = rect.right + gap;
    if (left + popoverWidth > window.innerWidth - margin) {
      left = rect.left - gap - popoverWidth;
    }
    if (left < margin) {
      left = Math.min(Math.max(centerX - popoverWidth / 2, margin), window.innerWidth - margin - popoverWidth);
    }

    let top = centerY - popoverHeight / 2;
    top = Math.min(Math.max(top, margin), window.innerHeight - margin - popoverHeight);

    setPopoverPos({ top, left });
  };

  const openCardPreview = (card: CardDef, element: HTMLButtonElement) => {
    hoveredRef.current = element;
    setPreviewCard(card);
    requestAnimationFrame(updatePopoverPosition);
  };

  const handleCardEnter = (
    card: CardDef,
    event: React.MouseEvent<HTMLButtonElement> | React.FocusEvent<HTMLButtonElement>,
  ) => openCardPreview(card, event.currentTarget);

  const handlePreviewClick = (card: CardDef, event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (
      window.matchMedia('(hover: none)').matches ||
      window.matchMedia('(pointer: coarse)').matches ||
      window.matchMedia('(max-width: 767px)').matches
    ) {
      hoveredRef.current = null;
      setPreviewCard(null);
      setPopoverPos(null);
      setDetailSheetCard(card);
      return;
    }
    openCardPreview(card, event.currentTarget);
  };

  const handleCardLeave = () => {
    hoveredRef.current = null;
    setPreviewCard(null);
    setPopoverPos(null);
  };

  useEffect(() => {
    if (!previewCard) return;
    const onScroll = () => updatePopoverPosition();
    const onResize = () => updatePopoverPosition();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [previewCard]);

  const filteredCards = useMemo(() => {
    let cards = allCards;

    if (filterElement !== 'all') cards = cards.filter((card) => card.element === filterElement);
    if (filterType !== 'all') cards = cards.filter((card) => card.type === filterType);
    if (searchText) {
      const query = searchText.toLowerCase();
      cards = cards.filter((card) => {
        const translatedEffect = getTranslatedEffect(card.id, locale);
        return (
          card.name.toLowerCase().includes(query) ||
          card.effect.toLowerCase().includes(query) ||
          (translatedEffect?.toLowerCase().includes(query) ?? false) ||
          card.song.toLowerCase().includes(query)
        );
      });
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
  }, [allCards, filterElement, filterType, searchText, sortBy, locale]);

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
  const filterSummary = [
    elementLabel(filterElement),
    typeLabel(filterType),
    sortBy === 'cost'
      ? t('deckEditor.sortCost')
      : sortBy === 'attack'
        ? t('deckEditor.sortAttack')
        : t('deckEditor.sortName'),
  ].join(' · ');
  const deckStatusLabel = `${isValid ? t('deckEditor.valid') : t('deckEditor.invalid')} · ${deck.length}/${DECK_SIZE}`;

  const renderFilterControls = () => (
    <div className="space-y-3 lg:space-y-2">
      <fieldset className="flex flex-wrap items-center gap-3">
        <legend className="w-full text-[10px] uppercase tracking-[0.3em] text-bone/40 sm:w-auto">
          {t('deckEditor.filterElement')}
        </legend>
        {ELEMENTS.map((element) => (
          <button
            key={element}
            type="button"
            onClick={() => setFilterElement(element)}
            className={`deck-filter-chip min-h-11 rounded-sm px-3 text-[10px] uppercase tracking-[0.18em] transition md:tracking-[0.3em] ${
              filterElement === element ? 'text-gold' : 'text-bone/40 hover:text-bone'
            }`}
            aria-pressed={filterElement === element}
          >
            {elementLabel(element)}
          </button>
        ))}
      </fieldset>
      <fieldset className="flex flex-wrap items-center gap-3">
        <legend className="w-full text-[10px] uppercase tracking-[0.3em] text-bone/40 sm:w-auto">
          {t('deckEditor.filterType')}
        </legend>
        {TYPES.map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => setFilterType(type)}
            className={`deck-filter-chip min-h-11 rounded-sm px-3 text-[10px] uppercase tracking-[0.18em] transition md:tracking-[0.3em] ${
              filterType === type ? 'text-gold' : 'text-bone/40 hover:text-bone'
            }`}
            aria-pressed={filterType === type}
          >
            {typeLabel(type)}
          </button>
        ))}
      </fieldset>
      <fieldset className="flex flex-wrap items-center gap-3">
        <legend className="w-full text-[10px] uppercase tracking-[0.3em] text-bone/40 sm:w-auto">
          {t('deckEditor.sort')}
        </legend>
        {(['cost', 'attack', 'name'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setSortBy(option)}
            className={`deck-filter-chip min-h-11 rounded-sm px-3 text-[10px] uppercase tracking-[0.18em] transition md:tracking-[0.3em] ${
              sortBy === option ? 'text-gold' : 'text-bone/40 hover:text-bone'
            }`}
            aria-pressed={sortBy === option}
          >
            {option === 'cost'
              ? t('deckEditor.sortCost')
              : option === 'attack'
                ? t('deckEditor.sortAttack')
                : t('deckEditor.sortName')}
          </button>
        ))}
      </fieldset>
    </div>
  );

  const renderActiveDeckContent = () => (
    <>
      <div className="mb-3 flex items-end justify-between border-b border-bone/10 pb-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.3em] text-gold/70">Active Deck</div>
          <h2 className="truncate font-display text-2xl italic">{deckName?.trim() || t('deckEditor.currentDeck')}</h2>
        </div>
        <div className="font-mono text-xs text-bone/50" aria-live="polite">
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

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto" role="list" aria-label="Deck Cards">
        {deckEntries.map(({ card, count, firstIndex }) => (
          <div
            key={`${card.id}-${firstIndex}`}
            className="flex items-center justify-between rounded-xs bg-lacquer-deep/60 px-3 py-2 ring-1 ring-bone/5 transition hover:ring-gold/30"
            role="listitem"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="font-mono text-[10px] text-gold" aria-label={`${t('card.energy')} ${card.powerCost}`}>
                {card.powerCost}
              </span>
              <span className="truncate font-display text-sm italic text-bone/80">{card.name}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-bone/40" aria-label={`${count} copies`}>
                ×{count}
              </span>
              <button
                type="button"
                onClick={() => removeCard(firstIndex)}
                aria-label={`${t('deckEditor.removeCard')} ${card.name}`}
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
            role="listitem"
            aria-label="Empty slot"
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
    </>
  );

  const cardDetailProps = (card: CardDef) => ({
    title: card.name,
    meta: `${elementLabel(card.element)} · ${typeLabel(card.type)} · ${card.rarity}`,
    stats: (
      <>
        <span className="text-bone/60">
          <span className="text-gold/70">{t('card.energy')}</span> {card.powerCost}
        </span>
        {card.attack && (
          <span className="text-bone/60">
            <span className="text-gold/70">
              {t('card.night')}/{t('card.day')}
            </span>{' '}
            {card.attack.night}/{card.attack.day}
          </span>
        )}
        <span className="text-bone/60">
          <span className="text-gold/70">{t('card.clock')}</span> {card.clock}
        </span>
        {card.sendToPower > 0 && (
          <span className="text-bone/60">
            <span className="text-gold/70">{t('card.charge')}</span> {card.sendToPower}
          </span>
        )}
      </>
    ),
    effect: card.effect ? (getTranslatedEffect(card.id, locale) ?? card.effect) : undefined,
    footer:
      card.song || card.illustrator ? (
        <>
          {card.song && <span>{card.song}</span>}
          {card.song && card.illustrator && <span> · </span>}
          {card.illustrator && <span>illust. {card.illustrator}</span>}
        </>
      ) : undefined,
  });

  return (
    <PageShell variant="workspace" className="flex flex-col">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-40 top-0 h-[60vh] w-[60vh] rounded-full bg-gold/8 blur-[140px]" />
      </div>

      <header className="relative z-30 flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-bone/5 bg-lacquer-deep/80 px-3 py-2 backdrop-blur md:h-12 md:flex-nowrap md:px-6 md:py-0">
        <BackButton className="min-h-11" type="button" onClick={onCancel} aria-label={t('common.backToLobby')}>
          <span className="hidden sm:inline">{t('common.backToLobby')}</span>
        </BackButton>
        <h1 className="hidden font-display text-sm italic md:block">Deck Editor · 牌組編輯</h1>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 md:flex-nowrap md:gap-3">
          {onDeckNameChange && (
            <Input
              value={deckName ?? ''}
              aria-label={t('deck.custom')}
              placeholder={t('deck.custom')}
              onChange={(event) => onDeckNameChange(event.target.value)}
              className="min-h-11 w-32 text-xs md:w-40"
            />
          )}
          {syncLabel && (
            <span
              className={`font-mono text-[10px] uppercase tracking-[0.3em] ${synced ? 'text-gold' : 'text-bone/40'}`}
              aria-live="polite"
            >
              {syncLabel}
            </span>
          )}
          <Button
            type="button"
            disabled={!isValid || saving}
            onClick={saveDeck}
            size="sm"
            variant="primary"
            className="min-h-11"
            aria-label={saveLabel ?? t('deckEditor.saveDeck')}
          >
            <Save className="size-3.5" aria-hidden="true" /> {saveLabel ?? t('deckEditor.saveDeck')}
          </Button>
        </div>
      </header>

      {errorMessage && (
        <div className="relative z-30 bg-vermilion/10 px-4 py-1.5 text-[10px] text-vermilion/80 md:px-6" role="alert">
          {errorMessage}
        </div>
      )}

      <div className="relative z-10 grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto px-3 py-4 xl:grid-cols-[minmax(0,1fr)_320px] xl:overflow-hidden xl:px-6 xl:py-6">
        <CardBrowser label="Card Pool">
          <CardBrowserToolbar
            kicker="Archive"
            title="Card Pool"
            search={
              <div className="relative flex w-full items-center gap-2 border border-bone/10 px-3 py-2 sm:w-auto sm:py-1.5">
                <Search className="size-3.5 text-bone/40" aria-hidden="true" />
                <input
                  type="search"
                  placeholder={t('deckEditor.search')}
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  className="w-full bg-transparent text-xs text-bone placeholder:text-bone/30 focus:outline-none sm:w-56"
                  aria-label={t('deckEditor.search')}
                />
                {searchText && (
                  <button
                    type="button"
                    onClick={() => setSearchText('')}
                    className="text-bone/40 transition hover:text-bone"
                    aria-label={t('common.clear')}
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
            }
            actions={
              <div className="grid grid-cols-2 gap-2 lg:flex lg:justify-end xl:hidden">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setFiltersOpen(true)}
                  className="min-h-11 w-full justify-between px-3 tracking-[0.18em] lg:hidden"
                  aria-label={t('deckEditor.filters')}
                  data-deck-editor-control="filters"
                >
                  <SlidersHorizontal className="size-3.5" aria-hidden="true" />
                  <span className="truncate">{t('deckEditor.filters')}</span>
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setDeckSheetOpen(true)}
                  className="min-h-11 w-full justify-between px-3 tracking-[0.18em] lg:w-auto"
                  aria-label={t('deckEditor.openDeck')}
                  data-deck-editor-control="active-deck"
                >
                  <Layers className="size-3.5" aria-hidden="true" />
                  <span className="truncate">
                    {deck.length}/{DECK_SIZE}
                  </span>
                </Button>
              </div>
            }
            summary={
              <div
                className="flex min-h-6 flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[9px] uppercase tracking-[0.18em] lg:hidden"
                aria-live="polite"
              >
                <span className={isValid ? 'text-gold/70' : 'text-vermilion/70'}>{deckStatusLabel}</span>
                <span className="min-w-0 truncate text-bone/35">{filterSummary}</span>
              </div>
            }
          />

          <div className="mb-4 hidden lg:block">{renderFilterControls()}</div>

          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span
              className="font-mono text-[10px] uppercase tracking-[0.18em] text-bone/40 md:tracking-[0.3em]"
              aria-live="polite"
            >
              {t('deck.foundCards').replace('{count}', String(filteredCards.length))} · {currentPage + 1}/{totalPages}
            </span>
            <nav className="flex items-center gap-3" aria-label="Pagination">
              <button
                type="button"
                disabled={currentPage === 0}
                onClick={() => setPage((value) => Math.max(0, value - 1))}
                className="flex min-h-11 items-center gap-1 px-2 text-[10px] uppercase tracking-[0.18em] text-bone/40 transition hover:text-bone disabled:opacity-30 disabled:hover:text-bone/40 md:tracking-[0.3em]"
                aria-label={t('common.prev')}
              >
                <ChevronLeft className="size-3.5" aria-hidden="true" /> {t('common.prev')}
              </button>
              <button
                type="button"
                disabled={currentPage >= totalPages - 1}
                onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))}
                className="flex min-h-11 items-center gap-1 px-2 text-[10px] uppercase tracking-[0.18em] text-bone/40 transition hover:text-bone disabled:opacity-30 disabled:hover:text-bone/40 md:tracking-[0.3em]"
                aria-label={t('common.next')}
              >
                {t('common.next')} <ChevronRight className="size-3.5" aria-hidden="true" />
              </button>
            </nav>
          </div>

          <CardBrowserGrid>
            {visibleCards.map((card) => {
              const count = deckCounts.get(card.id) ?? 0;
              const canAdd = count < MAX_COPIES && deck.length < DECK_SIZE;
              return (
                <div key={card.id} className="group relative">
                  <button
                    type="button"
                    disabled={!canAdd}
                    onClick={() => addCard(card.id)}
                    onMouseEnter={(e) => handleCardEnter(card, e)}
                    onMouseLeave={handleCardLeave}
                    onFocus={(e) => handleCardEnter(card, e)}
                    onBlur={handleCardLeave}
                    className={`relative flex aspect-[5/7] w-full cursor-pointer flex-col rounded-sm bg-lacquer-deep ring-1 transition hover:-translate-y-1 hover:ring-gold/40 focus:outline-none focus:ring-gold/40 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:ring-bone/10 ${
                      count > 0 ? 'ring-gold/30' : 'ring-bone/10'
                    }`}
                  >
                    <div className="absolute inset-0 overflow-hidden rounded-sm">
                      <img
                        src={card.image}
                        alt={card.name}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className="absolute inset-0 size-full object-cover"
                      />
                    </div>
                    {/* 費用角標 */}
                    <span className="absolute left-1 top-1 rounded-full bg-lacquer-deep/85 px-1.5 py-0.5 font-mono text-[9px] leading-none text-gold ring-1 ring-gold/30">
                      {card.powerCost}
                    </span>
                    {/* 已加入數量 */}
                    {count > 0 && (
                      <span className="absolute right-1 top-1 rounded-full bg-gold/30 px-1.5 py-0.5 font-mono text-[9px] leading-none text-gold ring-1 ring-gold/40">
                        ×{count}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    className="absolute bottom-1 right-1 z-10 inline-flex size-11 items-center justify-center rounded-sm bg-lacquer-deep/90 text-bone/70 ring-1 ring-bone/20 backdrop-blur transition hover:text-gold focus:outline-none focus:ring-2 focus:ring-gold/60 focus:ring-offset-2 focus:ring-offset-lacquer"
                    aria-label={`Preview ${card.name}`}
                    onClick={(event) => handlePreviewClick(card, event)}
                    onMouseEnter={(event) => handleCardEnter(card, event)}
                    onMouseLeave={handleCardLeave}
                    onFocus={(event) => handleCardEnter(card, event)}
                    onBlur={handleCardLeave}
                  >
                    <Eye className="size-4" aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </CardBrowserGrid>
        </CardBrowser>

        {/* hover 浮層：透過 portal 渲染到 document.body，避免被 overflow 裁切 */}
        {previewCard &&
          popoverPos &&
          createPortal(
            <CardBrowserDetailPopover
              {...cardDetailProps(previewCard)}
              style={{ top: `${popoverPos.top}px`, left: `${popoverPos.left}px` }}
            />,
            document.body,
          )}

        <ActiveDeckPanel label="Active Deck">{renderActiveDeckContent()}</ActiveDeckPanel>
      </div>

      {detailSheetCard && (
        <CardBrowserDetailSheet
          open={Boolean(detailSheetCard)}
          onOpenChange={(open) => {
            if (!open) setDetailSheetCard(null);
          }}
          closeLabel={t('common.close')}
          {...cardDetailProps(detailSheetCard)}
        />
      )}

      <CardBrowserFilterSheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        title={t('deckEditor.filters')}
        closeLabel={t('common.close')}
        confirmLabel={t('common.confirm')}
      >
        {renderFilterControls()}
      </CardBrowserFilterSheet>

      <ActiveDeckSheet
        open={deckSheetOpen}
        onOpenChange={setDeckSheetOpen}
        title={deckName?.trim() || t('deckEditor.currentDeck')}
        closeLabel={t('common.close')}
        footer={
          <Button
            type="button"
            disabled={!isValid || saving}
            onClick={() => void saveDeck()}
            fullWidth
            variant="primary"
            className="min-h-11"
          >
            <Save className="size-3.5" aria-hidden="true" /> {saveLabel ?? t('deckEditor.saveDeck')}
          </Button>
        }
      >
        {renderActiveDeckContent()}
      </ActiveDeckSheet>
    </PageShell>
  );
}
