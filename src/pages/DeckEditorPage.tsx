import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createDeck, getDecks, isLoggedIn, type DeckResponse } from '../api/client';
import { DeckEditor } from '../components/DeckEditor';
import { CUSTOM_DECK_STORAGE_KEY, loadCustomDeckIds } from '../game/cards/deckBuilder';
import { t } from '../i18n';

interface DeckEditorPageProps {
  serverDecks: DeckResponse[];
  onServerDecksLoaded: (decks: DeckResponse[]) => void;
  onDeckSaved: (deck?: DeckResponse) => void;
}

export function DeckEditorPage({ serverDecks, onServerDecksLoaded, onDeckSaved }: DeckEditorPageProps) {
  const navigate = useNavigate();
  const [deckName, setDeckName] = useState(t('deck.custom'));
  const [saving, setSaving] = useState(false);
  const [syncedDeckId, setSyncedDeckId] = useState<string | null>(null);
  const loggedIn = isLoggedIn();

  useEffect(() => {
    if (!loggedIn) return;
    let cancelled = false;
    getDecks()
      .then(decks => {
        if (!cancelled) onServerDecksLoaded(decks);
      })
      .catch(() => {
        if (!cancelled) onServerDecksLoaded([]);
      });
    return () => {
      cancelled = true;
    };
  }, [loggedIn, onServerDecksLoaded]);

  const initialDeck = useMemo(() => {
    if (loggedIn && serverDecks[0]?.cardIds.length) return serverDecks[0].cardIds;
    return loadCustomDeckIds() ?? undefined;
  }, [loggedIn, serverDecks]);

  return (
    <DeckEditor
      key={initialDeck?.join('|') ?? 'empty'}
      initialDeck={initialDeck}
      deckName={deckName}
      onDeckNameChange={setDeckName}
      saveLabel={loggedIn ? t('deck.saveToServer') : t('deckEditor.saveDeck')}
      saving={saving}
      synced={!!syncedDeckId}
      syncLabel={loggedIn && syncedDeckId ? t('deck.synced') : undefined}
      saveLocalDeck={!loggedIn}
      onSave={async deckIds => {
        setSaving(true);
        try {
          if (loggedIn) {
            const savedDeck = await createDeck(deckName.trim() || t('deck.custom'), deckIds);
            setSyncedDeckId(savedDeck.id);
            onDeckSaved(savedDeck);
          } else {
            localStorage.setItem(CUSTOM_DECK_STORAGE_KEY, JSON.stringify(deckIds));
            onDeckSaved();
          }
        } finally {
          setSaving(false);
        }
        navigate('/');
      }}
      onCancel={() => navigate('/')}
    />
  );
}
