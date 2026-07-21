import { useEffect, useMemo, useState } from 'react';
import { Copy, Flag, Heart, Link2, UserRound } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  copyDeckShare,
  getDeckShare,
  getProfile,
  isLoggedIn,
  likeDeckShare,
  reportDeckShare,
  unlikeDeckShare,
  type DeckShareDetail,
  type DeckShareReportReason,
  type DeckResponse,
} from '../api/client';
import { copyText } from '../clipboard';
import { trackDeckShareEvent } from '../deckShareAnalytics';
import {
  applyDeckShareLikeState,
  deckShareElementLabel,
  getDeckShareCopyIssue,
  type DeckShareCopyIssue,
} from '../deckShareUi';
import { getLocalDeckShareDemo, isLocalDeckShareDemo, shouldUseLocalDeckShareDemo } from '../deckShareDemo';
import { CardBrowserDetailSheet } from '../components/CardBrowser';
import { CardImage } from '../components/CardImage';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { useToast } from '../components/ToastProvider';
import { getCardDef } from '../game/cards/loader';
import { getLocalizedCardEffect, getLocalizedCardName, getLocalizedSongTitle } from '../game/cards/i18n';
import { saveCustomDeck } from '../game/cards/customDeck';
import type { CardDef } from '../game/types';
import { t, useLocale } from '../i18n';
import { APP_VERSION_INFO } from '../version';
import {
  Alert,
  AppHeader,
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  LoadingState,
  PageShell,
  Select,
  Textarea,
} from '../ui';

function copyIssueMessage(issue: DeckShareCopyIssue): string {
  if (issue.type === 'unknown') {
    return t('deckShare.invalidDeckUnknownCards').replace('{cards}', issue.cardIds.join(', '));
  }
  if (issue.type === 'copies') {
    return t('deckShare.invalidDeckCopies').replace('{card}', issue.cardId).replace('{count}', String(issue.count));
  }
  return t('deckShare.invalidDeckSize').replace('{count}', String(issue.count));
}

export function DeckShareDetailPage({ onServerDeckCopied }: { onServerDeckCopied?: (deck: DeckResponse) => void }) {
  const { shareId = '' } = useParams();
  const navigate = useNavigate();
  const locale = useLocale();
  const { showToast } = useToast();
  const [share, setShare] = useState<DeckShareDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copying, setCopying] = useState(false);
  const [liking, setLiking] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState<DeckShareReportReason>('inappropriate_name');
  const [reportNote, setReportNote] = useState('');
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [viewerIdentityResolved, setViewerIdentityResolved] = useState(() => !isLoggedIn());
  const [detailCard, setDetailCard] = useState<CardDef | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    getDeckShare(shareId)
      .catch((requestError) => {
        if (shouldUseLocalDeckShareDemo() && isLocalDeckShareDemo(shareId)) {
          const demo = getLocalDeckShareDemo(shareId, locale);
          if (demo) return demo;
        }
        throw requestError;
      })
      .then((result) => {
        if (!cancelled) {
          setShare(result);
          trackDeckShareEvent('deck_share_detail_open', {
            visibility: result.visibility,
            is_logged_in: isLoggedIn(),
            source: 'detail',
          });
        }
      })
      .catch(() => {
        if (!cancelled) setError(t('deckShare.detailNotFound'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [locale, shareId]);

  useEffect(() => {
    if (!isLoggedIn()) {
      setCurrentUserId(null);
      setViewerIdentityResolved(true);
      return;
    }
    let cancelled = false;
    void getProfile().then(
      (profile) => {
        if (!cancelled) {
          setCurrentUserId(profile.id);
          setViewerIdentityResolved(true);
        }
      },
      () => {
        if (!cancelled) {
          setCurrentUserId(null);
          setViewerIdentityResolved(true);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const entries = useMemo(() => {
    if (!share) return [];
    const counts = new Map<string, number>();
    for (const cardId of share.cardIds) counts.set(cardId, (counts.get(cardId) ?? 0) + 1);
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
  }, [share]);
  const copyIssue = useMemo(
    () => (share ? getDeckShareCopyIssue(share.cardIds, (cardId) => Boolean(getCardDef(cardId))) : null),
    [share],
  );
  const isOwner = Boolean(share && currentUserId && share.owner.userId === currentUserId);
  const localPreview = Boolean(share && isLocalDeckShareDemo(share.id));
  const showSocialActions = viewerIdentityResolved && !isOwner && !localPreview;

  const formatTimestamp = (value: string | null) => {
    if (!value) return t('deckShare.timeUnavailable');
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return t('deckShare.timeUnavailable');
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  };

  const detailCardProps = (card: CardDef) => ({
    title: getLocalizedCardName(card, locale),
    meta: `${card.element} · ${card.type} · ${card.rarity}`,
    stats: (
      <>
        <span>
          {t('card.energy')} {card.powerCost}
        </span>
        {card.attack && (
          <span>
            {t('card.night')}/{t('card.day')} {card.attack.night}/{card.attack.day}
          </span>
        )}
        <span>
          {t('card.clock')} {card.clock}
        </span>
      </>
    ),
    effect: getLocalizedCardEffect(card, locale) || undefined,
    footer: getLocalizedSongTitle(card.song, locale),
  });

  const shareLink = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: share?.name || t('deckShare.lobbyTitle'), url });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }
    try {
      await copyText(url);
      showToast({ title: t('deckShare.linkCopied'), kind: 'success' });
    } catch {
      showToast({ title: t('deckShare.linkCopyFailed'), kind: 'error' });
    }
  };

  const copyShare = async () => {
    if (!share || copying || copyIssue) return;
    setCopying(true);
    try {
      const copyName = `${share.name} ${t('deckShare.copySuffix')}`.slice(0, 60);
      if (localPreview) {
        saveCustomDeck(copyName, share.cardIds);
        showToast({ title: t('deckShare.localCopySuccess'), kind: 'success' });
      } else if (isLoggedIn()) {
        const idempotencyKey =
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `copy_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
        const result = await copyDeckShare(share.id, copyName, idempotencyKey);
        setShare((current) => (current ? { ...current, copyCount: result.copyCount } : current));
        onServerDeckCopied?.(result.deck);
        showToast({ title: t('deckShare.copySuccess'), kind: 'success' });
      } else {
        saveCustomDeck(copyName, share.cardIds);
        showToast({ title: t('deckShare.localCopySuccess'), kind: 'success' });
      }
      trackDeckShareEvent('deck_share_copy', { is_logged_in: isLoggedIn(), source: 'detail' });
      navigate('/deck-builder');
    } catch {
      showToast({ title: t('deckShare.copyError'), kind: 'error' });
    } finally {
      setCopying(false);
    }
  };

  const toggleLike = async () => {
    if (!share || liking) return;
    if (!isLoggedIn()) {
      showToast({ title: t('deckShare.loginToLike'), kind: 'info' });
      return;
    }
    const previous = share;
    const nextLiked = !share.viewerHasLiked;
    setShare(applyDeckShareLikeState(share, nextLiked));
    setLiking(true);
    try {
      const result = nextLiked ? await likeDeckShare(share.id) : await unlikeDeckShare(share.id);
      setShare((current) => (current ? applyDeckShareLikeState(current, result.liked, result.likeCount) : current));
      trackDeckShareEvent('deck_share_like', { is_logged_in: true, source: 'detail' });
    } catch {
      setShare(previous);
      showToast({ title: t('deckShare.likeError'), kind: 'error' });
    } finally {
      setLiking(false);
    }
  };

  const openReport = () => {
    if (!isLoggedIn()) {
      showToast({ title: t('deckShare.loginToReport'), kind: 'info' });
      return;
    }
    setReportOpen(true);
  };

  const submitReport = async () => {
    if (!share || reporting) return;
    setReporting(true);
    try {
      await reportDeckShare(share.id, {
        reason: reportReason,
        ...(reportNote.trim() ? { note: reportNote.trim() } : {}),
      });
      setReported(true);
      setReportOpen(false);
      trackDeckShareEvent('deck_share_report', { is_logged_in: true, source: 'detail' });
      showToast({ title: t('deckShare.reportSuccess'), kind: 'success' });
    } catch {
      showToast({ title: t('deckShare.reportError'), kind: 'error' });
    } finally {
      setReporting(false);
    }
  };

  return (
    <PageShell variant="scroll" glow={{ color: 'gold', size: 'lg', className: 'left-1/3 top-0' }}>
      {detailCard && (
        <CardBrowserDetailSheet
          open
          onOpenChange={(open) => {
            if (!open) setDetailCard(null);
          }}
          closeLabel={t('common.close')}
          {...detailCardProps(detailCard)}
        />
      )}
      <Dialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        title={t('deckShare.reportTitle')}
        description={t('deckShare.reportBody')}
        closeLabel={t('common.close')}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setReportOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="button" variant="danger" disabled={reporting} onClick={() => void submitReport()}>
              {reporting ? t('deckShare.reporting') : t('deckShare.reportSubmit')}
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <label className="grid gap-1.5">
            <span className="font-mono text-caption uppercase tracking-[var(--tracking-control)] text-content-muted">
              {t('deckShare.reportReason')}
            </span>
            <Select
              value={reportReason}
              onChange={(event) => setReportReason(event.target.value as DeckShareReportReason)}
            >
              <option value="inappropriate_name">{t('deckShare.reportReasonName')}</option>
              <option value="impersonation_or_harassment">{t('deckShare.reportReasonHarassment')}</option>
              <option value="spam">{t('deckShare.reportReasonSpam')}</option>
              <option value="other">{t('deckShare.reportReasonOther')}</option>
            </Select>
          </label>
          <label className="grid gap-1.5">
            <span className="font-mono text-caption uppercase tracking-[var(--tracking-control)] text-content-muted">
              {t('deckShare.reportNote')}
            </span>
            <Textarea
              value={reportNote}
              maxLength={300}
              rows={4}
              placeholder={t('deckShare.reportNotePlaceholder')}
              onChange={(event) => setReportNote(event.target.value)}
            />
          </label>
        </div>
      </Dialog>
      <AppHeader
        title={share?.name || t('deckShare.detailTitle')}
        backTo="/deck-shares"
        actions={
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            {share && (
              <Button type="button" size="sm" variant="secondary" onClick={() => void shareLink()}>
                <Link2 className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">{t('deckShare.shareLink')}</span>
              </Button>
            )}
          </div>
        }
      />

      <div className="relative z-10 mx-auto grid min-h-full w-full max-w-7xl gap-5 px-4 pb-8 pt-24 md:px-6">
        {loading ? (
          <LoadingState label={t('deckShare.loadingDetail')} className="min-h-72" />
        ) : error || !share ? (
          <EmptyState title={t('deckShare.detailNotFoundTitle')} description={error || t('deckShare.detailNotFound')} />
        ) : (
          <>
            <header className="grid gap-5 border-b border-border-soft pb-6">
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-mono text-caption uppercase tracking-[var(--tracking-kicker)] text-accent-primary">
                      {share.visibility === 'unlisted' ? t('deckShare.unlisted') : t('deckShare.public')}
                    </p>
                    {localPreview && <Badge tone="gold">{t('deckShare.localPreview')}</Badge>}
                  </div>
                  <h1 className="mt-1 break-words font-display text-title-lg font-bold">{share.name}</h1>
                  <p className="mt-2 flex items-center gap-2 text-body text-content-muted">
                    <UserRound className="size-4" aria-hidden="true" />
                    {share.owner.nickname || t('deckShare.unknownAuthor')}
                  </p>
                  <dl className="mt-3 grid gap-1 font-mono text-caption text-content-muted sm:grid-cols-2">
                    <div>
                      <dt className="inline text-content-dim">{t('deckShare.publishedAt')}: </dt>
                      <dd className="inline">
                        <time dateTime={share.publishedAt || undefined}>{formatTimestamp(share.publishedAt)}</time>
                      </dd>
                    </div>
                    <div>
                      <dt className="inline text-content-dim">{t('deckShare.updatedAt')}: </dt>
                      <dd className="inline">
                        <time dateTime={share.updatedAt || undefined}>{formatTimestamp(share.updatedAt)}</time>
                      </dd>
                    </div>
                  </dl>
                </div>
                <div className="flex flex-wrap gap-2 md:justify-end">
                  {share.elements.map((element) => (
                    <Badge key={element} tone="neutral">
                      {deckShareElementLabel(element, t)}
                    </Badge>
                  ))}
                </div>
              </div>

              {share.publishedRulesVersion !== APP_VERSION_INFO.rulesVersion && (
                <Alert tone="warning" title={t('deckShare.oldRulesTitle')}>
                  {t('deckShare.oldRulesBody').replace('{version}', share.publishedRulesVersion)}
                </Alert>
              )}

              {copyIssue && (
                <Alert tone="danger" title={t('deckShare.invalidDeckTitle')}>
                  {copyIssueMessage(copyIssue)}
                </Alert>
              )}

              <dl className="grid grid-cols-3 divide-x divide-border-soft border-y border-border-soft py-4">
                {[
                  [t('deckShare.cards'), share.cardIds.length],
                  [t('deckShare.likes'), share.likeCount],
                  [t('deckShare.copies'), share.copyCount],
                ].map(([label, value]) => (
                  <div className="px-3 first:pl-0 last:pr-0 md:px-5" key={label}>
                    <dt className="font-mono text-caption uppercase text-content-dim">{label}</dt>
                    <dd className="mt-1 font-mono text-title-sm text-accent-primary">{value}</dd>
                  </div>
                ))}
              </dl>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="primary"
                  disabled={copying || Boolean(copyIssue)}
                  onClick={() => void copyShare()}
                >
                  <Copy className="size-4" aria-hidden="true" />
                  {copying ? t('deckShare.copying') : t('deckShare.copyDeck')}
                </Button>
                {showSocialActions && (
                  <Button
                    type="button"
                    variant={share.viewerHasLiked ? 'primary' : 'secondary'}
                    disabled={liking}
                    aria-pressed={share.viewerHasLiked}
                    onClick={() => void toggleLike()}
                  >
                    <Heart className="size-4" aria-hidden="true" />
                    {share.viewerHasLiked ? t('deckShare.unlike') : t('deckShare.like')}
                  </Button>
                )}
                <Button type="button" variant="secondary" onClick={() => void shareLink()}>
                  <Link2 className="size-4" aria-hidden="true" />
                  {t('deckShare.shareLink')}
                </Button>
                {showSocialActions && (
                  <Button type="button" variant="ghost" disabled={reported} onClick={openReport}>
                    <Flag className="size-4" aria-hidden="true" />
                    {reported ? t('deckShare.reported') : t('deckShare.report')}
                  </Button>
                )}
              </div>
            </header>

            <section aria-labelledby="deck-share-cards-title">
              <div className="mb-3 flex items-end justify-between gap-3">
                <div>
                  <p className="font-mono text-caption uppercase tracking-[var(--tracking-kicker)] text-accent-primary">
                    20 Cards
                  </p>
                  <h2 id="deck-share-cards-title" className="font-display text-title-sm font-bold">
                    {t('deckShare.deckContents')}
                  </h2>
                </div>
                <span className="font-mono text-caption text-content-muted">
                  {t('deckShare.characters').replace('{count}', String(share.characterCount))}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {entries.map(([cardId, count]) => {
                  const card = getCardDef(cardId);
                  const name = card ? getLocalizedCardName(card, locale) : cardId;
                  return (
                    <Card
                      key={cardId}
                      as="article"
                      interactive={Boolean(card)}
                      role={card ? 'button' : undefined}
                      tabIndex={card ? 0 : undefined}
                      aria-label={card ? t('deckShare.inspectCard').replace('{card}', name) : undefined}
                      className="relative grid gap-2 p-2 sm:p-3"
                      onClick={() => {
                        if (card) setDetailCard(card);
                      }}
                      onKeyDown={(event) => {
                        if (card && (event.key === 'Enter' || event.key === ' ')) {
                          event.preventDefault();
                          setDetailCard(card);
                        }
                      }}
                    >
                      <div className="relative overflow-hidden rounded-sm bg-surface-canvas ring-1 ring-border-soft">
                        <CardImage
                          cardId={cardId}
                          context="thumbnail"
                          alt={name}
                          className="aspect-[5/7] h-full w-full object-cover"
                        />
                        {count > 1 && (
                          <Badge className="absolute right-2 top-2 shadow-floating" tone="gold">
                            ×{count}
                          </Badge>
                        )}
                      </div>
                      <div className="min-w-0">
                        <span className="block truncate font-mono text-caption text-content-muted">{cardId}</span>
                        <h3 className="line-clamp-2 text-body-sm font-semibold text-content-primary">{name}</h3>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </section>
          </>
        )}
      </div>
    </PageShell>
  );
}
