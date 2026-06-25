import type { BoardProps } from 'boardgame.io/react';
import { useEffect, useRef, useState } from 'react';
import type { CardInstance, ChronosTime, GameState, JankenChoice, PlayerIndex } from '../game/types';
import { getCardDef } from '../game/cards/loader';
import { Card } from './Card';
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

function Zone({ label, className, card, onClick, large, activeTime }: {
  label: string;
  className: string;
  card: CardInstance | null;
  onClick?: () => void;
  large?: boolean;
  activeTime?: ChronosTime;
}) {
  const content = (
    <>
      <span className="zone-label">{label}</span>
      {card ? (
        <Card card={card} size={large ? 'normal' : 'small'} activeTime={activeTime} />
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

function cardDisplayName(card: CardInstance | null): string {
  if (!card) return t('common.empty');
  return getCardDef(card.defId)?.name ?? t('card.unknown');
}

function ResourceStat({ className, label, value }: { className: string; label: string; value: string | number }) {
  return (
    <span className={className}>
      <span>{label}</span>
      <strong>{value}</strong>
    </span>
  );
}

function OpponentSummary({ G, opponentIndex }: { G: GameState; opponentIndex: PlayerIndex }) {
  const opponent = G.players[opponentIndex];

  return (
    <section className="opponent-summary" aria-label={t('player.opponent')}>
      <strong className="opponent-name">{t('player.opponent')}：{playerName(opponentIndex)}</strong>
      <ResourceStat className="hp" label={t('board.hp')} value={opponent.hp} />
      <ResourceStat className="deck-count" label={t('board.deck')} value={opponent.deck.length} />
      <ResourceStat className="power" label={t('board.energy')} value={powerTotal(G, opponentIndex)} />
      <div className="battle-char">
        <span>{t('card.type.character')}</span>
        <strong>{cardDisplayName(opponent.battleZone)}</strong>
      </div>
    </section>
  );
}

function PlayerStatus({ G, meIndex, timeLeft, timerTone }: {
  G: GameState;
  meIndex: PlayerIndex;
  timeLeft: number;
  timerTone: string;
}) {
  const me = G.players[meIndex];

  return (
    <section className="player-status" aria-label={t('player.me')}>
      <ResourceStat className={`hp ${hpClass(me.hp)}`} label={t('board.hp')} value={me.hp} />
      <ResourceStat className="deck-count" label={t('board.deck')} value={me.deck.length} />
      <ResourceStat className="power" label={t('board.energy')} value={powerTotal(G, meIndex)} />
      <ResourceStat className="abyss" label={t('board.abyss')} value={me.abyss.length} />
      {G.step === 'turnSet' && (
        <ResourceStat className={`timer ${timerTone}`} label={t('board.timer')} value={`${timeLeft}${t('board.secondsUnit')}`} />
      )}
    </section>
  );
}

function PlayerField({ G, meIndex, timeLeft, timerTone, time, moves }: {
  G: GameState;
  meIndex: PlayerIndex;
  timeLeft: number;
  timerTone: string;
  time: ChronosTime;
  moves: Props['moves'];
}) {
  const me = G.players[meIndex];

  return (
    <section className="player-field" aria-label={t('player.me')}>
      <div className="zones-row">
        <Zone
          label={t('board.setZoneA')}
          className="set-zone"
          card={me.setZoneA && { ...me.setZoneA, faceUp: true }}
          onClick={me.setZoneA && !G.ready[meIndex] ? () => moves.undoSetCard('A') : undefined}
        />
        <Zone label={t('board.battleZone')} className="battle-zone" card={me.battleZone} large activeTime={time} />
        <Zone
          label={t('board.setZoneB')}
          className="set-zone"
          card={me.setZoneB && { ...me.setZoneB, faceUp: true }}
          onClick={me.setZoneB && !G.ready[meIndex] ? () => moves.undoSetCard('B') : undefined}
        />
        <Zone label={t('board.areaEnchant')} className="area-zone" card={me.setZoneC} />
      </div>
      <PlayerStatus G={G} meIndex={meIndex} timeLeft={timeLeft} timerTone={timerTone} />
    </section>
  );
}

function HandArea({ cards, onCardClick }: {
  cards: CardInstance[];
  onCardClick?: (index: number) => void;
}) {
  return (
    <section className="hand-area" aria-label={t('board.hand')}>
      {cards.map((card, index) => (
        <Card
          key={card.instanceId}
          card={card}
          size="normal"
          onClick={onCardClick ? () => onCardClick(index) : undefined}
        />
      ))}
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

function InfoBar({ G, opponentIndex, time, phaseText }: {
  G: GameState;
  opponentIndex: PlayerIndex;
  time: ChronosTime;
  phaseText: string;
}) {
  return (
    <section className="info-bar" aria-label={phaseText}>
      <span>{t('board.turn')} {G.turnNumber}</span>
      <span className={`time-badge ${time}`}>{time === 'night' ? t('board.night') : t('board.day')}</span>
      <span>{t('chronos.title')}：{G.chronos.position}/12</span>
      <span>{phaseText}</span>
      <span>{G.ready[opponentIndex] ? t('board.opponentReady') : t('board.opponentChoosing')}</span>
    </section>
  );
}

function BattleBoard({ G, moves, playerID }: Props) {
  const meIndex = Number(playerID ?? '0') as PlayerIndex;
  const opponentIndex = (1 - meIndex) as PlayerIndex;
  const me = G.players[meIndex];
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
    <div className={`board chrono-${time}`}>
      <OpponentSummary G={G} opponentIndex={opponentIndex} />
      <PlayerField
        G={G}
        meIndex={meIndex}
        timeLeft={timeLeft}
        timerTone={timerTone}
        time={time}
        moves={moves}
      />
      <section className="bottom-panel">
        <HandArea cards={me.hand} onCardClick={!G.ready[meIndex] ? setFromHand : undefined} />
        <ActionsBar
          ready={G.ready[meIndex]}
          canConfirm={canConfirm}
          cardsSet={me.cardsSetThisTurn}
          required={required}
          onConfirm={() => moves.confirmReady()}
        />
        <InfoBar G={G} opponentIndex={opponentIndex} time={time} phaseText={phaseText} />
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
