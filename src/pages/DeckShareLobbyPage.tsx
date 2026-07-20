import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, SlidersHorizontal } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { listDeckShares, type DeckShareSort, type DeckShareSummary } from '../api/client';
import {
  DECK_SHARE_ELEMENTS,
  DECK_SHARE_SORTS,
  mergeDeckSharePages,
  readDeckShareLobbyState,
  updateDeckShareSearchParam,
} from '../deckShareUi';
import { trackDeckShareEvent } from '../deckShareAnalytics';
import { DeckShareCard } from '../components/deck-sharing/DeckShareCard';
import { t } from '../i18n';
import {
  Alert,
  AppHeader,
  Button,
  EmptyState,
  FilterToolbar,
  LoadingState,
  PageShell,
  SearchInput,
  Select,
} from '../ui';

function sortLabel(sort: DeckShareSort): string {
  if (sort === 'popular') return t('deckShare.sortPopular');
  if (sort === 'most-copied') return t('deckShare.sortMostCopied');
  return t('deckShare.sortNewest');
}

export function DeckShareLobbyPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { sort, element, query } = readDeckShareLobbyState(searchParams);
  const [searchDraft, setSearchDraft] = useState(query);
  const [shares, setShares] = useState<DeckShareSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const requestIdRef = useRef(0);

  const setParam = useCallback(
    (key: string, value: string) => {
      setSearchParams((current) => {
        return updateDeckShareSearchParam(current, key, value);
      });
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
      const page = await listDeckShares({ sort, q: query || undefined, element: element || undefined, limit: 24 });
      if (requestId !== requestIdRef.current) return;
      setShares(page.shares);
      setNextCursor(page.nextCursor);
    } catch {
      if (requestId !== requestIdRef.current) return;
      setError(t('deckShare.loadError'));
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [element, query, sort]);

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

  return (
    <PageShell variant="scroll" glow={{ color: 'gold', size: 'lg', className: 'left-1/4 top-0' }}>
      <AppHeader title={t('deckShare.lobbyTitle')} backTo="/" />
      <div className="relative z-10 mx-auto grid min-h-full w-full max-w-7xl gap-4 px-4 pb-8 pt-24 md:px-6">
        <header className="grid gap-2">
          <p className="font-mono text-caption uppercase tracking-[var(--tracking-kicker)] text-accent-primary">
            {t('deckShare.lobbyKicker')}
          </p>
          <h1 className="font-display text-title-lg font-bold">{t('deckShare.lobbyHeading')}</h1>
          <p className="max-w-3xl text-body leading-relaxed text-content-muted">{t('deckShare.lobbyDescription')}</p>
        </header>

        <FilterToolbar
          primary={
            <SearchInput
              icon={<Search className="size-4" aria-hidden="true" />}
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder={t('deckShare.searchPlaceholder')}
              aria-label={t('deckShare.searchPlaceholder')}
              className="min-w-0 sm:w-72"
            />
          }
          actions={
            <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
              <label className="grid gap-1">
                <span className="sr-only">{t('deckShare.elementFilter')}</span>
                <Select value={element} onChange={(event) => setParam('element', event.target.value)}>
                  {DECK_SHARE_ELEMENTS.map((value) => (
                    <option key={value || 'all'} value={value}>
                      {value || t('deckShare.allElements')}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="grid gap-1">
                <span className="sr-only">{t('deckShare.sortLabel')}</span>
                <Select value={sort} onChange={(event) => setParam('sort', event.target.value)}>
                  {DECK_SHARE_SORTS.map((value) => (
                    <option key={value} value={value}>
                      {sortLabel(value)}
                    </option>
                  ))}
                </Select>
              </label>
            </div>
          }
        />

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
                  onClick={() => {
                    setSearchDraft('');
                    setSearchParams({ sort });
                  }}
                >
                  <SlidersHorizontal className="size-4" aria-hidden="true" />
                  {t('deckShare.clearFilters')}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <section
              className={`grid gap-4 sm:grid-cols-2 xl:grid-cols-3 ${loading ? 'opacity-60' : ''}`}
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
