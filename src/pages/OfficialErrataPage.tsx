import { ArrowRight, CalendarDays, RotateCcw, SlidersHorizontal, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { fetchOfficialErrata, type OfficialErrataItem } from '../api/client';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import {
  RulesFilterButton,
  RulesSearchField,
  RulesTabs,
  TranslationStatusBadge,
} from '../components/rules/OfficialRulesComponents';
import { t, useLocale } from '../i18n';
import { filterOfficialErrata, officialErrataPacks, type OfficialErrataChangeFilter } from '../lib/officialRulesView';
import { Alert, AppHeader, Badge, Button, EmptyState, LoadingState, PageShell, Select } from '../ui';

export function OfficialErrataPage() {
  const locale = useLocale();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<OfficialErrataItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const query = searchParams.get('query') ?? '';
  const requestedChange = searchParams.get('change');
  const change: OfficialErrataChangeFilter =
    requestedChange === 'name' || requestedChange === 'effect' ? requestedChange : 'all';
  const pack = searchParams.get('pack') ?? '';

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void fetchOfficialErrata(locale)
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

  const packs = useMemo(() => officialErrataPacks(items), [items]);
  const visibleItems = useMemo(
    () => filterOfficialErrata(items, { query, change, pack, locale }),
    [change, items, locale, pack, query],
  );
  const hasFilters = Boolean(query || pack || change !== 'all');

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  };

  const clearFilters = () => setSearchParams(new URLSearchParams(), { replace: true });

  return (
    <PageShell variant="scroll" glow={{ color: 'vermilion', size: 'lg' }}>
      <AppHeader
        title={t('officialRules.errataTitle')}
        subtitle="OFFICIAL ERRATA"
        backTo="/"
        actions={<LanguageSwitcher />}
      />
      <div className="relative mx-auto grid w-full max-w-6xl gap-6 px-4 pb-12 pt-24 md:px-6 md:pt-28">
        <RulesTabs />

        <header className="grid gap-5 border-b border-border-soft pb-6">
          <div>
            <p className="font-mono text-caption uppercase tracking-[var(--tracking-kicker)] text-accent-action">
              {t('officialRules.databaseKicker')}
            </p>
            <h1 className="mt-1 font-display text-title-lg font-bold">{t('officialRules.errataHeading')}</h1>
            <p className="mt-2 max-w-3xl text-body-sm leading-relaxed text-content-muted">
              {t('officialRules.errataDescription')}
            </p>
          </div>
          <RulesSearchField
            value={query}
            onChange={(event) => updateParam('query', event.target.value)}
            onClear={() => updateParam('query', '')}
            placeholder={t('officialRules.errataSearchPlaceholder')}
          />
        </header>

        <div className="grid min-w-0 gap-6 md:grid-cols-[15rem_minmax(0,1fr)] lg:gap-8">
          <aside className="min-w-0 md:sticky md:top-28 md:self-start" aria-label={t('officialRules.filters')}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="inline-flex items-center gap-2 font-mono text-caption uppercase text-content-dim">
                <SlidersHorizontal className="size-4" aria-hidden="true" />
                {t('officialRules.changeScope')}
              </h2>
              {hasFilters && (
                <button
                  type="button"
                  className="inline-flex min-h-10 items-center gap-1.5 text-caption text-content-dim transition hover:text-accent-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--focus-ring-color]"
                  onClick={clearFilters}
                >
                  <RotateCcw className="size-3.5" aria-hidden="true" />
                  {t('officialRules.clearAll')}
                </button>
              )}
            </div>
            <div
              className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:mx-0 md:grid md:px-0"
              aria-label={t('officialRules.changeScope')}
            >
              <RulesFilterButton
                label={t('officialRules.allChanges')}
                count={items.length}
                selected={change === 'all'}
                tone="vermilion"
                onClick={() => updateParam('change', '')}
              />
              <RulesFilterButton
                label={t('officialRules.affectsName')}
                count={items.filter((item) => item.affectsName).length}
                selected={change === 'name'}
                tone="vermilion"
                onClick={() => updateParam('change', change === 'name' ? '' : 'name')}
              />
              <RulesFilterButton
                label={t('officialRules.affectsEffect')}
                count={items.filter((item) => item.affectsEffect).length}
                selected={change === 'effect'}
                tone="vermilion"
                onClick={() => updateParam('change', change === 'effect' ? '' : 'effect')}
              />
            </div>
            <label className="mt-4 grid gap-2 font-mono text-caption text-content-dim">
              <span>{t('officialRules.packFilter')}</span>
              <Select
                value={pack}
                onChange={(event) => updateParam('pack', event.target.value)}
                aria-label={t('officialRules.packFilter')}
              >
                <option value="">{t('officialRules.allPacks')}</option>
                {packs.map((packName) => (
                  <option key={packName} value={packName}>
                    {packName}
                  </option>
                ))}
              </Select>
            </label>
          </aside>

          <section className="min-w-0" aria-label={t('officialRules.errataResults')}>
            <p className="mb-4 font-mono text-caption text-content-dim" aria-live="polite">
              {t('officialRules.resultCount').replace('{count}', String(visibleItems.length))}
            </p>
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
                {visibleItems.map((item) => (
                  <article key={item.errataId}>
                    <Link
                      to={`/rules/errata/${item.errataId}`}
                      state={{ from: `${location.pathname}${location.search}` }}
                      className="group grid min-w-0 gap-4 rounded-sm border border-border-soft bg-surface-panel/70 p-4 shadow-floating backdrop-blur transition hover:border-accent-action/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--focus-ring-color] md:grid-cols-[minmax(12rem,0.8fr)_minmax(0,1.2fr)_auto] md:p-5"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center gap-2 font-mono text-caption text-accent-action">
                            <TriangleAlert className="size-4" aria-hidden="true" />#{item.errataId}
                          </span>
                          {item.affectsName && <Badge tone="gold">{t('officialRules.affectsName')}</Badge>}
                          {item.affectsEffect && <Badge tone="gold">{t('officialRules.affectsEffect')}</Badge>}
                        </div>
                        <h2 className="mt-3 font-display text-body-lg font-bold transition group-hover:text-accent-action">
                          {item.cardName}
                        </h2>
                        <p className="mt-1 font-mono text-caption leading-relaxed text-content-dim">
                          {item.pack} · {item.cardNumber} · {item.rarity}
                        </p>
                      </div>

                      <div className="grid min-w-0 gap-2 border-y border-border-soft py-3 md:border-x md:border-y-0 md:px-5 md:py-0">
                        <p className="line-clamp-1 text-body-sm leading-relaxed text-content-dim line-through decoration-accent-action/60">
                          <span className="sr-only">{t('officialRules.incorrect')}: </span>
                          {item.localized.incorrectText}
                        </p>
                        <div className="flex min-w-0 items-start gap-2">
                          <ArrowRight className="mt-1 size-4 shrink-0 text-accent-success" aria-hidden="true" />
                          <p className="line-clamp-2 text-body-sm font-medium leading-relaxed text-content-primary">
                            <span className="sr-only">{t('officialRules.corrected')}: </span>
                            {item.localized.correctedText}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-3 md:flex-col md:items-end">
                        <TranslationStatusBadge status={item.translationStatus} />
                        <span className="inline-flex items-center gap-1.5 font-mono text-caption text-content-dim">
                          <CalendarDays className="size-3.5" aria-hidden="true" />
                          <time dateTime={item.publishedAt}>{item.publishedAt}</time>
                        </span>
                        <ArrowRight
                          className="size-5 text-content-dim transition group-hover:translate-x-1 group-hover:text-accent-action"
                          aria-hidden="true"
                        />
                      </div>
                    </Link>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </PageShell>
  );
}
