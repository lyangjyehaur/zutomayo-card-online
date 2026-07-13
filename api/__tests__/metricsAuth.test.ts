import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { metricsRequestAuthorized } = require('../metricsAuth.cjs') as {
  metricsRequestAuthorized: (authorization?: string, options?: { token?: string; nodeEnv?: string }) => boolean;
};

describe('API metrics authentication', () => {
  it('fails closed without a production token', () => {
    expect(metricsRequestAuthorized(undefined, { token: '', nodeEnv: 'production' })).toBe(false);
    expect(metricsRequestAuthorized(undefined, { token: '', nodeEnv: 'development' })).toBe(true);
  });

  it('requires the exact bearer token when configured', () => {
    expect(metricsRequestAuthorized(undefined, { token: 'metrics-secret', nodeEnv: 'production' })).toBe(false);
    expect(metricsRequestAuthorized('Bearer wrong', { token: 'metrics-secret', nodeEnv: 'production' })).toBe(false);
    expect(metricsRequestAuthorized('Bearer metrics-secret', { token: 'metrics-secret', nodeEnv: 'production' })).toBe(
      true,
    );
  });
});
