import { describe, expect, it } from 'vitest';
import { CACHE_CONTROL, frontendCacheControl } from '../cachePolicy';

function policy(pathname: string, options: { method?: string; status?: number; query?: string } = {}) {
  return frontendCacheControl({
    buildId: 'build-123',
    method: options.method ?? 'GET',
    pathname,
    searchParams: new URLSearchParams(options.query),
    status: options.status ?? 200,
  });
}

describe('frontend cache policy', () => {
  it('keeps hashed build output and versioned fonts immutable', () => {
    expect(policy('/assets/index-DT9XGHRa.js')).toBe(CACHE_CONTROL.immutable);
    expect(policy('/workbox-2767b327.js')).toBe(CACHE_CONTROL.immutable);
    expect(policy('/fonts/jiangcheng-jiexing-ui-v1.woff2')).toBe(CACHE_CONTROL.immutable);
  });

  it('only makes battle assets immutable for the active build ID', () => {
    expect(policy('/battle/chronos.svg', { query: 'v=build-123' })).toBe(CACHE_CONTROL.immutable);
    expect(policy('/battle/chronos.svg')).toBe(CACHE_CONTROL.noStore);
    expect(policy('/battle/chronos.svg', { query: 'v=old-build' })).toBe(CACHE_CONTROL.noStore);
  });

  it('revalidates PWA control files and never stores HTML', () => {
    expect(policy('/sw.js')).toBe(CACHE_CONTROL.revalidate);
    expect(policy('/manifest.webmanifest')).toBe(CACHE_CONTROL.revalidate);
    expect(policy('/index.html')).toBe(CACHE_CONTROL.noStore);
  });

  it('does not cache missing static-looking responses or mutation responses', () => {
    expect(policy('/battle/missing.svg', { query: 'v=build-123', status: 404 })).toBe(CACHE_CONTROL.noStore);
    expect(policy('/assets/missing.js', { status: 500 })).toBe(CACHE_CONTROL.noStore);
    expect(policy('/assets/index-DT9XGHRa.js', { method: 'POST' })).toBeUndefined();
  });
});
