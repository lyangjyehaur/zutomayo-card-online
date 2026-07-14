import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { resolveBackgroundWorkersEnabled } = require('../backgroundWorkerConfig.cjs') as {
  resolveBackgroundWorkersEnabled: (env: Record<string, string | undefined>, variableName: string) => boolean;
};

describe('background worker ownership configuration', () => {
  it('preserves the legacy enabled default', () => {
    expect(resolveBackgroundWorkersEnabled({}, 'API_BACKGROUND_WORKERS_ENABLED')).toBe(true);
  });

  it('accepts explicit boolean values', () => {
    expect(
      resolveBackgroundWorkersEnabled({ API_BACKGROUND_WORKERS_ENABLED: 'true' }, 'API_BACKGROUND_WORKERS_ENABLED'),
    ).toBe(true);
    expect(
      resolveBackgroundWorkersEnabled({ API_BACKGROUND_WORKERS_ENABLED: ' FALSE ' }, 'API_BACKGROUND_WORKERS_ENABLED'),
    ).toBe(false);
    expect(
      resolveBackgroundWorkersEnabled({ GAME_BACKGROUND_WORKERS_ENABLED: 'false' }, 'GAME_BACKGROUND_WORKERS_ENABLED'),
    ).toBe(false);
  });

  it('rejects ambiguous values instead of silently starting workers', () => {
    expect(() =>
      resolveBackgroundWorkersEnabled({ API_BACKGROUND_WORKERS_ENABLED: 'stable' }, 'API_BACKGROUND_WORKERS_ENABLED'),
    ).toThrow('API_BACKGROUND_WORKERS_ENABLED must be either true or false');
  });
});
