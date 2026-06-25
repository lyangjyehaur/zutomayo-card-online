import { useNavigate } from 'react-router-dom';
import { DeckEditor } from '../components/DeckEditor';

interface DeckEditorPageProps {
  onDeckSaved: () => void;
}

export function DeckEditorPage({ onDeckSaved }: DeckEditorPageProps) {
  const navigate = useNavigate();

  return (
    <DeckEditor
      onSave={() => {
        onDeckSaved();
        navigate('/');
      }}
      onCancel={() => navigate('/')}
    />
  );
}
