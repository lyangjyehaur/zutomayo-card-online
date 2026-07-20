import { ExternalLink, Languages } from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import type { OfficialTranslationStatus } from '../../api/client';
import { getCardDef } from '../../game/cards/loader';
import { getLocalizedCardName } from '../../game/cards/i18n';
import { t, useLocale } from '../../i18n';
import { Badge, cn } from '../../ui';
import { CardImage } from '../CardImage';

export function RulesTabs() {
  const links = [
    { to: '/rules/qa', label: t('officialRules.qaTitle') },
    { to: '/rules/errata', label: t('officialRules.errataTitle') },
  ];
  return (
    <nav className="flex flex-wrap gap-2" aria-label={t('officialRules.navigation')}>
      {links.map((link) => (
        <NavLink
          key={link.to}
          to={link.to}
          className={({ isActive }) =>
            cn(
              'inline-flex min-h-11 items-center rounded-sm border px-4 font-mono text-caption uppercase tracking-[var(--tracking-control)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--focus-ring-color]',
              isActive
                ? 'border-accent-primary/60 bg-accent-primary/10 text-accent-primary'
                : 'border-border-soft bg-surface-panel/60 text-content-muted hover:border-border-strong hover:text-content-primary',
            )
          }
        >
          {link.label}
        </NavLink>
      ))}
    </nav>
  );
}

export function TranslationStatusBadge({ status }: { status: OfficialTranslationStatus }) {
  if (status === 'verified') return <Badge tone="jade">{t('officialRules.translationVerified')}</Badge>;
  if (status === 'machine') return <Badge tone="gold">{t('officialRules.translationMachine')}</Badge>;
  return <Badge>{t('officialRules.translationSource')}</Badge>;
}

export function TranslationNotice({ status }: { status: OfficialTranslationStatus }) {
  if (status === 'source') return null;
  return (
    <p className="flex items-start gap-2 text-caption leading-relaxed text-content-dim">
      <Languages className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      {status === 'verified' ? t('officialRules.verifiedNotice') : t('officialRules.machineNotice')}
    </p>
  );
}

export function SourceTextToggle({ children }: { children: ReactNode }) {
  return (
    <details className="group rounded-sm border border-border-soft bg-surface-canvas/50 p-4">
      <summary className="cursor-pointer font-mono text-caption uppercase tracking-[var(--tracking-control)] text-content-muted transition hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--focus-ring-color]">
        {t('officialRules.showJapanese')}
      </summary>
      <div className="mt-4 whitespace-pre-line border-t border-border-soft pt-4 text-body-sm leading-relaxed text-content-muted">
        {children}
      </div>
    </details>
  );
}

export function OfficialSourceLink({ href }: { href: string }) {
  return (
    <a
      className="inline-flex min-h-11 items-center gap-2 text-body-sm text-content-muted underline-offset-4 transition hover:text-accent-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--focus-ring-color]"
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      {t('officialRules.officialSource')}
      <ExternalLink className="size-4" aria-hidden="true" />
    </a>
  );
}

export function RelatedCardLinks({ cardIds }: { cardIds: string[] }) {
  const locale = useLocale();
  if (cardIds.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2" aria-label={t('officialRules.relatedCards')}>
      {cardIds.map((cardId) => {
        const card = getCardDef(cardId);
        const label = card ? getLocalizedCardName(card, locale) : cardId;
        return (
          <NavLink
            key={cardId}
            to={`/rules/qa?cardId=${encodeURIComponent(cardId)}`}
            className="group inline-flex min-h-16 max-w-72 items-center gap-3 rounded-xs border border-border-soft bg-surface-canvas p-2 pr-3 text-caption text-content-muted transition hover:border-accent-primary/50 hover:text-accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--focus-ring-color]"
          >
            {card ? (
              <CardImage
                cardId={card.id}
                context="thumbnail"
                alt=""
                aria-hidden="true"
                className="h-14 w-10 shrink-0 rounded-xs object-contain ring-1 ring-content-primary/10"
              />
            ) : null}
            <span className="min-w-0">
              <span className="block font-mono text-minutia text-content-dim">{cardId}</span>
              <span className="mt-0.5 line-clamp-2 block leading-snug group-hover:text-accent-primary">{label}</span>
            </span>
          </NavLink>
        );
      })}
    </div>
  );
}

export function FormattedText({ children, className }: { children: string; className?: string }) {
  return (
    <p className={cn('whitespace-pre-line text-body leading-relaxed text-content-primary/85', className)}>{children}</p>
  );
}
