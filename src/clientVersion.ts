import { registerSW } from 'virtual:pwa-register';
import { APP_VERSION_INFO, isSameAppVersion, normalizeVersionInfo, type AppVersionInfo } from './version';

export const PWA_UPDATE_READY_EVENT = 'zutomayo:pwa-update-ready';

export interface PwaUpdateReadyDetail {
  applyUpdate: () => void;
}

let currentRegistration: ServiceWorkerRegistration | null = null;
let currentApplyUpdate: (() => void) | null = null;

function dispatchPwaUpdateReady(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<PwaUpdateReadyDetail>(PWA_UPDATE_READY_EVENT, {
      detail: {
        applyUpdate: currentApplyUpdate ?? reloadForAppUpdate,
      },
    }),
  );
}

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

export async function recoverPwaAndReload(): Promise<void> {
  if (typeof window === 'undefined') return;

  const unregisterServiceWorkers = async () => {
    if (!('serviceWorker' in navigator)) return;
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  };

  const clearCaches = async () => {
    if (!('caches' in window)) return;
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
  };

  await Promise.allSettled([unregisterServiceWorkers(), clearCaches()]);
  window.location.reload();
}

export async function checkForPwaUpdate(): Promise<'update-ready' | 'up-to-date' | 'unsupported'> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return 'unsupported';

  const registration = currentRegistration ?? (await navigator.serviceWorker.getRegistration());
  if (!registration) return 'unsupported';

  await registration.update();
  if (registration.waiting) {
    dispatchPwaUpdateReady();
    return 'update-ready';
  }

  return 'up-to-date';
}

export function registerPwaAutoUpdate(): void {
  if (typeof window === 'undefined') return;
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      dispatchPwaUpdateReady();
    },
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      currentRegistration = registration;
      currentApplyUpdate = () => {
        void updateSW(true);
      };
      window.setInterval(
        () => {
          void registration.update();
        },
        60 * 60 * 1000,
      );
    },
  });
}
