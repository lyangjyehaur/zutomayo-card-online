import { describe, expect, it } from 'vitest';
import { metricsRequestAuthorized } from '../observability/metrics';

describe('game metrics authentication', () => {
  it('fails closed without a production token', () => {
    expect(metricsRequestAuthorized(undefined, '', 'production')).toBe(false);
    expect(metricsRequestAuthorized(undefined, '', 'development')).toBe(true);
  });

  it('requires the exact bearer token when configured', () => {
    expect(metricsRequestAuthorized(undefined, 'metrics-secret', 'production')).toBe(false);
    expect(metricsRequestAuthorized('Bearer wrong', 'metrics-secret', 'production')).toBe(false);
    expect(metricsRequestAuthorized('Bearer metrics-secret', 'metrics-secret', 'production')).toBe(true);
  });
});
