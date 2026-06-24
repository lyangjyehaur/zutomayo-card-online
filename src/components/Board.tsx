import { BoardProps } from 'boardgame.io/react';
import { useState, useEffect, useRef } from 'react';
import type { GameState } from '../game/types';
import { getCardDef } from '../game/cards/loader';
import { Card } from './Card';
import { Chronos } from './Chronos';
import { getChronosTime, getMaxSetCards } from '../game/GameLogic';
import { saveMatchRecord } from '../game/matchHistory';

const TURN_TIMER_SECONDS = 60;

export function Board({ G, ctx, moves, playerID }: BoardProps<GameState>) {
  const myIdx = parseInt(playerID || '0') as 0 | 1;
  const oppIdx = (1 - myIdx) as 0 | 1;
  const me = G.players[myIdx];
  const opp = G.players[oppIdx];
  const currentTime = getChronosTime(G);

  const maxSet = getMaxSetCards(G, myIdx);
  const canSet = me.cardsSetThisTurn < maxSet;

  // Turn timer
  const [timeLeft, setTimeLeft] = useState(TURN_TIMER_SECONDS);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setTimeLeft(TURN_TIMER_SECONDS);
    if (timerRef.current) clearInterval(timerRef.current);

    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          // Auto-confirm when timer runs out
          if (me.cardsSetThisTurn > 0) {
            moves.confirmSet();
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [G.turn, me.cardsSetThisTurn]);

  const timerColor = timeLeft > 30 ? '#2ec4b6' : timeLeft > 10 ? '#f4d35e' : '#e63946';

  if (ctx.gameover) {
    // Save match record
    saveMatchRecord(G, ctx.gameover.winner as string);
    return (
      <div className="game-over">
        <h1>Game Over</h1>
        <p>{ctx.gameover.winner}</p>
        <button onClick={() => window.location.reload()}>Play Again</button>
      </div>
    );
  }

  return (
    <div className="board">
      {/* Opponent area */}
      <div className="player-area opponent">
        <div className="player-info">
          <span className="hp">❤️ {opp.hp}</span>
          <span className="deck-cards">🃏 {opp.deck.length}</span>
          <span className="power">⚡ {opp.powerCharger.reduce((s, c) => s + (getCardDef(c.defId)?.sendToPower || 0), 0)}</span>
        </div>

        <div className="zones opponent-zones">
          <div className="zone set-zone">
            <div className="zone-label">Set A</div>
            {opp.setZoneA && <Card card={opp.setZoneA} small />}
          </div>
          <div className="zone battle-zone">
            <div className="zone-label">Battle</div>
            {opp.battleZone && <Card card={opp.battleZone} />}
          </div>
          <div className="zone set-zone">
            <div className="zone-label">Set B</div>
            {opp.setZoneB && <Card card={opp.setZoneB} small />}
          </div>
          <div className="zone area-zone">
            <div className="zone-label">Area E</div>
            {opp.setZoneC && <Card card={opp.setZoneC} small />}
          </div>
        </div>

        <div className="side-zones">
          <span title="Power Charger">⚡{opp.powerCharger.length}</span>
          <span title="Abyss">🕳️{opp.abyss.length}</span>
        </div>

        <div className="opponent-hand">
          {opp.hand.map((c, i) => (
            <Card key={c.instanceId} card={{ ...c, faceUp: false }} small />
          ))}
        </div>
      </div>

      {/* Center: Chronos */}
      <div className="center-area">
        <Chronos chronos={G.chronos} currentTime={currentTime} />
        <div className="turn-info">
          <div>Turn {G.turn + 1}</div>
          <div>{currentTime === 'night' ? '🌙 Night' : '☀️ Day'} Phase</div>
          <div className="turn-timer" style={{ color: timerColor }}>
            ⏱ {timeLeft}s
          </div>
          {G.lastBattleResult.winner !== null && (
            <div className="last-battle">
              Last: {G.lastBattleResult.winnerAttack} vs {G.lastBattleResult.loserAttack}
              {G.lastBattleResult.damage > 0 && ` (${G.lastBattleResult.damage} dmg)`}
            </div>
          )}
        </div>
      </div>

      {/* My area */}
      <div className="player-area self">
        <div className="zones my-zones">
          <div className="zone set-zone">
            <div className="zone-label">Set A</div>
            {me.setZoneA && <Card card={me.setZoneA} small />}
          </div>
          <div className="zone battle-zone">
            <div className="zone-label">Battle</div>
            {me.battleZone && <Card card={me.battleZone} />}
          </div>
          <div className="zone set-zone">
            <div className="zone-label">Set B</div>
            {me.setZoneB && <Card card={me.setZoneB} small />}
          </div>
          <div className="zone area-zone">
            <div className="zone-label">Area E</div>
            {me.setZoneC && <Card card={me.setZoneC} small />}
          </div>
        </div>

        <div className="player-info">
          <span className="hp">❤️ {me.hp}</span>
          <span className="deck-cards">🃏 {me.deck.length}</span>
          <span className="power">⚡ {me.powerCharger.reduce((s, c) => s + (getCardDef(c.defId)?.sendToPower || 0), 0)}</span>
          <span className="abyss">🕳️ {me.abyss.length}</span>
        </div>

        {/* Hand */}
        <div className="hand">
          {me.hand.map((card, i) => (
            <Card
              key={card.instanceId}
              card={card}
              small
              onClick={canSet ? () => {
                const slot = !me.setZoneA ? 'A' : 'B';
                moves.selectCard(i, slot);
              } : undefined}
            />
          ))}
        </div>

        <div className="actions">
          <button
            disabled={me.cardsSetThisTurn === 0}
            onClick={() => moves.confirmSet()}
          >
            Confirm Set ({me.cardsSetThisTurn}/{maxSet})
          </button>
        </div>
      </div>

      {/* Game log */}
      <details className="game-log">
        <summary>Game Log</summary>
        <div>
          {G.log.slice(-10).map((entry, i) => (
            <div key={i} className="log-entry">{entry}</div>
          ))}
        </div>
      </details>
    </div>
  );
}
