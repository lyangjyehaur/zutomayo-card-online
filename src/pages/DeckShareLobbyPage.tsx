import { RotateCcw, Search, SlidersHorizontal, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { isLoggedIn, listDeckShares, type DeckShareSort, type DeckShareSummary } from '../api/client';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { DeckShareCard } from '../components/deck-sharing/DeckShareCard';
import { DeckShareLobbyPublishFlow } from '../components/deck-sharing/DeckShareLobbyPublishFlow';
import { trackDeckShareEvent } from '../deckShareAnalytics';
import { getLocalDeckShareDemoPage, isLocalDeckShareDemo, shouldUseLocalDeckShareDemo } from '../deckShareDemo';
import {
  DECK_SHARE_ELEMENTS,
  DECK_SHARE_SORTS,
  deckShareElementLabel,
  mergeDeckSharePages,
  readDeckShareLobbyState,
  updateDeckShareSearchParam,
} from '../deckShareUi';
import { t, useLocale } from '../i18n';
import { Alert, AppHeader, Button, EmptyState, LoadingState, PageShell, SearchInput, Select, cn } from '../ui';

const ELEMENT_COLORS: Record<string, string> = {
  闇: '#7562a8',
  炎: '#d95d48',
  電気: '#d9be45',
  風: '#57a279',
  カオス: '#aaa6ba',
};

function sortLabel(sort: DeckShareSort): string {
  if (sort === 'popular') return t('deckShare.sortPopular');
  if (sort === 'most-copied') return t('deckShare.sortMostCopied');
  return t('deckShare.sortNewest');
}

function elementLabel(element: string): string {
  if (!element) return t('deckShare.allElements');
  return deckShareElementLabel(element, t);
}

export function DeckShareLobbyPage() {
  const locale = useLocale();
  const loggedIn = isLoggedIn();
  const [searchParams, setSearchParams] = useSearchParams();
  const { sort, element, query } = readDeckShareLobbyState(searchParams);
  const [searchDraft, setSearchDraft] = useState(query);
  const [shares, setShares] = useState<DeckShareSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [usingLocalPreview, setUsingLocalPreview] = useState(false);
  const requestIdRef = useRef(0);
  const localPreviewModeRef = useRef(false);

  const setParam = useCallback(
    (key: string, value: string) => {
      setSearchParams((current) => updateDeckShareSearchParam(current, key, value));
    },
    [setSearchParams],
  );

  useEffect(() => {
    setSearchDraft(query);
  }, [query]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (searchDraft.trim() !== query) setParam('q', searchDraft.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query, searchDraft, setParam]);

  const loadFirstPage = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError('');
    try {
      const remotePage = await listDeckShares({
        sort,
        q: query || undefined,
        element: element || undefined,
        limit: 24,
      });
      if (requestId !== requestIdRef.current) return;

      let page = remotePage;
      if (remotePage.shares.length > 0) {
        localPreviewModeRef.current = false;
      } else if (shouldUseLocalDeckShareDemo() && (localPreviewModeRef.current || (!query && !element))) {
        localPreviewModeRef.current = true;
        page = getLocalDeckShareDemoPage(locale, {
          sort,
          q: query || undefined,
          element: element || undefined,
        });
      }

      setShares(page.shares);
      setNextCursor(page.nextCursor);
      setUsingLocalPreview(page.shares.some((share) => isLocalDeckShareDemo(share.id)));
    } catch {
      if (requestId !== requestIdRef.current) return;
      setError(t('deckShare.loadError'));
      setUsingLocalPreview(false);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [element, locale, query, sort]);

  useEffect(() => {
    void loadFirstPage();
    trackDeckShareEvent('deck_share_lobby_filter', {
      sort,
      ...(element ? { element } : {}),
      source: 'lobby',
    });
  }, [element, loadFirstPage, sort]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError('');
    try {
      const page = await listDeckShares({
        sort,
        q: query || undefined,
        element: element || undefined,
        cursor: nextCursor,
        limit: 24,
      });
      setShares((current) => mergeDeckSharePages(current, page.shares));
      setNextCursor(page.nextCursor);
    } catch {
      setError(t('deckShare.loadMoreError'));
    } finally {
      setLoadingMore(false);
    }
  };

  const hasFilters = Boolean(query || element);
  const clearFilters = () => {
    setSearchDraft('');
    setSearchParams({ sort });
  };
  return (
    <PageShell variant="scroll" glow={{ color: 'gold', size: 'lg', className: 'left-1/4 top-0' }}>
      <AppHeader title={t('deckShare.lobbyTitle')} backTo="/" actions={<LanguageSwitcher />} />
      <div className="relative z-10 mx-auto grid min-h-full w-full max-w-7xl gap-6 px-4 pb-12 pt-24 md:px-6 md:pt-28">
        <header className="grid gap-5 border-b border-border-soft pb-6">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
            <div>
              <p className="font-mono text-caption uppercase tracking-[var(--tracking-kicker)] text-accent-primary">
                {t('deckShare.lobbyKicker')}
              </p>
              <h1 className="mt-1 font-display text-title-lg font-bold">{t('deckShare.lobbyHeading')}</h1>
              <p className="mt-2 max-w-3xl text-body-sm leading-relaxed text-content-muted">
                {t('deckShare.lobbyDescription')}
              </p>
            </div>
            {loggedIn && <DeckShareLobbyPublishFlow onChanged={loadFirstPage} />}
          </div>

          <div className="relative">
            <SearchInput
              icon={<Search className="size-4 text-content-dim" aria-hidden="true" />}
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder={t('deckShare.searchPlaceholder')}
              aria-label={t('deckShare.searchPlaceholder')}
              className="pr-10"
              containerClassName="min-h-12 bg-surface-panel/65 backdrop-blur"
            />
            {searchDraft && (
              <button
                type="button"
                className="absolute right-1 top-1 inline-flex size-10 items-center justify-center rounded-sm text-content-dim transition hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--focus-ring-color]"
                onClick={() => {
                  setSearchDraft('');
                  setParam('q', '');
                }}
                aria-label={t('deckShare.clearSearch')}
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            )}
          </div>
        </header>

        <section aria-label={t('deckShare.elementFilter')}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="inline-flex items-center gap-2 font-mono text-caption uppercase text-content-dim">
              <SlidersHorizontal className="size-4" aria-hidden="true" />
              {t('deckShare.elementFilter')}
            </h2>
            <div className="flex items-center gap-3">
              {hasFilters && (
                <button
                  type="button"
                  className="inline-flex min-h-10 items-center gap-1.5 text-caption text-content-dim transition hover:text-accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--focus-ring-color]"
                  onClick={clearFilters}
                >
                  <RotateCcw className="size-3.5" aria-hidden="true" />
                  {t('deckShare.clearFilters')}
                </button>
              )}
              <label className="flex items-center gap-2 font-mono text-caption text-content-dim">
                <span>{t('deckShare.sortLabel')}</span>
                <Select
                  className="min-h-11 w-auto py-1 text-body-sm"
                  value={sort}
                  onChange={(event) => setParam('sort', event.target.value)}
                  aria-label={t('deckShare.sortLabel')}
                >
                  {DECK_SHARE_SORTS.map((value) => (
                    <option key={value} value={value}>
                      {sortLabel(value)}
                    </option>
                  ))}
                </Select>
              </label>
            </div>
          </div>

          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:mx-0 md:px-0">
            {DECK_SHARE_ELEMENTS.map((value) => {
              const selected = element === value;
              const color = value ? ELEMENT_COLORS[value] : undefined;
              return (
                <button
                  key={value || 'all'}
                  type="button"
                  className={cn(
                    'inline-flex min-h-11 shrink-0 items-center gap-2 rounded-sm border px-3 text-body-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--focus-ring-color]',
                    selected
                      ? 'border-accent-primary/60 bg-accent-primary/10 text-accent-primary'
                      : 'border-border-soft bg-surface-panel/50 text-content-muted hover:border-border-strong hover:text-content-primary',
                  )}
                  aria-pressed={selected}
                  onClick={() => setParam('element', selected ? '' : value)}
                >
                  {color && (
                    <span
                      className="size-2.5 rounded-full border border-content-primary/20"
                      style={{ backgroundColor: color }}
                      aria-hidden="true"
                    />
                  )}
                  {elementLabel(value)}
                </button>
              );
            })}
          </div>
        </section>

        {error && (
          <Alert tone="danger" role="alert" title={t('deckShare.errorTitle')}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>{error}</span>
              {!loadingMore && (
                <Button type="button" size="sm" variant="secondary" onClick={() => void loadFirstPage()}>
                  {t('common.retry')}
                </Button>
              )}
            </div>
          </Alert>
        )}

        {usingLocalPreview && <Alert tone="info">{t('deckShare.localPreviewNotice')}</Alert>}

        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-caption text-content-dim" aria-live="polite">
            {t('deckShare.resultCount').replace('{count}', String(shares.length))}
          </p>
        </div>

        {loading && shares.length === 0 ? (
          <LoadingState label={t('deckShare.loading')} className="min-h-72" />
        ) : shares.length === 0 ? (
          <EmptyState
            title={hasFilters ? t('deckShare.emptyFilteredTitle') : t('deckShare.emptyTitle')}
            description={hasFilters ? t('deckShare.emptyFilteredBody') : t('deckShare.emptyBody')}
            actions={
              hasFilters ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={clearFilters}
                  leftIcon={<RotateCcw className="size-4" aria-hidden="true" />}
                >
                  {t('deckShare.clearFilters')}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <section
              className={cn(
                'grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
                loading && 'opacity-60',
              )}
              aria-busy={loading}
              aria-label={t('deckShare.results')}
            >
              {shares.map((share) => (
                <DeckShareCard key={share.id} share={share} />
              ))}
            </section>
            {nextCursor && (
              <div className="flex justify-center pt-2">
                <Button type="button" variant="secondary" disabled={loadingMore} onClick={() => void loadMore()}>
                  {loadingMore ? t('deckShare.loadingMore') : t('deckShare.loadMore')}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </PageShell>
  );
}
