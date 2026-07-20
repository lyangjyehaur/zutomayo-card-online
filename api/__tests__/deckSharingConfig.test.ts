import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { deckSharingEnabled } = require('../deckSharingConfig.cjs') as {
  deckSharingEnabled: (env?: Record<string, string | undefined>) => boolean;
};

describe('deck sharing config', () => {
  it('defaults off in production and on in development/test', () => {
    expect(deckSharingEnabled({ NODE_ENV: 'production' })).toBe(false);
    expect(deckSharingEnabled({ NODE_ENV: 'development' })).toBe(true);
    expect(deckSharingEnabled({ NODE_ENV: 'test' })).toBe(true);
  });

  it('honors explicit true and false values', () => {
    expect(deckSharingEnabled({ NODE_ENV: 'production', DECK_SHARING_ENABLED: 'true' })).toBe(true);
    expect(deckSharingEnabled({ NODE_ENV: 'development', DECK_SHARING_ENABLED: '0' })).toBe(false);
  });
});
