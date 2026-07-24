import {
  ArrowRight,
  BookOpenText,
  CalendarDays,
  ChevronDown,
  CreditCard,
  RotateCcw,
  SlidersHorizontal,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { fetchOfficialQa, type OfficialQaItem } from '../api/client';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import {
  RulesFilterButton,
  RulesSearchField,
  RulesTabs,
  TranslationStatusBadge,
} from '../components/rules/OfficialRulesComponents';
import { t, useLocale } from '../i18n';
import { officialQaTagOptionIsSelected, officialQaTagOptions } from '../lib/officialQaTags';
import { filterAndSortOfficialQa, type OfficialQaSort } from '../lib/officialRulesView';
import { Alert, AppHeader, Button, EmptyState, LoadingState, PageShell, Select, Tag } from '../ui';

const PAGE_SIZE = 18;

export function OfficialQaPage() {
  const locale = useLocale();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<OfficialQaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pageState, setPageState] = useState({ key: '', limit: PAGE_SIZE });
  const query = searchParams.get('query') ?? '';
  const selectedTag = searchParams.get('tag') ?? '';
  const cardId = searchParams.get('cardId') ?? '';
  const sort: OfficialQaSort = searchParams.get('sort') === 'latest' ? 'latest' : 'official';

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void fetchOfficialQa(locale)
      .then((result) => {
        if (active) setItems(result);
      })
      .catch(() => {
        if (active) setError(t('officialRules.loadError'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [locale]);

  const tags = useMemo(() => officialQaTagOptions(items, locale), [items, locale]);
  const tagCounts = useMemo(
    () => new Map(tags.map((tag) => [tag.id, items.filter((item) => item.tagIds.includes(tag.id)).length] as const)),
    [items, tags],
  );
  const visibleItems = useMemo(
    () => filterAndSortOfficialQa(items, { query, tag: selectedTag, cardId, locale, sort }),
    [cardId, items, locale, query, selectedTag, sort],
  );
  const listKey = `${query}\n${selectedTag}\n${cardId}\n${sort}\n${locale}`;
  const visibleLimit = pageState.key === listKey ? pageState.limit : PAGE_SIZE;
  const pagedItems = visibleItems.slice(0, visibleLimit);
  const hasMore = pagedItems.length < visibleItems.length;
  const hasFilters = Boolean(query || selectedTag || cardId);

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  };

  const clearFilters = () => {
    const next = new URLSearchParams();
    if (sort === 'latest') next.set('sort', sort);
    setSearchParams(next, { replace: true });
  };

  return (
    <PageShell variant="scroll" glow={{ color: 'gold', size: 'lg' }}>
      <AppHeader title={t('officialRules.qaTitle')} subtitle="RULE / Q&A" backTo="/" actions={<LanguageSwitcher />} />
      <div className="relative mx-auto grid w-full max-w-6xl gap-6 px-4 pb-12 pt-24 md:px-6 md:pt-28">
        <RulesTabs />

        <header className="grid gap-5 border-b border-border-soft pb-6">
          <div>
            <p className="font-mono text-caption uppercase tracking-[var(--tracking-kicker)] text-accent-primary/80">
              {t('officialRules.databaseKicker')}
            </p>
            <h1 className="mt-1 font-display text-title-lg font-bold">{t('officialRules.qaHeading')}</h1>
            <p className="mt-2 max-w-3xl text-body-sm leading-relaxed text-content-muted">
              {t('officialRules.qaDescription')}
            </p>
          </div>
          <RulesSearchField
            value={query}
            onChange={(event) => updateParam('query', event.target.value)}
            onClear={() => updateParam('query', '')}
            placeholder={t('officialRules.searchPlaceholder')}
          />
        </header>

        <div className="grid min-w-0 gap-6 md:grid-cols-[15rem_minmax(0,1fr)] lg:gap-8">
          <aside className="min-w-0 md:sticky md:top-28 md:self-start" aria-label={t('officialRules.filters')}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="inline-flex items-center gap-2 font-mono text-caption uppercase text-content-dim">
                <SlidersHorizontal className="size-4" aria-hidden="true" />
                {t('officialRules.categories')}
              </h2>
              {hasFilters && (
                <button
                  type="button"
                  className="inline-flex min-h-10 items-center gap-1.5 text-caption text-content-dim transition hover:text-accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--focus-ring-color]"
                  onClick={clearFilters}
                >
                  <RotateCcw className="size-3.5" aria-hidden="true" />
                  {t('officialRules.clearAll')}
                </button>
              )}
            </div>
            <div
              className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:mx-0 md:grid md:px-0"
              aria-label={t('officialRules.categories')}
            >
              <RulesFilterButton
                label={t('officialRules.all')}
                count={items.length}
                selected={!selectedTag}
                onClick={() => updateParam('tag', '')}
              />
              {tags.map((tag) => (
                <RulesFilterButton
                  key={tag.id}
                  label={tag.label}
                  count={tagCounts.get(tag.id) ?? 0}
                  selected={officialQaTagOptionIsSelected(tag, selectedTag)}
                  onClick={() => updateParam('tag', officialQaTagOptionIsSelected(tag, selectedTag) ? '' : tag.id)}
                />
              ))}
            </div>
            {cardId && (
              <Alert tone="info" className="mt-3">
                {t('officialRules.cardFilterActive')} <code>{cardId}</code>
              </Alert>
            )}
          </aside>

          <section className="min-w-0" aria-label={t('officialRules.qaResults')}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <p className="font-mono text-caption text-content-dim" aria-live="polite">
                {t('officialRules.resultCount').replace('{count}', String(visibleItems.length))}
              </p>
              <label className="flex items-center gap-2 font-mono text-caption text-content-dim">
                <span>{t('officialRules.sort')}</span>
                <Select
                  className="min-h-11 w-auto py-1 text-body-sm"
                  value={sort}
                  onChange={(event) => updateParam('sort', event.target.value === 'latest' ? 'latest' : '')}
                  aria-label={t('officialRules.sort')}
                >
                  <option value="official">{t('officialRules.sortOfficial')}</option>
                  <option value="latest">{t('officialRules.sortLatest')}</option>
                </Select>
              </label>
            </div>

            {loading ? (
              <LoadingState label={t('officialRules.loading')} />
            ) : error ? (
              <Alert tone="danger" role="alert">
                {error}
              </Alert>
            ) : visibleItems.length === 0 ? (
              <EmptyState
                title={t('officialRules.empty')}
                description={t('officialRules.emptyDescription')}
                actions={
                  hasFilters ? (
                    <Button
                      size="sm"
                      onClick={clearFilters}
                      leftIcon={<RotateCcw className="size-4" aria-hidden="true" />}
                    >
                      {t('officialRules.clearAll')}
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <div className="grid gap-3">
                {pagedItems.map((item) => (
                  <article
                    key={item.id}
                    className="overflow-hidden rounded-sm border border-border-soft bg-surface-panel/70 shadow-floating backdrop-blur transition hover:border-accent-primary/50 focus-within:border-accent-primary/50"
                  >
                    <Link
                      to={`/rules/qa/${item.number}`}
                      state={{ from: `${location.pathname}${location.search}` }}
                      className="group grid min-w-0 gap-3 p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[--focus-ring-color] sm:grid-cols-[6.75rem_minmax(0,1fr)_auto] sm:gap-4 md:p-5"
                    >
                      <div className="flex items-center justify-between gap-3 sm:block">
                        <span className="inline-flex items-center gap-2 font-mono text-caption text-accent-primary">
                          <BookOpenText className="size-4" aria-hidden="true" />
                          Q.{item.number}
                        </span>
                        <time
                          className="mt-0 inline-flex items-center gap-1 whitespace-nowrap font-mono text-caption text-content-dim sm:mt-2"
                          dateTime={item.publishedAt}
                        >
                          <CalendarDays className="size-3.5" aria-hidden="true" />
                          {item.publishedAt}
                        </time>
                      </div>
                      <div className="min-w-0">
                        <h2 className="text-body-lg font-semibold leading-relaxed text-content-primary transition group-hover:text-accent-primary">
                          {item.localized.question}
                        </h2>
                        <p className="mt-1.5 line-clamp-2 whitespace-pre-line text-body-sm leading-relaxed text-content-muted">
                          {item.localized.answer}
                        </p>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          {[...new Set(item.tags)].map((tag) => (
                            <Tag key={tag}>{tag}</Tag>
                          ))}
                          {item.relatedCardIds.length > 0 && (
                            <span className="inline-flex items-center gap-1.5 font-mono text-caption text-content-dim">
                              <CreditCard className="size-3.5" aria-hidden="true" />
                              {t('officialRules.relatedCardCount').replace(
                                '{count}',
                                String(item.relatedCardIds.length),
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end">
                        <TranslationStatusBadge status={item.translationStatus} />
                        <ArrowRight
                          className="size-5 text-content-dim transition group-hover:translate-x-1 group-hover:text-accent-primary"
                          aria-hidden="true"
                        />
                      </div>
                    </Link>
                  </article>
                ))}
                {hasMore && (
                  <Button
                    variant="secondary"
                    className="mt-2 justify-self-center"
                    onClick={() => setPageState({ key: listKey, limit: visibleLimit + PAGE_SIZE })}
                    rightIcon={<ChevronDown className="size-4" aria-hidden="true" />}
                  >
                    {t('officialRules.showMore')}
                  </Button>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </PageShell>
  );
}
