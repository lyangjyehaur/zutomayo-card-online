import { ExternalLink, Link2, RefreshCw, Send, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DeckShareVisibility, OwnedDeckShare } from '../../api/client';
import { copyText } from '../../clipboard';
import { t } from '../../i18n';
import { Alert, Badge, Button, Dialog, LoadingState, Select } from '../../ui';
import { useToast } from '../ToastProvider';

export function DeckShareManagerDialog({
  open,
  onOpenChange,
  deckName,
  share,
  loading,
  saving,
  error,
  onPublish,
  onUpdate,
  onUnpublish,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deckName: string;
  share: OwnedDeckShare | null;
  loading: boolean;
  saving: boolean;
  error: string;
  onPublish: (visibility: DeckShareVisibility) => Promise<void>;
  onUpdate: (input: {
    visibility?: DeckShareVisibility;
    published?: boolean;
    publishLatest?: boolean;
  }) => Promise<void>;
  onUnpublish: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [visibility, setVisibility] = useState<DeckShareVisibility>('public');

  useEffect(() => {
    setVisibility(share?.visibility || 'public');
  }, [share?.visibility]);

  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const shareUrl = share ? `${origin}/deck-shares/${encodeURIComponent(share.id)}` : '';

  const handleCopyLink = async () => {
    try {
      await copyText(shareUrl);
      showToast({ title: t('deckShare.linkCopied'), kind: 'success' });
    } catch {
      showToast({ title: t('deckShare.linkCopyFailed'), kind: 'error' });
    }
  };

  const confirmUnpublish = async () => {
    if (!window.confirm(t('deckShare.unpublishConfirm'))) return;
    await onUnpublish();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={share ? t('deckShare.manageTitle') : t('deckShare.publishTitle')}
      description={t('deckShare.snapshotDescription')}
      closeLabel={t('common.close')}
      size="md"
    >
      {loading ? (
        <LoadingState label={t('deckShare.loadingOwned')} />
      ) : (
        <div className="grid gap-4">
          <div className="rounded-sm border border-border-soft bg-surface-base/50 p-3">
            <span className="font-mono text-caption uppercase tracking-[var(--tracking-control)] text-content-muted">
              {t('deckShare.selectedDeck')}
            </span>
            <strong className="mt-1 block break-words font-display text-title-sm">{deckName}</strong>
          </div>

          {error && (
            <Alert tone="danger" role="alert">
              {error}
            </Alert>
          )}

          {share?.moderationStatus === 'hidden' && (
            <Alert tone="danger" title={t('deckShare.hiddenTitle')}>
              {t('deckShare.hiddenBody')}
            </Alert>
          )}

          {share?.sourceChanged && share.moderationStatus !== 'hidden' && (
            <Alert tone="warning" title={t('deckShare.outdatedTitle')}>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <span>{t('deckShare.outdatedBody')}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={saving}
                  onClick={() => void onUpdate({ publishLatest: true, published: true })}
                >
                  <RefreshCw className="size-4" aria-hidden="true" />
                  {t('deckShare.updateSnapshot')}
                </Button>
              </div>
            </Alert>
          )}

          <label className="grid gap-1.5">
            <span className="font-mono text-caption uppercase tracking-[var(--tracking-control)] text-content-muted">
              {t('deckShare.visibility')}
            </span>
            <Select
              value={visibility}
              disabled={saving || share?.moderationStatus === 'hidden'}
              onChange={(event) => setVisibility(event.target.value as DeckShareVisibility)}
            >
              <option value="public">{t('deckShare.visibilityPublic')}</option>
              <option value="unlisted">{t('deckShare.visibilityUnlisted')}</option>
            </Select>
          </label>

          {!share ? (
            <Button type="button" variant="primary" disabled={saving} onClick={() => void onPublish(visibility)}>
              <Send className="size-4" aria-hidden="true" />
              {saving ? t('deckShare.publishing') : t('deckShare.publishAction')}
            </Button>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <Badge tone={share.publicationStatus === 'published' ? 'jade' : 'neutral'}>
                  {share.publicationStatus === 'published' ? t('deckShare.published') : t('deckShare.unpublished')}
                </Badge>
                <Badge tone="neutral">
                  {share.visibility === 'public' ? t('deckShare.public') : t('deckShare.unlisted')}
                </Badge>
              </div>

              {visibility !== share.visibility && share.moderationStatus !== 'hidden' && (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={saving}
                  onClick={() => void onUpdate({ visibility })}
                >
                  {t('deckShare.saveVisibility')}
                </Button>
              )}

              {share.publicationStatus === 'unpublished' && share.moderationStatus !== 'hidden' && (
                <Button
                  type="button"
                  variant="primary"
                  disabled={saving}
                  onClick={() =>
                    void onUpdate({ published: true, ...(share.sourceChanged ? { publishLatest: true } : {}) })
                  }
                >
                  <Send className="size-4" aria-hidden="true" />
                  {t('deckShare.republish')}
                </Button>
              )}

              {share.publicationStatus === 'published' && share.moderationStatus === 'visible' && (
                <div className="grid grid-cols-2 gap-2">
                  <Button type="button" variant="secondary" onClick={() => void handleCopyLink()}>
                    <Link2 className="size-4" aria-hidden="true" />
                    {t('deckShare.copyLink')}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      onOpenChange(false);
                      navigate(`/deck-shares/${encodeURIComponent(share.id)}`);
                    }}
                  >
                    <ExternalLink className="size-4" aria-hidden="true" />
                    {t('deckShare.viewShare')}
                  </Button>
                </div>
              )}

              {share.publicationStatus === 'published' && (
                <Button type="button" variant="danger" disabled={saving} onClick={() => void confirmUnpublish()}>
                  <Trash2 className="size-4" aria-hidden="true" />
                  {t('deckShare.unpublishAction')}
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </Dialog>
  );
}
