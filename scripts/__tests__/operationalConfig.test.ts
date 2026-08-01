import { describe, expect, it } from 'vitest';
import { validateOperationalConfig } from '../verify-operational-config.mjs';

describe('operational release configuration', () => {
  it('contains local-verifiable backup, DSAR export, monitoring, chaos, and load gates', () => {
    expect(validateOperationalConfig()).toBe(true);
  });
});
