export const CACHE_CONTROL = {
  immutable: 'public, max-age=31536000, immutable',
  noStore: 'no-store',
  revalidate: 'public, max-age=0, must-revalidate',
  shortPublic: 'public, max-age=86400, stale-while-revalidate=604800',
} as const;

const STATIC_FILE_PATH = /\/(?:[^/]*\.)[^/]+$/;
const HASHED_WORKBOX_FILE = /^\/workbox-[A-Za-z0-9_-]+\.js$/;

interface FrontendCachePolicyInput {
  buildId: string;
  method: string;
  pathname: string;
  searchParams: URLSearchParams;
  status: number;
}

export function isStaticFilePath(pathname: string): boolean {
  return STATIC_FILE_PATH.test(pathname);
}

export function frontendCacheControl({
  buildId,
  method,
  pathname,
  searchParams,
  status,
}: FrontendCachePolicyInput): string | undefined {
  if (method !== 'GET' && method !== 'HEAD') return undefined;

  const isKnownStaticPath =
    isStaticFilePath(pathname) ||
    pathname.startsWith('/assets/') ||
    pathname.startsWith('/battle/') ||
    pathname.startsWith('/fonts/');
  if (status >= 400) return isKnownStaticPath ? CACHE_CONTROL.noStore : undefined;

  if (pathname.startsWith('/assets/') || HASHED_WORKBOX_FILE.test(pathname)) {
    return CACHE_CONTROL.immutable;
  }
  if (pathname.startsWith('/battle/')) {
    return searchParams.get('v') === buildId ? CACHE_CONTROL.immutable : CACHE_CONTROL.noStore;
  }
  // Font URLs are immutable contracts and must be renamed when their bytes change.
  if (pathname.startsWith('/fonts/')) return CACHE_CONTROL.immutable;
  if (pathname === '/sw.js' || pathname === '/manifest.webmanifest') return CACHE_CONTROL.revalidate;
  if (pathname === '/index.html') return CACHE_CONTROL.noStore;
  if (isStaticFilePath(pathname)) return CACHE_CONTROL.shortPublic;
  return undefined;
}
