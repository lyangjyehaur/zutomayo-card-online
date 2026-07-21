import { ArrowRight, CalendarDays, Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { fetchOfficialErrataItem, type OfficialErrataItem } from '../api/client';
import { CardImage } from '../components/CardImage';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import {
  FormattedText,
  OfficialSourceLink,
  RulesTabs,
  SourceTextToggle,
  TranslationNotice,
  TranslationStatusBadge,
} from '../components/rules/OfficialRulesComponents';
import { t, useLocale } from '../i18n';
import { Alert, AppHeader, Badge, Button, LoadingState, PageShell } from '../ui';

function ErrataSourceContent({ item }: { item: OfficialErrataItem }) {
  return (
    <div className="grid gap-5">
      <div className="grid gap-5 md:grid-cols-2">
        <section>
          <h3 className="font-mono text-caption uppercase text-accent-action">{t('officialRules.incorrect')}</h3>
          <FormattedText className="mt-2 text-content-muted">{item.source.incorrectText}</FormattedText>
        </section>
        <section>
          <h3 className="font-mono text-caption uppercase text-accent-success">{t('officialRules.corrected')}</h3>
          <FormattedText className="mt-2 text-content-muted">{item.source.correctedText}</FormattedText>
        </section>
      </div>
      <div className="grid gap-4 border-t border-border-soft pt-4 md:grid-cols-3">
        {[
          ['officialRules.reason', item.source.reason],
          ['officialRules.replacementPolicy', item.source.replacementPolicy],
          ['officialRules.usagePolicy', item.source.usagePolicy],
        ].map(([key, value]) => (
          <section key={key}>
            <h3 className="font-mono text-caption uppercase text-content-dim">{t(key as Parameters<typeof t>[0])}</h3>
            <FormattedText className="mt-2 text-body-sm text-content-muted">{value}</FormattedText>
          </section>
        ))}
      </div>
    </div>
  );
}

export function OfficialErrataDetailPage() {
  const locale = useLocale();
  const location = useLocation();
  const params = useParams();
  const errataId = params.errataId ?? '';
  const [item, setItem] = useState<OfficialErrataItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const backTo =
    typeof location.state === 'object' && location.state && 'from' in location.state
      ? String(location.state.from)
      : '/rules/errata';

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

  const copyCorrectedText = async () => {
    if (!item || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(item.localized.correctedText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <PageShell variant="scroll" glow={{ color: 'vermilion', size: 'lg' }}>
      <AppHeader
        title={item ? `${t('officialRules.errataTitle')} #${item.errataId}` : t('officialRules.errataTitle')}
        backTo={backTo}
        actions={<LanguageSwitcher />}
      />
      <div className="relative mx-auto grid w-full max-w-5xl gap-6 px-4 pb-12 pt-24 md:px-6 md:pt-28">
        <RulesTabs />
        {loading ? (
          <LoadingState label={t('officialRules.loading')} />
        ) : error || !item ? (
          <Alert tone="danger" role="alert">
            {error || t('officialRules.notFound')}
          </Alert>
        ) : (
          <>
            <article className="grid gap-7">
              <header className="grid gap-5 border-b border-border-soft pb-6 sm:grid-cols-[7rem_minmax(0,1fr)]">
                <CardImage
                  cardId={item.cardId}
                  context="thumbnail"
                  alt={item.cardName}
                  className="h-40 w-28 rounded-sm object-contain ring-1 ring-content-primary/10"
                  loading="eager"
                />
                <div className="min-w-0 self-center">
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="font-mono text-caption text-accent-action">ERRATA #{item.errataId}</p>
                    <time
                      className="inline-flex items-center gap-1.5 font-mono text-caption text-content-dim"
                      dateTime={item.publishedAt}
                    >
                      <CalendarDays className="size-3.5" aria-hidden="true" />
                      {item.publishedAt}
                    </time>
                  </div>
                  <h1 className="mt-2 font-display text-title-md font-bold leading-relaxed md:text-title-lg">
                    {item.cardName}
                  </h1>
                  <p className="mt-1 font-mono text-caption leading-relaxed text-content-dim">
                    {item.pack} · {item.cardNumber} · {item.rarity}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {item.affectsName && <Badge tone="gold">{t('officialRules.affectsName')}</Badge>}
                    {item.affectsEffect && <Badge tone="gold">{t('officialRules.affectsEffect')}</Badge>}
                    <TranslationStatusBadge status={item.translationStatus} />
                  </div>
                </div>
              </header>

              <section aria-labelledby="errata-comparison-heading">
                <h2
                  id="errata-comparison-heading"
                  className="mb-4 font-display text-title-sm font-bold text-content-primary"
                >
                  {t('officialRules.correctionComparison')}
                </h2>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-sm border border-accent-action/40 bg-accent-action/5 p-4 md:p-5">
                    <h3 className="font-mono text-caption uppercase text-accent-action">
                      {t('officialRules.incorrect')}
                    </h3>
                    <FormattedText className="mt-3 text-content-muted">{item.localized.incorrectText}</FormattedText>
                  </div>
                  <div className="rounded-sm border border-accent-success/40 bg-accent-success/5 p-4 md:p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h3 className="font-mono text-caption uppercase text-accent-success">
                        {t('officialRules.corrected')}
                      </h3>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="min-h-9 px-2"
                        onClick={() => void copyCorrectedText()}
                        leftIcon={
                          copied ? (
                            <Check className="size-4" aria-hidden="true" />
                          ) : (
                            <Copy className="size-4" aria-hidden="true" />
                          )
                        }
                      >
                        {copied ? t('officialRules.copied') : t('officialRules.copyCorrected')}
                      </Button>
                    </div>
                    <FormattedText className="mt-3">{item.localized.correctedText}</FormattedText>
                  </div>
                </div>
              </section>

              <div className="grid border-y border-border-soft md:grid-cols-3 md:divide-x md:divide-border-soft">
                {[
                  ['officialRules.reason', item.localized.reason],
                  ['officialRules.replacementPolicy', item.localized.replacementPolicy],
                  ['officialRules.usagePolicy', item.localized.usagePolicy],
                ].map(([key, value]) => (
                  <section
                    className="border-b border-border-soft py-5 last:border-b-0 md:border-b-0 md:px-5 md:first:pl-0 md:last:pr-0"
                    key={key}
                  >
                    <h2 className="font-mono text-caption uppercase tracking-[var(--tracking-control)] text-content-dim">
                      {t(key as Parameters<typeof t>[0])}
                    </h2>
                    <FormattedText className="mt-2 text-body-sm">{value}</FormattedText>
                  </section>
                ))}
              </div>

              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <TranslationNotice status={item.translationStatus} />
                <Link
                  className="group inline-flex min-h-11 items-center gap-2 text-body-sm text-content-muted underline-offset-4 transition hover:text-accent-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--focus-ring-color]"
                  to={`/rules/qa?cardId=${encodeURIComponent(item.cardId)}`}
                >
                  {t('officialRules.relatedQa')}
                  <ArrowRight className="size-4 transition group-hover:translate-x-1" aria-hidden="true" />
                </Link>
              </div>
            </article>

            {item.effectiveLocale !== 'ja' && (
              <SourceTextToggle>
                <ErrataSourceContent item={item} />
              </SourceTextToggle>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-soft pt-4">
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
