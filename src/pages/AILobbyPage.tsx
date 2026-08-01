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
  type DeckOptionGroup,
} from '../components/lobby/shared';
import type { AIDifficulty } from '../game/ai';
import { RANDOM_DECK_NAME } from '../game/cards/deckBuilder';
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

function Step({ no, title, children }: { no: string; title: string; children: React.ReactNode }) {
  return (
    <section
      className="min-w-0 rounded-sm bg-surface-elevated/25 p-5 ring-1 ring-border-soft md:p-6"
      aria-label={`${no} ${title}`}
    >
      <div className="mb-3 flex items-center gap-2" aria-hidden="true">
        <span className="font-mono text-caption text-accent-primary/80">{no}</span>
        <span className="text-caption uppercase tracking-[var(--tracking-kicker)] text-content-primary/55">
          {title}
        </span>
      </div>
      {children}
    </section>
  );
}

function selectedDeckLabel(value: string, groups: DeckOptionGroup[]): string | undefined {
  return groups.flatMap((group) => group.options).find((option) => option.id === value)?.name;
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
    const localOptions = buildAIOpponentDeckOptions(customDeckAvailable);
    const serverOptions = buildServerDeckOptions(serverDecks);
    return [
      { label: translate(locale, 'deck.localDecks'), options: localOptions },
      ...(serverOptions.length > 0 ? [{ label: translate(locale, 'deck.serverDecks'), options: serverOptions }] : []),
    ];
  }, [customDeckAvailable, locale, serverDecks]);
  const playerDeckLabel = selectedDeckLabel(deck0Name, playerDeckOptions);
  const effectiveOpponentDeckName = deck1Name || RANDOM_DECK_NAME;
  const opponentDeckLabel = selectedDeckLabel(effectiveOpponentDeckName, opponentDeckOptions);
  const canStart = canStartAI({ cardsReady, deck0Name, deck1Name });

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
      <AppHeader title={t('lobby.aiBattle')} subtitle="VS. CPU" backTo="/" />

      <main className="relative z-[var(--z-dropdown)] h-full overflow-y-auto px-4 pb-8 pt-20 md:px-6 md:pt-24">
        <div className="mx-auto w-full max-w-5xl">
          {serverDeckError && (
            <Alert className="mb-4" tone="danger" role="alert">
              {serverDeckError}
            </Alert>
          )}
          {cardsLoadError && (
            <Alert className="mb-4" tone="danger" role="alert">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>{t('game.cardsUnavailable')}</span>
                <Button type="button" variant="secondary" onClick={() => void onRetryCards?.()}>
                  {t('common.retry')}
                </Button>
              </div>
            </Alert>
          )}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_5rem_minmax(0,1fr)]">
            <Step no="01" title={t('lobby.myDeck')}>
              <DeckSelector
                label={t('lobby.myDeck')}
                value={deck0Name}
                options={playerDeckOptions}
                onChange={handlePlayerDeckChange}
                density="compact"
                showHeader={false}
                scrollable
              />
            </Step>

            <div className="hidden items-center justify-center lg:flex" aria-hidden="true">
              <span className="font-display text-4xl font-bold tracking-[0.12em] text-accent-primary">VS</span>
            </div>

            <div ref={opponentStepRef} className="min-w-0 scroll-mt-24">
              <Step no="02" title={t('lobby.opponentDeck')}>
                <DeckSelector
                  label={t('lobby.opponentDeck')}
                  value={effectiveOpponentDeckName}
                  options={opponentDeckOptions}
                  onChange={handleOpponentDeckChange}
                  density="compact"
                  showHeader={false}
                  scrollable
                />
              </Step>
            </div>

            <section
              ref={difficultyStepRef}
              className="scroll-mt-24 rounded-sm bg-surface-elevated/35 p-5 ring-1 ring-border-soft md:p-6 lg:col-span-3"
              aria-label={`03 ${t('lobby.difficulty')}`}
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-caption text-accent-primary/80">03</span>
                    <span className="text-caption uppercase tracking-[var(--tracking-kicker)] text-content-primary/55">
                      {t('lobby.difficulty')}
                    </span>
                  </div>
                  <div className="mt-4 flex min-w-0 items-center gap-3 border-y border-border-soft py-3">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-content-primary/80">
                      {playerDeckLabel ?? t('lobby.noDeckSelected')}
                    </span>
                    <span className="shrink-0 font-mono text-caption text-accent-primary/80">VS</span>
                    <span className="min-w-0 flex-1 truncate text-right text-sm font-medium text-content-primary/80">
                      {opponentDeckLabel ?? t('lobby.noDeckSelected')}
                    </span>
                  </div>
                </div>
                <div className="w-full lg:max-w-2xl">
                  <DifficultyButtons onStart={onStartAI} disabled={!canStart} layout="row" />
                </div>
              </div>
            </section>
          </div>
        </div>
      </main>
    </PageShell>
  );
}

// 保持既有 API：其他頁面經由此模組使用 navigate 型別（無實際輸出變更）
export type { AILobbyPageProps };
