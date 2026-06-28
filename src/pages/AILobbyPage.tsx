import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DeckResponse } from '../api/client';
import { DeckSelector } from '../components/lobby/DeckSelector';
import { DifficultyButtons } from '../components/lobby/DifficultyButtons';
import { buildDeckOptions, buildServerDeckOptions } from '../components/lobby/shared';
import type { AIDifficulty } from '../game/ai';
import { t, useLocale } from '../i18n';

interface AILobbyPageProps {
  deck0Name: string;
  deck1Name: string;
  customDeckAvailable: boolean;
  serverDecks: DeckResponse[];
  setDeck0Name: (deckName: string) => void;
  setDeck1Name: (deckName: string) => void;
  onStartAI: (difficulty: AIDifficulty) => void;
  serverDeckError?: string;
}

export function AILobbyPage({
  deck0Name,
  deck1Name,
  customDeckAvailable,
  serverDecks,
  setDeck0Name,
  setDeck1Name,
  onStartAI,
  serverDeckError,
}: AILobbyPageProps) {
  const navigate = useNavigate();
  const locale = useLocale();
  const deckOptions = useMemo(() => {
    const localOptions = buildDeckOptions(customDeckAvailable);
    const serverOptions = buildServerDeckOptions(serverDecks);
    return [
      { label: t('deck.localDecks'), options: localOptions },
      ...(serverOptions.length > 0 ? [{ label: t('deck.serverDecks'), options: serverOptions }] : []),
    ];
  }, [customDeckAvailable, locale, serverDecks]);

  return (
    <main className="min-h-screen container mx-auto flex flex-col gap-6 p-4">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => navigate('/')}>
            ← {t('common.backToLobby')}
          </button>
          <h1 className="text-2xl font-bold text-primary">{t('lobby.aiBattle')}</h1>
        </div>
      </header>

      {serverDeckError && <div className="alert alert-error">{serverDeckError}</div>}

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex flex-col gap-6">
          <DeckSelector label={t('lobby.myDeck')} value={deck0Name} options={deckOptions} onChange={setDeck0Name} />
          <div className="divider" />
          <DeckSelector
            label={t('lobby.opponentDeck')}
            value={deck1Name}
            options={deckOptions}
            onChange={setDeck1Name}
          />
        </div>
        <div className="flex flex-col gap-4">
          <DifficultyButtons onStart={onStartAI} />
        </div>
      </section>
    </main>
  );
}
