import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchOfficialErrataItem, type OfficialErrataItem } from '../api/client';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { CardImage } from '../components/CardImage';
import {
  FormattedText,
  OfficialSourceLink,
  RulesTabs,
  SourceTextToggle,
  TranslationNotice,
  TranslationStatusBadge,
} from '../components/rules/OfficialRulesComponents';
import { t, useLocale } from '../i18n';
import { Alert, AppHeader, Badge, LoadingState, PageShell, Panel } from '../ui';

function ErrataContent({ item, source = false }: { item: OfficialErrataItem; source?: boolean }) {
  const content = source ? item.source : item.localized;
  return (
    <div className="grid gap-5">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-sm border border-accent-action/30 bg-accent-action/5 p-4">
          <span className="font-mono text-caption uppercase tracking-[var(--tracking-control)] text-accent-action">
            {t('officialRules.incorrect')}
          </span>
          <FormattedText className="mt-2">{content.incorrectText}</FormattedText>
        </div>
        <div className="rounded-sm border border-accent-success/30 bg-accent-success/5 p-4">
          <span className="font-mono text-caption uppercase tracking-[var(--tracking-control)] text-accent-success">
            {t('officialRules.corrected')}
          </span>
          <FormattedText className="mt-2">{content.correctedText}</FormattedText>
        </div>
      </div>
      {[
        ['officialRules.reason', content.reason],
        ['officialRules.replacementPolicy', content.replacementPolicy],
        ['officialRules.usagePolicy', content.usagePolicy],
      ].map(([key, value]) => (
        <section key={key}>
          <h2 className="font-mono text-caption uppercase tracking-[var(--tracking-control)] text-content-dim">
            {t(key as Parameters<typeof t>[0])}
          </h2>
          <FormattedText className="mt-2">{value}</FormattedText>
        </section>
      ))}
    </div>
  );
}

export function OfficialErrataDetailPage() {
  const locale = useLocale();
  const params = useParams();
  const errataId = params.errataId ?? '';
  const [item, setItem] = useState<OfficialErrataItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void fetchOfficialErrataItem(errataId, locale)
      .then((result) => {
        if (active) setItem(result);
      })
      .catch(() => {
        if (active) setError(t('officialRules.notFound'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [errataId, locale]);

  return (
    <PageShell variant="scroll" glow={{ color: 'vermilion', size: 'lg' }}>
      <AppHeader
        title={item ? `${t('officialRules.errataTitle')} #${item.errataId}` : t('officialRules.errataTitle')}
        backTo="/rules/errata"
        actions={<LanguageSwitcher />}
      />
      <div className="relative mx-auto grid w-full max-w-5xl gap-5 px-4 pb-12 pt-24 md:px-6 md:pt-28">
        <RulesTabs />
        {loading ? (
          <LoadingState label={t('officialRules.loading')} />
        ) : error || !item ? (
          <Alert tone="danger" role="alert">
            {error || t('officialRules.notFound')}
          </Alert>
        ) : (
          <>
            <Panel className="grid gap-5 bg-surface-panel/75 backdrop-blur" size="lg">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-4">
                  <CardImage
                    cardId={item.cardId}
                    context="thumbnail"
                    alt={item.cardName}
                    className="h-28 w-20 shrink-0 rounded-sm object-contain ring-1 ring-content-primary/10"
                    loading="eager"
                  />
                  <div className="min-w-0">
                    <p className="font-mono text-caption text-accent-action">ERRATA #{item.errataId}</p>
                    <h1 className="mt-1 font-display text-title-md font-bold">{item.cardName}</h1>
                    <p className="mt-1 font-mono text-caption text-content-dim">
                      {item.pack} · {item.cardNumber} · {item.rarity}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {item.affectsName && <Badge tone="gold">{t('officialRules.affectsName')}</Badge>}
                  {item.affectsEffect && <Badge tone="gold">{t('officialRules.affectsEffect')}</Badge>}
                  <TranslationStatusBadge status={item.translationStatus} />
                </div>
              </div>
              <ErrataContent item={item} />
              <TranslationNotice status={item.translationStatus} />
              <Link
                className="inline-flex min-h-11 items-center text-body-sm text-content-muted underline-offset-4 hover:text-accent-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--focus-ring-color]"
                to={`/rules/qa?cardId=${encodeURIComponent(item.cardId)}`}
              >
                {t('officialRules.relatedQa')}
              </Link>
            </Panel>
            {item.effectiveLocale !== 'ja' && (
              <SourceTextToggle>
                <ErrataContent item={item} source />
              </SourceTextToggle>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <OfficialSourceLink href={item.sourceUrl} />
              <span className="font-mono text-caption text-content-dim">
                {t('officialRules.lastSynced')}{' '}
                {item.lastSyncedAt ? new Date(item.lastSyncedAt).toLocaleString(locale) : '—'}
              </span>
            </div>
          </>
        )}
      </div>
    </PageShell>
  );
}
