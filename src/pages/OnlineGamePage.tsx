import { useNavigate, useParams } from 'react-router-dom';
import { OnlineGame } from '../components/OnlineGame';
import { t } from '../i18n';

export interface OnlineSession {
  matchID: string;
  playerID: '0' | '1';
  playerCredentials: string;
}

interface OnlineGamePageProps {
  session: OnlineSession | null;
  onClearSession: () => void;
}

export function OnlineGamePage({ session, onClearSession }: OnlineGamePageProps) {
  const navigate = useNavigate();
  const { matchID = '' } = useParams<'matchID'>();
  const activeSession = session?.matchID === matchID ? session : null;

  if (!activeSession) {
    return (
      <main className="online-session-missing app-screen">
        <section className="empty-route-panel">
          <span>{t('game.onlineMode')}</span>
          <h1>{t('onlineSession.missingTitle')}</h1>
          <p>{t('onlineSession.missingBody')}</p>
          <button className="primary-action" type="button" onClick={() => navigate('/')}>
            {t('common.backToLobby')}
          </button>
        </section>
      </main>
    );
  }

  return (
    <OnlineGame
      matchID={activeSession.matchID}
      playerID={activeSession.playerID}
      playerCredentials={activeSession.playerCredentials}
      onBack={() => {
        onClearSession();
        navigate('/');
      }}
    />
  );
}
