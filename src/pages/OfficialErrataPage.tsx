import { AlertTriangle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchOfficialErrata, type OfficialErrataItem } from '../api/client';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { RulesTabs, TranslationStatusBadge } from '../components/rules/OfficialRulesComponents';
import { t, useLocale } from '../i18n';
import { Alert, AppHeader, EmptyState, LoadingState, PageShell, Panel } from '../ui';

export function OfficialErrataPage() {
  const locale = useLocale();
  const [items, setItems] = useState<OfficialErrataItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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

  return (
    <PageShell variant="scroll" glow={{ color: 'vermilion', size: 'lg' }}>
      <AppHeader
        title={t('officialRules.errataTitle')}
        subtitle="OFFICIAL ERRATA"
        backTo="/"
        actions={<LanguageSwitcher />}
      />
      <div className="relative mx-auto grid w-full max-w-6xl gap-5 px-4 pb-12 pt-24 md:px-6 md:pt-28">
        <RulesTabs />
        <Panel className="bg-surface-panel/70 backdrop-blur" size="lg">
          <p className="font-mono text-caption uppercase tracking-[var(--tracking-kicker)] text-accent-action/80">
            {t('officialRules.databaseKicker')}
          </p>
          <h1 className="mt-1 font-display text-title-lg font-bold">{t('officialRules.errataHeading')}</h1>
          <p className="mt-2 max-w-3xl text-body-sm leading-relaxed text-content-muted">
            {t('officialRules.errataDescription')}
          </p>
        </Panel>
        {loading ? (
          <LoadingState label={t('officialRules.loading')} />
        ) : error ? (
          <Alert tone="danger" role="alert">
            {error}
          </Alert>
        ) : items.length === 0 ? (
          <EmptyState title={t('officialRules.empty')} />
        ) : (
          <section className="grid gap-3 sm:grid-cols-2" aria-label={t('officialRules.errataResults')}>
            {items.map((item) => (
              <Link
                key={item.errataId}
                to={`/rules/errata/${item.errataId}`}
                className="group rounded-sm border border-border-soft bg-surface-panel/75 p-4 shadow-floating backdrop-blur transition hover:border-accent-action/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--focus-ring-color] md:p-5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2 font-mono text-caption text-accent-action">
                    <AlertTriangle className="size-4" aria-hidden="true" />#{item.errataId}
                  </span>
                  <TranslationStatusBadge status={item.translationStatus} />
                </div>
                <h2 className="mt-3 font-display text-body-lg font-bold transition group-hover:text-accent-action">
                  {item.cardName}
                </h2>
                <p className="mt-1 font-mono text-caption text-content-dim">
                  {item.pack} · {item.cardNumber} · {item.rarity}
                </p>
                <p className="mt-3 line-clamp-3 whitespace-pre-line text-body-sm leading-relaxed text-content-muted">
                  {item.localized.correctedText}
                </p>
                <time className="mt-4 block font-mono text-caption text-content-dim" dateTime={item.publishedAt}>
                  {item.publishedAt}
                </time>
              </Link>
            ))}
          </section>
        )}
      </div>
    </PageShell>
  );
}
