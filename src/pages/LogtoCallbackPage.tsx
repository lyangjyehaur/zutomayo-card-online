import { useEffect } from 'react';
import { useHandleSignInCallback } from '@logto/react';
import { useNavigate } from 'react-router-dom';
import { t } from '../i18n';

export function LogtoCallbackPage() {
  const navigate = useNavigate();
  const { isLoading, isAuthenticated, error } = useHandleSignInCallback(() => {
    navigate('/', { replace: true });
  });

  useEffect(() => {
    if (!isLoading && isAuthenticated) navigate('/', { replace: true });
  }, [isAuthenticated, isLoading, navigate]);

  return (
    <main className="app-screen grid place-items-center bg-lacquer-deep font-mono text-[10px] uppercase tracking-[0.3em] text-bone/50">
      {error ? t('auth.profileUnavailable') : t('game.loading')}
    </main>
  );
}
