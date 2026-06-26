import type { BoardProps } from 'boardgame.io/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { getProfile, isLoggedIn, submitMatch } from '../api/client';
import type { CardInstance, ChronosTime, GameState, JankenChoice, PlayerIndex } from '../game/types';
import { getCardDef } from '../game/cards/loader';
import { Card, type CardSize } from './Card';
import { Chronos } from './Chronos';
import { getChronosTime, getMinimumSetCount, getRequiredSetCount } from '../game/GameLogic';
import { saveMatchRecord } from '../game/matchHistory';
import { t } from '../i18n';

const TURN_TIMER_SECONDS = 60;
type Props = BoardProps<GameState>;

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

function FeedbackOverlay({ message, onAction }: {
  message: FeedbackMessage | null;
  onAction?: () => void;
}) {
  if (!message) return null;

  return (
    <div className={`phase-message-overlay phase-message-${message.tone ?? 'neutral'}`} role="status" aria-live="polite">
      <div className="phase-message-panel">
        {message.kicker && <div className="phase-message-kicker">{message.kicker}</div>}
        <strong className="phase-message-title">{message.title}</strong>
        {message.lines?.map(line => <p key={line}>{line}</p>)}
        {message.actionLabel && onAction && (
          <button className="primary-action phase-message-action" type="button" onClick={onAction}>
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
    <div className="setup-screen janken-screen">
      <div className="setup-panel">
        <div className="setup-kicker">{t('board.janken')}</div>
        <h2>{t('board.jankenHint')}</h2>
        {choice ? (
          <p className="setup-status">
            {t('board.youChose')} {jankenLabel(choice)}。{t('board.waitingOpponent')}
          </p>
        ) : (
          <div className="janken-buttons">
            {choices.map(({ value, mark }) => (
              <button key={value} className="janken-btn" type="button" onClick={() => moves.janken(value)}>
                <span>{mark}</span>
                {jankenLabel(value)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MulliganScreen({ G, moves, playerID, onMulliganFeedback }: Props & {
  onMulliganFeedback: (redrawCount: number) => void;
}) {
  const me = Number(playerID ?? '0') as PlayerIndex;
  const [selected, setSelected] = useState<number[]>([]);
  const done = G.mulliganUsed[me];
  const toggle = (index: number) => setSelected(current =>
    current.includes(index) ? current.filter(item => item !== index) : [...current, index],
  );

  return (
    <div className="setup-screen mulligan-screen">
      <div className="setup-panel wide">
        <div className="setup-kicker">{t('board.mulligan')}</div>
        <h2>{t('board.mulliganHint')}</h2>
        <div className="mulligan-hand">
          {G.players[me].hand.map((card, index) => (
            <button
              key={card.instanceId}
              className={`mulligan-card ${selected.includes(index) ? 'selected' : ''}`}
              type="button"
              disabled={done}
              onClick={() => toggle(index)}
            >
              <Card card={card} size="small" selected={selected.includes(index)} showPopover />
            </button>
          ))}
        </div>
        {done ? (
          <p className="setup-status">{t('board.handConfirmed')}。{t('board.waitingOpponent')}</p>
        ) : (
          <div className="setup-actions">
            <button
              className="primary-action"
              type="button"
              onClick={() => {
                onMulliganFeedback(selected.length);
                moves.mulligan(selected);
              }}
            >
              {t('board.redraw')} {selected.length} {t('board.cardsUnit')}
            </button>
            <button
              className="secondary-action"
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

function signedChange(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

function GameOverScreen({ G, ctx, matchStartedAt, playerID }: Props & { matchStartedAt: number }) {
  const saved = useRef(false);
  const [eloNotice, setEloNotice] = useState('');

  useEffect(() => {
    if (saved.current) return;
    saved.current = true;
    const gameover = ctx.gameover as { winner?: string | number; draw?: boolean } | undefined;
    const durationSeconds = (Date.now() - matchStartedAt) / 1000;
    const winner = normalizeWinner(G, gameover);
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
      .then(result => {
        const change = winner === accountPlayer
          ? result.winnerEloChange ?? 0
          : result.loserEloChange ?? 0;
        setEloNotice(`${t('auth.eloChange')} ${signedChange(change)}`);
      })
      .catch(() => {
        // Local history above remains the fallback when the API is unavailable.
      });
  }, [G, ctx.gameover, matchStartedAt, playerID]);

  return (
    <div className="game-over">
      <div className="game-over-panel">
        <div className="setup-kicker">{t('board.gameOver')}</div>
        <h1>{G.winner === null ? t('board.draw') : `${playerName(G.winner)} ${t('board.playerWins')}`}</h1>
        <p>{translateGameOverReason(G.gameoverReason)}</p>
        {eloNotice && <p className="elo-notice">{eloNotice}</p>}
        {ctx.gameover && (
          <button className="primary-action" type="button" onClick={() => window.location.reload()}>
            {t('board.playAgain')}
          </button>
        )}
      </div>
    </div>
  );
}

function powerTotal(G: GameState, player: PlayerIndex): number {
  return G.players[player].powerCharger.reduce(
    (sum, card) => sum + (getCardDef(card.defId)?.sendToPower ?? 0), 0,
  );
}

function hpClass(hp: number): string {
  if (hp <= 25) return 'danger';
  if (hp <= 50) return 'warning';
  return 'healthy';
}

function FieldZone({ label, shortLabel, className, card, onClick, size = 'small', activeTime }: {
  label: string;
  shortLabel?: string;
  className: string;
  card: CardInstance | null;
  onClick?: () => void;
  size?: CardSize;
  activeTime?: ChronosTime;
}) {
  const content = (
    <>
      <span className="zone-label">{label}</span>
      {card ? (
        <Card card={card} size={size} activeTime={activeTime} showPopover />
      ) : (
        <span className="zone-empty">{shortLabel ?? label}</span>
      )}
    </>
  );

  if (onClick) {
    return (
      <button className={`zone zone-${size} ${className} zone-clickable`} type="button" onClick={onClick}>
        {content}
      </button>
    );
  }

  return <div className={`zone zone-${size} ${className}`}>{content}</div>;
}

function ResourceStat({ className, icon, label, value }: {
  className: string;
  icon: string;
  label: string;
  value: string | number;
}) {
  const isHp = className.split(' ').includes('hp') && typeof value === 'number';
  const hpPercent = isHp ? Math.max(0, Math.min(100, value)) : 0;

  return (
    <span className={`resource-stat ${className}`} title={label}>
      <span className="resource-icon" aria-hidden="true">{icon}</span>
      <strong>{value}</strong>
      <span className="resource-label">{label}</span>
      {isHp && (
        <span className="hp-meter" aria-hidden="true">
          <span className="hp-fill" style={{ width: `${hpPercent}%` }} />
        </span>
      )}
    </span>
  );
}

function StackZone({ kind, label, icon, value, cards }: {
  kind: 'deck' | 'power';
  label: string;
  icon: string;
  value: number;
  cards?: CardInstance[];
}) {
  if (kind === 'deck') {
    return (
      <div className="stack-zone deck-zone deck-stack" aria-label={`${label}: ${value}`}>
        <div className="deck-card-back" aria-hidden="true">
          <div className="card-back-design">ZC</div>
        </div>
        <span className="deck-count" aria-hidden="true">{icon} {value}</span>
      </div>
    );
  }

  if (cards && cards.length > 0) {
    return (
      <div className="stack-zone power-stack" aria-label={`${label}: ${value}`}>
        <div className="power-charger-cards" aria-hidden="true">
          {cards.map((card, i) => {
            const def = getCardDef(card.defId);
            return (
              <div
                key={card.instanceId}
                className="power-card"
                style={{ transform: `translateX(${i * 12}px)` }}
              >
                <img
                  src={def?.image ?? ''}
                  alt={def?.name ?? label}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
                <span className="power-value">{def?.sendToPower ?? 0}</span>
              </div>
            );
          })}
        </div>
        <strong className="power-total">{icon} {value}</strong>
      </div>
    );
  }

  return (
    <div className={`stack-zone ${kind}-stack`} aria-label={`${label}: ${value}`}>
      <div className="power-charger-visual" aria-hidden="true">
        <span>{icon}</span>
      </div>
      <strong>
        <span>{label}</span>
        {value}
      </strong>
    </div>
  );
}

function FieldStats({ G, playerIndex, showAbyss, showPower = true, timeLeft, timerTone }: {
  G: GameState;
  playerIndex: PlayerIndex;
  showAbyss: boolean;
  showPower?: boolean;
  timeLeft?: number;
  timerTone?: string;
}) {
  const player = G.players[playerIndex];
  return (
    <div className="field-stats">
      <ResourceStat className={`hp ${hpClass(player.hp)}`} icon="❤️" label={t('board.hp')} value={player.hp} />
      <ResourceStat className="deck-count" icon="🃏" label={t('board.deck')} value={player.deck.length} />
      {showPower && <ResourceStat className="power" icon="⚡" label={t('board.powerCharger')} value={powerTotal(G, playerIndex)} />}
      {showAbyss && <ResourceStat className="abyss" icon="🕳️" label={t('board.abyss')} value={player.abyss.length} />}
      {timeLeft !== undefined && timerTone && G.step === 'turnSet' && (
        <ResourceStat
          className={`timer ${timerTone}`}
          icon="⏱"
          label={t('board.timer')}
          value={`${timeLeft}${t('board.secondsUnit')}`}
        />
      )}
    </div>
  );
}

function OpponentStatsBar({ G, opponentIndex, damageAmount }: {
  G: GameState;
  opponentIndex: PlayerIndex;
  damageAmount?: number;
}) {
  const opponent = G.players[opponentIndex];

  return (
    <section className={`opponent-stats-bar ${damageAmount ? 'damaged' : ''}`} aria-label={t('player.opponent')}>
      <strong>{t('player.opponent')}：{playerName(opponentIndex)}</strong>
      <FieldStats G={G} playerIndex={opponentIndex} showAbyss showPower={false} />
      <StackZone
        kind="power"
        label={t('board.powerCharger')}
        icon="⚡"
        value={powerTotal(G, opponentIndex)}
        cards={opponent.powerCharger}
      />
      {damageAmount ? <span className="damage-float" key={`opp-${damageAmount}`}>-{damageAmount}</span> : null}
    </section>
  );
}

function BottomZones({ G, meIndex, moves }: {
  G: GameState;
  meIndex: PlayerIndex;
  moves: Props['moves'];
}) {
  const me = G.players[meIndex];

  return (
    <section className="bottom-zones" aria-label={t('player.me')}>
      <StackZone
        kind="power"
        label={t('board.powerCharger')}
        icon="⚡"
        value={powerTotal(G, meIndex)}
        cards={me.powerCharger}
      />
      <FieldZone
        label={t('board.setZoneA')}
        shortLabel="A"
        className="set-zone set-zone-a"
        card={me.setZoneA}
        onClick={me.setZoneA && !G.ready[meIndex] ? () => moves.undoSetCard('A') : undefined}
        size="normal"
      />
      <FieldZone
        label={t('board.setZoneB')}
        shortLabel="B"
        className="set-zone set-zone-b"
        card={me.setZoneB}
        onClick={me.setZoneB && !G.ready[meIndex] ? () => moves.undoSetCard('B') : undefined}
        size="normal"
      />
      <FieldZone
        label={t('board.areaEnchant')}
        shortLabel="C"
        className="area-zone area-zone-c"
        card={me.setZoneC}
        size="normal"
      />
      <StackZone kind="deck" label={t('board.deckZone')} icon="🃏" value={me.deck.length} />
    </section>
  );
}

function CentralArena({ G, meIndex, opponentIndex, time }: {
  G: GameState;
  meIndex: PlayerIndex;
  opponentIndex: PlayerIndex;
  time: ChronosTime;
}) {
  const me = G.players[meIndex];
  const opponent = G.players[opponentIndex];

  return (
    <section className="central-arena" aria-label={t('chronos.title')}>
      <div className="chronos-container">
        <Chronos
          chronos={G.chronos}
          currentTime={time}
          nightSidePlayer={G.chronos.nightSidePlayer}
          currentPlayer={meIndex}
        />
        <div className="opp-battle-slot">
          <FieldZone
            label={`${t('player.opponent')} ${t('board.battleZone')}`}
            shortLabel={t('board.battleZoneShort')}
            className="battle-zone central-battle-zone opponent-battle-zone"
            card={opponent.battleZone}
            size="normal"
            activeTime={time}
          />
        </div>
        <div className="my-battle-slot">
          <FieldZone
            label={`${t('player.me')} ${t('board.battleZone')}`}
            shortLabel={t('board.battleZoneShort')}
            className="battle-zone central-battle-zone player-battle-zone"
            card={me.battleZone}
            size="normal"
            activeTime={time}
          />
        </div>
      </div>
    </section>
  );
}

function HandDrawer({ cards, expanded, onToggle, onCardClick, children }: {
  cards: CardInstance[];
  expanded: boolean;
  onToggle: () => void;
  onCardClick?: (index: number) => void;
  children?: ReactNode;
}) {
  return (
    <section className={`hand-drawer ${expanded ? 'expanded' : 'collapsed'}`} aria-label={t('board.hand')}>
      <button className="hand-drawer-handle" type="button" onClick={onToggle} aria-expanded={expanded}>
        <span className="hand-drawer-grip" aria-hidden="true" />
        <span>{`${expanded ? '▼' : '▲'} ${t('board.hand')} (${cards.length})`}</span>
      </button>
      <div className="hand-drawer-content" aria-hidden={!expanded}>
        <div className="hand-area">
          {cards.map((card, index) => (
            <Card
              key={card.instanceId}
              card={card}
              size="normal"
              className={`hand-card hand-card-${Math.min(index, 9)}`}
              showBadges={false}
              showPopover
              onClick={onCardClick ? () => onCardClick(index) : undefined}
            />
          ))}
        </div>
        {children && <div className="hand-drawer-footer">{children}</div>}
      </div>
    </section>
  );
}

function ActionsBar({ ready, canConfirm, cardsSet, required, onConfirm }: {
  ready: boolean;
  canConfirm: boolean;
  cardsSet: number;
  required: number;
  onConfirm: () => void;
}) {
  return (
    <section className="actions-bar">
      <button className="confirm-button" disabled={!canConfirm} type="button" onClick={onConfirm}>
        {ready
          ? t('board.readyWaiting')
          : `${t('board.confirmSet')} (${cardsSet}/${required})`}
      </button>
    </section>
  );
}

function StatusBar({ G, meIndex, timeLeft, timerTone, time, phaseText, damageAmount }: {
  G: GameState;
  meIndex: PlayerIndex;
  timeLeft: number;
  timerTone: string;
  time: ChronosTime;
  phaseText: string;
  damageAmount?: number;
}) {
  const me = G.players[meIndex];

  return (
    <section className={`status-bar ${damageAmount ? 'damaged' : ''}`} aria-label={phaseText}>
      <ResourceStat className={`hp ${hpClass(me.hp)}`} icon="❤️" label={t('board.hp')} value={me.hp} />
      <ResourceStat
        className={`timer ${timerTone}`}
        icon="⏱"
        label={t('board.timer')}
        value={`${timeLeft}${t('board.secondsUnit')}`}
      />
      <span className="status-pill">{t('board.turn')} {G.turnNumber}</span>
      <span className={`status-pill time-badge ${time}`}>
        {time === 'night' ? `🌙 ${t('board.night')}` : `☀️ ${t('board.day')}`}
      </span>
      <span className="status-pill phase-pill">{phaseText}</span>
      {damageAmount ? <span className="damage-float" key={`me-${damageAmount}`}>-{damageAmount}</span> : null}
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

function EffectOrderPanel({ G, moves, playerID }: {
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

function PendingChoicePanel({ G, moves, playerID }: {
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
    setSelected(current => {
      if (current.includes(optionId)) return current.filter(item => item !== optionId);
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
          <p>{choice.prompt || choice.type}</p>
          <div className="effect-order-list">
            {choice.options.map(option => {
              const isSelected = selected.includes(option.id);
              return (
                <button
                  key={option.id}
                  className={`effect-order-item pending-choice-option ${isSelected ? 'selected' : ''}`}
                  type="button"
                  onClick={() => toggle(option.id)}
                >
                  <span className="effect-order-card">{option.label}</span>
                  <span className="effect-order-action">
                    {isSelected ? t('common.selected') : t('common.select')}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="pending-choice-footer">
            <span>{t('board.choiceCount')} {selected.length}/{choice.max}</span>
            <button className="primary-action" type="button" disabled={!canSubmit} onClick={() => moves.submitPendingChoice(selected)}>
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

function BattleBoard({ G, moves, playerID }: Props) {
  const meIndex = Number(playerID ?? '0') as PlayerIndex;
  const opponentIndex = (1 - meIndex) as PlayerIndex;
  const me = G.players[meIndex];
  const minimum = getMinimumSetCount(G, meIndex);
  const required = getRequiredSetCount(G, meIndex);
  const [timeLeft, setTimeLeft] = useState(TURN_TIMER_SECONDS);
  const [handExpanded, setHandExpanded] = useState(true);
  const [phaseMessage, setPhaseMessage] = useState<FeedbackMessage | null>(null);
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
    phaseTimers.current.push(setTimeout(() => setPhaseMessage(null), duration));
  };

  const playBattleFeedbackSequence = (resultMessage: FeedbackMessage) => {
    clearPhaseTimers();
    const sequence: { message: FeedbackMessage; duration: number }[] = [
      { message: { title: t('board.phaseReveal'), tone: 'phase' }, duration: 700 },
      { message: { title: t('board.phaseTimeAdvance'), tone: 'phase' }, duration: 700 },
      { message: { title: t('board.phaseBattleStart'), tone: 'phase' }, duration: 700 },
      { message: resultMessage, duration: 2600 },
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
    setTimeLeft(TURN_TIMER_SECONDS);
    if (timer.current) clearInterval(timer.current);
    if (G.step !== 'turnSet') return;
    timer.current = setInterval(() => setTimeLeft(value => Math.max(0, value - 1)), 1000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [G.turnNumber, G.step]);

  useEffect(() => {
    if (
      G.step === 'turnSet'
      && timeLeft === 0
      && !G.ready[meIndex]
      && me.cardsSetThisTurn >= minimum
      && me.cardsSetThisTurn <= required
    ) {
      moves.confirmReady();
    }
  }, [G.step, timeLeft, G.ready, me.cardsSetThisTurn, minimum, required, meIndex, moves]);

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
  const timerTone = timeLeft > 30 ? 'timer-safe' : timeLeft > 10 ? 'timer-warning' : 'timer-danger';
  const phaseText = G.step === 'effectOrder'
    ? t('board.effectOrder')
    : G.step === 'initialSet'
    ? t('board.initialSet')
    : `${t('board.setCards')} ${required} ${t('board.cardsUnit')}`;
  const canConfirm = !G.ready[meIndex] && me.cardsSetThisTurn >= minimum && me.cardsSetThisTurn <= required;
  const myDamage = damageFlash?.target === meIndex ? damageFlash.amount : undefined;
  const opponentDamage = damageFlash?.target === opponentIndex ? damageFlash.amount : undefined;

  return (
    <div className={`board chrono-${time} ${handExpanded ? 'drawer-expanded' : 'drawer-collapsed'}`}>
      <main className="field-layout">
        <OpponentStatsBar G={G} opponentIndex={opponentIndex} damageAmount={opponentDamage} />
        <CentralArena G={G} meIndex={meIndex} opponentIndex={opponentIndex} time={time} />
        <BottomZones G={G} meIndex={meIndex} moves={moves} />
        <StatusBar
          G={G}
          meIndex={meIndex}
          timeLeft={timeLeft}
          timerTone={timerTone}
          time={time}
          phaseText={phaseText}
          damageAmount={myDamage}
        />
      </main>
      {G.step === 'effectOrder' && <EffectOrderPanel G={G} moves={moves} playerID={playerID} />}
      {G.pendingChoice && <PendingChoicePanel G={G} moves={moves} playerID={playerID} />}
      <HandDrawer
        cards={me.hand}
        expanded={handExpanded}
        onToggle={() => setHandExpanded(value => !value)}
        onCardClick={!G.ready[meIndex] ? setFromHand : undefined}
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

  useEffect(() => () => {
    if (setupFeedbackTimer.current) clearTimeout(setupFeedbackTimer.current);
  }, []);

  useEffect(() => {
    if (
      previousStep.current === 'janken'
      && props.G.step === 'mulligan'
      && props.G.jankenChoices[0]
      && props.G.jankenChoices[1]
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
      title: redrawCount > 0
        ? `${t('board.redrewCards')} ${redrawCount} ${t('board.cardsUnit')}卡`
        : t('board.handConfirmed'),
      tone: 'success',
    });
    setupFeedbackTimer.current = setTimeout(() => setSetupFeedback(null), 1600);
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
