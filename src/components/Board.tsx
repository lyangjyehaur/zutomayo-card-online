import type { BoardProps } from 'boardgame.io/react';
import { useEffect, useRef, useState } from 'react';
import type { CardInstance, GameState, JankenChoice, PlayerIndex } from '../game/types';
import { getCardDef } from '../game/cards/loader';
import { Card } from './Card';
import { Chronos } from './Chronos';
import { getChronosTime, getRequiredSetCount } from '../game/GameLogic';
import { saveMatchRecord } from '../game/matchHistory';
import { t } from '../i18n';

const TURN_TIMER_SECONDS = 60;
type Props = BoardProps<GameState>;

function playerName(index: PlayerIndex): string {
  return index === 0 ? t('player.zero') : t('player.one');
}

function jankenLabel(choice: JankenChoice): string {
  const labels: Record<JankenChoice, string> = {
    rock: t('board.rock'),
    paper: t('board.paper'),
    scissors: t('board.scissors'),
  };
  return labels[choice];
}

function JankenScreen({ G, moves, playerID }: Props) {
  const me = Number(playerID ?? '0') as PlayerIndex;
  const choice = G.jankenChoices[me];
  const choices: { value: JankenChoice; mark: string }[] = [
    { value: 'rock', mark: '✊' },
    { value: 'paper', mark: '✋' },
    { value: 'scissors', mark: '✌' },
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

function MulliganScreen({ G, moves, playerID }: Props) {
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
              <Card card={card} size="small" selected={selected.includes(index)} />
            </button>
          ))}
        </div>
        {done ? (
          <p className="setup-status">{t('board.waitingOpponent')}</p>
        ) : (
          <div className="setup-actions">
            <button className="primary-action" type="button" onClick={() => moves.mulligan(selected)}>
              {t('board.redraw')} {selected.length} {t('board.cardsUnit')}
            </button>
            <button className="secondary-action" type="button" onClick={() => moves.keepHand()}>
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

function GameOverScreen({ G, ctx, matchStartedAt }: Props & { matchStartedAt: number }) {
  const saved = useRef(false);

  useEffect(() => {
    if (saved.current) return;
    saved.current = true;
    const gameover = ctx.gameover as { winner?: string | number; draw?: boolean } | undefined;
    const durationSeconds = (Date.now() - matchStartedAt) / 1000;
    saveMatchRecord(G, gameover?.winner ?? (G.winner === null ? null : G.winner), durationSeconds);
  }, [G, ctx.gameover, matchStartedAt]);

  return (
    <div className="game-over">
      <div className="game-over-panel">
        <div className="setup-kicker">{t('board.gameOver')}</div>
        <h1>{G.winner === null ? t('board.draw') : `${playerName(G.winner)} ${t('board.playerWins')}`}</h1>
        <p>{translateGameOverReason(G.gameoverReason)}</p>
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

function StatusPill({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className={`status-pill ${tone ?? ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PlayerStats({ G, player, side }: { G: GameState; player: PlayerIndex; side: 'self' | 'opponent' }) {
  const state = G.players[player];
  const hp = Math.max(0, Math.min(100, state.hp));
  const hpTone = hpClass(hp);

  return (
    <div className={`player-stats ${side}`}>
      <div className="player-identity">
        <span>{side === 'self' ? t('player.me') : t('player.opponent')}</span>
        <strong>{playerName(player)}</strong>
      </div>
      <div className={`hp-meter ${hpTone}`}>
        <div className="hp-copy">
          <span>{t('board.hp')}</span>
          <strong>{state.hp}</strong>
        </div>
        <div className="hp-track">
          <div className="hp-fill" style={{ width: `${hp}%` }} />
        </div>
      </div>
      <div className="resource-row">
        <StatusPill label={t('board.energy')} value={powerTotal(G, player)} tone="energy" />
        <StatusPill label={t('board.deck')} value={state.deck.length} />
        <StatusPill label={t('board.abyss')} value={state.abyss.length} tone="abyss" />
      </div>
    </div>
  );
}

function Zone({ label, className, card, onClick, large }: {
  label: string;
  className: string;
  card: CardInstance | null;
  onClick?: () => void;
  large?: boolean;
}) {
  const content = (
    <>
      <span className="zone-label">{label}</span>
      {card ? (
        <Card card={card} size={large ? 'normal' : 'small'} />
      ) : (
        <span className="zone-empty">{label}</span>
      )}
    </>
  );

  if (onClick) {
    return (
      <button className={`zone ${className} zone-clickable`} type="button" onClick={onClick}>
        {content}
      </button>
    );
  }

  return <div className={`zone ${className}`}>{content}</div>;
}

function HandRow({ cards, hidden, onCardClick }: {
  cards: CardInstance[];
  hidden?: boolean;
  onCardClick?: (index: number) => void;
}) {
  return (
    <div className={hidden ? 'opponent-hand hand-row' : 'hand hand-row'}>
      {cards.map((card, index) => (
        <Card
          key={card.instanceId}
          card={hidden ? { ...card, faceUp: false } : card}
          size={hidden ? 'micro' : 'small'}
          onClick={onCardClick ? () => onCardClick(index) : undefined}
        />
      ))}
    </div>
  );
}

function BattleSummary({ G }: { G: GameState }) {
  const result = G.lastBattleResult;
  if (G.turnNumber <= 1 || result.damage <= 0) {
    return (
      <div className="battle-summary muted">
        <span>{t('board.lastBattle')}</span>
        <strong>{t('board.draw')}</strong>
      </div>
    );
  }

  return (
    <div className="battle-summary">
      <span>{t('board.lastBattle')}</span>
      <strong>{t('board.damage')} {result.damage}</strong>
      <em>{t('board.winner')} {result.winner !== null ? playerName(result.winner) : t('board.draw')}</em>
    </div>
  );
}

function BattleBoard({ G, moves, playerID }: Props) {
  const meIndex = Number(playerID ?? '0') as PlayerIndex;
  const opponentIndex = (1 - meIndex) as PlayerIndex;
  const me = G.players[meIndex];
  const opponent = G.players[opponentIndex];
  const required = getRequiredSetCount(G, meIndex);
  const [timeLeft, setTimeLeft] = useState(TURN_TIMER_SECONDS);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setTimeLeft(TURN_TIMER_SECONDS);
    if (timer.current) clearInterval(timer.current);
    if (G.step !== 'turnSet') return;
    timer.current = setInterval(() => setTimeLeft(value => Math.max(0, value - 1)), 1000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [G.turnNumber, G.step]);

  useEffect(() => {
    if (G.step === 'turnSet' && timeLeft === 0 && !G.ready[meIndex] && me.cardsSetThisTurn === required) {
      moves.confirmReady();
    }
  }, [G.step, timeLeft, G.ready, me.cardsSetThisTurn, required, meIndex, moves]);

  const setFromHand = (handIndex: number) => {
    if (G.ready[meIndex] || me.cardsSetThisTurn >= required) return;
    if (G.step === 'initialSet') moves.setInitialCard(handIndex);
    else moves.setTurnCard(handIndex, me.setZoneA ? 'B' : 'A');
  };

  const time = getChronosTime(G);
  const timerTone = timeLeft > 30 ? 'timer-safe' : timeLeft > 10 ? 'timer-warning' : 'timer-danger';
  const phaseText = G.step === 'initialSet'
    ? t('board.initialSet')
    : `${t('board.setCards')} ${required} ${t('board.cardsUnit')}`;
  const canConfirm = !G.ready[meIndex] && me.cardsSetThisTurn === required;

  return (
    <div className="board">
      <section className="player-area opponent-area">
        <PlayerStats G={G} player={opponentIndex} side="opponent" />
        <div className="zones opponent-zones">
          <Zone label={t('board.setZoneA')} className="set-zone" card={opponent.setZoneA} />
          <Zone label={t('board.battleZone')} className="battle-zone" card={opponent.battleZone} large />
          <Zone label={t('board.setZoneB')} className="set-zone" card={opponent.setZoneB} />
          <Zone label={t('board.areaEnchant')} className="area-zone" card={opponent.setZoneC} />
        </div>
        <div className="hand-label">{t('board.opponentHand')}</div>
        <HandRow cards={opponent.hand} hidden />
      </section>

      <section className="center-area">
        <Chronos chronos={G.chronos} currentTime={time} />
        <div className="turn-panel">
          <div className="turn-number">{t('board.turn')} {G.turnNumber}</div>
          <div className={`time-badge ${time}`}>{time === 'night' ? t('board.night') : t('board.day')}</div>
          {G.step === 'turnSet' && (
            <div className={`turn-timer ${timerTone}`}>{t('board.timer')} {timeLeft}s</div>
          )}
          <div className="phase-text">{phaseText}</div>
          <div className="opponent-state">
            {G.ready[opponentIndex] ? t('board.opponentReady') : t('board.opponentChoosing')}
          </div>
        </div>
        <BattleSummary G={G} />
      </section>

      <section className="player-area self-area">
        <div className="hand-label">{t('board.hand')}</div>
        <HandRow cards={me.hand} onCardClick={!G.ready[meIndex] ? setFromHand : undefined} />
        <div className="zones my-zones">
          <Zone
            label={t('board.setZoneA')}
            className="set-zone"
            card={me.setZoneA && { ...me.setZoneA, faceUp: true }}
            onClick={me.setZoneA && !G.ready[meIndex] ? () => moves.undoSetCard('A') : undefined}
          />
          <Zone label={t('board.battleZone')} className="battle-zone" card={me.battleZone} large />
          <Zone
            label={t('board.setZoneB')}
            className="set-zone"
            card={me.setZoneB && { ...me.setZoneB, faceUp: true }}
            onClick={me.setZoneB && !G.ready[meIndex] ? () => moves.undoSetCard('B') : undefined}
          />
          <Zone label={t('board.areaEnchant')} className="area-zone" card={me.setZoneC} />
        </div>
        <PlayerStats G={G} player={meIndex} side="self" />
        <div className="actions">
          <button className="confirm-button" disabled={!canConfirm} type="button" onClick={() => moves.confirmReady()}>
            {G.ready[meIndex]
              ? t('board.readyWaiting')
              : `${t('board.confirmSet')} (${me.cardsSetThisTurn}/${required})`}
          </button>
        </div>
      </section>
    </div>
  );
}

export function Board(props: Props) {
  const matchStartedAt = useRef(Date.now());

  if (props.G.step === 'janken') return <JankenScreen {...props} />;
  if (props.G.step === 'mulligan') return <MulliganScreen {...props} />;
  if (props.G.step === 'gameOver') return <GameOverScreen {...props} matchStartedAt={matchStartedAt.current} />;
  return <BattleBoard {...props} />;
}
