import { UserScope, type LogtoConfig } from '@logto/react';

const endpoint = import.meta.env.VITE_LOGTO_ENDPOINT?.replace(/\/+$/, '') ?? '';
const appId = import.meta.env.VITE_LOGTO_APP_ID ?? '';

export const logtoApiResource = import.meta.env.VITE_LOGTO_API_RESOURCE ?? '';
export const isLogtoConfigured = Boolean(endpoint && appId && logtoApiResource);

export const logtoConfig: LogtoConfig | null = isLogtoConfigured
  ? {
      endpoint,
      appId,
      resources: logtoApiResource ? [logtoApiResource] : undefined,
      scopes: [UserScope.Email],
    }
  : null;

export function logtoRedirectUri(): string {
  return `${window.location.origin}/callback`;
}

export function logtoPostLogoutRedirectUri(): string {
  return window.location.origin;
}
