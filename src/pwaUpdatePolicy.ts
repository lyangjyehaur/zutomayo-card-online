import type { AppVersionInfo } from './version';

export const PWA_LAST_BOOT_RELEASE_STORAGE_KEY = 'zutomayo:pwa:last-boot-build';

export type PwaBootTransition = 'first-visit' | 'same-build' | 'updated' | 'storage-unavailable';

/** The home lobby is the only route where an automatic reload cannot interrupt a match or editor workflow. */
export function isPwaUpdateSafePath(pathname: string): boolean {
  return pathname === '/';
}

function releaseIdentity(version: Pick<AppVersionInfo, 'buildId' | 'builtAt'>): string {
  return version.builtAt ? `${version.buildId}@${version.builtAt}` : version.buildId;
}

export function recordRunningRelease(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null,
  version: Pick<AppVersionInfo, 'buildId' | 'builtAt'>,
): PwaBootTransition {
  if (!storage) return 'storage-unavailable';
  try {
    const currentRelease = releaseIdentity(version);
    const previousRelease = storage.getItem(PWA_LAST_BOOT_RELEASE_STORAGE_KEY);
    storage.setItem(PWA_LAST_BOOT_RELEASE_STORAGE_KEY, currentRelease);
    if (!previousRelease) return 'first-visit';
    return previousRelease === currentRelease ? 'same-build' : 'updated';
  } catch {
    return 'storage-unavailable';
  }
}
