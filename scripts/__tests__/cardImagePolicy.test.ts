import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { auditCardImagePolicy } from '../verify-card-image-policy';

const rootDir = path.resolve(import.meta.dirname, '../..');

describe('card image delivery policy', () => {
  it('keeps player-facing card art behind imgproxy', () => {
    const summary = auditCardImagePolicy(rootDir);

    expect(summary.violations).toEqual([]);
    expect(summary.cardImageCallSites).toBeGreaterThan(0);
    expect(summary.directCardImageElements).toBe(0);
    expect(summary.originalFallbackExceptions).toBe(0);
    expect(summary.nonProductionExceptions).toBe(1);
  });
});
