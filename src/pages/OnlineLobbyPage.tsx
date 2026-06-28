import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DeckResponse } from '../api/client';
import { DeckSelector } from '../components/lobby/DeckSelector';
import { OnlinePanel } from '../components/lobby/OnlinePanel';
import { buildDeckOptions, buildServerDeckOptions } from '../components/lobby/shared';
import { t, useLocale } from '../i18n';
import type { OnlineSession } from '../onlineSession';

interface OnlineLobbyPageProps {
  deck0Name: string;
  customDeckAvailable: boolean;
  serverDecks: DeckResponse[];
  setDeck0Name: (deckName: string) => void;
  onStartOnline: (matchID?: string) => Promise<OnlineSession>;
  serverDeckError?: string;
}

export function OnlineLobbyPage({
  deck0Name,
  customDeckAvailable,
  serverDecks,
  setDeck0Name,
  onStartOnline,
  serverDeckError,
}: OnlineLobbyPageProps) {
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
          <h1 className="text-2xl font-bold text-primary">{t('lobby.onlineTitle')}</h1>
        </div>
      </header>

      {serverDeckError && <div className="alert alert-error">{serverDeckError}</div>}

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <DeckSelector label={t('lobby.myDeck')} value={deck0Name} options={deckOptions} onChange={setDeck0Name} />
        <div className="flex flex-col gap-4">
          <OnlinePanel startOnline={onStartOnline} />
          {/* 本地對戰入口（PVP 本地，與線上同為對人對戰） */}
          <section className="card bg-base-200 shadow-xl">
            <div className="card-body">
              <div>
                <h3 className="card-title">{t('lobby.localBattle')}</h3>
                <span className="text-sm opacity-70">{t('app.subtitle')}</span>
              </div>
              <button className="btn btn-secondary" type="button" onClick={() => navigate('/play/local')}>
                {t('lobby.localBattle')}
              </button>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
