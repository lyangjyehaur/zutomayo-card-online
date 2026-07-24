import { ArrowRight, Plus, Share2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ApiError,
  getDecks,
  getOwnedDeckShare,
  publishDeckShare,
  unpublishDeckShare,
  updateDeckShare,
  type DeckResponse,
  type DeckShareVisibility,
  type OwnedDeckShare,
} from '../../api/client';
import { trackDeckShareEvent } from '../../deckShareAnalytics';
import { t } from '../../i18n';
import { Alert, Button, Dialog, EmptyState, LoadingState, Select } from '../../ui';
import { useToast } from '../ToastProvider';
import { DeckShareManagerDialog } from './DeckShareManagerDialog';

export function DeckShareLobbyPublishFlow({ onChanged }: { onChanged: () => void | Promise<void> }) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [chooserOpen, setChooserOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [decks, setDecks] = useState<DeckResponse[]>([]);
  const [selectedDeckId, setSelectedDeckId] = useState('');
  const [decksLoading, setDecksLoading] = useState(false);
  const [decksError, setDecksError] = useState('');
  const [ownedDeckShare, setOwnedDeckShare] = useState<OwnedDeckShare | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareSaving, setShareSaving] = useState(false);
  const [shareError, setShareError] = useState('');

  const selectedDeck = useMemo(() => decks.find((deck) => deck.id === selectedDeckId) ?? null, [decks, selectedDeckId]);

  const loadDecks = useCallback(async () => {
    setDecksLoading(true);
    setDecksError('');
    try {
      const result = await getDecks();
      setDecks(result);
      setSelectedDeckId((current) => (result.some((deck) => deck.id === current) ? current : (result[0]?.id ?? '')));
    } catch {
      setDecks([]);
      setSelectedDeckId('');
      setDecksError(t('deck.loadServerError'));
    } finally {
      setDecksLoading(false);
    }
  }, []);

  useEffect(() => {
    if (chooserOpen) void loadDecks();
  }, [chooserOpen, loadDecks]);

  useEffect(() => {
    if (!managerOpen || !selectedDeckId) return;
    let cancelled = false;
    setShareLoading(true);
    setShareError('');
    getOwnedDeckShare(selectedDeckId)
      .then((share) => {
        if (!cancelled) setOwnedDeckShare(share);
      })
      .catch((error) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 404) {
          setOwnedDeckShare(null);
          return;
        }
        setShareError(t('deckShare.ownerLoadError'));
      })
      .finally(() => {
        if (!cancelled) setShareLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [managerOpen, selectedDeckId]);

  const runShareAction = async (action: () => Promise<OwnedDeckShare>, successTitle: string) => {
    setShareSaving(true);
    setShareError('');
    try {
      const share = await action();
      setOwnedDeckShare(share);
      showToast({ title: successTitle, kind: 'success' });
      await onChanged();
      return true;
    } catch {
      setShareError(t('deckShare.saveError'));
      showToast({ title: t('deckShare.saveError'), kind: 'error' });
      return false;
    } finally {
      setShareSaving(false);
    }
  };

  const publish = async (visibility: DeckShareVisibility) => {
    if (!selectedDeckId) return;
    const published = await runShareAction(
      () => publishDeckShare(selectedDeckId, visibility),
      t('deckShare.publishSuccess'),
    );
    if (published) {
      trackDeckShareEvent('deck_share_publish', { visibility, is_logged_in: true, source: 'lobby' });
    }
  };

  const update = async (input: { visibility?: DeckShareVisibility; published?: boolean; publishLatest?: boolean }) => {
    if (!ownedDeckShare) return;
    const updated = await runShareAction(
      () => updateDeckShare(ownedDeckShare.id, input),
      input.publishLatest ? t('deckShare.updateSuccess') : t('deckShare.settingsSaved'),
    );
    if (updated) {
      trackDeckShareEvent('deck_share_update', {
        visibility: input.visibility || ownedDeckShare.visibility,
        is_logged_in: true,
        source: 'lobby',
      });
    }
  };

  const unpublish = async () => {
    if (!ownedDeckShare) return;
    setShareSaving(true);
    setShareError('');
    try {
      await unpublishDeckShare(ownedDeckShare.id);
      setOwnedDeckShare((current) =>
        current ? { ...current, publicationStatus: 'unpublished', unpublishedAt: new Date().toISOString() } : current,
      );
      showToast({ title: t('deckShare.unpublishSuccess'), kind: 'success' });
      trackDeckShareEvent('deck_share_unpublish', { is_logged_in: true, source: 'lobby' });
      await onChanged();
    } catch {
      setShareError(t('deckShare.saveError'));
    } finally {
      setShareSaving(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="primary"
        className="w-full sm:w-auto sm:self-start"
        leftIcon={<Share2 className="size-4" aria-hidden="true" />}
        onClick={() => setChooserOpen(true)}
      >
        {t('deckShare.shareDeck')}
      </Button>

      <Dialog
        open={chooserOpen}
        onOpenChange={setChooserOpen}
        title={t('deckShare.chooseDeckTitle')}
        description={t('deckShare.chooseDeckDescription')}
        closeLabel={t('common.close')}
        size="md"
        footer={
          decks.length > 0 ? (
            <>
              <Button type="button" variant="secondary" onClick={() => setChooserOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={!selectedDeck}
                rightIcon={<ArrowRight className="size-4" aria-hidden="true" />}
                onClick={() => {
                  setOwnedDeckShare(null);
                  setShareLoading(true);
                  setChooserOpen(false);
                  setManagerOpen(true);
                }}
              >
                {t('common.continue')}
              </Button>
            </>
          ) : undefined
        }
      >
        {decksLoading ? (
          <LoadingState label={t('deckShare.loadingDecks')} />
        ) : decksError ? (
          <Alert tone="danger" role="alert" title={decksError}>
            <Button type="button" size="sm" variant="secondary" onClick={() => void loadDecks()}>
              {t('common.retry')}
            </Button>
          </Alert>
        ) : decks.length === 0 ? (
          <EmptyState
            title={t('deckShare.noSavedDecksTitle')}
            description={t('deckShare.noSavedDecksBody')}
            actions={
              <Button
                type="button"
                variant="primary"
                leftIcon={<Plus className="size-4" aria-hidden="true" />}
                onClick={() => {
                  setChooserOpen(false);
                  navigate('/deck-builder');
                }}
              >
                {t('deckShare.createDeck')}
              </Button>
            }
          />
        ) : (
          <label className="grid gap-1.5">
            <span className="font-mono text-caption uppercase tracking-[var(--tracking-control)] text-content-muted">
              {t('deckShare.chooseDeckLabel')}
            </span>
            <Select value={selectedDeckId} onChange={(event) => setSelectedDeckId(event.target.value)}>
              {decks.map((deck) => (
                <option key={deck.id} value={deck.id}>
                  {deck.name}
                </option>
              ))}
            </Select>
          </label>
        )}
      </Dialog>

      {selectedDeck && (
        <DeckShareManagerDialog
          open={managerOpen}
          onOpenChange={setManagerOpen}
          deckName={selectedDeck.name}
          share={ownedDeckShare}
          loading={shareLoading}
          saving={shareSaving}
          error={shareError}
          onPublish={publish}
          onUpdate={update}
          onUnpublish={unpublish}
        />
      )}
    </>
  );
}
