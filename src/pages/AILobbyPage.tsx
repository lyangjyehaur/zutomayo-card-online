import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DeckResponse } from '../api/client';
import { DeckSelector } from '../components/lobby/DeckSelector';
import { DifficultyButtons } from '../components/lobby/DifficultyButtons';
import { useToast } from '../components/ToastProvider';
import { BackButton, PageHeader, PageShell } from '../components/ui';
import {
  buildAIOpponentDeckOptions,
  buildDeckOptions,
  buildServerDeckOptions,
  canStartAI,
} from '../components/lobby/shared';
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
  cardsReady: boolean;
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
  cardsReady,
}: AILobbyPageProps) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const locale = useLocale();
  // 玩家牌組用完整選項（含自訂牌組）；AI 對手牌組移除自訂牌組、改用克制牌組選項。
  const playerDeckOptions = useMemo(() => {
    const localOptions = buildDeckOptions(customDeckAvailable);
    const serverOptions = buildServerDeckOptions(serverDecks);
    return [
      { label: translate(locale, 'deck.localDecks'), options: localOptions },
      ...(serverOptions.length > 0 ? [{ label: translate(locale, 'deck.serverDecks'), options: serverOptions }] : []),
    ];
  }, [customDeckAvailable, locale, serverDecks]);
  // AI 對手牌組移除自訂牌組與伺服器牌組（AI 不該用玩家自訂牌組），改用克制牌組選項。
  const opponentDeckOptions = useMemo(() => {
    const localOptions = buildAIOpponentDeckOptions();
    return [{ label: translate(locale, 'deck.localDecks'), options: localOptions }];
  }, [locale]);

  // 牌組選擇後 Toast 提示（首次選擇時顯示）
  const handlePlayerDeckChange = (newDeck: string) => {
    const isFirstSelection = !deck0Name && newDeck;
    setDeck0Name(newDeck);

    if (isFirstSelection) {
      const hasShownToast = sessionStorage.getItem('zutomayo_deck_selected_toast');
      if (!hasShownToast) {
        showToast({
          title: t('deck.selectionSuccess'),
          body: t('deck.readyToStart'),
          kind: 'success',
          durationMs: 3000,
        });
        sessionStorage.setItem('zutomayo_deck_selected_toast', 'true');
      }
    }
  };

  return (
    <PageShell variant="workspace" className="flex flex-col" glow={{ color: 'vermilion', size: 'md' }}>
      <PageHeader
        leading={
          <BackButton type="button" onClick={() => navigate('/')}>
            <span className="hidden sm:inline">{t('common.backToLobby')}</span>
          </BackButton>
        }
        title={t('lobby.aiBattle')}
      />

      <div className="relative z-10 grid min-h-0 flex-1 grid-cols-1 gap-8 overflow-y-auto px-4 py-4 lg:grid-cols-[minmax(0,1fr)_24rem] lg:gap-4 lg:overflow-hidden lg:px-6 lg:py-6">
        <div className="flex flex-col gap-6 lg:min-h-0 lg:overflow-y-auto lg:pr-2">
          {serverDeckError && <p className="text-[10px] text-vermilion/80">{serverDeckError}</p>}
          <DeckSelector
            label={t('lobby.myDeck')}
            value={deck0Name}
            options={playerDeckOptions}
            onChange={handlePlayerDeckChange}
          />
          <div className="border-t border-bone/10 pt-6">
            <DeckSelector
              label={t('lobby.opponentDeck')}
              value={deck1Name}
              options={opponentDeckOptions}
              onChange={setDeck1Name}
            />
          </div>
        </div>
        <div className="flex flex-col gap-4 border-t border-bone/10 pt-6 lg:min-h-0 lg:border-t-0 lg:pt-0 lg:overflow-y-auto lg:pr-2">
          <DifficultyButtons onStart={onStartAI} disabled={!canStartAI({ cardsReady, deck0Name, deck1Name })} />
        </div>
      </div>
    </PageShell>
  );
}
