import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_RATE_LIMIT, apiRateLimitConfig } from '../rateLimitConfig.cjs';

describe('API rate-limit configuration', () => {
  it('preserves production defaults when overrides are absent', () => {
    expect(apiRateLimitConfig({})).toEqual({
      windowMs: 60_000,
      auth: 10,
      default: 120,
      imgproxy: 600,
      upload: 10,
    });
  });

  it('accepts bounded integer overrides for isolated test and load environments', () => {
    expect(
      apiRateLimitConfig({
        RATE_LIMIT_AUTH: '1000',
        RATE_LIMIT_DEFAULT: '10000',
        RATE_LIMIT_IMGPROXY: '2000',
        RATE_LIMIT_UPLOAD: '500',
      }),
    ).toMatchObject({ auth: 1_000, default: 10_000, imgproxy: 2_000, upload: 500 });
  });

  it.each(['0', '-1', '1.5', 'disabled', String(MAX_RATE_LIMIT + 1)])('rejects invalid override %s', (value) => {
    expect(() => apiRateLimitConfig({ RATE_LIMIT_DEFAULT: value })).toThrow(/RATE_LIMIT_DEFAULT/);
  });

  it('raises limits only in the E2E overlay instead of disabling the limiter', () => {
    const compose = readFileSync('docker-compose.e2e.yml', 'utf8');
    expect(compose).toContain('RATE_LIMIT_AUTH=1000');
    expect(compose).toContain('RATE_LIMIT_DEFAULT=10000');
    expect(compose).toContain('RATE_LIMIT_UPLOAD=1000');
    expect(compose).not.toMatch(/RATE_LIMIT_(?:AUTH|DEFAULT|UPLOAD)=0/);
  });
});
