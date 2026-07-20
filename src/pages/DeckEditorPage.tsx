import { useEffect, useMemo, useRef, useState } from 'react';
import { Share2 } from 'lucide-react';
import {
  ApiError,
  createDeck,
  getDecks,
  getOwnedDeckShare,
  isLoggedIn,
  publishDeckShare,
  unpublishDeckShare,
  updateDeck,
  updateDeckShare,
  type DeckResponse,
  type DeckShareVisibility,
  type OwnedDeckShare,
} from '../api/client';
import { DeckEditor } from '../components/DeckEditor';
import { DeckShareManagerDialog } from '../components/deck-sharing/DeckShareManagerDialog';
import { useToast } from '../components/ToastProvider';
import { Sentry } from '../sentry';
import { trackDeckShareEvent } from '../deckShareAnalytics';
import {
  createDeckExport,
  customDeckIdFromOption,
  customDeckOptionId,
  loadActiveCustomDeckId,
  loadSavedCustomDecks,
  parseDeckImport,
  removeSavedCustomDecks,
  saveCustomDeck,
  setActiveCustomDeckId,
  type SavedCustomDeck,
} from '../game/cards/customDeck';
import { isValidConstructedDeck } from '../game/cards/deckBuilder';
import { serverDeckIdFromOption, serverDeckOptionId } from '../components/lobby/shared';
import { t } from '../i18n';
import { Alert, Button } from '../ui';

interface DeckEditorPageProps {
  serverDecks: DeckResponse[];
  onServerDecksLoaded: (decks: DeckResponse[]) => void;
  onDeckSaved: (deck?: DeckResponse) => void;
  deckSharingEnabled?: boolean;
}

function initialCustomDeckSelection(): { decks: SavedCustomDeck[]; selectedId: string; deck?: SavedCustomDeck } {
  const decks = loadSavedCustomDecks();
  const activeId = loadActiveCustomDeckId();
  const deck = (activeId ? decks.find((item) => item.id === activeId) : null) ?? decks[0];
  return {
    decks,
    selectedId: deck ? customDeckOptionId(deck.id) : '',
    deck,
  };
}

function isCompleteLocalDeck(deck: SavedCustomDeck): boolean {
  return isValidConstructedDeck(deck.cardIds);
}

function deckFingerprint(cardIds: string[]): string {
  return [...cardIds]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
    .join('\u0000');
}

function sameDeckContents(a: string[], b: string[]): boolean {
  return a.length === b.length && deckFingerprint(a) === deckFingerprint(b);
}

export function DeckEditorPage({
  serverDecks,
  onServerDecksLoaded,
  onDeckSaved,
  deckSharingEnabled = false,
}: DeckEditorPageProps) {
  const { showToast } = useToast();
  const loggedIn = isLoggedIn();
  const [initialCustomDeck] = useState(initialCustomDeckSelection);
  const [savedCustomDecks, setSavedCustomDecks] = useState<SavedCustomDeck[]>(() => initialCustomDeck.decks);
  const [selectedDeckLibraryId, setSelectedDeckLibraryId] = useState(() =>
    loggedIn ? '' : initialCustomDeck.selectedId,
  );
  const [deckName, setDeckName] = useState(() =>
    loggedIn ? t('deck.custom') : (initialCustomDeck.deck?.name ?? t('deck.custom')),
  );
  const [editorDeck, setEditorDeck] = useState<string[] | undefined>(() =>
    loggedIn ? undefined : initialCustomDeck.deck?.cardIds,
  );
  const [editorRevision, setEditorRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [syncedDeckId, setSyncedDeckId] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [linkingLocalDecks, setLinkingLocalDecks] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [ownedDeckShare, setOwnedDeckShare] = useState<OwnedDeckShare | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareSaving, setShareSaving] = useState(false);
  const [shareError, setShareError] = useState('');
  const importInputRef = useRef<HTMLInputElement>(null);
  const selectedServerDeckId = serverDeckIdFromOption(selectedDeckLibraryId);

  useEffect(() => {
    if (!loggedIn) return;
    let cancelled = false;
    getDecks()
      .then((decks) => {
        if (!cancelled) {
          setLoadError('');
          onServerDecksLoaded(decks);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError(t('deck.loadServerError'));
          onServerDecksLoaded([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [loggedIn, onServerDecksLoaded]);

  useEffect(() => {
    if (!loggedIn || selectedDeckLibraryId || !serverDecks[0]) return;
    const firstDeck = serverDecks[0];
    setSelectedDeckLibraryId(serverDeckOptionId(firstDeck.id));
    setDeckName(firstDeck.name);
    setEditorDeck(firstDeck.cardIds);
    setSyncedDeckId(firstDeck.id);
    setHasUnsavedChanges(false);
    setEditorRevision((value) => value + 1);
  }, [loggedIn, selectedDeckLibraryId, serverDecks]);

  useEffect(() => {
    if (!deckSharingEnabled || !loggedIn || !selectedServerDeckId) {
      setOwnedDeckShare(null);
      setShareError('');
      setShareLoading(false);
      return;
    }
    let cancelled = false;
    setShareLoading(true);
    setShareError('');
    getOwnedDeckShare(selectedServerDeckId)
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
  }, [deckSharingEnabled, loggedIn, selectedServerDeckId, serverDecks]);

  const runShareAction = async (action: () => Promise<OwnedDeckShare>, successTitle: string) => {
    setShareSaving(true);
    setShareError('');
    try {
      const share = await action();
      setOwnedDeckShare(share);
      showToast({ title: successTitle, kind: 'success' });
      return true;
    } catch {
      setShareError(t('deckShare.saveError'));
      showToast({ title: t('deckShare.saveError'), kind: 'error' });
      return false;
    } finally {
      setShareSaving(false);
    }
  };

  const handlePublishShare = async (visibility: DeckShareVisibility) => {
    if (!selectedServerDeckId) return;
    const published = await runShareAction(
      () => publishDeckShare(selectedServerDeckId, visibility),
      t('deckShare.publishSuccess'),
    );
    if (published) {
      trackDeckShareEvent('deck_share_publish', { visibility, is_logged_in: true, source: 'deck_builder' });
    }
  };

  const handleUpdateShare = async (input: {
    visibility?: DeckShareVisibility;
    published?: boolean;
    publishLatest?: boolean;
  }) => {
    if (!ownedDeckShare) return;
    const updated = await runShareAction(
      () => updateDeckShare(ownedDeckShare.id, input),
      input.publishLatest ? t('deckShare.updateSuccess') : t('deckShare.settingsSaved'),
    );
    if (updated) {
      trackDeckShareEvent('deck_share_update', {
        visibility: input.visibility || ownedDeckShare.visibility,
        is_logged_in: true,
        source: 'deck_builder',
      });
    }
  };

  const handleUnpublishShare = async () => {
    if (!ownedDeckShare) return;
    setShareSaving(true);
    setShareError('');
    try {
      await unpublishDeckShare(ownedDeckShare.id);
      setOwnedDeckShare((current) =>
        current ? { ...current, publicationStatus: 'unpublished', unpublishedAt: new Date().toISOString() } : current,
      );
      showToast({ title: t('deckShare.unpublishSuccess'), kind: 'success' });
      trackDeckShareEvent('deck_share_unpublish', { is_logged_in: true, source: 'deck_builder' });
    } catch {
      setShareError(t('deckShare.saveError'));
    } finally {
      setShareSaving(false);
    }
  };

  const deckLibraryOptions = useMemo(() => {
    const draftOption =
      selectedDeckLibraryId === ''
        ? [{ id: '', name: deckName.trim() || t('deckEditor.currentDraft'), description: t('deckEditor.currentDraft') }]
        : [];
    if (loggedIn) {
      return [
        ...draftOption,
        ...serverDecks.map((deck) => ({
          id: serverDeckOptionId(deck.id),
          name: deck.name,
          description: t('deck.synced'),
        })),
      ];
    }
    return [
      ...draftOption,
      ...savedCustomDecks.map((deck) => ({
        id: customDeckOptionId(deck.id),
        name: deck.name,
        description: t('deck.customDesc'),
      })),
    ];
  }, [deckName, loggedIn, savedCustomDecks, selectedDeckLibraryId, serverDecks]);

  const initialDeck = useMemo(() => {
    if (editorDeck) return editorDeck;
    if (selectedDeckLibraryId === '') return [];
    const serverDeckId = serverDeckIdFromOption(selectedDeckLibraryId);
    if (serverDeckId) return serverDecks.find((deck) => deck.id === serverDeckId)?.cardIds;
    const customDeckId = customDeckIdFromOption(selectedDeckLibraryId);
    if (customDeckId) return savedCustomDecks.find((deck) => deck.id === customDeckId)?.cardIds;
    return undefined;
  }, [editorDeck, savedCustomDecks, selectedDeckLibraryId, serverDecks]);

  const unlinkedLocalDecks = useMemo(
    () =>
      savedCustomDecks
        .filter(isCompleteLocalDeck)
        .filter(
          (localDeck) => !serverDecks.some((serverDeck) => sameDeckContents(serverDeck.cardIds, localDeck.cardIds)),
        ),
    [savedCustomDecks, serverDecks],
  );

  const markDeckDirty = () => {
    setSyncedDeckId(null);
    setSaveError('');
    setHasUnsavedChanges(true);
  };

  const canDiscardCurrentDraft = () => !hasUnsavedChanges || window.confirm(t('deckEditor.discardChangesConfirm'));

  const handleSelectDeckLibrary = (optionId: string) => {
    if (optionId === selectedDeckLibraryId) return;
    if (!canDiscardCurrentDraft()) return;
    setSelectedDeckLibraryId(optionId);
    setSyncedDeckId(null);
    setHasUnsavedChanges(false);
    setSaveError('');
    const serverDeckId = serverDeckIdFromOption(optionId);
    if (serverDeckId) {
      const deck = serverDecks.find((item) => item.id === serverDeckId);
      if (!deck) return;
      setDeckName(deck.name);
      setEditorDeck(deck.cardIds);
      setSyncedDeckId(deck.id);
      setEditorRevision((value) => value + 1);
      return;
    }
    const customDeckId = customDeckIdFromOption(optionId);
    if (customDeckId) {
      const deck = savedCustomDecks.find((item) => item.id === customDeckId);
      if (!deck) return;
      setActiveCustomDeckId(deck.id);
      setDeckName(deck.name);
      setEditorDeck(deck.cardIds);
      setEditorRevision((value) => value + 1);
    }
  };

  const handleNewDeck = () => {
    if (!canDiscardCurrentDraft()) return;
    setSelectedDeckLibraryId('');
    setDeckName(t('deck.custom'));
    setEditorDeck([]);
    setSyncedDeckId(null);
    setHasUnsavedChanges(false);
    setSaveError('');
    setEditorRevision((value) => value + 1);
  };

  const handleExportDeck = (deckIds: string[]) => {
    const exportData = createDeckExport(deckName, deckIds);
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeName = (exportData.name || 'deck').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'deck';
    link.href = url;
    link.download = `${safeName}.zutomayo-deck.json`;
    link.click();
    URL.revokeObjectURL(url);
    showToast({ title: t('deckEditor.exportSuccess'), kind: 'success' });
  };

  const handleImportFile = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = parseDeckImport(JSON.parse(text));
      if (!parsed) throw new Error('Invalid deck import');
      setSelectedDeckLibraryId('');
      setDeckName(parsed.name?.trim() || t('deckEditor.currentDraft'));
      setEditorDeck(parsed.cardIds);
      setSyncedDeckId(null);
      setHasUnsavedChanges(true);
      setSaveError('');
      setEditorRevision((value) => value + 1);
      showToast({ title: t('deckEditor.importSuccess'), kind: 'success' });
    } catch (err) {
      Sentry.captureException(err, { tags: { action: 'deck-import' } });
      showToast({ title: t('deckEditor.importError'), kind: 'error' });
    } finally {
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  const handleLinkLocalDecksToAccount = async () => {
    if (!loggedIn || unlinkedLocalDecks.length === 0) return;
    setLinkingLocalDecks(true);
    setSaveError('');
    const uploadedDecks: DeckResponse[] = [];
    const uploadedLocalDeckIds: string[] = [];
    try {
      for (const localDeck of unlinkedLocalDecks) {
        const uploadedDeck = await createDeck(localDeck.name.trim() || t('deck.custom'), localDeck.cardIds);
        uploadedDecks.push(uploadedDeck);
        uploadedLocalDeckIds.push(localDeck.id);
      }
      onServerDecksLoaded([...uploadedDecks, ...serverDecks]);
      setSavedCustomDecks(removeSavedCustomDecks(uploadedLocalDeckIds));
      onDeckSaved();
      const firstDeck = uploadedDecks[0];
      if (firstDeck) {
        setSyncedDeckId(firstDeck.id);
        setSelectedDeckLibraryId(serverDeckOptionId(firstDeck.id));
        setDeckName(firstDeck.name);
        setEditorDeck(firstDeck.cardIds);
        setHasUnsavedChanges(false);
        setEditorRevision((value) => value + 1);
      }
      showToast({
        title: t('deckEditor.linkLocalDecksSuccess').replace('{count}', String(uploadedDecks.length)),
        kind: 'success',
      });
    } catch {
      if (uploadedDecks.length > 0) {
        onServerDecksLoaded([...uploadedDecks, ...serverDecks]);
        setSavedCustomDecks(removeSavedCustomDecks(uploadedLocalDeckIds));
        onDeckSaved();
      }
      const message = t('deckEditor.linkLocalDecksError');
      setSaveError(message);
      showToast({
        title: t('deck.saveFailedTitle'),
        body: message,
        kind: 'error',
      });
    } finally {
      setLinkingLocalDecks(false);
    }
  };

  return (
    <>
      <DeckShareManagerDialog
        open={shareDialogOpen}
        onOpenChange={setShareDialogOpen}
        deckName={deckName}
        share={ownedDeckShare}
        loading={shareLoading}
        saving={shareSaving}
        error={shareError}
        onPublish={handlePublishShare}
        onUpdate={handleUpdateShare}
        onUnpublish={handleUnpublishShare}
      />
      <input
        ref={importInputRef}
        className="hidden"
        type="file"
        accept="application/json,.json"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleImportFile(file);
        }}
      />
      <DeckEditor
        key={`${selectedDeckLibraryId || 'draft'}:${editorRevision}:${initialDeck?.join('|') ?? 'empty'}`}
        initialDeck={initialDeck}
        deckName={deckName}
        onDeckNameChange={(name) => {
          setDeckName(name);
          markDeckDirty();
        }}
        deckLibraryOptions={deckLibraryOptions}
        selectedDeckLibraryId={selectedDeckLibraryId}
        onSelectDeckLibrary={handleSelectDeckLibrary}
        onNewDeck={handleNewDeck}
        onImportDeck={() => {
          if (canDiscardCurrentDraft()) importInputRef.current?.click();
        }}
        onExportDeck={handleExportDeck}
        onDeckChange={markDeckDirty}
        saveLabel={loggedIn ? t('deck.saveToServer') : t('deckEditor.saveDeck')}
        saving={saving}
        synced={!hasUnsavedChanges && !!syncedDeckId}
        syncLabel={
          hasUnsavedChanges ? t('deckEditor.unsavedChanges') : loggedIn && syncedDeckId ? t('deck.synced') : undefined
        }
        headerActions={
          deckSharingEnabled && loggedIn ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="size-touch shrink-0 px-0 sm:w-auto sm:px-3"
              disabled={!selectedServerDeckId || hasUnsavedChanges || saving}
              title={
                !selectedServerDeckId
                  ? t('deckShare.saveServerFirst')
                  : hasUnsavedChanges
                    ? t('deckShare.saveChangesFirst')
                    : undefined
              }
              onClick={() => setShareDialogOpen(true)}
            >
              <Share2 className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">
                {ownedDeckShare?.sourceChanged ? t('deckShare.updateSnapshot') : t('deckShare.shareAction')}
              </span>
            </Button>
          ) : undefined
        }
        errorMessage={saveError || loadError}
        notice={
          loggedIn && unlinkedLocalDecks.length > 0 ? (
            <Alert
              className="mb-3 flex flex-col gap-2 border-accent-primary/35 bg-accent-primary/10 text-content-primary sm:flex-row sm:items-center sm:justify-between"
              tone="warning"
              title={t('deckEditor.linkLocalDecksTitle')}
            >
              <span className="text-content-primary/75">
                {t('deckEditor.linkLocalDecksBody').replace('{count}', String(unlinkedLocalDecks.length))}
              </span>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="shrink-0 border-accent-primary/40 text-accent-primary hover:text-accent-primary"
                disabled={linkingLocalDecks}
                onClick={handleLinkLocalDecksToAccount}
              >
                {linkingLocalDecks ? t('deckEditor.linkingLocalDecks') : t('deckEditor.linkLocalDecksAction')}
              </Button>
            </Alert>
          ) : null
        }
        onSave={async (deckIds) => {
          setSaving(true);
          setSaveError('');
          try {
            if (loggedIn) {
              const serverDeckId = serverDeckIdFromOption(selectedDeckLibraryId);
              const savedDeck = serverDeckId
                ? await updateDeck(serverDeckId, deckName.trim() || t('deck.custom'), deckIds)
                : await createDeck(deckName.trim() || t('deck.custom'), deckIds);
              setSyncedDeckId(savedDeck.id);
              setHasUnsavedChanges(false);
              setSelectedDeckLibraryId(serverDeckOptionId(savedDeck.id));
              setDeckName(savedDeck.name);
              setEditorDeck(savedDeck.cardIds);
              if (serverDeckId) {
                onServerDecksLoaded([savedDeck, ...serverDecks.filter((deck) => deck.id !== savedDeck.id)]);
              } else {
                onDeckSaved(savedDeck);
              }
            } else {
              const customDeckId = customDeckIdFromOption(selectedDeckLibraryId);
              const savedDeck = saveCustomDeck(deckName.trim() || t('deck.custom'), deckIds, customDeckId);
              setSavedCustomDecks(loadSavedCustomDecks());
              setSelectedDeckLibraryId(customDeckOptionId(savedDeck.id));
              setDeckName(savedDeck.name);
              setEditorDeck(savedDeck.cardIds);
              setHasUnsavedChanges(false);
              onDeckSaved();
            }
            showToast({
              title: loggedIn ? t('deck.saveServerSuccess') : t('deck.saveLocalSuccess'),
              kind: 'success',
            });
          } catch {
            const message = loggedIn ? t('deck.saveServerError') : t('deck.saveLocalError');
            setSaveError(message);
            showToast({
              title: t('deck.saveFailedTitle'),
              body: message,
              kind: 'error',
            });
          } finally {
            setSaving(false);
          }
        }}
      />
    </>
  );
}
