import { useMemo, useRef } from 'react';
import type { DeckResponse } from '../api/client';
import { DeckSelector } from '../components/lobby/DeckSelector';
import { DifficultyButtons } from '../components/lobby/DifficultyButtons';
import { useToast } from '../components/ToastProvider';
import { Alert, AppHeader, Button, PageShell } from '../ui';
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
  cardsLoadError?: boolean;
  onRetryCards?: () => void | Promise<void>;
}

/**
 * AI 對戰大廳「設定台」— v2 從零設計。
 * 單欄三步流程（01 我的牌組 → 02 對手牌組 → 03 難度・開戰），
 * 每步是一塊玻璃面板；不再使用側欄工作區構圖。
 */
function Step({ no, title, children }: { no: string; title: string; children: React.ReactNode }) {
  return (
    <section
      className="rounded-md border border-border-soft bg-surface-base/70 p-5 backdrop-blur md:p-6"
      aria-label={`${no} ${title}`}
    >
      <div className="mb-3 flex items-center gap-3" aria-hidden="true">
        <span className="font-mono text-caption tracking-[var(--tracking-meta)] text-accent-primary/80">STEP {no}</span>
        <span className="h-px flex-1 bg-border-soft" />
      </div>
      {children}
    </section>
  );
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
  cardsLoadError,
  onRetryCards,
}: AILobbyPageProps) {
  const { showToast } = useToast();
  const locale = useLocale();
  const opponentStepRef = useRef<HTMLDivElement | null>(null);
  const difficultyStepRef = useRef<HTMLDivElement | null>(null);
  const playerDeckOptions = useMemo(() => {
    const localOptions = buildDeckOptions(customDeckAvailable);
    const serverOptions = buildServerDeckOptions(serverDecks);
    return [
      { label: translate(locale, 'deck.localDecks'), options: localOptions },
      ...(serverOptions.length > 0 ? [{ label: translate(locale, 'deck.serverDecks'), options: serverOptions }] : []),
    ];
  }, [customDeckAvailable, locale, serverDecks]);
  const opponentDeckOptions = useMemo(() => {
    const localOptions = buildAIOpponentDeckOptions();
    return [{ label: translate(locale, 'deck.localDecks'), options: localOptions }];
  }, [locale]);

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
    if (newDeck && window.matchMedia('(max-width: 1023px)').matches) {
      window.requestAnimationFrame(() =>
        opponentStepRef.current?.scrollIntoView({
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
          block: 'center',
        }),
      );
    }
  };

  const handleOpponentDeckChange = (newDeck: string) => {
    setDeck1Name(newDeck);
    if (newDeck && window.matchMedia('(max-width: 1023px)').matches) {
      window.requestAnimationFrame(() =>
        difficultyStepRef.current?.scrollIntoView({
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
          block: 'center',
        }),
      );
    }
  };

  return (
    <PageShell>
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute left-1/2 top-1/3 h-[50vh] w-[90vh] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[oklch(from_var(--time-day)_l_c_h_/_0.05)] blur-[var(--ambient-glow-blur-md)]" />
        <div className="absolute inset-0 opacity-[0.04] [background-image:var(--pattern-dot)] [background-size:var(--pattern-dot-size)]" />
      </div>

      <AppHeader title={t('lobby.aiBattle')} subtitle="VS. CPU" backTo="/" />

      <main className="relative z-[var(--z-dropdown)] h-full overflow-y-auto px-4 pb-10 pt-20 md:pt-24">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
          {serverDeckError && (
            <Alert tone="danger" role="alert">
              {serverDeckError}
            </Alert>
          )}
          {cardsLoadError && (
            <Alert tone="danger" role="alert">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>{t('game.cardsUnavailable')}</span>
                <Button type="button" variant="secondary" onClick={() => void onRetryCards?.()}>
                  {t('common.retry')}
                </Button>
              </div>
            </Alert>
          )}
          <Step no="01" title={t('lobby.myDeck')}>
            <DeckSelector
              label={t('lobby.myDeck')}
              value={deck0Name}
              options={playerDeckOptions}
              onChange={handlePlayerDeckChange}
            />
          </Step>
          <div ref={opponentStepRef} className="scroll-mt-24">
            <Step no="02" title={t('lobby.opponentDeck')}>
              <DeckSelector
                label={t('lobby.opponentDeck')}
                value={deck1Name}
                options={opponentDeckOptions}
                onChange={handleOpponentDeckChange}
              />
            </Step>
          </div>
          <div ref={difficultyStepRef} className="scroll-mt-24">
            <Step no="03" title={t('lobby.difficulty')}>
              <h2 className="mb-3 font-display text-lg font-bold leading-tight">{t('lobby.difficulty')}</h2>
              <DifficultyButtons onStart={onStartAI} disabled={!canStartAI({ cardsReady, deck0Name, deck1Name })} />
            </Step>
          </div>
        </div>
      </main>
    </PageShell>
  );
}

// 保持既有 API：其他頁面經由此模組使用 navigate 型別（無實際輸出變更）
export type { AILobbyPageProps };
