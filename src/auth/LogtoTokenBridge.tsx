import { useEffect } from 'react';
import { useLogto } from '@logto/react';
import { setAccessTokenProvider, setLogtoAuthenticated } from '../api/client';
import { logtoApiResource } from './logto';

export function LogtoTokenBridge() {
  const { getAccessToken, isAuthenticated } = useLogto();

  useEffect(() => {
    setLogtoAuthenticated(isAuthenticated);
    setAccessTokenProvider(isAuthenticated ? () => getAccessToken(logtoApiResource) : null);
    return () => {
      setAccessTokenProvider(null);
    };
  }, [getAccessToken, isAuthenticated]);

  return null;
}
