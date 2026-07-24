import { BookMarked, BookOpenText, ExternalLink, Languages, Scale, Search, TriangleAlert, X } from 'lucide-react';
import type { ChangeEvent, ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import type { OfficialTranslationStatus } from '../../api/client';
import { getCardDef } from '../../game/cards/loader';
import { getLocalizedCardName } from '../../game/cards/i18n';
import { t, useLocale } from '../../i18n';
import { Badge, cn, SearchInput } from '../../ui';
import { CardImage } from '../CardImage';

export function RulesTabs() {
  const links = [
    { to: '/rules/grand', label: t('officialRules.grandTitle'), icon: BookMarked },
    { to: '/rules/floor', label: t('officialRules.floorTitle'), icon: Scale },
    { to: '/rules/qa', label: t('officialRules.qaTitle'), icon: BookOpenText },
    { to: '/rules/errata', label: t('officialRules.errataTitle'), icon: TriangleAlert },
  ];
  return (
    <nav
      className="-mx-4 flex overflow-x-auto border-b border-border-soft px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:w-fit sm:px-0"
      aria-label={t('officialRules.navigation')}
    >
      {links.map((link) => {
        const Icon = link.icon;
        return (
          <NavLink
            key={link.to}
            to={link.to}
            className={({ isActive }) =>
              cn(
                'relative inline-flex min-h-12 min-w-max items-center justify-center gap-2 px-4 font-mono text-caption uppercase tracking-[var(--tracking-control)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[--focus-ring-color] sm:min-w-32',
                isActive
                  ? 'text-accent-primary after:absolute after:inset-x-0 after:bottom-[-1px] after:h-0.5 after:bg-accent-primary'
                  : 'text-content-dim hover:text-content-primary',
              )
            }
          >
            <Icon className="size-4" aria-hidden="true" />
            {link.label}
          </NavLink>
        );
      })}
    </nav>
  );
}

export function RulesSearchField({
  value,
  onChange,
  onClear,
  placeholder,
}: {
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onClear: () => void;
  placeholder: string;
}) {
  return (
    <div className="relative w-full">
      <SearchInput
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        aria-label={placeholder}
        icon={<Search className="size-4 text-content-dim" aria-hidden="true" />}
        className="pr-10"
        containerClassName="min-h-12 bg-surface-panel/65 backdrop-blur"
      />
      {value && (
        <button
          type="button"
          className="absolute right-1 top-1 inline-flex size-10 items-center justify-center rounded-sm text-content-dim transition hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--focus-ring-color]"
          onClick={onClear}
          aria-label={t('officialRules.clearSearch')}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export function RulesFilterButton({
  label,
  count,
  selected,
  tone = 'gold',
  className,
  onClick,
}: {
  label: string;
  count: number;
  selected: boolean;
  tone?: 'gold' | 'vermilion';
  className?: string;
  onClick: () => void;
}) {
  const selectedClasses =
    tone === 'vermilion'
      ? 'border-accent-action/60 bg-accent-action/10 text-accent-action'
      : 'border-accent-primary/60 bg-accent-primary/10 text-accent-primary';
  return (
    <button
      type="button"
      className={cn(
        'inline-flex min-h-11 shrink-0 items-center justify-between gap-3 rounded-sm border px-3 text-left text-body-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--focus-ring-color] md:w-full',
        selected
          ? selectedClasses
          : 'border-border-soft bg-surface-panel/50 text-content-muted hover:border-border-strong hover:text-content-primary',
        className,
      )}
      aria-pressed={selected}
      aria-label={label}
      onClick={onClick}
    >
      <span>{label}</span>
      <span className="font-mono text-caption opacity-70">{count}</span>
    </button>
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
