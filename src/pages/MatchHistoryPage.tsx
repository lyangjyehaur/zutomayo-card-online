import { useLocation, useNavigate } from 'react-router-dom';
import { MatchHistory } from '../components/MatchHistory';

export function MatchHistoryPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const chatSourceMatchId = new URLSearchParams(location.search).get('chat')?.trim() || undefined;

  return <MatchHistory initialChatSourceMatchId={chatSourceMatchId} onBack={() => navigate('/')} />;
}
