import { registerSW } from 'virtual:pwa-register';
import { APP_VERSION_INFO, isSameAppVersion, normalizeVersionInfo, type AppVersionInfo } from './version';

export class VersionMismatchError extends Error {
  serverVersion: AppVersionInfo | null;

  constructor(serverVersion: AppVersionInfo | null) {
    super('online.versionMismatch');
    this.name = 'VersionMismatchError';
    this.serverVersion = serverVersion;
  }
}

export function isVersionMismatchError(error: unknown): error is VersionMismatchError {
  return (
    error instanceof VersionMismatchError || (error instanceof Error && error.message === 'online.versionMismatch')
  );
}

export async function fetchServerVersion(): Promise<AppVersionInfo | null> {
  const response = await fetch('/api/app-version', {
    cache: 'no-store',
    headers: {
      'X-Client-App-Version': APP_VERSION_INFO.appVersion,
      'X-Client-Build-Id': APP_VERSION_INFO.buildId,
      'X-Client-Rules-Version': APP_VERSION_INFO.rulesVersion,
    },
  });
  if (!response.ok) return null;
  return normalizeVersionInfo(await response.json());
}

export async function ensureCompatibleAppVersion(): Promise<void> {
  const serverVersion = await fetchServerVersion();
  if (serverVersion && !isSameAppVersion(APP_VERSION_INFO, serverVersion)) {
    throw new VersionMismatchError(serverVersion);
  }
}

export function reloadForAppUpdate(): void {
  if (typeof window === 'undefined') return;
  window.location.reload();
}

export function registerPwaAutoUpdate(): void {
  if (typeof window === 'undefined') return;
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      void updateSW(true);
    },
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      window.setInterval(
        () => {
          void registration.update();
        },
        60 * 60 * 1000,
      );
    },
  });
}
