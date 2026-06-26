import { useCallback, useEffect, useRef, useState } from 'react';
import { Client, type BoardProps } from 'boardgame.io/react';
import { SocketIO } from 'boardgame.io/multiplayer';
import { ZutomayoCard } from '../game/Game';
import type { GameState } from '../game/types';
import { Board } from './Board';
import { t } from '../i18n';

interface OnlineGameProps {
  matchID: string;
  playerID: string;
  playerCredentials: string;
  showRejoinedStatus?: boolean;
  onBack: () => void;
}

type ConnectionStatus = 'reconnecting' | 'disconnected' | 'rejoined' | null;

function OnlineLoading() {
  return <div className="online-connection-panel" role="status">{t('onlineSession.reconnecting')}</div>;
}

function OnlineBoard(
  props: BoardProps<GameState> & { onConnectionStatusChange: (isConnected: boolean) => void },
) {
  const { onConnectionStatusChange, ...boardProps } = props;

  useEffect(() => {
    onConnectionStatusChange(props.isConnected);
  }, [onConnectionStatusChange, props.isConnected]);

  return <Board {...boardProps} />;
}

export function OnlineGame({
  matchID,
  playerID,
  playerCredentials,
  showRejoinedStatus = false,
  onBack,
}: OnlineGameProps) {
  const connectedOnce = useRef(false);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('reconnecting');

  useEffect(() => () => {
    if (statusTimer.current) clearTimeout(statusTimer.current);
  }, []);

  const flashRejoined = useCallback(() => {
    if (statusTimer.current) clearTimeout(statusTimer.current);
    setConnectionStatus('rejoined');
    statusTimer.current = setTimeout(() => setConnectionStatus(null), 2400);
  }, []);

  const handleConnectionStatusChange = useCallback((isConnected: boolean) => {
    if (isConnected) {
      const isReconnect = connectedOnce.current;
      connectedOnce.current = true;
      if (showRejoinedStatus || isReconnect) flashRejoined();
      else setConnectionStatus(null);
      return;
    }

    setConnectionStatus(connectedOnce.current ? 'disconnected' : 'reconnecting');
  }, [flashRejoined, showRejoinedStatus]);

  const [OnlineClient] = useState(() => Client({
    game: ZutomayoCard,
    board: (props: BoardProps<GameState>) => (
      <OnlineBoard {...props} onConnectionStatusChange={handleConnectionStatusChange} />
    ),
    loading: OnlineLoading,
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
        {connectionStatus && (
          <span className={`online-connection-status ${connectionStatus}`}>
            {connectionStatus === 'rejoined'
              ? t('onlineSession.rejoined')
              : connectionStatus === 'disconnected'
              ? t('onlineSession.disconnectedRetrying')
              : t('onlineSession.reconnecting')}
          </span>
        )}
      </header>
      <div className="game-container single">
        <OnlineClient playerID={playerID} matchID={matchID} credentials={playerCredentials} />
      </div>
    </div>
  );
}
