import { useNavigate } from 'react-router-dom';
import { MatchHistory } from '../components/MatchHistory';

export function MatchHistoryPage() {
  const navigate = useNavigate();

  return <MatchHistory onBack={() => navigate('/')} />;
}
