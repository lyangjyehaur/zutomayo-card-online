import { useState } from 'react';
import { Client } from 'boardgame.io/react';
import { SocketIO } from 'boardgame.io/multiplayer';
import { ZutomayoCard } from '../game/Game';
import { Board } from './Board';

interface OnlineGameProps {
  matchID: string;
  playerID: string;
  playerCredentials: string;
  onBack: () => void;
}

export function OnlineGame({ matchID, playerID, playerCredentials, onBack }: OnlineGameProps) {
  const [OnlineClient] = useState(() => Client({
    game: ZutomayoCard,
    board: Board,
    numPlayers: 2,
    multiplayer: SocketIO({ server: window.location.origin }),
    debug: false,
  }));

  return (
    <div className="app">
      <div className="ai-header">
        <button className="back-btn" onClick={onBack}>← Back to Lobby</button>
        <span className="ai-label">⚔️ Online Match: {matchID}</span>
      </div>
      <div className="game-container single">
        <OnlineClient playerID={playerID} matchID={matchID} credentials={playerCredentials} />
      </div>
    </div>
  );
}
