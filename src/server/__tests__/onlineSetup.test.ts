import { describe, expect, it } from 'vitest';
import { authoritativeOnlineSetupData } from '../onlineSetup';

describe('authoritativeOnlineSetupData', () => {
  it('replaces a client-controlled seed and rules version', () => {
    expect(
      authoritativeOnlineSetupData(
        { deck0Name: 'dark', rngSeed: 7, rulesVersion: 'client-rules' },
        'server-rules',
        () => 99,
      ),
    ).toEqual({
      deck0Name: 'dark',
      rngSeed: 99,
      rulesVersion: 'server-rules',
    });
  });
});
