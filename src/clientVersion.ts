import { registerSW } from 'virtual:pwa-register';
import { APP_VERSION_INFO, isSameAppVersion, normalizeVersionInfo, type AppVersionInfo } from './version';

export const PWA_UPDATE_READY_EVENT = 'zutomayo:pwa-update-ready';
export const PWA_RECOVER_REQUESTED_EVENT = 'zutomayo:pwa-recover-requested';

export interface PwaUpdateReadyDetail {
  applyUpdate: () => void;
}

let currentApplyUpdate: (() => void) | null = null;
let pendingUpdateReady: PwaUpdateReadyDetail | null = null;
let currentRegistration: ServiceWorkerRegistration | null = null;

function waitForPwaUpdateReady(timeoutMs = 1500): Promise<PwaUpdateReadyDetail | null> {
  if (typeof window === 'undefined' || pendingUpdateReady) return Promise.resolve(pendingUpdateReady);

  return new Promise((resolve) => {
    let timeoutId: number | null = null;
    const finish = (updateReady: PwaUpdateReadyDetail | null) => {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      window.removeEventListener(PWA_UPDATE_READY_EVENT, onUpdateReady);
      resolve(updateReady);
    };
    const onUpdateReady = (event: Event) => {
      const updateEvent = event as CustomEvent<PwaUpdateReadyDetail>;
      finish(updateEvent.detail ?? pendingUpdateReady);
    };

    window.addEventListener(PWA_UPDATE_READY_EVENT, onUpdateReady);
    timeoutId = window.setTimeout(() => finish(pendingUpdateReady), timeoutMs);
  });
}

function dispatchPwaUpdateReady(): void {
  if (typeof window === 'undefined') return;
  pendingUpdateReady = {
    applyUpdate: currentApplyUpdate ?? reloadForAppUpdate,
  };
  window.dispatchEvent(
    new CustomEvent<PwaUpdateReadyDetail>(PWA_UPDATE_READY_EVENT, {
      detail: pendingUpdateReady,
    }),
  );
}

export function getPendingPwaUpdate(): PwaUpdateReadyDetail | null {
  return pendingUpdateReady;
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
  const data = await response.json();
  return normalizeVersionInfo(data) ?? normalizeVersionInfo((data as { version?: unknown }).version);
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

export function requestPwaRecoveryPrompt(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(PWA_RECOVER_REQUESTED_EVENT));
}

export async function requestPwaUpdateCheck(): Promise<PwaUpdateReadyDetail | null> {
  if (typeof window === 'undefined') return pendingUpdateReady;
  if (currentRegistration) {
    const updateReadyPromise = waitForPwaUpdateReady();
    await currentRegistration.update();
    if (pendingUpdateReady) return pendingUpdateReady;
    return updateReadyPromise;
  }
  return pendingUpdateReady;
}

export async function applyPwaUpdateOrRecover(preferredUpdate: PwaUpdateReadyDetail | null = null): Promise<void> {
  const updateReady = preferredUpdate ?? pendingUpdateReady ?? (await requestPwaUpdateCheck().catch(() => null));
  if (updateReady) {
    updateReady.applyUpdate();
    return;
  }
  await recoverPwaAndReload();
}

export function registerPwaAutoUpdate(): void {
  if (typeof window === 'undefined') return;
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      currentApplyUpdate = () => {
        void updateSW(true);
      };
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
