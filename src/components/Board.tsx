import type { BoardProps } from 'boardgame.io/react';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { getProfile, isLoggedIn, submitMatch } from '../api/client';
import type { CardInstance, ChronosTime, GameState, JankenChoice, PlayerIndex } from '../game/types';
import { getCardDef } from '../game/cards/loader';
import { Card, type CardSize } from './Card';
import { Chronos } from './Chronos';
import { getChronosTime, getMinimumSetCount, getRequiredSetCount } from '../game/GameLogic';
import { saveMatchRecord } from '../game/matchHistory';
import { t } from '../i18n';

const TURN_TIMER_SECONDS = 60;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export type BoardGameOverAction = {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
};

export type BoardGameOverActions = {
  helperText?: string;
  primary: BoardGameOverAction;
  secondary?: BoardGameOverAction;
};

type Props = BoardProps<GameState> & {
  gameOverActions?: BoardGameOverActions;
  // P3-16：線上模式用伺服器權威計時器（G.turnStartTime）；本機/AI 維持客戶端 setInterval。
  useServerTimer?: boolean;
};

type FeedbackTone = 'phase' | 'success' | 'danger' | 'neutral';
type FeedbackMessage = {
  title: string;
  kicker?: string;
  lines?: string[];
  tone?: FeedbackTone;
  actionLabel?: string;
};
type AccountProfile = {
  id: string;
  elo: number;
};
type MatchSubmitResponse = {
  winnerEloChange?: number;
  loserEloChange?: number;
};

function playerName(index: PlayerIndex): string {
  return index === 0 ? t('player.zero') : t('player.one');
}

function jankenMark(choice: JankenChoice | null): string {
  if (choice === 'rock') return '✊';
  if (choice === 'paper') return '✋';
  if (choice === 'scissors') return '✌️';
  return '?';
}

function jankenLabel(choice: JankenChoice): string {
  const labels: Record<JankenChoice, string> = {
    rock: t('board.rock'),
    paper: t('board.paper'),
    scissors: t('board.scissors'),
  };
  return labels[choice];
}

function FeedbackOverlay({ message, onAction }: { message: FeedbackMessage | null; onAction?: () => void }) {
  if (!message) return null;

  return (
    <div
      className={`phase-message-overlay phase-message-${message.tone ?? 'neutral'} pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-lacquer-deep/55 px-4 text-bone backdrop-blur-sm`}
      role="status"
      aria-live="polite"
    >
      <div className="pointer-events-auto min-w-72 max-w-md rounded-sm bg-lacquer p-4 text-center ring-1 ring-bone/10 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)]">
        {message.kicker && (
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.3em] text-gold/70">{message.kicker}</div>
        )}
        <strong className="block font-display text-lg italic text-bone">{message.title}</strong>
        {message.lines?.map((line) => (
          <p key={line} className="mt-2 font-mono text-[10px] uppercase tracking-[0.2em] text-bone/50">
            {line}
          </p>
        ))}
        {message.actionLabel && onAction && (
          <button className={primaryActionClass('mt-4')} type="button" onClick={onAction}>
            {message.actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}

function JankenScreen({ G, moves, playerID }: Props) {
  const me = Number(playerID ?? '0') as PlayerIndex;
  const choice = G.jankenChoices[me];
  const choices: { value: JankenChoice; mark: string }[] = [
    { value: 'rock', mark: '✊' },
    { value: 'paper', mark: '✋' },
    { value: 'scissors', mark: '✌️' },
  ];

  return (
    <div className="relative flex h-screen w-screen items-center justify-center overflow-hidden bg-lacquer-deep px-4 font-sans text-bone">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-1/2 h-[60vh] w-[120vh] -translate-x-1/2 -translate-y-1/2 rounded-full bg-vermilion/8 blur-[120px]" />
      </div>
      <div className="relative z-10 w-full max-w-lg rounded-sm bg-lacquer p-6 text-center ring-1 ring-bone/10">
        <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold/70">{t('board.janken')}</div>
        <h2 className="mt-3 font-display text-3xl italic">{t('board.jankenHint')}</h2>
        {choice ? (
          <p className="mt-4 text-sm leading-relaxed text-bone/60">
            {t('board.youChose')} {jankenLabel(choice)}。{t('board.waitingOpponent')}
          </p>
        ) : (
          <div className="mt-6 grid grid-cols-3 gap-3">
            {choices.map(({ value, mark }) => (
              <button
                key={value}
                className="group flex flex-col items-center gap-3 rounded-sm bg-lacquer-deep/60 px-4 py-5 ring-1 ring-bone/10 transition hover:-translate-y-1 hover:ring-gold/40"
                type="button"
                onClick={() => moves.janken(value)}
              >
                <span className="text-3xl" aria-hidden="true">
                  {mark}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-bone/60 group-hover:text-gold">
                  {jankenLabel(value)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MulliganScreen({
  G,
  moves,
  playerID,
  onMulliganFeedback,
}: Props & {
  onMulliganFeedback: (redrawCount: number) => void;
}) {
  const me = Number(playerID ?? '0') as PlayerIndex;
  const [selected, setSelected] = useState<number[]>([]);
  const done = G.mulliganUsed[me];
  const toggle = (index: number) =>
    setSelected((current) =>
      current.includes(index) ? current.filter((item) => item !== index) : [...current, index],
    );

  return (
    <div className="relative flex h-screen w-screen items-center justify-center overflow-hidden bg-lacquer-deep px-6 font-sans text-bone">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-1/2 h-[60vh] w-[120vh] -translate-x-1/2 -translate-y-1/2 rounded-full bg-vermilion/8 blur-[120px]" />
      </div>
      <div className="relative z-10 flex w-full max-w-5xl flex-col items-center rounded-sm bg-lacquer p-6 ring-1 ring-bone/10">
        <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold/70">{t('board.mulligan')}</div>
        <h2 className="mt-3 text-center font-display text-3xl italic">{t('board.mulliganHint')}</h2>
        <div className="mt-6 flex w-full justify-center gap-3 overflow-x-auto pb-4">
          {G.players[me].hand.map((card, index) => (
            <button
              key={card.instanceId}
              className={`shrink-0 rounded-sm bg-lacquer-deep/60 p-1 ring-1 ring-bone/10 transition hover:-translate-y-2 hover:ring-gold/40 disabled:cursor-not-allowed disabled:opacity-50 ${
                selected.includes(index) ? 'ring-2 ring-gold shadow-[0_20px_40px_-10px] shadow-gold/30' : ''
              }`}
              type="button"
              disabled={done}
              onClick={() => toggle(index)}
            >
              <Card card={card} size="small" selected={selected.includes(index)} showPopover />
            </button>
          ))}
        </div>
        {done ? (
          <p className="mt-2 text-sm text-bone/60">
            {t('board.handConfirmed')}。{t('board.waitingOpponent')}
          </p>
        ) : (
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            <button
              className={primaryActionClass()}
              type="button"
              onClick={() => {
                onMulliganFeedback(selected.length);
                moves.mulligan(selected);
              }}
            >
              {t('board.redraw')} {selected.length} {t('board.cardsUnit')}
            </button>
            <button
              className={secondaryActionClass()}
              type="button"
              onClick={() => {
                onMulliganFeedback(0);
                moves.keepHand();
              }}
            >
              {t('board.keepHand')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function translateGameOverReason(reason: string | null): string {
  if (!reason) return t('board.reason');
  if (reason.includes('simultaneous overdraw')) return t('board.reasonBothDeckEmpty');
  if (reason.includes('not enough cards')) return t('board.reasonDeckEmpty');
  if (reason.includes('effect attempted to draw')) return t('board.reasonEffectDraw');
  if (reason.includes('0 HP')) return t('board.reasonHpZero');
  return t('board.reason');
}

function normalizeWinner(G: GameState, gameover?: { winner?: string | number; draw?: boolean }): PlayerIndex | null {
  if (gameover?.draw) return null;
  const winner = gameover?.winner ?? G.winner;
  if (winner === 0 || winner === '0') return 0;
  if (winner === 1 || winner === '1') return 1;
  return G.winner;
}

function activeAccountPlayer(playerID: Props['playerID']): PlayerIndex | null {
  if (playerID !== '0' && playerID !== '1') return 0;
  const player = Number(playerID) as PlayerIndex;
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/play/online/')) return player;
  return player === 0 ? 0 : null;
}

function accountIdForPlayer(player: PlayerIndex, accountPlayer: PlayerIndex, profile: AccountProfile): string {
  return player === accountPlayer ? profile.id : `guest-player-${player}`;
}

function matchSubmissionKey(G: GameState, winner: PlayerIndex | null): string {
  const firstEntry = G.actionLog?.[0];
  const lastEntry = G.actionLog?.[G.actionLog.length - 1];
  const path = typeof window === 'undefined' ? 'server' : window.location.pathname;
  return [
    'zutomayo-match-submit',
    path,
    winner ?? 'draw',
    G.turnNumber,
    G.gameoverReason ?? '',
    G.actionLog?.length ?? 0,
    firstEntry?.timestamp ?? '',
    lastEntry?.timestamp ?? '',
    lastEntry?.action ?? '',
  ].join(':');
}

function isAlreadySubmitted(key: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function markSubmitted(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(key, '1');
  } catch {
    // Submission still proceeds; the in-memory ref prevents same-mount duplicates.
  }
}

function signedChange(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

function primaryActionClass(extra = ''): string {
  return [
    'bg-bone px-5 py-2.5 text-[10px] font-medium uppercase tracking-[0.3em] text-lacquer transition',
    'hover:bg-gold disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-bone',
    extra,
  ]
    .filter(Boolean)
    .join(' ');
}

function secondaryActionClass(extra = ''): string {
  return [
    'border border-bone/20 px-5 py-2 text-[10px] uppercase tracking-[0.3em] text-bone/60 transition',
    'hover:border-gold/40 hover:bg-bone/5 hover:text-bone disabled:cursor-not-allowed disabled:opacity-40',
    extra,
  ]
    .filter(Boolean)
    .join(' ');
}

function gameOverActionClass(action: BoardGameOverAction): string {
  return action.variant === 'secondary' ? secondaryActionClass() : primaryActionClass();
}

function GameOverScreen({ G, ctx, matchStartedAt, playerID, gameOverActions }: Props & { matchStartedAt: number }) {
  const saved = useRef(false);
  const [eloNotice, setEloNotice] = useState('');

  useEffect(() => {
    if (saved.current) return;
    saved.current = true;
    const gameover = ctx.gameover as { winner?: string | number; draw?: boolean } | undefined;
    const durationSeconds = (Date.now() - matchStartedAt) / 1000;
    const winner = normalizeWinner(G, gameover);
    const submitKey = matchSubmissionKey(G, winner);
    if (isAlreadySubmitted(submitKey)) return;
    markSubmitted(submitKey);
    saveMatchRecord(G, gameover?.winner ?? winner, durationSeconds);

    const accountPlayer = activeAccountPlayer(playerID);
    if (!isLoggedIn() || winner === null || accountPlayer === null) return;

    const loser = (1 - winner) as PlayerIndex;
    getProfile()
      .then((profile: AccountProfile) => {
        const winnerId = accountIdForPlayer(winner, accountPlayer, profile);
        const loserId = accountIdForPlayer(loser, accountPlayer, profile);
        return submitMatch(
          winnerId,
          loserId,
          G.turnNumber,
          durationSeconds,
          G.actionLog,
        ) as Promise<MatchSubmitResponse>;
      })
      .then((result) => {
        if ((result.winnerEloChange ?? 0) === 0 && (result.loserEloChange ?? 0) === 0) {
          setEloNotice(t('auth.matchSubmittedNoElo'));
          return;
        }
        const change = winner === accountPlayer ? (result.winnerEloChange ?? 0) : (result.loserEloChange ?? 0);
        setEloNotice(`${t('auth.eloChange')} ${signedChange(change)}`);
      })
      .catch(() => {
        // Local history above remains the fallback when the API is unavailable.
        setEloNotice(t('auth.matchSubmitFailed'));
      });
  }, [G, ctx.gameover, matchStartedAt, playerID]);

  return (
    <div className="relative flex h-screen w-screen items-center justify-center overflow-hidden bg-lacquer-deep px-4 font-sans text-bone">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-1/2 h-[60vh] w-[120vh] -translate-x-1/2 -translate-y-1/2 rounded-full bg-vermilion/8 blur-[120px]" />
      </div>
      <div className="relative z-10 w-full max-w-lg rounded-sm bg-lacquer p-6 text-center ring-1 ring-bone/10">
        <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold/70">{t('board.gameOver')}</div>
        <h1 className="mt-3 font-display text-4xl italic">
          {G.winner === null ? t('board.draw') : `${playerName(G.winner)} ${t('board.playerWins')}`}
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-bone/60">{translateGameOverReason(G.gameoverReason)}</p>
        {eloNotice && <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.3em] text-gold/70">{eloNotice}</p>}
        {ctx.gameover &&
          (gameOverActions ? (
            <div className="mt-6 flex flex-col items-center gap-3">
              {gameOverActions.helperText && <p className="text-xs text-bone/45">{gameOverActions.helperText}</p>}
              <button
                className={gameOverActionClass(gameOverActions.primary)}
                type="button"
                onClick={gameOverActions.primary.onClick}
              >
                {gameOverActions.primary.label}
              </button>
              {gameOverActions.secondary && (
                <button
                  className={gameOverActionClass(gameOverActions.secondary)}
                  type="button"
                  onClick={gameOverActions.secondary.onClick}
                >
                  {gameOverActions.secondary.label}
                </button>
              )}
            </div>
          ) : (
            <button className={primaryActionClass('mt-6')} type="button" onClick={() => window.location.reload()}>
              {t('board.playAgain')}
            </button>
          ))}
      </div>
    </div>
  );
}

function powerTotal(G: GameState, player: PlayerIndex): number {
  return G.players[player].powerCharger.reduce((sum, card) => sum + (getCardDef(card.defId)?.sendToPower ?? 0), 0);
}

function hpClass(hp: number): string {
  if (hp <= 25) return 'danger';
  if (hp <= 50) return 'warning';
  return 'healthy';
}

type FocusedCard = { card: CardInstance; owner: PlayerIndex; zone: string } | null;

function cardDefinition(card: CardInstance | null) {
  return card?.faceUp ? getCardDef(card.defId) : undefined;
}

function actionTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function LpBar({ hp, tone }: { hp: number; tone: 'gold' | 'vermilion' }) {
  const hpPercent = Math.max(0, Math.min(100, hp));
  return (
    <div className="relative h-1 w-full bg-bone/10" aria-hidden="true">
      <div
        className={`absolute inset-y-0 left-0 ${tone === 'gold' ? 'bg-gold' : 'bg-vermilion'}`}
        style={{ width: `${hpPercent}%` }}
      />
    </div>
  );
}

function FieldZone({
  label,
  shortLabel,
  className,
  card,
  onClick,
  size = 'small',
  activeTime,
  owner,
  onFocusCard,
}: {
  label: string;
  shortLabel?: string;
  className: string;
  card: CardInstance | null;
  onClick?: () => void;
  size?: CardSize;
  activeTime?: ChronosTime;
  owner?: PlayerIndex;
  onFocusCard?: (focus: FocusedCard) => void;
}) {
  const focus = card && owner !== undefined ? { card, owner, zone: label } : null;
  const content = (
    <>
      <span className="absolute left-2 top-1.5 z-10 font-mono text-[8px] uppercase tracking-[0.2em] text-bone/25">
        {label}
      </span>
      {card ? (
        <div
          className="flex h-full w-full items-center justify-center pt-3"
          onMouseEnter={() => onFocusCard?.(focus)}
          onFocus={() => onFocusCard?.(focus)}
        >
          <Card card={card} size={size} activeTime={activeTime} showPopover />
        </div>
      ) : (
        <span className="font-display text-xl italic text-bone/20">{shortLabel ?? label}</span>
      )}
    </>
  );
  const slotClass = [
    'zone',
    `zone-${size}`,
    className,
    'relative flex size-[88px] shrink-0 items-center justify-center rounded-sm bg-lacquer-deep/60 ring-1 ring-bone/5',
    'shadow-[inset_0_2px_6px_rgba(0,0,0,0.5)] transition hover:ring-gold/30',
    onClick ? 'cursor-pointer' : '',
  ]
    .filter(Boolean)
    .join(' ');

  if (onClick) {
    return (
      <button
        className={slotClass}
        type="button"
        onClick={onClick}
        onMouseEnter={() => onFocusCard?.(focus)}
        onFocus={() => onFocusCard?.(focus)}
      >
        {content}
      </button>
    );
  }

  return (
    <div className={slotClass} onMouseEnter={() => onFocusCard?.(focus)} onFocus={() => onFocusCard?.(focus)}>
      {content}
    </div>
  );
}

function StackZone({
  kind,
  label,
  value,
  cards,
}: {
  kind: 'deck' | 'power';
  label: string;
  value: number;
  cards?: CardInstance[];
}) {
  if (kind === 'deck') {
    return (
      <div className="flex flex-col items-center gap-2" aria-label={`${label}: ${value}`}>
        <div className="flex h-16 w-11 items-center justify-center rounded-xs bg-lacquer ring-1 ring-bone/10" aria-hidden="true">
          <div className="font-display text-sm italic text-gold/60">ZC</div>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-bone/40" aria-hidden="true">
          {label} {value}
        </span>
      </div>
    );
  }

  if (cards && cards.length > 0) {
    return (
      <div className="relative flex min-w-24 flex-col gap-2" aria-label={`${label}: ${value}`}>
        <div className="relative h-16" aria-hidden="true">
          {cards.map((card, i) => {
            const def = getCardDef(card.defId);
            return (
              <div
                key={card.instanceId}
                className="absolute top-0 h-16 w-11 overflow-hidden rounded-xs bg-lacquer-deep ring-1 ring-bone/10"
                style={{ left: `${i * 12}px` }}
              >
                {def?.image && (
                  <img
                    className="h-full w-full object-cover opacity-70"
                    src={def.image}
                    alt={def.name}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                )}
              </div>
            );
          })}
        </div>
        <strong className="font-mono text-[10px] uppercase tracking-[0.25em] text-gold/70">
          {label} {value}
        </strong>
      </div>
    );
  }

  return (
    <div className="flex min-w-24 flex-col gap-2 rounded-sm bg-lacquer-deep/50 p-3 ring-1 ring-bone/5" aria-label={`${label}: ${value}`}>
      <strong className="font-mono text-[10px] uppercase tracking-[0.25em] text-bone/45">
        <span>{label}</span>
      </strong>
      <span className="font-display text-2xl italic text-gold/70">{value}</span>
    </div>
  );
}

function OpponentStatsBar({
  G,
  opponentIndex,
  damageAmount,
}: {
  G: GameState;
  opponentIndex: PlayerIndex;
  damageAmount?: number;
}) {
  const opponent = G.players[opponentIndex];

  return (
    <section
      className={`relative flex items-end justify-between gap-6 border-b border-bone/5 pb-3 ${damageAmount ? 'damaged' : ''}`}
      aria-label={t('player.opponent')}
    >
      <div className="min-w-52 flex-1">
        <strong className="font-display text-xl italic text-bone">{playerName(opponentIndex)}</strong>
        <div className="mt-2 max-w-sm">
          <LpBar hp={opponent.hp} tone="vermilion" />
        </div>
        <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.25em] text-bone/40">
          {t('board.hp')} {opponent.hp}/100 · {t('board.hand')} {opponent.hand.length} · {t('board.deck')}{' '}
          {opponent.deck.length}
        </div>
      </div>
      <div className="flex items-end gap-2" aria-label={t('board.hand')}>
        {opponent.hand.map((card, index) => (
          <div
            key={card.instanceId}
            className="h-12 w-9 rounded-xs bg-lacquer ring-1 ring-bone/10 shadow-[0_12px_30px_-18px_rgba(0,0,0,0.9)]"
            style={{ transform: `translateY(${Math.abs(index - (opponent.hand.length - 1) / 2) * 2}px)` }}
          >
            <div className="flex h-full w-full items-center justify-center font-display text-[10px] italic text-gold/40">
              ZC
            </div>
          </div>
        ))}
      </div>
      {damageAmount ? (
        <span
          className="damage-float absolute right-0 top-0 font-display text-3xl italic text-vermilion"
          key={`opp-${damageAmount}`}
        >
          -{damageAmount}
        </span>
      ) : null}
    </section>
  );
}

function BottomZones({
  G,
  meIndex,
  moves,
  damageAmount,
  onFocusCard,
}: {
  G: GameState;
  meIndex: PlayerIndex;
  moves: Props['moves'];
  damageAmount?: number;
  onFocusCard?: (focus: FocusedCard) => void;
}) {
  const me = G.players[meIndex];

  return (
    <section className="relative flex items-center justify-between gap-4 border-t border-bone/5 pt-3" aria-label={t('player.me')}>
      <div className="min-w-52">
        <strong className="font-display text-xl italic text-bone">{playerName(meIndex)}</strong>
        <div className="mt-2">
          <LpBar hp={me.hp} tone="gold" />
        </div>
        <div className={`mt-2 font-mono text-[10px] uppercase tracking-[0.25em] text-bone/40 ${hpClass(me.hp)}`}>
          {t('board.hp')} {me.hp}/100 · {t('board.deck')} {me.deck.length} · {t('board.powerCharger')}{' '}
          {powerTotal(G, meIndex)} · {t('board.abyss')} {me.abyss.length}
        </div>
      </div>
      <div className="flex items-center justify-center gap-3">
        <StackZone kind="power" label={t('board.powerCharger')} value={powerTotal(G, meIndex)} cards={me.powerCharger} />
        <FieldZone
          label={t('board.setZoneA')}
          shortLabel="A"
          className="set-zone set-zone-a"
          card={me.setZoneA}
          onClick={me.setZoneA && !G.ready[meIndex] ? () => moves.undoSetCard('A') : undefined}
          size="normal"
          owner={meIndex}
          onFocusCard={onFocusCard}
        />
        <FieldZone
          label={t('board.setZoneB')}
          shortLabel="B"
          className="set-zone set-zone-b"
          card={me.setZoneB}
          onClick={me.setZoneB && !G.ready[meIndex] ? () => moves.undoSetCard('B') : undefined}
          size="normal"
          owner={meIndex}
          onFocusCard={onFocusCard}
        />
        <FieldZone
          label={t('board.areaEnchant')}
          shortLabel="C"
          className="area-zone area-zone-c"
          card={me.setZoneC}
          size="normal"
          owner={meIndex}
          onFocusCard={onFocusCard}
        />
        <StackZone kind="deck" label={t('board.deckZone')} value={me.deck.length} />
      </div>
      {damageAmount ? (
        <span
          className="damage-float absolute left-0 top-2 font-display text-3xl italic text-vermilion"
          key={`me-${damageAmount}`}
        >
          -{damageAmount}
        </span>
      ) : null}
    </section>
  );
}

function CentralArena({
  G,
  meIndex,
  opponentIndex,
  time,
  onFocusCard,
}: {
  G: GameState;
  meIndex: PlayerIndex;
  opponentIndex: PlayerIndex;
  time: ChronosTime;
  onFocusCard?: (focus: FocusedCard) => void;
}) {
  const me = G.players[meIndex];
  const opponent = G.players[opponentIndex];

  return (
    <section className="flex min-h-0 flex-1 items-center justify-center" aria-label={t('chronos.title')}>
      <div className="grid w-full max-w-3xl grid-rows-[88px_minmax(180px,1fr)_88px] items-center justify-items-center gap-4">
        <div className="opp-battle-slot">
          <FieldZone
            label={`${t('player.opponent')} ${t('board.battleZone')}`}
            shortLabel={t('board.battleZoneShort')}
            className="battle-zone central-battle-zone opponent-battle-zone"
            card={opponent.battleZone}
            size="normal"
            activeTime={time}
            owner={opponentIndex}
            onFocusCard={onFocusCard}
          />
        </div>
        <Chronos
          chronos={G.chronos}
          currentTime={time}
          nightSidePlayer={G.chronos.nightSidePlayer}
          currentPlayer={meIndex}
        />
        <div className="my-battle-slot">
          <FieldZone
            label={`${t('player.me')} ${t('board.battleZone')}`}
            shortLabel={t('board.battleZoneShort')}
            className="battle-zone central-battle-zone player-battle-zone"
            card={me.battleZone}
            size="normal"
            activeTime={time}
            owner={meIndex}
            onFocusCard={onFocusCard}
          />
        </div>
      </div>
    </section>
  );
}

function HandDrawer({
  cards,
  owner,
  onCardClick,
  onFocusCard,
  children,
}: {
  cards: CardInstance[];
  owner: PlayerIndex;
  expanded: boolean;
  onToggle: () => void;
  onCardClick?: (index: number) => void;
  onFocusCard?: (focus: FocusedCard) => void;
  children?: ReactNode;
}) {
  const center = (cards.length - 1) / 2;
  return (
    <section className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex items-end justify-between gap-4 px-6 pb-4" aria-label={t('board.hand')}>
      <div className="pointer-events-auto min-w-48">{children}</div>
      <div className="pointer-events-auto flex min-h-44 flex-1 items-end justify-center overflow-visible">
        <div className="flex items-end justify-center">
          {cards.map((card, index) => {
            const rotate = (index - center) * 4;
            const translateY = Math.abs(index - center) * 6;
            const fanStyle = {
              '--hand-rotate': `${rotate}deg`,
              '--hand-y': `${translateY}px`,
            } as CSSProperties;
            return (
              <div
                key={card.instanceId}
                className="-mx-2 h-36 w-24 shrink-0 rounded-sm bg-gradient-to-b from-bone/10 to-lacquer-deep p-0.5 ring-1 ring-bone/10 transition duration-200 [transform:rotate(var(--hand-rotate))_translateY(var(--hand-y))] hover:z-20 hover:ring-gold/60 hover:[transform:translateY(-1.5rem)_rotate(0deg)] focus-within:z-20 focus-within:ring-gold/60 focus-within:[transform:translateY(-1.5rem)_rotate(0deg)]"
                style={fanStyle}
                onMouseEnter={() => onFocusCard?.({ card, owner, zone: t('board.hand') })}
                onFocus={() => onFocusCard?.({ card, owner, zone: t('board.hand') })}
              >
                <Card
                  card={card}
                  size="normal"
                  className="hand-card !h-full !w-full"
                  showBadges={false}
                  showPopover
                  onClick={onCardClick ? () => onCardClick(index) : undefined}
                />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function ActionsBar({
  ready,
  canConfirm,
  cardsSet,
  required,
  onConfirm,
}: {
  ready: boolean;
  canConfirm: boolean;
  cardsSet: number;
  required: number;
  onConfirm: () => void;
}) {
  return (
    <section className="actions-bar flex flex-col items-start gap-2">
      <button className={primaryActionClass()} disabled={!canConfirm} type="button" onClick={onConfirm}>
        {ready ? t('board.readyWaiting') : `${t('board.confirmSet')} (${cardsSet}/${required})`}
      </button>
    </section>
  );
}

function battleFeedback(G: GameState, meIndex: PlayerIndex, opponentIndex: PlayerIndex): FeedbackMessage {
  const result = G.lastBattleResult;
  if (result.winner === null) {
    return {
      title: t('board.battleDrawTitle'),
      lines: [t('board.noBattleDamage')],
      tone: 'neutral',
    };
  }

  if (result.winner === meIndex) {
    return {
      title: t('board.youWinBattle'),
      lines: [
        `${t('board.dealtDamage')} ${result.damage} ${t('board.damagePointSuffix')}`,
        `${t('board.opponentHp')}: ${G.players[opponentIndex].hp}`,
      ],
      tone: 'success',
    };
  }

  return {
    title: t('board.youLoseBattle'),
    lines: [
      `${t('board.receivedDamage')} ${result.damage} ${t('board.damagePointSuffix')}`,
      `${t('board.yourHp')}: ${G.players[meIndex].hp}`,
    ],
    tone: 'danger',
  };
}

function effectSummary(effect: GameState['pendingEffects'][number][number]): string {
  const action = effect.effect.action;
  const value = action.params.value ?? action.params.count ?? action.params.max;
  return value === undefined ? action.type : `${action.type} ${value}`;
}

function latestTraceMessage(G: GameState): string | null {
  const latest = [...(G.actionLog ?? [])].reverse().find((entry) => entry.result?.message || entry.action);
  if (!latest) return null;
  const message = latest.result?.message;
  const hp = latest.hp ? `${t('board.phaseHp')} ${latest.hp[0]}/${latest.hp[1]}` : null;
  const chronos =
    typeof latest.chronosPosition === 'number' ? `${t('board.phaseChronos')} ${latest.chronosPosition}/12` : null;
  return [message ?? latest.action, hp, chronos].filter(Boolean).join(' · ');
}

function choiceInstruction(type: string): string {
  if (type === 'handToDeckBottomThenDraw') return t('board.choiceHintDeckBottomDraw');
  if (type === 'reorderOpponentDeckTop') return t('board.choiceHintReorder');
  if (type === 'opponentPowerCharacterSwap') return t('board.choiceHintSwap');
  if (type === 'abyssToDeckBottomOrLose') return t('board.choiceHintAbyss');
  if (type.includes('Hand') || type.includes('hand')) return t('board.choiceHintHand');
  return t('board.choiceHintDefault');
}

function phaseInstruction(
  G: GameState,
  meIndex: PlayerIndex,
  required: number,
  minimum: number,
): { title: string; body: string; meta: string[] } {
  const me = G.players[meIndex];
  if (G.pendingChoice) {
    const mine = G.pendingChoice.player === meIndex;
    return {
      title: mine ? t('board.phaseChoiceTitle') : t('board.phaseChoiceWaitingTitle'),
      body: mine
        ? choiceInstruction(G.pendingChoice.type)
        : `${playerName(G.pendingChoice.player)} ${t('board.phaseChoosing')}`,
      meta: [`${t('board.choiceCount')} ${G.pendingChoice.min}-${G.pendingChoice.max}`],
    };
  }
  if (G.step === 'effectOrder') {
    const player = G.pendingEffectPlayer;
    const pendingCount = player === null ? 0 : G.pendingEffects[player].length;
    return {
      title: player === meIndex ? t('board.phaseEffectTitle') : t('board.phaseEffectWaitingTitle'),
      body:
        player === meIndex
          ? t('board.phaseEffectBody')
          : player === null
            ? t('board.phaseEffectResolving')
            : `${playerName(player)} ${t('board.phaseResolvingEffects')}`,
      meta: [`${t('board.phasePendingEffects')} ${pendingCount}`],
    };
  }
  if (G.step === 'initialSet') {
    return {
      title: t('board.phaseInitialSetTitle'),
      body: G.ready[meIndex] ? t('board.phaseWaitingOpponentReady') : t('board.phaseInitialSetBody'),
      meta: [`${t('board.phaseSetCount')} ${me.cardsSetThisTurn}/1`],
    };
  }
  if (G.step === 'turnSet') {
    return {
      title: G.ready[meIndex] ? t('board.phaseWaitingTitle') : t('board.phaseTurnSetTitle'),
      body: G.ready[meIndex] ? t('board.phaseWaitingOpponentReady') : t('board.phaseTurnSetBody'),
      meta: [`${t('board.phaseSetCount')} ${me.cardsSetThisTurn}/${required}`, `${t('board.phaseMinimum')} ${minimum}`],
    };
  }
  return { title: t('board.gameOver'), body: t('online.gameOverHelper'), meta: [] };
}

function PhaseInstructionBar({
  G,
  meIndex,
  required,
  minimum,
}: {
  G: GameState;
  meIndex: PlayerIndex;
  required: number;
  minimum: number;
}) {
  const instruction = phaseInstruction(G, meIndex, required, minimum);
  const trace = latestTraceMessage(G);
  const phases = [
    { label: 'Draw', active: false },
    { label: 'Prep', active: G.step === 'initialSet' || G.step === 'turnSet' },
    { label: 'Main', active: G.step === 'effectOrder' || !!G.pendingChoice },
    { label: 'Battle', active: Boolean(G.lastBattleResult?.damage) },
    { label: 'End', active: G.step === 'gameOver' },
  ];
  return (
    <section className="border-y border-bone/5 py-2" aria-live="polite">
      <div className="flex items-center justify-center gap-8 font-mono text-[10px] uppercase tracking-[0.3em]">
        {phases.map((phase) => (
          <span key={phase.label} className={phase.active ? 'text-gold' : 'text-bone/20'}>
            {phase.label}
          </span>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between gap-4 text-xs text-bone/45">
        <div>
          <strong className="font-display text-base italic text-bone/80">{instruction.title}</strong>
          <p className="mt-0.5">{instruction.body}</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-bone/35">
          {instruction.meta.map((item) => (
            <span key={item}>{item}</span>
          ))}
          {trace && <span className="max-w-96 truncate text-gold/50">{trace}</span>}
        </div>
      </div>
    </section>
  );
}

function EffectOrderPanel({
  G,
  moves,
  playerID,
}: {
  G: GameState;
  moves: Props['moves'];
  playerID: Props['playerID'];
}) {
  const meIndex = Number(playerID ?? '0') as PlayerIndex;
  const currentPlayer = G.pendingEffectPlayer;
  if (currentPlayer === null) return null;

  const isCurrentPlayer = currentPlayer === meIndex;
  const pending = G.pendingEffects[currentPlayer];

  return (
    <section className="effect-order-panel" aria-label={t('board.effectOrder')}>
      <div className="effect-order-heading">
        <strong>{isCurrentPlayer ? t('board.chooseEffect') : t('board.waitingEffectPlayer')}</strong>
        <span>{playerName(currentPlayer)}</span>
      </div>
      {isCurrentPlayer ? (
        <div className="effect-order-list">
          {pending.map((effect, index) => {
            const card = getCardDef(effect.cardDefId);
            return (
              <button
                key={effect.id}
                className="effect-order-item"
                type="button"
                onClick={() => moves.resolvePendingEffect(index)}
              >
                <span className="effect-order-card">{card?.name ?? effect.cardDefId}</span>
                <span className="effect-order-text">{effect.rawText || effectSummary(effect)}</span>
                <span className="effect-order-action">{effectSummary(effect)}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <p>{t('board.waitingOpponent')}</p>
      )}
    </section>
  );
}

function PendingChoicePanel({
  G,
  moves,
  playerID,
}: {
  G: GameState;
  moves: Props['moves'];
  playerID: Props['playerID'];
}) {
  const choice = G.pendingChoice;
  const meIndex = Number(playerID ?? '0') as PlayerIndex;
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    setSelected([]);
  }, [choice?.id]);

  if (!choice) return null;

  const isCurrentPlayer = choice.player === meIndex;
  const canSubmit = selected.length >= choice.min && selected.length <= choice.max;
  const toggle = (optionId: string) => {
    setSelected((current) => {
      if (current.includes(optionId)) return current.filter((item) => item !== optionId);
      if (current.length >= choice.max) return current;
      return [...current, optionId];
    });
  };

  return (
    <section className="effect-order-panel pending-choice-panel" aria-label={t('board.pendingChoice')}>
      <div className="effect-order-heading">
        <strong>{isCurrentPlayer ? t('board.chooseCards') : t('board.waitingChoicePlayer')}</strong>
        <span>{playerName(choice.player)}</span>
      </div>
      {isCurrentPlayer ? (
        <>
          <p>{choice.prompt || choiceInstruction(choice.type)}</p>
          <p className="pending-choice-range">
            {t('board.choiceCount')} {selected.length}/{choice.max} · {t('board.phaseMinimum')} {choice.min}
          </p>
          <div className="effect-order-list">
            {choice.options.map((option) => {
              const isSelected = selected.includes(option.id);
              const order = selected.indexOf(option.id) + 1;
              return (
                <button
                  key={option.id}
                  className={`effect-order-item pending-choice-option ${isSelected ? 'selected' : ''}`}
                  type="button"
                  onClick={() => toggle(option.id)}
                >
                  <span className="effect-order-card">{option.label}</span>
                  <span className="effect-order-action">
                    {isSelected && choice.type === 'reorderOpponentDeckTop'
                      ? `#${order}`
                      : isSelected
                        ? t('common.selected')
                        : t('common.select')}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="pending-choice-footer">
            <span>
              {t('board.choiceCount')} {selected.length}/{choice.max}
            </span>
            <button
              className="primary-action"
              type="button"
              disabled={!canSubmit}
              onClick={() => moves.submitPendingChoice(selected)}
            >
              {t('board.submitChoice')}
            </button>
          </div>
        </>
      ) : (
        <p>{t('board.waitingOpponent')}</p>
      )}
    </section>
  );
}

function FocusPanel({ focus }: { focus: FocusedCard }) {
  const def = cardDefinition(focus?.card ?? null);
  return (
    <section className="rounded-sm bg-lacquer p-4 ring-1 ring-bone/10">
      <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold/70">Focus</div>
      {focus && def ? (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-[0.25em] text-bone/35">
            {playerName(focus.owner)} · {focus.zone}
          </div>
          <h2 className="mt-1 font-display text-xl italic text-bone">{def.name}</h2>
          <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-[10px] uppercase tracking-[0.15em] text-bone/45">
            <span>
              {t('card.energy')} <span className="text-gold">{def.powerCost}</span>
            </span>
            <span>
              {t('card.clock')} <span className="text-gold">{def.clock}</span>
            </span>
            {def.attack && (
              <>
                <span>
                  {t('card.night')} <span className="text-gold">{def.attack.night}</span>
                </span>
                <span>
                  {t('card.day')} <span className="text-gold">{def.attack.day}</span>
                </span>
              </>
            )}
          </div>
          {def.effect && <p className="mt-4 text-xs leading-relaxed text-bone/60">{def.effect}</p>}
        </div>
      ) : (
        <div className="mt-8 rounded-sm bg-lacquer-deep/50 p-4 text-center font-mono text-[10px] uppercase tracking-[0.25em] text-bone/25 ring-1 ring-bone/5">
          {t('card.unknown')}
        </div>
      )}
    </section>
  );
}

function BattleLogPanel({ G }: { G: GameState }) {
  const entries = (G.actionLog ?? []).slice(-14).reverse();
  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-sm bg-lacquer/60 p-4 ring-1 ring-bone/10">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold/70">Ritual Log</span>
        <span className="size-1.5 animate-pulse rounded-full bg-vermilion" />
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto font-mono text-[10px] leading-relaxed text-bone/40">
        {entries.map((entry) => (
          <p key={`${entry.id ?? entry.timestamp}-${entry.action}`}>
            <span className="text-bone/60">[{actionTime(entry.timestamp)}]</span>{' '}
            <span className="text-gold/50">{t('board.turn')} {entry.turn}</span> {entry.result?.message ?? entry.action}
          </p>
        ))}
        {entries.length === 0 && <p className="text-bone/30">{t('board.waitingOpponent')}</p>}
      </div>
    </section>
  );
}

function BattleBoard({ G, moves, playerID, useServerTimer = false }: Props) {
  const meIndex = Number(playerID ?? '0') as PlayerIndex;
  const opponentIndex = (1 - meIndex) as PlayerIndex;
  const me = G.players[meIndex];
  const minimum = getMinimumSetCount(G, meIndex);
  const required = getRequiredSetCount(G, meIndex);
  const [timeLeft, setTimeLeft] = useState(TURN_TIMER_SECONDS);
  // P3-16：伺服器權威計時器超時後，每秒遞增 retryTick 以重試 timeoutSkip（處理時鐘漂移）。
  const [retryTick, setRetryTick] = useState(0);
  const [handExpanded, setHandExpanded] = useState(true);
  const [phaseMessage, setPhaseMessage] = useState<FeedbackMessage | null>(null);
  const [focusedCard, setFocusedCard] = useState<FocusedCard>(null);
  const [damageFlash, setDamageFlash] = useState<{ target: PlayerIndex; amount: number; id: number } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const phaseTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const previousTurnNumber = useRef(G.turnNumber);

  const clearPhaseTimers = () => {
    for (const phaseTimer of phaseTimers.current) clearTimeout(phaseTimer);
    phaseTimers.current = [];
  };

  const showTransientPhaseMessage = (message: FeedbackMessage, duration = 1500) => {
    clearPhaseTimers();
    setPhaseMessage(message);
    const effectiveDuration = prefersReducedMotion() ? Math.min(duration, 600) : duration;
    phaseTimers.current.push(setTimeout(() => setPhaseMessage(null), effectiveDuration));
  };

  const playBattleFeedbackSequence = (resultMessage: FeedbackMessage) => {
    clearPhaseTimers();
    const reduced = prefersReducedMotion();
    const phaseDuration = reduced ? 250 : 700;
    const resultDuration = reduced ? 1200 : 2600;
    const sequence: { message: FeedbackMessage; duration: number }[] = [
      { message: { title: t('board.phaseReveal'), tone: 'phase' }, duration: phaseDuration },
      { message: { title: t('board.phaseTimeAdvance'), tone: 'phase' }, duration: phaseDuration },
      { message: { title: t('board.phaseBattleStart'), tone: 'phase' }, duration: phaseDuration },
      { message: resultMessage, duration: resultDuration },
    ];

    let offset = 0;
    for (const item of sequence) {
      phaseTimers.current.push(setTimeout(() => setPhaseMessage(item.message), offset));
      offset += item.duration;
    }
    phaseTimers.current.push(setTimeout(() => setPhaseMessage(null), offset));
  };

  useEffect(() => () => clearPhaseTimers(), []);

  useEffect(() => {
    if (useServerTimer) {
      // P3-16：伺服器權威計時器。根據 G.turnStartTime 計算剩餘秒數，避免兩端 setInterval 漂移。
      const compute = () => {
        if (typeof G.turnStartTime !== 'number') return TURN_TIMER_SECONDS;
        const elapsed = Math.floor((Date.now() - G.turnStartTime) / 1000);
        return Math.max(0, TURN_TIMER_SECONDS - elapsed);
      };
      setTimeLeft(compute());
      if (G.step !== 'turnSet') return;
      timer.current = setInterval(() => {
        const next = compute();
        setTimeLeft(next);
        // 超時後持續 tick，讓超時 effect 重試 timeoutSkip 直到伺服器確認。
        if (next === 0) setRetryTick((tick) => tick + 1);
      }, 1000);
      return () => {
        if (timer.current) clearInterval(timer.current);
      };
    }
    // 本機/AI：維持原客戶端 setInterval 倒數行為。
    setTimeLeft(TURN_TIMER_SECONDS);
    if (timer.current) clearInterval(timer.current);
    if (G.step !== 'turnSet') return;
    timer.current = setInterval(() => setTimeLeft((value) => Math.max(0, value - 1)), 1000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [G.turnNumber, G.step, G.turnStartTime, useServerTimer]);

  useEffect(() => {
    if (G.step !== 'turnSet' || timeLeft > 0 || G.ready[meIndex]) return;
    if (useServerTimer) {
      // P3-16：線上模式超時由伺服器權威 timeoutSkip 處理，允許未達最低出牌數時跳過該玩家回合。
      moves.timeoutSkip();
      return;
    }
    // 本機/AI：維持原行為，僅達最低出牌數時自動 confirmReady。
    if (me.cardsSetThisTurn >= minimum && me.cardsSetThisTurn <= required) {
      moves.confirmReady();
    }
  }, [G.step, timeLeft, G.ready, me.cardsSetThisTurn, minimum, required, meIndex, moves, useServerTimer, retryTick]);

  useEffect(() => {
    if ((G.step === 'initialSet' || G.step === 'turnSet') && !G.ready[meIndex]) setHandExpanded(true);
  }, [G.step, G.turnNumber, G.ready, meIndex]);

  useEffect(() => {
    if (G.ready[meIndex]) setHandExpanded(false);
  }, [G.ready, meIndex]);

  useEffect(() => {
    if (G.turnNumber > previousTurnNumber.current) {
      playBattleFeedbackSequence(battleFeedback(G, meIndex, opponentIndex));
      const result = G.lastBattleResult;
      if (result.winner !== null && result.damage > 0) {
        const target = (1 - result.winner) as PlayerIndex;
        setDamageFlash({ target, amount: result.damage, id: Date.now() });
        const flashTimer = setTimeout(() => setDamageFlash(null), 900);
        phaseTimers.current.push(flashTimer);
      }
    }
    previousTurnNumber.current = G.turnNumber;
  }, [G.turnNumber, G.lastBattleResult, G.players, meIndex, opponentIndex]);

  const setFromHand = (handIndex: number) => {
    if (G.ready[meIndex] || me.cardsSetThisTurn >= required) return;
    if (G.step === 'initialSet') moves.setInitialCard(handIndex);
    else moves.setTurnCard(handIndex, me.setZoneA ? 'B' : 'A');
  };

  const time = getChronosTime(G);
  const phaseText =
    G.step === 'effectOrder'
      ? t('board.effectOrder')
      : G.step === 'initialSet'
        ? t('board.initialSet')
        : `${t('board.setCards')} ${required} ${t('board.cardsUnit')}`;
  const canConfirm = !G.ready[meIndex] && me.cardsSetThisTurn >= minimum && me.cardsSetThisTurn <= required;
  const myDamage = damageFlash?.target === meIndex ? damageFlash.amount : undefined;
  const opponentDamage = damageFlash?.target === opponentIndex ? damageFlash.amount : undefined;

  return (
    <div
      className={`board chrono-${time} ${handExpanded ? 'drawer-expanded' : 'drawer-collapsed'} relative h-screen w-screen overflow-hidden bg-lacquer-deep text-bone font-sans`}
    >
      {/* 環境光暈 */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-1/2 h-[60vh] w-[120vh] -translate-x-1/2 -translate-y-1/2 rounded-full bg-vermilion/8 blur-[120px]" />
      </div>

      {/* 頂欄 */}
      <header className="absolute inset-x-0 top-0 z-30 flex h-12 items-center justify-between border-b border-bone/5 bg-lacquer-deep/80 px-6 backdrop-blur">
        <button className="font-mono text-[10px] uppercase tracking-[0.3em] text-bone/40 transition hover:text-bone" type="button" disabled>
          Exit
        </button>
        <div className="flex items-center gap-6 font-mono text-[10px] uppercase tracking-[0.3em]">
          <span className="text-bone/40">{t('board.turn')} {G.turnNumber}</span>
          <span className="text-bone/40">{time === 'night' ? `🌙 ${t('board.night')}` : `☀️ ${t('board.day')}`}</span>
          <span className="text-gold">{phaseText}</span>
        </div>
        <div className="flex items-center gap-5">
          <span className={`font-mono text-[10px] uppercase tracking-[0.3em] ${timeLeft <= 10 ? 'text-vermilion' : 'text-bone/40'}`}>
            {timeLeft}{t('board.secondsUnit')}
          </span>
          <button className="font-mono text-[10px] uppercase tracking-[0.3em] text-bone/40 transition hover:text-vermilion" type="button" disabled>
            Surrender
          </button>
        </div>
      </header>

      {/* 主內容雙欄 */}
      <div className="relative z-10 grid h-full grid-cols-[1fr_280px] gap-4 px-4 pb-52 pt-14">
        {/* 戰場欄 */}
        <main className="field-layout flex min-h-0 flex-col gap-3 overflow-hidden">
          <OpponentStatsBar G={G} opponentIndex={opponentIndex} damageAmount={opponentDamage} />
          <PhaseInstructionBar G={G} meIndex={meIndex} required={required} minimum={minimum} />
          <CentralArena
            G={G}
            meIndex={meIndex}
            opponentIndex={opponentIndex}
            time={time}
            onFocusCard={setFocusedCard}
          />
          <BottomZones
            G={G}
            meIndex={meIndex}
            moves={moves}
            damageAmount={myDamage}
            onFocusCard={setFocusedCard}
          />
        </main>

        {/* 側欄 */}
        <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto">
          <FocusPanel focus={focusedCard} />
          {G.step === 'effectOrder' && <EffectOrderPanel G={G} moves={moves} playerID={playerID} />}
          {G.pendingChoice && <PendingChoicePanel G={G} moves={moves} playerID={playerID} />}
          <BattleLogPanel G={G} />
        </aside>
      </div>

      <HandDrawer
        cards={me.hand}
        owner={meIndex}
        expanded={handExpanded}
        onToggle={() => setHandExpanded((value) => !value)}
        onCardClick={!G.ready[meIndex] ? setFromHand : undefined}
        onFocusCard={setFocusedCard}
      >
        <ActionsBar
          ready={G.ready[meIndex]}
          canConfirm={canConfirm}
          cardsSet={me.cardsSetThisTurn}
          required={required}
          onConfirm={() => {
            showTransientPhaseMessage({ title: t('board.setConfirmed'), tone: 'neutral' });
            moves.confirmReady();
            setHandExpanded(false);
          }}
        />
      </HandDrawer>
      <FeedbackOverlay message={phaseMessage} />
    </div>
  );
}

export function Board(props: Props) {
  const matchStartedAt = useRef(Date.now());
  const me = Number(props.playerID ?? '0') as PlayerIndex;
  const previousStep = useRef(props.G.step);
  const setupFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [setupFeedback, setSetupFeedback] = useState<FeedbackMessage | null>(null);

  useEffect(
    () => () => {
      if (setupFeedbackTimer.current) clearTimeout(setupFeedbackTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (
      previousStep.current === 'janken' &&
      props.G.step === 'mulligan' &&
      props.G.jankenChoices[0] &&
      props.G.jankenChoices[1]
    ) {
      const opponent = (1 - me) as PlayerIndex;
      const nightSidePlayer = props.G.chronos.nightSidePlayer;
      setSetupFeedback({
        kicker: `${jankenMark(props.G.jankenChoices[me])} vs ${jankenMark(props.G.jankenChoices[opponent])}`,
        title: nightSidePlayer === me ? t('board.youWinNightSide') : t('board.youLoseNightSide'),
        tone: nightSidePlayer === me ? 'success' : 'danger',
        actionLabel: t('common.continue'),
      });
    }
    previousStep.current = props.G.step;
  }, [props.G.step, props.G.jankenChoices, props.G.chronos.nightSidePlayer, me]);

  const showMulliganFeedback = (redrawCount: number) => {
    if (setupFeedbackTimer.current) clearTimeout(setupFeedbackTimer.current);
    setSetupFeedback({
      title:
        redrawCount > 0
          ? `${t('board.redrewCards')} ${redrawCount} ${t('board.cardsUnit')}卡`
          : t('board.handConfirmed'),
      tone: 'success',
    });
    setupFeedbackTimer.current = setTimeout(() => setSetupFeedback(null), prefersReducedMotion() ? 1000 : 1600);
  };

  const renderWithSetupFeedback = (node: ReactNode) => (
    <div className="board-feedback-root">
      {node}
      <FeedbackOverlay message={setupFeedback} onAction={() => setSetupFeedback(null)} />
    </div>
  );

  if (props.G.step === 'janken') return renderWithSetupFeedback(<JankenScreen {...props} />);
  if (props.G.step === 'mulligan') {
    return renderWithSetupFeedback(<MulliganScreen {...props} onMulliganFeedback={showMulliganFeedback} />);
  }
  if (props.G.step === 'gameOver') return <GameOverScreen {...props} matchStartedAt={matchStartedAt.current} />;
  return renderWithSetupFeedback(<BattleBoard {...props} />);
}
