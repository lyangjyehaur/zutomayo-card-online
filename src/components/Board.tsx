import type { BoardProps } from 'boardgame.io/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { CardInstance, ChronosTime, GameState, JankenChoice, PlayerIndex } from '../game/types';
import { getCardDef } from '../game/cards/loader';
import { Card, type CardSize } from './Card';
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
  return (
    <span className={`resource-stat ${className}`} title={label}>
      <span className="resource-icon" aria-hidden="true">{icon}</span>
      <strong>{value}</strong>
      <span className="resource-label">{label}</span>
    </span>
  );
}

function StackZone({ kind, label, icon, value }: {
  kind: 'deck' | 'power';
  label: string;
  icon: string;
  value: number;
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

function FieldStats({ G, playerIndex, showAbyss, timeLeft, timerTone }: {
  G: GameState;
  playerIndex: PlayerIndex;
  showAbyss: boolean;
  timeLeft?: number;
  timerTone?: string;
}) {
  const player = G.players[playerIndex];
  return (
    <div className="field-stats">
      <ResourceStat className={`hp ${hpClass(player.hp)}`} icon="❤️" label={t('board.hp')} value={player.hp} />
      <ResourceStat className="deck-count" icon="🃏" label={t('board.deck')} value={player.deck.length} />
      <ResourceStat className="power" icon="⚡" label={t('board.powerCharger')} value={powerTotal(G, playerIndex)} />
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

function OpponentField({ G, opponentIndex }: {
  G: GameState;
  opponentIndex: PlayerIndex;
}) {
  const opponent = G.players[opponentIndex];

  return (
    <>
      <section className="field-panel opponent-field opponent-side-zones" aria-label={t('player.opponent')}>
        <div className="field-heading">
          <strong>{t('player.opponent')}：{playerName(opponentIndex)}</strong>
          <FieldStats G={G} playerIndex={opponentIndex} showAbyss={false} />
        </div>
        <div className="field-zones side-zone-grid opponent-zones">
          <FieldZone label={t('board.setZoneA')} shortLabel="A" className="set-zone set-zone-a" card={opponent.setZoneA} size="small" />
          <FieldZone label={t('board.setZoneB')} shortLabel="B" className="set-zone set-zone-b" card={opponent.setZoneB} size="small" />
          <StackZone kind="power" label={t('board.powerCharger')} icon="⚡" value={powerTotal(G, opponentIndex)} />
        </div>
      </section>
      <section className="field-panel opponent-field opponent-area-panel" aria-label={t('board.areaEnchant')}>
        <FieldZone label={t('board.areaEnchant')} shortLabel="C" className="area-zone area-zone-c" card={opponent.setZoneC} size="small" />
      </section>
    </>
  );
}

function PlayerField({ G, meIndex, timeLeft, timerTone, moves }: {
  G: GameState;
  meIndex: PlayerIndex;
  timeLeft: number;
  timerTone: string;
  moves: Props['moves'];
}) {
  const me = G.players[meIndex];

  return (
    <>
      <section className="field-panel player-field player-side-zones" aria-label={t('player.me')}>
        <div className="field-heading">
          <strong>{t('player.me')}：{playerName(meIndex)}</strong>
          <FieldStats G={G} playerIndex={meIndex} showAbyss timeLeft={timeLeft} timerTone={timerTone} />
        </div>
        <div className="field-zones side-zone-grid player-zones">
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
          <div className="player-resource-row">
            <StackZone kind="power" label={t('board.powerCharger')} icon="⚡" value={powerTotal(G, meIndex)} />
            <StackZone kind="deck" label={t('board.deckZone')} icon="🃏" value={me.deck.length} />
          </div>
        </div>
      </section>
      <section className="field-panel player-field player-area-panel" aria-label={t('board.areaEnchant')}>
        <FieldZone label={t('board.areaEnchant')} shortLabel="C" className="area-zone area-zone-c" card={me.setZoneC} size="normal" />
      </section>
    </>
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
      <FieldZone
        label={`${t('player.opponent')} ${t('board.battleZone')}`}
        shortLabel={t('board.battleZoneShort')}
        className="battle-zone central-battle-zone opponent-battle-zone"
        card={opponent.battleZone}
        size="small"
        activeTime={time}
      />
      <div className="chronos-wrap">
        <Chronos chronos={G.chronos} currentTime={time} />
      </div>
      <FieldZone
        label={`${t('player.me')} ${t('board.battleZone')}`}
        shortLabel={t('board.battleZoneShort')}
        className="battle-zone central-battle-zone player-battle-zone"
        card={me.battleZone}
        size="normal"
        activeTime={time}
      />
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
        <span>{`${t('board.hand')} (${cards.length}) ${expanded ? '▼' : '▲'}`}</span>
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

function InfoBar({ G, opponentIndex, time, phaseText }: {
  G: GameState;
  opponentIndex: PlayerIndex;
  time: ChronosTime;
  phaseText: string;
}) {
  return (
    <section className="info-bar" aria-label={phaseText}>
      <span>{t('board.turn')} {G.turnNumber}</span>
      <span className={`time-badge ${time}`}>{time === 'night' ? `🌙 ${t('board.night')}` : `☀️ ${t('board.day')}`}</span>
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
  const [handExpanded, setHandExpanded] = useState(true);
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

  useEffect(() => {
    if ((G.step === 'initialSet' || G.step === 'turnSet') && !G.ready[meIndex]) setHandExpanded(true);
  }, [G.step, G.turnNumber, G.ready, meIndex]);

  useEffect(() => {
    if (G.ready[meIndex]) setHandExpanded(false);
  }, [G.ready, meIndex]);

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
    <div className={`board chrono-${time} ${handExpanded ? 'drawer-expanded' : 'drawer-collapsed'}`}>
      <main className="field-layout">
        <OpponentField G={G} opponentIndex={opponentIndex} />
        <CentralArena G={G} meIndex={meIndex} opponentIndex={opponentIndex} time={time} />
        <PlayerField
          G={G}
          meIndex={meIndex}
          timeLeft={timeLeft}
          timerTone={timerTone}
          moves={moves}
        />
      </main>
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
            moves.confirmReady();
            setHandExpanded(false);
          }}
        />
        <InfoBar G={G} opponentIndex={opponentIndex} time={time} phaseText={phaseText} />
      </HandDrawer>
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
