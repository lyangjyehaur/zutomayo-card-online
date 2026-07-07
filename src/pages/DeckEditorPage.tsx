import { useEffect, useMemo, useRef, useState } from 'react';
import { createDeck, getDecks, isLoggedIn, updateDeck, type DeckResponse } from '../api/client';
import { DeckEditor } from '../components/DeckEditor';
import { useToast } from '../components/ToastProvider';
import { Sentry } from '../sentry';
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

export function DeckEditorPage({ serverDecks, onServerDecksLoaded, onDeckSaved }: DeckEditorPageProps) {
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
  const importInputRef = useRef<HTMLInputElement>(null);

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
