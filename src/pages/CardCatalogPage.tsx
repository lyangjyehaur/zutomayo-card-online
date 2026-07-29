import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Filter,
  PackageCheck,
  Search,
  Sparkles,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  fetchCardRecommendations,
  fetchCatalogCards,
  getOwnedCardIds,
  isLoggedIn,
  mergeOwnedCards,
  setOwnedCard,
  type CardRecommendation,
} from '../api/client';
import { clearLocalOwnedCardIds, readLocalOwnedCardIds, setLocalCardOwned } from '../cardCollection';
import { CardImage } from '../components/CardImage';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import {
  getLocalizedCardEffect,
  getLocalizedCardName,
  getLocalizedSongTitle,
  matchesLocalizedCardSearch,
} from '../game/cards/i18n';
import { getCardElementTranslationKey } from '../game/cards/taxonomy';
import {
  CARD_DISTRIBUTION_TYPES,
  type CardDef,
  type CardDistributionType,
  type CardType,
  type Element,
} from '../game/types';
import { availableLocales, t, useLocale } from '../i18n';
import { compareCardIds, sortCardsById } from '../lib/cardOrder';
import { Alert, AppHeader, Badge, Button, EmptyState, LoadingState, PageShell, SearchInput, Select } from '../ui';

const ELEMENTS: Array<Element | ''> = ['', '闇', '炎', '電気', '風', 'カオス'];
const TYPES: Array<CardType | ''> = ['', 'Character', 'Enchant', 'Area Enchant'];
const RARITIES = ['N', 'R', 'SR', 'UR', 'SE'] as const;
const CATALOG_PAGE_SIZE = 48;

const REASON_KEYS: Record<string, string> = {
  named_card_reference: 'cardCatalog.reason.namedCard',
  song_reference: 'cardCatalog.reason.songReference',
  same_song: 'cardCatalog.reason.sameSong',
  synergy_named_card_song: 'cardCatalog.reason.synergyNamed',
  synergy_element: 'cardCatalog.reason.synergyElement',
  synergy_zone_resource: 'cardCatalog.reason.synergyZone',
  synergy_chronos: 'cardCatalog.reason.synergyChronos',
  synergy_hp_damage: 'cardCatalog.reason.synergyDamage',
  synergy_hand_draw: 'cardCatalog.reason.synergyHand',
  synergy_card_stats_type: 'cardCatalog.reason.synergyStats',
  synergy_deck_flow: 'cardCatalog.reason.synergyDeck',
  synergy_area_enchant: 'cardCatalog.reason.synergyArea',
  synergy_event_trigger: 'cardCatalog.reason.synergyTrigger',
  synergy_other: 'cardCatalog.reason.related',
};

function distributionLabel(value: CardDistributionType | undefined): string {
  return t(`cardCatalog.distribution.${value || 'standard'}` as Parameters<typeof t>[0]);
}

function elementLabel(value: Element): string {
  return t(getCardElementTranslationKey(value));
}

function cardTypeLabel(value: CardType): string {
  return t(`cardCatalog.type.${value.replace(' ', '')}` as Parameters<typeof t>[0]);
}

function cardDetailPath(cardId: string, returnTo: string): string {
  const params = new URLSearchParams({ from: returnTo });
  return `/cards/${encodeURIComponent(cardId)}?${params.toString()}`;
}

function safeCatalogReturnPath(value: string | null): string {
  return value && /^\/cards(?:[?#]|$)/.test(value) ? value : '/cards';
}

function paginationItems(currentPage: number, totalPages: number): Array<number | 'ellipsis'> {
  const pages = new Set([1, totalPages, currentPage - 1, currentPage, currentPage + 1]);
  const visiblePages = [...pages].filter((page) => page >= 1 && page <= totalPages).sort((a, b) => a - b);
  const items: Array<number | 'ellipsis'> = [];

  visiblePages.forEach((page, index) => {
    if (index > 0 && page - visiblePages[index - 1] > 1) items.push('ellipsis');
    items.push(page);
  });
  return items;
}

function DetailMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0 border-l border-border-soft pl-3">
      <dt className="font-mono text-minutia uppercase text-content-dim">{label}</dt>
      <dd className="mt-1 break-words text-body font-semibold text-content-primary">{value}</dd>
    </div>
  );
}

function RecommendationCard({
  entry,
  locale,
  returnTo,
}: {
  entry: CardRecommendation;
  locale: ReturnType<typeof useLocale>;
  returnTo: string;
}) {
  const rationale = entry.rationaleI18n?.[locale] || entry.rationale;

  return (
    <Link
      to={cardDetailPath(entry.card.id, returnTo)}
      className="group grid min-w-0 grid-cols-[4.5rem_minmax(0,1fr)] gap-3 rounded-md border border-border-soft bg-surface-base/55 p-3 transition hover:border-accent-primary/45 hover:bg-surface-base/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--focus-ring-color]"
    >
      <span className="aspect-[5/7] overflow-hidden rounded-sm bg-surface-canvas [&>picture]:block [&>picture]:h-full [&>picture]:w-full">
        <CardImage
          src={entry.card.image}
          sourceKind="url"
          context="thumbnail"
          alt=""
          className="h-full w-full object-contain transition duration-300 group-hover:scale-[1.03]"
        />
      </span>
      <span className="min-w-0 py-0.5">
        <span className="flex items-start justify-between gap-2">
          <strong className="line-clamp-2 text-body-sm leading-snug text-content-primary">
            {getLocalizedCardName(entry.card, locale)}
          </strong>
          {entry.recommendationType === 'synergy' && (
            <span className="shrink-0 font-mono text-minutia text-accent-primary">{entry.score}</span>
          )}
        </span>
        <span className="mt-2 flex flex-wrap gap-x-2 gap-y-1">
          {entry.reasons.slice(0, 3).map((reason) => (
            <span key={reason} className="text-minutia leading-snug text-content-dim">
              {t((REASON_KEYS[reason] || 'cardCatalog.reason.related') as Parameters<typeof t>[0])}
            </span>
          ))}
        </span>
        {entry.source === 'approved' && rationale && (
          <span className="mt-2 line-clamp-2 block text-caption leading-relaxed text-content-muted">{rationale}</span>
        )}
      </span>
    </Link>
  );
}

export function CardCatalogPage() {
  const locale = useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { cardId } = useParams<{ cardId?: string }>();
  const pageNavigationRef = useRef(false);
  const [cards, setCards] = useState<CardDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [recommendations, setRecommendations] = useState<CardRecommendation[]>([]);
  const [recommendationsLoading, setRecommendationsLoading] = useState(false);
  const [ownedCardIds, setOwnedCardIds] = useState<Set<string>>(new Set());
  const [collectionScope, setCollectionScope] = useState<'account' | 'local'>('local');
  const [collectionLoading, setCollectionLoading] = useState(true);
  const [collectionSavingCardId, setCollectionSavingCardId] = useState('');
  const [collectionError, setCollectionError] = useState('');

  const query = searchParams.get('q') || '';
  const rawElement = searchParams.get('element') || '';
  const rawType = searchParams.get('type') || '';
  const pack = searchParams.get('pack') || '';
  const rawRarity = searchParams.get('rarity') || '';
  const rawOwnership = searchParams.get('ownership') || '';
  const rawDistribution = searchParams.get('distribution') || '';
  const element = ELEMENTS.includes(rawElement as Element | '') ? (rawElement as Element | '') : '';
  const type = TYPES.includes(rawType as CardType | '') ? (rawType as CardType | '') : '';
  const rarity = RARITIES.includes(rawRarity as (typeof RARITIES)[number]) ? rawRarity : '';
  const ownership = rawOwnership === 'owned' || rawOwnership === 'unowned' ? rawOwnership : '';
  const distribution = CARD_DISTRIBUTION_TYPES.includes(rawDistribution as CardDistributionType)
    ? (rawDistribution as CardDistributionType | '')
    : '';
  const requestedPage = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1);
  const catalogReturnTo = safeCatalogReturnPath(searchParams.get('from'));

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void fetchCatalogCards()
      .then((result) => {
        if (active) setCards(sortCardsById(result));
      })
      .catch(() => {
        if (active) setError(t('cardCatalog.loadError'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const localCardIds = readLocalOwnedCardIds();
    if (!isLoggedIn()) {
      setOwnedCardIds(new Set(localCardIds));
      setCollectionScope('local');
      setCollectionLoading(false);
      return () => {
        active = false;
      };
    }

    void getOwnedCardIds()
      .then(async (accountCardIds) => {
        const mergedCardIds = localCardIds.length > 0 ? await mergeOwnedCards(localCardIds) : accountCardIds;
        if (!active) return;
        if (localCardIds.length > 0) clearLocalOwnedCardIds();
        setOwnedCardIds(new Set(mergedCardIds));
        setCollectionScope('account');
      })
      .catch(() => {
        if (!active) return;
        setOwnedCardIds(new Set(localCardIds));
        setCollectionScope('local');
        setCollectionError(t('cardCatalog.collectionLoadError'));
      })
      .finally(() => {
        if (active) setCollectionLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const packs = useMemo(
    () => [...new Set(cards.map((card) => card.pack).filter(Boolean))].sort(compareCardIds),
    [cards],
  );
  const distributions = useMemo(
    () =>
      CARD_DISTRIBUTION_TYPES.filter((value) => cards.some((card) => (card.distributionType || 'standard') === value)),
    [cards],
  );
  const visibleCards = useMemo(
    () =>
      cards.filter(
        (card) =>
          (!query || matchesLocalizedCardSearch(card, query, availableLocales)) &&
          (!element || card.element === element) &&
          (!type || card.type === type) &&
          (!pack || card.pack === pack) &&
          (!rarity || card.rarity === rarity) &&
          (collectionLoading ||
            !ownership ||
            (ownership === 'owned' ? ownedCardIds.has(card.id) : !ownedCardIds.has(card.id))) &&
          (!distribution || (card.distributionType || 'standard') === distribution),
      ),
    [cards, collectionLoading, distribution, element, ownedCardIds, ownership, pack, query, rarity, type],
  );
  const totalPages = Math.max(1, Math.ceil(visibleCards.length / CATALOG_PAGE_SIZE));
  const currentPage = Math.min(requestedPage, totalPages);
  const pageCards = useMemo(
    () => visibleCards.slice((currentPage - 1) * CATALOG_PAGE_SIZE, currentPage * CATALOG_PAGE_SIZE),
    [currentPage, visibleCards],
  );
  const pageItems = useMemo(() => paginationItems(currentPage, totalPages), [currentPage, totalPages]);
  const selectedCardIndex = cardId ? cards.findIndex((card) => card.id === cardId) : -1;
  const selectedCard = selectedCardIndex >= 0 ? cards[selectedCardIndex] : undefined;
  const previousCard = selectedCardIndex > 0 ? cards[selectedCardIndex - 1] : undefined;
  const nextCard =
    selectedCardIndex >= 0 && selectedCardIndex < cards.length - 1 ? cards[selectedCardIndex + 1] : undefined;
  const hasFilters = Boolean(query || element || type || pack || rarity || ownership || distribution);
  const synergyRecommendations = recommendations.filter((entry) => entry.recommendationType === 'synergy');
  const sameSongRecommendations = recommendations.filter((entry) => entry.recommendationType === 'same_song');

  useEffect(() => {
    if (cardId || loading || requestedPage <= totalPages) return;
    const nextParams = new URLSearchParams(searchParams);
    if (totalPages === 1) nextParams.delete('page');
    else nextParams.set('page', String(totalPages));
    navigate({ pathname: '/cards', search: `?${nextParams.toString()}` }, { replace: true });
  }, [cardId, loading, navigate, requestedPage, searchParams, totalPages]);

  useEffect(() => {
    if (cardId || loading) return;

    if (location.hash.startsWith('#card-')) {
      let targetId = location.hash.slice(1);
      try {
        targetId = decodeURIComponent(targetId);
      } catch {
        // Keep the literal hash when it is not valid percent-encoded text.
      }
      requestAnimationFrame(() => document.getElementById(targetId)?.scrollIntoView({ block: 'center' }));
      return;
    }

    if (pageNavigationRef.current) {
      pageNavigationRef.current = false;
      requestAnimationFrame(() => document.getElementById('catalog-results')?.scrollIntoView({ block: 'start' }));
    }
  }, [cardId, currentPage, loading, location.hash, pageCards]);

  useEffect(() => {
    if (!selectedCard) {
      setRecommendations([]);
      return;
    }
    let active = true;
    setRecommendationsLoading(true);
    void fetchCardRecommendations(selectedCard.id)
      .then((result) => {
        if (active) setRecommendations(result);
      })
      .catch(() => {
        if (active) setRecommendations([]);
      })
      .finally(() => {
        if (active) setRecommendationsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedCard]);

  const updateCatalogParam = (key: string, value: string) => {
    const nextParams = new URLSearchParams(searchParams);
    if (value) nextParams.set(key, value);
    else nextParams.delete(key);
    nextParams.delete('page');
    navigate(
      { pathname: '/cards', search: nextParams.size > 0 ? `?${nextParams.toString()}` : '', hash: '' },
      { replace: true },
    );
  };

  const goToPage = (page: number) => {
    const nextPage = Math.min(Math.max(page, 1), totalPages);
    const nextParams = new URLSearchParams(searchParams);
    if (nextPage === 1) nextParams.delete('page');
    else nextParams.set('page', String(nextPage));
    pageNavigationRef.current = true;
    navigate({ pathname: '/cards', search: nextParams.size > 0 ? `?${nextParams.toString()}` : '', hash: '' });
  };

  const toggleCardOwnership = async (cardId: string) => {
    if (collectionLoading || collectionSavingCardId) return;
    const owned = !ownedCardIds.has(cardId);
    const previous = ownedCardIds;
    const next = new Set(previous);
    if (owned) next.add(cardId);
    else next.delete(cardId);
    setOwnedCardIds(next);
    setCollectionError('');

    if (collectionScope === 'local') {
      setLocalCardOwned(cardId, owned);
      return;
    }

    setCollectionSavingCardId(cardId);
    try {
      await setOwnedCard(cardId, owned);
    } catch {
      setOwnedCardIds(previous);
      setCollectionError(t('cardCatalog.collectionSaveError'));
    } finally {
      setCollectionSavingCardId('');
    }
  };

  const clearFilters = () => {
    navigate('/cards', { replace: true });
  };

  if (cardId) {
    return (
      <PageShell variant="scroll" glow={{ color: 'gold', size: 'lg' }}>
        <AppHeader
          title={t('cardCatalog.title')}
          subtitle={t('cardCatalog.subtitle')}
          backTo={catalogReturnTo}
          actions={<LanguageSwitcher />}
        />
        <main className="relative mx-auto w-full max-w-7xl px-4 pb-14 pt-24 md:px-6 md:pt-28">
          {collectionScope === 'local' && !collectionLoading && (
            <Alert className="mb-6" tone="info">
              {t('cardCatalog.localCollectionNotice')}{' '}
              <Link className="font-semibold text-accent-action underline underline-offset-4" to="/profile">
                {t('cardCatalog.signInToSync')}
              </Link>
            </Alert>
          )}
          {collectionError && (
            <Alert className="mb-6" tone="danger" role="alert">
              {collectionError}
            </Alert>
          )}
          {loading ? (
            <LoadingState className="min-h-[60vh]" label={t('cardCatalog.loading')} />
          ) : error ? (
            <Alert tone="danger" role="alert">
              {error}
            </Alert>
          ) : !selectedCard ? (
            <EmptyState
              title={t('cardCatalog.notFound')}
              description={t('cardCatalog.notFoundDescription')}
              actions={<Button onClick={() => navigate(catalogReturnTo)}>{t('cardCatalog.backToCatalog')}</Button>}
            />
          ) : (
            <div className="grid gap-10">
              <article className="grid items-start gap-8 lg:grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)] lg:gap-12">
                <div className="lg:sticky lg:top-28">
                  <div className="mx-auto aspect-[5/7] w-full max-w-[22rem] overflow-hidden rounded-md border border-border-soft bg-surface-canvas shadow-card [&>picture]:block [&>picture]:h-full [&>picture]:w-full">
                    <CardImage
                      src={selectedCard.image}
                      sourceKind="url"
                      context="detail"
                      alt={getLocalizedCardName(selectedCard, locale)}
                      className="h-full w-full object-contain"
                    />
                  </div>
                  <p className="mt-3 text-center font-mono text-caption text-content-dim">{selectedCard.id}</p>
                </div>

                <div className="min-w-0">
                  <header className="border-b border-border-soft pb-6">
                    <div className="flex flex-wrap gap-2">
                      {selectedCard.hasElement !== false && selectedCard.element && (
                        <Badge tone="gold">{elementLabel(selectedCard.element)}</Badge>
                      )}
                      <Badge>{cardTypeLabel(selectedCard.type)}</Badge>
                      <Badge>{selectedCard.rarity}</Badge>
                      <Badge>{distributionLabel(selectedCard.distributionType)}</Badge>
                      {selectedCard.playStatus === 'display_only' && (
                        <Badge tone="vermilion">{t('cardCatalog.displayOnly')}</Badge>
                      )}
                    </div>
                    <h1 className="mt-5 break-words font-display text-title-lg font-bold leading-tight text-content-primary">
                      {getLocalizedCardName(selectedCard, locale)}
                    </h1>
                    {getLocalizedSongTitle(selectedCard.song, locale) && (
                      <p className="mt-2 text-body text-content-muted">
                        {t('cardCatalog.song')} · {getLocalizedSongTitle(selectedCard.song, locale)}
                      </p>
                    )}
                  </header>

                  {selectedCard.playStatus === 'display_only' && (
                    <Alert className="mt-6" tone="warning">
                      {selectedCard.playStatusReason || t('cardCatalog.notPlayable')}
                    </Alert>
                  )}

                  <section className="border-b border-border-soft py-6" aria-labelledby="card-stats-title">
                    <h2 id="card-stats-title" className="sr-only">
                      {t('cardCatalog.cardDetails')}
                    </h2>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
                      <DetailMetric
                        label="Power Cost"
                        value={selectedCard.hasPowerCost === false ? '—' : selectedCard.powerCost}
                      />
                      <DetailMetric
                        label="SEND TO POWER"
                        value={selectedCard.hasSendToPower === false ? '—' : selectedCard.sendToPower}
                      />
                      <DetailMetric
                        label={t('cardCatalog.clock')}
                        value={selectedCard.hasClock === false ? '—' : selectedCard.clock}
                      />
                      <DetailMetric
                        label={t('cardCatalog.attack')}
                        value={selectedCard.attack ? `${selectedCard.attack.night} / ${selectedCard.attack.day}` : '—'}
                      />
                    </dl>
                  </section>

                  <section className="border-b border-border-soft py-6" aria-labelledby="card-effect-title">
                    <h2 id="card-effect-title" className="font-display text-title-sm font-bold text-content-primary">
                      {t('cardCatalog.effect')}
                    </h2>
                    <p className="mt-4 whitespace-pre-wrap text-body leading-8 text-content-primary/90">
                      {getLocalizedCardEffect(selectedCard, locale) || t('cardCatalog.noEffect')}
                    </p>
                    {selectedCard.errata && (
                      <Alert className="mt-5" tone="warning">
                        {selectedCard.errata}
                      </Alert>
                    )}
                  </section>

                  <section className="grid gap-5 py-6 sm:grid-cols-2" aria-labelledby="card-meta-title">
                    <h2 id="card-meta-title" className="sr-only">
                      {t('cardCatalog.cardDetails')}
                    </h2>
                    <DetailMetric label={t('cardCatalog.pack')} value={selectedCard.pack || '—'} />
                    <DetailMetric label={t('cardCatalog.illustrator')} value={selectedCard.illustrator || '—'} />
                    <DetailMetric
                      label={t('cardCatalog.distribution')}
                      value={distributionLabel(selectedCard.distributionType)}
                    />
                    <DetailMetric
                      label={t('cardCatalog.playStatus')}
                      value={
                        selectedCard.playStatus === 'display_only'
                          ? t('cardCatalog.displayOnly')
                          : t('cardCatalog.playable')
                      }
                    />
                  </section>

                  <div className="flex flex-wrap gap-3 border-t border-border-soft pt-6">
                    <Button
                      variant={ownedCardIds.has(selectedCard.id) ? 'primary' : 'secondary'}
                      disabled={collectionLoading || collectionSavingCardId === selectedCard.id}
                      leftIcon={
                        ownedCardIds.has(selectedCard.id) ? (
                          <Check className="size-4" aria-hidden="true" />
                        ) : (
                          <PackageCheck className="size-4" aria-hidden="true" />
                        )
                      }
                      onClick={() => void toggleCardOwnership(selectedCard.id)}
                    >
                      {ownedCardIds.has(selectedCard.id) ? t('cardCatalog.markNotOwned') : t('cardCatalog.markOwned')}
                    </Button>
                    <Button
                      variant="primary"
                      disabled={selectedCard.playStatus === 'display_only'}
                      rightIcon={<ArrowRight className="size-4" aria-hidden="true" />}
                      onClick={() => navigate(`/deck-builder?card=${encodeURIComponent(selectedCard.id)}`)}
                    >
                      {selectedCard.playStatus === 'display_only'
                        ? t('cardCatalog.notPlayable')
                        : t('cardCatalog.openDeckBuilder')}
                    </Button>
                    {selectedCard.sourceUrl && (
                      <a
                        href={selectedCard.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-h-control-md items-center justify-center gap-2 rounded-sm border border-border-soft px-5 py-2.5 font-mono text-control font-medium uppercase text-content-muted transition hover:border-accent-action/50 hover:text-accent-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--focus-ring-color]"
                      >
                        {t('cardCatalog.openSource')}
                        <ExternalLink className="size-4" aria-hidden="true" />
                      </a>
                    )}
                  </div>
                </div>
              </article>

              <section className="border-t border-border-soft pt-8" aria-labelledby="card-recommendations-title">
                <div className="max-w-2xl">
                  <h2
                    id="card-recommendations-title"
                    className="inline-flex items-center gap-2 font-display text-title-sm font-bold"
                  >
                    <Sparkles className="size-5 text-accent-primary" aria-hidden="true" />
                    {t('cardCatalog.recommendations')}
                  </h2>
                  <p className="mt-2 text-body-sm leading-relaxed text-content-muted">
                    {t('cardCatalog.recommendationsDescription')}
                  </p>
                </div>
                {recommendationsLoading ? (
                  <LoadingState className="min-h-40" label={t('cardCatalog.loadingRecommendations')} />
                ) : (
                  <div className="space-y-8">
                    {synergyRecommendations.length === 0 ? (
                      <p className="mt-6 border-l-2 border-border-soft pl-4 text-body-sm text-content-dim">
                        {t('cardCatalog.noRecommendations')}
                      </p>
                    ) : (
                      <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {synergyRecommendations.map((entry) => (
                          <RecommendationCard
                            key={entry.card.id}
                            entry={entry}
                            locale={locale}
                            returnTo={catalogReturnTo}
                          />
                        ))}
                      </div>
                    )}
                    {sameSongRecommendations.length > 0 && (
                      <section className="border-t border-border-soft pt-6" aria-labelledby="same-song-cards-title">
                        <h3
                          id="same-song-cards-title"
                          className="font-display text-body-lg font-bold text-content-primary"
                        >
                          {t('cardCatalog.sameSongCards')}
                        </h3>
                        <p className="mt-1 text-body-sm leading-relaxed text-content-muted">
                          {t('cardCatalog.sameSongCardsDescription')}
                        </p>
                        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                          {sameSongRecommendations.map((entry) => (
                            <RecommendationCard
                              key={entry.card.id}
                              entry={entry}
                              locale={locale}
                              returnTo={catalogReturnTo}
                            />
                          ))}
                        </div>
                      </section>
                    )}
                  </div>
                )}
              </section>

              <nav
                className="grid gap-px overflow-hidden rounded-md border border-border-soft bg-border-soft sm:grid-cols-2"
                aria-label={t('cardCatalog.cardNavigation')}
              >
                {previousCard ? (
                  <Link
                    to={cardDetailPath(previousCard.id, catalogReturnTo)}
                    className="group flex min-h-24 items-center gap-3 bg-surface-base p-4 transition hover:bg-surface-raised focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[--focus-ring-color]"
                  >
                    <ChevronLeft
                      className="size-5 shrink-0 text-content-dim group-hover:text-accent-primary"
                      aria-hidden="true"
                    />
                    <span className="min-w-0">
                      <span className="font-mono text-minutia uppercase text-content-dim">
                        {t('cardCatalog.previousCard')}
                      </span>
                      <strong className="mt-1 block truncate text-body text-content-primary">
                        {getLocalizedCardName(previousCard, locale)}
                      </strong>
                    </span>
                  </Link>
                ) : (
                  <span className="hidden bg-surface-base sm:block" />
                )}
                {nextCard && (
                  <Link
                    to={cardDetailPath(nextCard.id, catalogReturnTo)}
                    className="group flex min-h-24 items-center justify-end gap-3 bg-surface-base p-4 text-right transition hover:bg-surface-raised focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[--focus-ring-color]"
                  >
                    <span className="min-w-0">
                      <span className="font-mono text-minutia uppercase text-content-dim">
                        {t('cardCatalog.nextCard')}
                      </span>
                      <strong className="mt-1 block truncate text-body text-content-primary">
                        {getLocalizedCardName(nextCard, locale)}
                      </strong>
                    </span>
                    <ChevronRight
                      className="size-5 shrink-0 text-content-dim group-hover:text-accent-primary"
                      aria-hidden="true"
                    />
                  </Link>
                )}
              </nav>
            </div>
          )}
        </main>
      </PageShell>
    );
  }

  return (
    <PageShell variant="scroll" glow={{ color: 'gold', size: 'lg' }}>
      <AppHeader
        title={t('cardCatalog.title')}
        subtitle={t('cardCatalog.subtitle')}
        backTo="/"
        actions={<LanguageSwitcher />}
      />
      <main className="relative mx-auto grid w-full max-w-7xl gap-6 px-4 pb-12 pt-24 md:px-6 md:pt-28">
        <header className="grid gap-4 border-b border-border-soft pb-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,28rem)] lg:items-end">
          <div>
            <p className="inline-flex items-center gap-2 font-mono text-caption uppercase text-accent-primary">
              <BookOpen className="size-4" aria-hidden="true" />
              {t('cardCatalog.kicker')}
            </p>
            <h1 className="mt-2 font-display text-title-lg font-bold text-content-primary">
              {t('cardCatalog.heading')}
            </h1>
            <p className="mt-2 max-w-2xl text-body-sm leading-relaxed text-content-muted">
              {t('cardCatalog.description')}
            </p>
          </div>
          <SearchInput
            icon={<Search className="size-4 text-content-dim" aria-hidden="true" />}
            aria-label={t('cardCatalog.search')}
            placeholder={t('cardCatalog.search')}
            value={query}
            onChange={(event) => updateCatalogParam('q', event.target.value)}
          />
        </header>

        <section className="grid gap-4" aria-label={t('cardCatalog.filters')}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="inline-flex items-center gap-2 font-mono text-caption uppercase text-content-dim">
              <Filter className="size-4" aria-hidden="true" />
              {t('cardCatalog.filters')}
            </h2>
            {hasFilters && (
              <Button size="sm" variant="ghost" onClick={clearFilters}>
                {t('cardCatalog.clearFilters')}
              </Button>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <Select value={element} onChange={(event) => updateCatalogParam('element', event.target.value)}>
              {ELEMENTS.map((value) => (
                <option key={value || 'all'} value={value}>
                  {value ? elementLabel(value) : t('cardCatalog.allElements')}
                </option>
              ))}
            </Select>
            <Select value={type} onChange={(event) => updateCatalogParam('type', event.target.value)}>
              {TYPES.map((value) => (
                <option key={value || 'all'} value={value}>
                  {value ? cardTypeLabel(value) : t('cardCatalog.allTypes')}
                </option>
              ))}
            </Select>
            <Select value={pack} onChange={(event) => updateCatalogParam('pack', event.target.value)}>
              <option value="">{t('cardCatalog.allPacks')}</option>
              {packs.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
            <Select value={rarity} onChange={(event) => updateCatalogParam('rarity', event.target.value)}>
              <option value="">{t('cardCatalog.allRarities')}</option>
              {RARITIES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
            <Select
              value={ownership}
              disabled={collectionLoading}
              onChange={(event) => updateCatalogParam('ownership', event.target.value)}
            >
              <option value="">{t('cardCatalog.allOwnership')}</option>
              <option value="owned">{t('cardCatalog.ownedOnly')}</option>
              <option value="unowned">{t('cardCatalog.unownedOnly')}</option>
            </Select>
            <Select value={distribution} onChange={(event) => updateCatalogParam('distribution', event.target.value)}>
              <option value="">{t('cardCatalog.allDistributions')}</option>
              {distributions.map((value) => (
                <option key={value || 'all'} value={value}>
                  {distributionLabel(value)}
                </option>
              ))}
            </Select>
          </div>
        </section>

        {collectionScope === 'local' && !collectionLoading && (
          <Alert tone="info">
            {t('cardCatalog.localCollectionNotice')}{' '}
            <Link className="font-semibold text-accent-action underline underline-offset-4" to="/profile">
              {t('cardCatalog.signInToSync')}
            </Link>
          </Alert>
        )}
        {collectionError && (
          <Alert tone="danger" role="alert">
            {collectionError}
          </Alert>
        )}

        <div
          className="flex flex-wrap items-center justify-between gap-2 font-mono text-caption text-content-dim"
          aria-live="polite"
        >
          <p>{t('cardCatalog.resultCount').replace('{count}', String(visibleCards.length))}</p>
          {visibleCards.length > 0 && (
            <p>
              {t('cardCatalog.pageRange')
                .replace('{start}', String((currentPage - 1) * CATALOG_PAGE_SIZE + 1))
                .replace('{end}', String(Math.min(currentPage * CATALOG_PAGE_SIZE, visibleCards.length)))}
            </p>
          )}
        </div>

        {loading ? (
          <LoadingState label={t('cardCatalog.loading')} />
        ) : error ? (
          <Alert tone="danger" role="alert">
            {error}
          </Alert>
        ) : visibleCards.length === 0 ? (
          <EmptyState
            title={t('cardCatalog.empty')}
            description={t('cardCatalog.emptyDescription')}
            actions={hasFilters ? <Button onClick={clearFilters}>{t('cardCatalog.clearFilters')}</Button> : undefined}
          />
        ) : (
          <section
            id="catalog-results"
            className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
            aria-label={t('cardCatalog.results')}
          >
            {pageCards.map((card) => {
              const returnTo = `/cards${location.search}#card-${encodeURIComponent(card.id)}`;
              return (
                <Link
                  key={card.id}
                  id={`card-${card.id}`}
                  to={cardDetailPath(card.id, returnTo)}
                  className="group min-w-0 overflow-hidden rounded-md border border-border-soft bg-surface-base/70 text-left transition hover:border-accent-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--focus-ring-color]"
                >
                  <span className="block aspect-[5/7] overflow-hidden bg-surface-canvas [&>picture]:block [&>picture]:h-full [&>picture]:w-full">
                    <CardImage
                      src={card.image}
                      sourceKind="url"
                      context="thumbnail"
                      alt={getLocalizedCardName(card, locale)}
                      className="h-full w-full object-contain transition duration-300 group-hover:scale-[1.03]"
                    />
                  </span>
                  <span className="grid gap-1.5 p-3">
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-mono text-minutia text-content-dim">{card.id}</span>
                      <span className="flex flex-wrap justify-end gap-1">
                        {ownedCardIds.has(card.id) && (
                          <Badge tone="gold">
                            <PackageCheck className="mr-1 size-3" aria-hidden="true" />
                            {t('cardCatalog.owned')}
                          </Badge>
                        )}
                        {card.playStatus === 'display_only' && <Badge>{t('cardCatalog.displayOnly')}</Badge>}
                      </span>
                    </span>
                    <strong className="line-clamp-2 min-h-10 text-body-sm leading-snug text-content-primary">
                      {getLocalizedCardName(card, locale)}
                    </strong>
                    <span className="truncate text-caption text-content-muted">
                      {card.hasElement === false || !card.element
                        ? cardTypeLabel(card.type)
                        : `${elementLabel(card.element)} · ${cardTypeLabel(card.type)}`}
                    </span>
                  </span>
                </Link>
              );
            })}
          </section>
        )}

        {!loading && !error && visibleCards.length > 0 && totalPages > 1 && (
          <nav
            className="flex flex-wrap items-center justify-center gap-1 border-t border-border-soft pt-6"
            aria-label={t('cardCatalog.paginationLabel')}
          >
            <Button
              size="sm"
              variant="ghost"
              disabled={currentPage === 1}
              leftIcon={<ChevronLeft className="size-4" aria-hidden="true" />}
              onClick={() => goToPage(currentPage - 1)}
            >
              {t('cardCatalog.previousPage')}
            </Button>
            <div className="flex flex-wrap items-center justify-center gap-1 px-1">
              {pageItems.map((item, index) =>
                item === 'ellipsis' ? (
                  <span key={`ellipsis-${index}`} className="flex size-10 items-center justify-center text-content-dim">
                    …
                  </span>
                ) : (
                  <button
                    key={item}
                    type="button"
                    className={`flex size-10 items-center justify-center rounded-sm border font-mono text-control transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--focus-ring-color] ${
                      item === currentPage
                        ? 'border-accent-primary bg-accent-primary/10 text-accent-primary'
                        : 'border-transparent text-content-muted hover:border-border-soft hover:text-content-primary'
                    }`}
                    aria-current={item === currentPage ? 'page' : undefined}
                    aria-label={t('cardCatalog.goToPage').replace('{page}', String(item))}
                    onClick={() => goToPage(item)}
                  >
                    {item}
                  </button>
                ),
              )}
            </div>
            <Button
              size="sm"
              variant="ghost"
              disabled={currentPage === totalPages}
              rightIcon={<ChevronRight className="size-4" aria-hidden="true" />}
              onClick={() => goToPage(currentPage + 1)}
            >
              {t('cardCatalog.nextPage')}
            </Button>
            <p className="basis-full pt-2 text-center font-mono text-caption text-content-dim">
              {t('cardCatalog.pageStatus')
                .replace('{page}', String(currentPage))
                .replace('{total}', String(totalPages))}
            </p>
          </nav>
        )}
      </main>
    </PageShell>
  );
}
