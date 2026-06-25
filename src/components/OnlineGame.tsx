import { useState } from 'react';
import { Client } from 'boardgame.io/react';
import { SocketIO } from 'boardgame.io/multiplayer';
import { ZutomayoCard } from '../game/Game';
import { Board } from './Board';
import { t } from '../i18n';

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
    <div className="app game-app">
      <header className="game-header">
        <button className="back-btn" type="button" onClick={onBack}>{t('common.backToLobby')}</button>
        <div>
          <strong>{t('game.onlineMode')}</strong>
          <span>{t('game.matchCode')} {matchID}</span>
        </div>
      </header>
      <div className="game-container single">
        <OnlineClient playerID={playerID} matchID={matchID} credentials={playerCredentials} />
      </div>
    </div>
  );
}
