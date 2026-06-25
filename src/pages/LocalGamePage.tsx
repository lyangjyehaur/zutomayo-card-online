import { useEffect, useState } from 'react';
import { Client } from 'boardgame.io/react';
import { Local } from 'boardgame.io/multiplayer';
import { useNavigate } from 'react-router-dom';
import { Board } from '../components/Board';
import { createZutomayoCard } from '../game/Game';
import { t } from '../i18n';

interface LocalGamePageProps {
  deck0Name?: string;
  deck1Name?: string;
}

export function LocalGamePage({ deck0Name, deck1Name }: LocalGamePageProps) {
  const navigate = useNavigate();
  const [gameActive, setGameActive] = useState(false);
  const [LocalClient, setLocalClient] = useState<ReturnType<typeof Client> | null>(null);

  useEffect(() => {
    const client = Client({
      game: createZutomayoCard({ deck0Name, deck1Name }),
      board: Board,
      numPlayers: 2,
      multiplayer: Local(),
      debug: false,
    });
    setLocalClient(() => client);
    setGameActive(true);
  }, [deck0Name, deck1Name]);

  if (!gameActive || !LocalClient) {
    return (
      <div className="app game-app loading-game">
        <div>{t('game.loading')}</div>
      </div>
    );
  }

  return (
    <div className="app game-app">
      <header className="game-header">
        <button className="back-btn" type="button" onClick={() => navigate('/')}>{t('common.backToLobby')}</button>
        <div>
          <strong>{t('game.localMode')}</strong>
          <span>{t('player.zero')} / {t('player.one')}</span>
        </div>
      </header>
      <div className="game-container local-duel">
        <section className="player-view">
          <div className="view-label">{t('player.zeroView')}</div>
          <LocalClient playerID="0" />
        </section>
        <section className="player-view">
          <div className="view-label">{t('player.oneView')}</div>
          <LocalClient playerID="1" />
        </section>
      </div>
    </div>
  );
}
