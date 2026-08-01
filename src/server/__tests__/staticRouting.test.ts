import { describe, expect, it } from 'vitest';
import { shouldServeSpaFallback } from '../staticRouting';

describe('SPA fallback routing', () => {
  it('serves client-side application routes', () => {
    expect(shouldServeSpaFallback('/online/room/ABC123')).toBe(true);
    expect(shouldServeSpaFallback('/qa/battle')).toBe(true);
  });

  it('does not turn missing static assets into cacheable HTML', () => {
    expect(shouldServeSpaFallback('/battle/chronos.svg')).toBe(false);
    expect(shouldServeSpaFallback('/battle/chronos-slots/00.svg')).toBe(false);
    expect(shouldServeSpaFallback('/assets/app.js')).toBe(false);
    expect(shouldServeSpaFallback('/favicon.ico')).toBe(false);
  });

  it('continues boardgame.io routes instead of serving the application shell', () => {
    expect(shouldServeSpaFallback('/games/zutomayo/create')).toBe(false);
  });
});
