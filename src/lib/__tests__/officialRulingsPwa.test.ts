import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const viteConfig = readFileSync('vite.config.ts', 'utf8');

describe('official rulings PWA cache contract', () => {
  it('uses a bounded NetworkFirst cache for public rule documents, Q&A, and errata APIs', () => {
    expect(viteConfig).toContain("cacheName: 'official-rulings-api'");
    expect(viteConfig).toContain("handler: 'NetworkFirst'");
    expect(viteConfig).toContain('networkTimeoutSeconds: 4');
    expect(viteConfig).toContain('maxEntries: 200');
    expect(viteConfig).toContain('maxAgeSeconds: 7 * 24 * 60 * 60');
    expect(viteConfig).toContain('/\\/api\\/official\\/');
    expect(viteConfig).toContain('(?:qa|errata|rules)');
  });
});
