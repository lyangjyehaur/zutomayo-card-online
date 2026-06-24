import type { BoardProps } from 'boardgame.io/react';
import { useEffect, useRef, useState } from 'react';
import type { GameState, JankenChoice, PlayerIndex } from '../game/types';
import { getCardDef } from '../game/cards/loader';
import { Card } from './Card';
import { Chronos } from './Chronos';
import { getChronosTime, getRequiredSetCount } from '../game/GameLogic';
import { saveMatchRecord } from '../game/matchHistory';

const TURN_TIMER_SECONDS = 60;
type Props = BoardProps<GameState>;

function JankenScreen({ G, moves, playerID }: Props) {
  const me = Number(playerID ?? '0') as PlayerIndex;
  const choice = G.jankenChoices[me];
  const labels: Record<JankenChoice, string> = { rock: '✊ Rock', paper: '✋ Paper', scissors: '✌️ Scissors' };
  return (
    <div className="setup-screen">
      <h2>✊ Rock · ✋ Paper · ✌️ Scissors</h2>
      <p className="setup-hint">Janken determines the night-side player.</p>
      {choice ? <p className="janken-waiting">You chose {labels[choice]}. Waiting for opponent…</p> : (
        <div className="janken-buttons">
          {(Object.keys(labels) as JankenChoice[]).map(value => (
            <button key={value} className="janken-btn" onClick={() => moves.janken(value)}>{labels[value]}</button>
          ))}
        </div>
      )}
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
    <div className="setup-screen">
      <h2>Opening hand</h2>
      <p className="setup-hint">Select any cards to redraw once, or keep all five.</p>
      <div className="mulligan-hand">
        {G.players[me].hand.map((card, index) => (
          <div key={card.instanceId} className={`mulligan-card ${selected.includes(index) ? 'selected' : ''}`} onClick={() => !done && toggle(index)}>
            <Card card={card} small />
          </div>
        ))}
      </div>
      {done ? <p className="mulligan-done">Waiting for opponent…</p> : (
        <div className="mulligan-actions">
          <button className="mulligan-btn" onClick={() => moves.mulligan(selected)}>Redraw {selected.length}</button>
          <button className="mulligan-btn keep" onClick={() => moves.keepHand()}>Keep hand</button>
        </div>
      )}
    </div>
  );
}

function GameOverScreen({ G, ctx, matchStartedAt }: Props & { matchStartedAt: number }) {
  const saved = useRef(false);

  useEffect(() => {
    if (saved.current) return;
    saved.current = true;
    const gameover = ctx.gameover as { winner?: string | number; draw?: boolean } | undefined;
    const durationSeconds = (Date.now() - matchStartedAt) / 1000;
    saveMatchRecord(G, gameover?.winner ?? (G.winner === null ? null : G.winner), durationSeconds);
  }, [G, ctx.gameover, matchStartedAt]); // Persist this terminal snapshot once per mounted match.
  return (
    <div className="game-over">
      <h1>Game Over</h1>
      <p>{G.winner === null ? 'Draw' : `Player ${G.winner} wins`}</p>
      <p>{G.gameoverReason}</p>
      {ctx.gameover && <button onClick={() => window.location.reload()}>Play Again</button>}
    </div>
  );
}

function powerTotal(G: GameState, player: PlayerIndex): number {
  return G.players[player].powerCharger.reduce(
    (sum, card) => sum + (getCardDef(card.defId)?.sendToPower ?? 0), 0,
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
    if (G.step === 'turnSet' && timeLeft === 0 && !G.ready[meIndex] && me.cardsSetThisTurn === required) moves.confirmReady();
  }, [G.step, timeLeft, G.ready, me.cardsSetThisTurn, required, meIndex, moves]);

  const setFromHand = (handIndex: number) => {
    if (G.ready[meIndex] || me.cardsSetThisTurn >= required) return;
    if (G.step === 'initialSet') moves.setInitialCard(handIndex);
    else moves.setTurnCard(handIndex, me.setZoneA ? 'B' : 'A');
  };
  const time = getChronosTime(G);
  const timerColor = timeLeft > 30 ? '#2ec4b6' : timeLeft > 10 ? '#f4d35e' : '#e63946';
  return (
    <div className="board">
      <div className="player-area opponent">
        <div className="player-info"><span>❤️ {opponent.hp}</span><span>🃏 {opponent.deck.length}</span><span>⚡ {powerTotal(G, opponentIndex)}</span></div>
        <div className="zones opponent-zones">
          <div className="zone set-zone"><div className="zone-label">Set A</div>{opponent.setZoneA && <Card card={opponent.setZoneA} small />}</div>
          <div className="zone battle-zone"><div className="zone-label">Battle</div>{opponent.battleZone && <Card card={opponent.battleZone} />}</div>
          <div className="zone set-zone"><div className="zone-label">Set B</div>{opponent.setZoneB && <Card card={opponent.setZoneB} small />}</div>
          <div className="zone area-zone"><div className="zone-label">Area</div>{opponent.setZoneC && <Card card={opponent.setZoneC} small />}</div>
        </div>
        <div className="opponent-hand">{opponent.hand.map(card => <Card key={card.instanceId} card={{ ...card, faceUp: false }} small />)}</div>
      </div>

      <div className="center-area">
        <Chronos chronos={G.chronos} currentTime={time} />
        <div className="turn-info">
          <div>Turn {G.turnNumber}</div><div>{time === 'night' ? '🌙 Night' : '☀️ Day'}</div>
          {G.step === 'turnSet' && <div className="turn-timer" style={{ color: timerColor }}>⏱ {timeLeft}s</div>}
          <div>{G.step === 'initialSet' ? 'Initial battle-zone setup' : `Set ${required} card${required === 1 ? '' : 's'}`}</div>
          <div>{G.ready[opponentIndex] ? 'Opponent ready' : 'Opponent choosing'}</div>
        </div>
      </div>

      <div className="player-area self">
        <div className="zones my-zones">
          <div className="zone set-zone" onClick={() => moves.undoSetCard('A')}><div className="zone-label">Set A</div>{me.setZoneA && <Card card={{ ...me.setZoneA, faceUp: true }} small />}</div>
          <div className="zone battle-zone"><div className="zone-label">Battle</div>{me.battleZone && <Card card={me.battleZone} />}</div>
          <div className="zone set-zone" onClick={() => moves.undoSetCard('B')}><div className="zone-label">Set B</div>{me.setZoneB && <Card card={{ ...me.setZoneB, faceUp: true }} small />}</div>
          <div className="zone area-zone"><div className="zone-label">Area</div>{me.setZoneC && <Card card={me.setZoneC} small />}</div>
        </div>
        <div className="player-info"><span>❤️ {me.hp}</span><span>🃏 {me.deck.length}</span><span>⚡ {powerTotal(G, meIndex)}</span><span>🕳️ {me.abyss.length}</span></div>
        <div className="hand">{me.hand.map((card, index) => <Card key={card.instanceId} card={card} small onClick={!G.ready[meIndex] ? () => setFromHand(index) : undefined} />)}</div>
        <div className="actions">
          <button disabled={G.ready[meIndex] || me.cardsSetThisTurn !== required} onClick={() => moves.confirmReady()}>
            {G.ready[meIndex] ? 'Ready — waiting' : `Confirm (${me.cardsSetThisTurn}/${required})`}
          </button>
        </div>
      </div>
      <details className="game-log"><summary>Game Log</summary>{G.log.slice(-12).map((entry, index) => <div key={index}>{entry}</div>)}</details>
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
