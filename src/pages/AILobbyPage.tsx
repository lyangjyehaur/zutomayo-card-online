import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import type { DeckResponse } from '../api/client';
import { DeckSelector } from '../components/lobby/DeckSelector';
import { DifficultyButtons } from '../components/lobby/DifficultyButtons';
import { buildDeckOptions, buildServerDeckOptions } from '../components/lobby/shared';
import type { AIDifficulty } from '../game/ai';
import { t, translate, useLocale } from '../i18n';

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
      { label: translate(locale, 'deck.localDecks'), options: localOptions },
      ...(serverOptions.length > 0 ? [{ label: translate(locale, 'deck.serverDecks'), options: serverOptions }] : []),
    ];
  }, [customDeckAvailable, locale, serverDecks]);

  return (
    <main className="relative flex h-screen w-screen flex-col overflow-hidden bg-lacquer-deep font-sans text-bone">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-1/2 h-[60vh] w-[120vh] -translate-x-1/2 -translate-y-1/2 rounded-full bg-vermilion/8 blur-[120px]" />
      </div>

      <header className="relative z-30 flex h-12 shrink-0 items-center border-b border-bone/5 bg-lacquer-deep/80 px-4 backdrop-blur md:px-6">
        <button
          className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] text-bone/50 transition hover:text-bone"
          type="button"
          onClick={() => navigate('/')}
        >
          <ArrowLeft strokeWidth={1.25} className="size-3.5" />
          {t('common.backToLobby')}
        </button>
        <h1 className="pointer-events-none absolute left-1/2 -translate-x-1/2 font-display text-sm italic">
          {t('lobby.aiBattle')}
        </h1>
      </header>

      <div className="relative z-10 grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto px-4 py-4 md:grid-cols-[minmax(0,1fr)_24rem] md:overflow-hidden md:px-6 md:py-6">
        <div className="flex min-h-0 flex-col gap-6 md:overflow-y-auto md:pr-2">
          {serverDeckError && <p className="text-[10px] text-vermilion/80">{serverDeckError}</p>}
          <DeckSelector label={t('lobby.myDeck')} value={deck0Name} options={deckOptions} onChange={setDeck0Name} />
          <div className="border-t border-bone/10 pt-6">
            <DeckSelector
              label={t('lobby.opponentDeck')}
              value={deck1Name}
              options={deckOptions}
              onChange={setDeck1Name}
            />
          </div>
        </div>
        <div className="flex min-h-0 flex-col gap-4 md:overflow-y-auto md:pr-2">
          <DifficultyButtons onStart={onStartAI} disabled={!deck0Name || !deck1Name} />
        </div>
      </div>
    </main>
  );
}
