import {
  BookOpenText,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  FileCheck2,
  Layers3,
  Search,
  Share2,
  X,
} from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { type KnowledgeSearchHit, type KnowledgeSearchScope } from '../api/client';
import { CardImage } from '../components/CardImage';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { HighlightedText } from '../components/knowledge-search/HighlightedText';
import { useDebouncedSearchQuery } from '../hooks/useDebouncedSearchQuery';
import { useKnowledgeSearch } from '../hooks/useKnowledgeSearch';
import { useKnowledgeSearchSuggestions } from '../hooks/useKnowledgeSearchSuggestions';
import { t, useLocale, type TranslationKey } from '../i18n';
import { Alert, AppHeader, Badge, Button, EmptyState, LoadingState, PageShell, SearchInput, cn } from '../ui';

type SearchScope = 'all' | KnowledgeSearchScope;

const PAGE_SIZE = 40;
const SCOPES: SearchScope[] = ['all', 'card', 'qa', 'rule', 'errata', 'deck'];

const SCOPE_KEYS: Record<SearchScope, TranslationKey> = {
  all: 'knowledgeSearch.scope.all',
  card: 'knowledgeSearch.scope.card',
  qa: 'knowledgeSearch.scope.qa',
  rule: 'knowledgeSearch.scope.rule',
  errata: 'knowledgeSearch.scope.errata',
  deck: 'knowledgeSearch.scope.deck',
};

function scopeIcon(scope: KnowledgeSearchScope) {
  if (scope === 'card') return CreditCard;
  if (scope === 'qa') return BookOpenText;
  if (scope === 'rule') return Layers3;
  if (scope === 'errata') return FileCheck2;
  return Share2;
}

function SearchResultRow({ hit }: { hit: KnowledgeSearchHit }) {
  const Icon = scopeIcon(hit.type);
  const hasImage = hit.type === 'card' && Boolean(hit.image);
  return (
    <Link
      to={hit.url}
      className="group grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 border-b border-border-soft px-1 py-4 transition hover:bg-surface-raised/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[--focus-ring-color] sm:gap-4 sm:px-3"
    >
      {hasImage ? (
        <span className="h-20 w-14 overflow-hidden rounded-sm bg-surface-canvas sm:h-24 sm:w-[4.25rem] [&>picture]:block [&>picture]:h-full [&>picture]:w-full">
          <CardImage
            src={hit.image}
            sourceKind="url"
            context="thumbnail"
            alt=""
            className="h-full w-full object-contain"
          />
        </span>
      ) : (
        <span className="mt-0.5 inline-flex size-10 items-center justify-center rounded-sm border border-border-soft bg-surface-canvas text-content-dim">
          <Icon className="size-4" aria-hidden="true" />
        </span>
      )}
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2">
          <Badge>{t(SCOPE_KEYS[hit.type])}</Badge>
          {hit.subtitle && <span className="truncate font-mono text-minutia text-content-dim">{hit.subtitle}</span>}
        </span>
        <strong className="mt-2 block text-title-xs font-semibold leading-snug text-content-primary group-hover:text-accent-primary">
          <HighlightedText text={hit.title} ranges={hit.titleHighlights} />
        </strong>
        {hit.snippet && (
          <span className="mt-1 line-clamp-3 whitespace-pre-line text-body-sm leading-relaxed text-content-muted">
            <HighlightedText text={hit.snippet} ranges={hit.snippetHighlights} />
          </span>
        )}
        {hit.relatedCardIds.length > 0 && hit.type !== 'card' && (
          <span className="mt-2 block font-mono text-minutia text-content-dim">
            {hit.relatedCardIds.slice(0, 4).join(' · ')}
          </span>
        )}
      </span>
      <ChevronRight className="mt-3 size-4 shrink-0 text-content-dim transition group-hover:translate-x-0.5 group-hover:text-accent-primary" />
    </Link>
  );
}

export function KnowledgeSearchPage() {
  const locale = useLocale();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const suggestionsId = useId();
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const query = searchParams.get('q') || '';
  const rawScope = searchParams.get('scope') || 'all';
  const scope: SearchScope = SCOPES.includes(rawScope as SearchScope) ? (rawScope as SearchScope) : 'all';
  const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1);

  const setSearchState = (key: string, value: string) => {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        if (key !== 'page') next.delete('page');
        return next;
      },
      { replace: true },
    );
  };
  const { draft, setDraft, inputBindings, isComposing } = useDebouncedSearchQuery({
    value: query,
    onCommit: (value) => setSearchState('q', value.trim()),
  });
  const { result, loading, error } = useKnowledgeSearch({
    query,
    locale,
    scopes: scope === 'all' ? [] : [scope],
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  const suggestionScopes = scope === 'all' ? [] : [scope];
  const { suggestions, loading: suggestionsLoading } = useKnowledgeSearchSuggestions({
    query: draft,
    locale,
    scopes: suggestionScopes,
    enabled: suggestionsOpen && !isComposing,
  });
  const showSuggestions =
    suggestionsOpen && !isComposing && Boolean(draft.trim()) && (suggestionsLoading || suggestions.length > 0);
  const totalPages = Math.max(1, Math.ceil(result.estimatedTotalHits / PAGE_SIZE));

  useEffect(() => {
    setActiveSuggestion((current) => (current < suggestions.length ? current : -1));
  }, [suggestions]);

  return (
    <PageShell variant="scroll" glow={{ color: 'gold', size: 'lg' }}>
      <AppHeader
        title={t('knowledgeSearch.title')}
        subtitle="SEARCH"
        backTo="/"
        actions={<LanguageSwitcher variant="header" />}
      />
      <main className="relative mx-auto grid w-full max-w-6xl gap-6 px-4 pb-12 pt-24 md:px-6 md:pt-28">
        <header className="grid gap-5 border-b border-border-soft pb-6">
          <div>
            <p className="font-mono text-caption uppercase tracking-[var(--tracking-kicker)] text-accent-primary">
              {t('knowledgeSearch.kicker')}
            </p>
            <h1 className="mt-1 font-display text-title-lg font-bold text-content-primary">
              {t('knowledgeSearch.heading')}
            </h1>
          </div>

          <div className="relative">
            <SearchInput
              icon={<Search className="size-4 text-content-dim" aria-hidden="true" />}
              {...inputBindings}
              onChange={(event) => {
                inputBindings.onChange(event);
                setSuggestionsOpen(true);
                setActiveSuggestion(-1);
              }}
              onCompositionStart={() => {
                inputBindings.onCompositionStart();
                setSuggestionsOpen(false);
                setActiveSuggestion(-1);
              }}
              onCompositionEnd={(event) => {
                inputBindings.onCompositionEnd(event);
                setSuggestionsOpen(true);
              }}
              onFocus={() => setSuggestionsOpen(true)}
              onBlur={() => setSuggestionsOpen(false)}
              onKeyDown={(event) => {
                if (isComposing || event.nativeEvent.isComposing) return;
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setSuggestionsOpen(false);
                  setActiveSuggestion(-1);
                  return;
                }
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  if (suggestions.length === 0) return;
                  event.preventDefault();
                  setSuggestionsOpen(true);
                  setActiveSuggestion((current) => {
                    if (event.key === 'ArrowDown') return current >= suggestions.length - 1 ? 0 : current + 1;
                    return current <= 0 ? suggestions.length - 1 : current - 1;
                  });
                  return;
                }
                if (event.key === 'Enter') {
                  const suggestion = suggestions[activeSuggestion];
                  if (showSuggestions && suggestion) {
                    event.preventDefault();
                    navigate(suggestion.url);
                  } else {
                    setSearchState('q', draft.trim());
                    setSuggestionsOpen(false);
                  }
                }
              }}
              autoFocus
              placeholder={t('knowledgeSearch.placeholder')}
              aria-label={t('knowledgeSearch.placeholder')}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={showSuggestions}
              aria-controls={suggestionsId}
              aria-activedescendant={
                showSuggestions && activeSuggestion >= 0 ? `${suggestionsId}-${activeSuggestion}` : undefined
              }
              aria-busy={suggestionsLoading}
              className="pr-10"
              containerClassName="min-h-12 bg-surface-panel/65"
            />
            {draft && (
              <button
                type="button"
                className="absolute right-1 top-1 inline-flex size-10 items-center justify-center rounded-sm text-content-dim transition hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--focus-ring-color]"
                onClick={() => {
                  setDraft('');
                  setSearchState('q', '');
                  setSuggestionsOpen(false);
                  setActiveSuggestion(-1);
                }}
                aria-label={t('knowledgeSearch.clear')}
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            )}
            {showSuggestions && (
              <div
                id={suggestionsId}
                role="listbox"
                aria-label={t('knowledgeSearch.suggestions')}
                className="absolute inset-x-0 top-[calc(100%+0.375rem)] z-[var(--z-dropdown)] max-h-[min(24rem,60vh)] overflow-y-auto border border-border-strong bg-surface-panel shadow-popover"
              >
                {suggestionsLoading && suggestions.length === 0 ? (
                  <div className="px-4 py-3 text-body-sm text-content-muted">{t('knowledgeSearch.loading')}</div>
                ) : (
                  suggestions.map((suggestion, index) => (
                    <button
                      key={suggestion.uid}
                      id={`${suggestionsId}-${index}`}
                      type="button"
                      role="option"
                      aria-selected={activeSuggestion === index}
                      className={cn(
                        'grid w-full grid-cols-[auto_minmax(0,1fr)] items-start gap-3 border-b border-border-soft px-4 py-3 text-left last:border-b-0',
                        activeSuggestion === index
                          ? 'bg-accent-primary/10 text-content-primary'
                          : 'text-content-muted hover:bg-surface-raised',
                      )}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setActiveSuggestion(index)}
                      onClick={() => navigate(suggestion.url)}
                    >
                      <Badge>{t(SCOPE_KEYS[suggestion.type])}</Badge>
                      <span className="min-w-0">
                        <strong className="block truncate text-body-sm font-semibold text-content-primary">
                          <HighlightedText text={suggestion.title} ranges={suggestion.titleHighlights} />
                        </strong>
                        {suggestion.subtitle && (
                          <span className="mt-0.5 block truncate font-mono text-minutia text-content-dim">
                            {suggestion.subtitle}
                          </span>
                        )}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <div
            className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:px-0"
            role="tablist"
            aria-label={t('knowledgeSearch.scopeLabel')}
          >
            {SCOPES.map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={scope === value}
                onClick={() => setSearchState('scope', value === 'all' ? '' : value)}
                className={cn(
                  'min-h-11 shrink-0 border-b-2 px-3 text-body-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--focus-ring-color]',
                  scope === value
                    ? 'border-accent-primary text-accent-primary'
                    : 'border-transparent text-content-muted hover:text-content-primary',
                )}
              >
                {t(SCOPE_KEYS[value])}
              </button>
            ))}
          </div>
        </header>

        {!query ? (
          <EmptyState title={t('knowledgeSearch.emptyTitle')} description={t('knowledgeSearch.emptyBody')} />
        ) : loading ? (
          <LoadingState label={t('knowledgeSearch.loading')} className="min-h-64" />
        ) : error ? (
          <Alert tone="danger" role="alert">
            {t('knowledgeSearch.error')}
          </Alert>
        ) : result.hits.length === 0 ? (
          <EmptyState title={t('knowledgeSearch.noResults')} description={t('knowledgeSearch.noResultsBody')} />
        ) : (
          <section aria-label={t('knowledgeSearch.results')}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
              <p className="font-mono text-caption text-content-dim" aria-live="polite">
                {t('knowledgeSearch.resultCount').replace('{count}', String(result.estimatedTotalHits))}
              </p>
              {result.engine === 'postgres-fallback' && <Badge tone="gold">{t('knowledgeSearch.fallback')}</Badge>}
            </div>
            <div className="border-t border-border-soft">
              {result.hits.map((hit) => (
                <SearchResultRow key={hit.uid} hit={hit} />
              ))}
            </div>
            {totalPages > 1 && (
              <nav className="mt-6 flex items-center justify-center gap-3" aria-label={t('knowledgeSearch.pagination')}>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={page <= 1}
                  onClick={() => setSearchState('page', page > 2 ? String(page - 1) : '')}
                  leftIcon={<ChevronLeft className="size-4" aria-hidden="true" />}
                >
                  {t('knowledgeSearch.previous')}
                </Button>
                <span className="font-mono text-caption text-content-dim">
                  {page} / {totalPages}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={page >= totalPages}
                  onClick={() => setSearchState('page', String(page + 1))}
                  rightIcon={<ChevronRight className="size-4" aria-hidden="true" />}
                >
                  {t('knowledgeSearch.next')}
                </Button>
              </nav>
            )}
          </section>
        )}
      </main>
    </PageShell>
  );
}
