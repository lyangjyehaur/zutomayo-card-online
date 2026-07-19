import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { CardDef, CardType, Element } from '../game/types';
import { getAllCardDefs, isCardsInitialized, refreshCards } from '../game/cards/loader';
import {
  getLocalizedCardEffect,
  getLocalizedCardName,
  getLocalizedSongTitle,
  matchesLocalizedCardSearch,
} from '../game/cards/i18n';
import { loadCustomDeckIds } from '../game/cards/customDeck';
import { availableLocales, t, useLocale } from '../i18n';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  Hash,
  Layers,
  Plus,
  Save,
  Search,
  SlidersHorizontal,
  Upload,
  X,
} from 'lucide-react';
import {
  Alert,
  AppHeader,
  Button,
  IconButton,
  Input,
  SearchInput,
  Select,
  SegmentedControl,
  WorkspaceLayout,
} from '../ui';
import {
  CardBrowser,
  CardBrowserDetailPopover,
  CardBrowserDetailSheet,
  CardBrowserFilterSheet,
  CardBrowserGrid,
  CardBrowserToolbar,
} from './CardBrowser';
import { CardImage } from './CardImage';
import { ActiveDeckPanel, ActiveDeckSheet } from './DeckBuilderWorkspace';

interface DeckEditorProps {
  onSave: (deckIds: string[]) => void | Promise<void>;
  initialDeck?: string[];
  deckName?: string;
  onDeckNameChange?: (name: string) => void;
  deckLibraryOptions?: DeckLibraryOption[];
  selectedDeckLibraryId?: string;
  onSelectDeckLibrary?: (deckId: string) => void;
  onNewDeck?: () => void;
  onImportDeck?: () => void;
  onExportDeck?: (deckIds: string[]) => void;
  onDeckChange?: () => void;
  notice?: ReactNode;
  saveLabel?: string;
  saving?: boolean;
  synced?: boolean;
  syncLabel?: string;
  errorMessage?: string;
}

interface DeckLibraryOption {
  id: string;
  name: string;
  description?: string;
}

const ELEMENTS: (Element | 'all')[] = ['all', '闇', '炎', '電気', '風', 'カオス'];
const TYPES: (CardType | 'all')[] = ['all', 'Character', 'Enchant', 'Area Enchant'];
const SORT_OPTIONS = ['number', 'cost', 'attack', 'name'] as const;
type DeckEditorSort = (typeof SORT_OPTIONS)[number];
const DECK_SIZE = 20;
const MAX_COPIES = 2;
const PAGE_SIZE = 12;

function normalizeCardNumber(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function compareCardNumber(a: CardDef, b: CardDef): number {
  return a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' });
}

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

function sortLabel(sort: DeckEditorSort): string {
  const labels: Record<DeckEditorSort, string> = {
    number: t('deckEditor.sortNumber'),
    cost: t('deckEditor.sortCost'),
    attack: t('deckEditor.sortAttack'),
    name: t('deckEditor.sortName'),
  };
  return labels[sort];
}

export function DeckEditor({
  onSave,
  initialDeck,
  deckName,
  onDeckNameChange,
  deckLibraryOptions = [],
  selectedDeckLibraryId = '',
  onSelectDeckLibrary,
  onNewDeck,
  onImportDeck,
  onExportDeck,
  onDeckChange,
  notice,
  saveLabel,
  saving = false,
  synced = false,
  syncLabel,
  errorMessage,
}: DeckEditorProps) {
  const [allCards, setAllCards] = useState<CardDef[]>(() => getAllCardDefs());
  const locale = useLocale();
  const [deck, setDeck] = useState<string[]>(() =>
    initialDeck !== undefined ? initialDeck : (loadCustomDeckIds() ?? []),
  );
  const [filterElement, setFilterElement] = useState<Element | 'all'>('all');
  const [filterType, setFilterType] = useState<CardType | 'all'>('all');
  const [filterPack, setFilterPack] = useState('all');
  const [filterErrata, setFilterErrata] = useState<'all' | 'errata'>('all');
  const [filterCardNumber, setFilterCardNumber] = useState('');
  const [searchText, setSearchText] = useState('');
  const [sortBy, setSortBy] = useState<DeckEditorSort>('number');
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

  const packOptions = useMemo(
    () =>
      [...new Set(allCards.map((card) => card.pack).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
      ),
    [allCards],
  );

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
    if (filterPack !== 'all') cards = cards.filter((card) => card.pack === filterPack);
    if (filterErrata === 'errata') cards = cards.filter((card) => card.hasOfficialErrata);
    if (filterCardNumber.trim()) {
      const cardNumberQuery = normalizeCardNumber(filterCardNumber);
      cards = cards.filter((card) => normalizeCardNumber(card.id).includes(cardNumberQuery));
    }
    if (searchText) {
      cards = cards.filter((card) => matchesLocalizedCardSearch(card, searchText, availableLocales));
    }

    return [...cards].sort((a, b) => {
      if (sortBy === 'number') return compareCardNumber(a, b);
      if (sortBy === 'cost') return a.powerCost - b.powerCost;
      if (sortBy === 'attack') {
        const aAttack = a.attack ? Math.max(a.attack.night, a.attack.day) : 0;
        const bAttack = b.attack ? Math.max(b.attack.night, b.attack.day) : 0;
        return bAttack - aAttack;
      }
      return getLocalizedCardName(a, locale).localeCompare(getLocalizedCardName(b, locale), locale);
    });
  }, [allCards, filterElement, filterType, filterPack, filterErrata, filterCardNumber, searchText, sortBy, locale]);

  useEffect(() => {
    setPage(0);
  }, [filterElement, filterType, filterPack, filterErrata, filterCardNumber, searchText, sortBy]);

  useEffect(() => {
    if (initialDeck !== undefined) setDeck(initialDeck);
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
    onDeckChange?.();
  };

  const removeCard = (index: number) => {
    setDeck((current) => current.filter((_, itemIndex) => itemIndex !== index));
    onDeckChange?.();
  };

  const saveDeck = async () => {
    await onSave(deck);
  };

  const emptySlotCount = Math.max(0, DECK_SIZE - deck.length);
  const filterSummary = [
    elementLabel(filterElement),
    typeLabel(filterType),
    filterPack === 'all' ? t('deckEditor.allPacks') : filterPack,
    filterErrata === 'errata' ? t('card.officialErrata') : null,
    filterCardNumber.trim() ? `${t('deckEditor.cardNumberShort')} ${filterCardNumber.trim()}` : null,
    sortLabel(sortBy),
  ]
    .filter(Boolean)
    .join(' · ');
  const deckStatusLabel = `${isValid ? t('deckEditor.valid') : t('deckEditor.invalid')} · ${deck.length}/${DECK_SIZE}`;

  const renderDeckLibraryControls = () => {
    const hasDeckLibraryActions = onNewDeck || onImportDeck || onExportDeck || deckLibraryOptions.length > 0;
    if (!hasDeckLibraryActions) return null;

    return (
      <div className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 rounded-sm border border-content-primary/10 bg-surface-base/55 p-2">
        <label className="grid min-w-0 gap-1">
          <span className="font-mono text-minutia uppercase tracking-[var(--tracking-control)] text-content-muted">
            {t('deckEditor.deckLibrary')}
          </span>
          <div className="relative min-w-0">
            <Select
              value={selectedDeckLibraryId}
              disabled={!onSelectDeckLibrary || deckLibraryOptions.length === 0}
              onChange={(event) => onSelectDeckLibrary?.(event.target.value)}
              aria-label={t('deckEditor.selectDeck')}
              className="min-h-11 appearance-none truncate border-border-soft bg-surface-canvas py-2 pl-3 pr-10 text-body-sm"
            >
              {deckLibraryOptions.length === 0 ? (
                <option value="">{t('deckEditor.currentDraft')}</option>
              ) : (
                deckLibraryOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))
              )}
            </Select>
            <ChevronDown
              className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-content-primary/35"
              aria-hidden="true"
            />
          </div>
        </label>
        <div className="flex items-end gap-2">
          {onNewDeck && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="size-touch !px-0 md:w-auto md:!px-3"
              onClick={onNewDeck}
              aria-label={t('deckEditor.newDeck')}
            >
              <Plus className="size-3.5" aria-hidden="true" />
              <span className="hidden md:inline">{t('deckEditor.newDeck')}</span>
            </Button>
          )}
          {onImportDeck && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="size-touch !px-0 md:w-auto md:!px-3"
              onClick={onImportDeck}
              aria-label={t('deckEditor.importDeck')}
            >
              <Upload className="size-3.5" aria-hidden="true" />
              <span className="hidden md:inline">{t('deckEditor.importDeck')}</span>
            </Button>
          )}
          {onExportDeck && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="size-touch !px-0 md:w-auto md:!px-3"
              onClick={() => onExportDeck(deck)}
              disabled={deck.length === 0}
              aria-label={t('deckEditor.exportDeck')}
            >
              <Download className="size-3.5" aria-hidden="true" />
              <span className="hidden md:inline">{t('deckEditor.exportDeck')}</span>
            </Button>
          )}
        </div>
      </div>
    );
  };

  const renderFilterControls = (mode: 'stacked' | 'compact' = 'stacked') => {
    const compact = mode === 'compact';
    const fieldsetClass = compact ? 'flex min-w-0 items-center gap-2' : 'flex flex-wrap items-center gap-3';
    const legendClass = compact
      ? 'shrink-0 text-minutia uppercase tracking-[var(--tracking-control)] text-content-muted'
      : 'w-full text-caption uppercase tracking-[var(--tracking-kicker)] text-content-muted sm:w-auto';
    const chipGroupClass = compact ? 'deck-filter-chip-group gap-1' : 'deck-filter-chip-group';
    const chipOptionClass = compact ? 'px-2' : undefined;
    const chipSize = compact ? 'sm' : 'md';

    return (
      <div
        className={
          compact
            ? 'flex flex-wrap items-center gap-x-4 gap-y-2 rounded-sm border border-content-primary/10 bg-surface-canvas/35 p-2'
            : 'space-y-3 lg:space-y-2'
        }
      >
        <fieldset className={compact ? 'flex min-w-[12rem] max-w-[18rem] flex-1 items-center gap-2' : fieldsetClass}>
          <legend className={legendClass}>{t('deckEditor.filterPack')}</legend>
          <div className="relative min-w-0 flex-1">
            <Select
              value={filterPack}
              onChange={(event) => setFilterPack(event.target.value)}
              aria-label={t('deckEditor.filterPack')}
              className={`appearance-none truncate border-border-soft bg-surface-canvas py-2 pl-3 pr-10 font-mono text-caption uppercase tracking-[var(--tracking-control)] text-content-primary/75 transition hover:border-accent-primary/40 hover:text-content-primary focus:border-accent-primary/60 ${
                compact ? 'min-h-control-sm' : 'min-h-11'
              }`}
            >
              <option value="all">{t('deckEditor.allPacks')}</option>
              {packOptions.map((pack) => (
                <option key={pack} value={pack}>
                  {pack}
                </option>
              ))}
            </Select>
            <ChevronDown
              className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-content-primary/35"
              aria-hidden="true"
            />
          </div>
        </fieldset>
        <fieldset className={fieldsetClass}>
          <legend className={legendClass}>{t('deckEditor.filterElement')}</legend>
          <SegmentedControl
            className={chipGroupClass}
            optionClassName={chipOptionClass}
            size={chipSize}
            options={ELEMENTS.map((element) => ({ value: element, label: elementLabel(element) }))}
            value={filterElement}
            onChange={setFilterElement}
            ariaLabel={t('deckEditor.filterElement')}
          />
        </fieldset>
        <fieldset className={fieldsetClass}>
          <legend className={legendClass}>{t('deckEditor.filterType')}</legend>
          <SegmentedControl
            className={chipGroupClass}
            optionClassName={chipOptionClass}
            size={chipSize}
            options={TYPES.map((type) => ({ value: type, label: typeLabel(type) }))}
            value={filterType}
            onChange={setFilterType}
            ariaLabel={t('deckEditor.filterType')}
          />
        </fieldset>
        <fieldset className={fieldsetClass}>
          <legend className={legendClass}>{t('deckEditor.filterErrata')}</legend>
          <SegmentedControl
            className={chipGroupClass}
            optionClassName={chipOptionClass}
            size={chipSize}
            options={[
              { value: 'all', label: t('deckEditor.all') },
              { value: 'errata', label: t('card.officialErrata') },
            ]}
            value={filterErrata}
            onChange={setFilterErrata}
            ariaLabel={t('deckEditor.filterErrata')}
          />
        </fieldset>
        <fieldset className={fieldsetClass}>
          <legend className={legendClass}>{t('deckEditor.sort')}</legend>
          <SegmentedControl
            className={chipGroupClass}
            optionClassName={chipOptionClass}
            size={chipSize}
            options={SORT_OPTIONS.map((option) => ({
              value: option,
              label: sortLabel(option),
            }))}
            value={sortBy}
            onChange={setSortBy}
            ariaLabel={t('deckEditor.sort')}
          />
        </fieldset>
      </div>
    );
  };

  const renderActiveDeckContent = () => (
    <>
      <div className="mb-3 flex items-end justify-between border-b border-content-primary/10 pb-3">
        <div className="min-w-0">
          <div className="text-caption uppercase tracking-[var(--tracking-kicker)] text-accent-primary/70">
            {t('deckEditor.currentDeck')}
          </div>
          <h2 className="truncate font-display text-2xl font-bold">
            {deckName?.trim() || t('deckEditor.currentDeck')}
          </h2>
        </div>
        <div className="font-mono text-xs text-content-primary/50" aria-live="polite">
          <span className="text-accent-primary">{deck.length}</span> / {DECK_SIZE}
        </div>
      </div>

      <div className="mb-3 space-y-1 font-mono text-caption uppercase tracking-normal text-content-muted">
        <div className="flex items-center justify-between">
          <span>{t('deckEditor.ruleCharacters')}</span>
          <span className={characterCount >= Math.ceil(DECK_SIZE * 0.5) ? 'text-accent-primary' : 'text-accent-action'}>
            {characterCount}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>{t('deckEditor.ruleCopies')}</span>
          <span className={copyLimitValid ? 'text-accent-primary' : 'text-accent-action'}>×{MAX_COPIES}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>{t('deckEditor.ruleSize')}</span>
          <span className={deck.length === DECK_SIZE ? 'text-accent-primary' : 'text-accent-action'}>
            {deck.length}/{DECK_SIZE}
          </span>
        </div>
      </div>

      <div
        className="min-h-0 flex-1 space-y-1.5 overflow-y-auto"
        role="list"
        aria-label={t('deckEditor.currentDeck')}
        tabIndex={0}
      >
        {deckEntries.map(({ card, count, firstIndex }) => (
          <div
            key={`${card.id}-${firstIndex}`}
            className="flex items-center justify-between rounded-xs bg-surface-canvas/60 px-3 py-2 ring-1 ring-content-primary/5 transition hover:ring-accent-primary/30"
            role="listitem"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="font-mono text-caption text-accent-primary"
                aria-label={`${t('card.energy')} ${card.powerCost}`}
              >
                {card.powerCost}
              </span>
              <span className="truncate font-display text-sm font-bold text-content-primary/80">
                {getLocalizedCardName(card, locale)}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span
                className="font-mono text-caption text-content-primary/40"
                aria-label={`${t('deckEditor.copyCount')} ${count}`}
              >
                ×{count}
              </span>
              <IconButton
                onClick={() => removeCard(firstIndex)}
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-sm text-content-primary/45 transition hover:bg-content-primary/5 hover:text-accent-action focus:outline-none focus:ring-2 focus:ring-accent-primary/60 focus:ring-offset-2 focus:ring-offset-surface-base"
                label={`${t('deckEditor.removeCard')} ${getLocalizedCardName(card, locale)}`}
                icon={<X className="size-4" aria-hidden="true" />}
              />
            </div>
          </div>
        ))}
        {Array.from({ length: emptySlotCount }, (_, index) => (
          <div
            key={`empty-${index}`}
            className="rounded-xs border border-dashed border-content-primary/10 px-3 py-2 text-caption text-content-muted"
            role="listitem"
            aria-label={t('deckEditor.emptySlot')}
          >
            {t('deckEditor.emptySlot')}
          </div>
        ))}
      </div>

      <div
        className={`mt-3 border-t border-content-primary/10 pt-3 font-mono text-caption uppercase tracking-normal ${
          isValid ? 'text-accent-primary' : 'text-accent-action'
        }`}
      >
        {isValid ? t('deckEditor.valid') : t('deckEditor.invalid')} · {deck.length}/{DECK_SIZE}
      </div>
    </>
  );

  const cardDetailProps = (card: CardDef) => ({
    title: getLocalizedCardName(card, locale),
    meta: `${elementLabel(card.element)} · ${typeLabel(card.type)} · ${card.rarity}`,
    stats: (
      <>
        <span className="text-content-primary/60">
          <span className="text-accent-primary/70">{t('card.energy')}</span> {card.powerCost}
        </span>
        {card.attack && (
          <span className="text-content-primary/60">
            <span className="text-accent-primary/70">
              {t('card.night')}/{t('card.day')}
            </span>{' '}
            {card.attack.night}/{card.attack.day}
          </span>
        )}
        <span className="text-content-primary/60">
          <span className="text-accent-primary/70">{t('card.clock')}</span> {card.clock}
        </span>
        {card.sendToPower > 0 && (
          <span className="text-content-primary/60">
            <span className="text-accent-primary/70">{t('card.charge')}</span> {card.sendToPower}
          </span>
        )}
      </>
    ),
    effect: getLocalizedCardEffect(card, locale) || undefined,
    footer:
      card.song || card.illustrator ? (
        <>
          {card.song && <span>{getLocalizedSongTitle(card.song, locale)}</span>}
          {card.song && card.illustrator && <span> · </span>}
          {card.illustrator && <span>illust. {card.illustrator}</span>}
        </>
      ) : undefined,
  });

  return (
    <WorkspaceLayout
      glow={{ color: 'gold', size: 'lg', className: '-left-40 top-0 translate-x-0 translate-y-0' }}
      sidebarSide="right"
      sidebarWidth="deck"
      contentClassName="gap-3 !overflow-y-auto !px-2 pb-3 pt-20 sm:!px-3 sm:pb-4 md:pt-24 xl:gap-4 xl:!overflow-hidden xl:!px-6 xl:pb-6"
      mainClassName="flex min-h-0 flex-col"
      sidebar={<ActiveDeckPanel label={t('deckEditor.currentDeck')}>{renderActiveDeckContent()}</ActiveDeckPanel>}
      header={
        <AppHeader
          title={t('nav.deckBuilder')}
          backTo="/"
          actions={
            <>
              {onDeckNameChange && (
                <Input
                  value={deckName ?? ''}
                  aria-label={t('deck.custom')}
                  placeholder={t('deck.custom')}
                  onChange={(event) => onDeckNameChange(event.target.value)}
                  className="min-h-11 w-32 px-3 py-2 text-body-sm sm:w-40"
                />
              )}
              {syncLabel && (
                <span
                  className={`hidden font-mono text-caption uppercase tracking-[var(--tracking-kicker)] sm:inline ${synced ? 'text-accent-primary' : 'text-content-primary/40'}`}
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
                aria-label={saveLabel ?? t('deckEditor.saveDeck')}
                className="size-touch shrink-0 px-0 sm:w-auto sm:px-3"
              >
                <Save className="size-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">{saveLabel ?? t('deckEditor.saveDeck')}</span>
              </Button>
            </>
          }
        />
      }
    >
      {errorMessage && (
        <Alert className="mb-3" tone="danger" role="alert">
          {errorMessage}
        </Alert>
      )}
      {notice}
      {renderDeckLibraryControls()}
      <CardBrowser label={t('deckEditor.cardPool')} className="min-h-[calc(100dvh-10rem)] p-3 sm:p-4 md:p-5 xl:min-h-0">
        <CardBrowserToolbar
          title={t('deckEditor.cardPool')}
          search={
            <div className="grid w-full grid-cols-[minmax(0,1fr)_minmax(6.75rem,0.42fr)_auto] items-center gap-2 sm:w-auto sm:grid-cols-[14rem_8.5rem_auto]">
              <SearchInput
                containerClassName="min-w-0"
                icon={<Search className="size-3.5 text-content-primary/40" aria-hidden="true" />}
                placeholder={t('deckEditor.search')}
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                aria-label={t('deckEditor.search')}
              />
              <SearchInput
                containerClassName="min-w-0"
                icon={<Hash className="size-3.5 text-content-primary/40" aria-hidden="true" />}
                value={filterCardNumber}
                onChange={(event) => setFilterCardNumber(event.target.value)}
                placeholder={t('deckEditor.cardNumberShort')}
                aria-label={t('deckEditor.filterCardNumber')}
                type="text"
                className="appearance-none border-0 font-mono text-caption uppercase tracking-[var(--tracking-control)] shadow-none"
              />
              {(searchText || filterCardNumber) && (
                <IconButton
                  onClick={() => {
                    setSearchText('');
                    setFilterCardNumber('');
                  }}
                  size="sm"
                  label={t('common.clear')}
                  icon={<X className="size-3.5" aria-hidden="true" />}
                />
              )}
            </div>
          }
          actions={
            <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end xl:hidden">
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={() => setFiltersOpen(true)}
                className="w-full justify-between px-3 tracking-[var(--tracking-control)] lg:hidden"
                aria-label={t('deckEditor.filters')}
                data-deck-editor-control="filters"
              >
                <SlidersHorizontal className="size-3.5" aria-hidden="true" />
                <span className="truncate">{t('deckEditor.filters')}</span>
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={() => setDeckSheetOpen(true)}
                className="w-full justify-between px-3 tracking-[var(--tracking-control)] lg:w-auto"
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
              className="flex min-h-6 flex-wrap items-center gap-x-3 gap-y-1 font-mono text-minutia uppercase tracking-[var(--tracking-control)] lg:hidden"
              aria-live="polite"
            >
              <span className={isValid ? 'text-accent-primary/70' : 'text-accent-action/70'}>{deckStatusLabel}</span>
              <span className="min-w-0 truncate text-content-muted">{filterSummary}</span>
            </div>
          }
        />

        <div className="mb-3 hidden lg:block">{renderFilterControls('compact')}</div>

        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span
            className="font-mono text-caption uppercase tracking-[var(--tracking-control)] text-content-muted md:tracking-[var(--tracking-kicker)]"
            aria-live="polite"
          >
            {t('deck.foundCards').replace('{count}', String(filteredCards.length))} · {currentPage + 1}/{totalPages}
          </span>
          <nav className="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:gap-3" aria-label="Pagination">
            <Button
              type="button"
              disabled={currentPage === 0}
              onClick={() => setPage((value) => Math.max(0, value - 1))}
              variant="ghost"
              size="md"
              className="w-full px-3 sm:w-auto"
              aria-label={t('common.prev')}
            >
              <ChevronLeft className="size-3.5" aria-hidden="true" /> {t('common.prev')}
            </Button>
            <Button
              type="button"
              disabled={currentPage >= totalPages - 1}
              onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))}
              variant="ghost"
              size="md"
              className="w-full px-3 sm:w-auto"
              aria-label={t('common.next')}
            >
              {t('common.next')} <ChevronRight className="size-3.5" aria-hidden="true" />
            </Button>
          </nav>
        </div>

        <CardBrowserGrid>
          {visibleCards.map((card) => {
            const count = deckCounts.get(card.id) ?? 0;
            const canAdd = count < MAX_COPIES && deck.length < DECK_SIZE;
            const localizedName = getLocalizedCardName(card, locale);
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
                  className={`relative flex aspect-[5/7] w-full cursor-pointer flex-col rounded-sm bg-surface-canvas ring-1 transition hover:-translate-y-1 hover:ring-accent-primary/40 focus:outline-none focus:ring-accent-primary/40 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:ring-content-primary/10 ${
                    count > 0 ? 'ring-accent-primary/30' : 'ring-content-primary/10'
                  }`}
                >
                  <div className="absolute inset-0 overflow-hidden rounded-sm">
                    <CardImage
                      cardId={card.id}
                      context="hand"
                      alt={localizedName}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="absolute inset-0 size-full object-contain"
                    />
                  </div>
                  {/* 費用角標 */}
                  <span className="absolute left-1 top-1 rounded-full bg-surface-canvas/85 px-1.5 py-0.5 font-mono text-minutia leading-none text-accent-primary ring-1 ring-accent-primary/30">
                    {card.powerCost}
                  </span>
                  {/* 已加入數量 */}
                  {count > 0 && (
                    <span className="absolute right-1 top-1 rounded-full bg-accent-primary/30 px-1.5 py-0.5 font-mono text-minutia leading-none text-accent-primary ring-1 ring-accent-primary/40">
                      ×{count}
                    </span>
                  )}
                  {card.hasOfficialErrata && (
                    <span className="absolute bottom-1 left-1 rounded-xs bg-accent-action/90 px-1.5 py-0.5 font-mono text-minutia leading-none text-surface-canvas">
                      {t('card.officialErrata')}
                    </span>
                  )}
                </button>
                <IconButton
                  className="absolute bottom-1 right-1 z-[var(--z-dropdown)] bg-surface-canvas/90 text-content-primary/70 ring-1 ring-content-primary/20 backdrop-blur hover:text-accent-primary md:hidden"
                  label={`Preview ${localizedName}`}
                  icon={<Eye className="size-4" aria-hidden="true" />}
                  onClick={(event) => handlePreviewClick(card, event)}
                  onMouseEnter={(event) => handleCardEnter(card, event)}
                  onMouseLeave={handleCardLeave}
                  onFocus={(event) => handleCardEnter(card, event)}
                  onBlur={handleCardLeave}
                />
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
    </WorkspaceLayout>
  );
}
