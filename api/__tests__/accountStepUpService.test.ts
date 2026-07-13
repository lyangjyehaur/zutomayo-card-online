import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { consumeAccountStepUp, issueAccountStepUp, stepUpKey } = require('../accountStepUpService.cjs') as {
  consumeAccountStepUp: (input: Record<string, unknown>) => Promise<string | null>;
  issueAccountStepUp: (input: Record<string, unknown>) => Promise<{ token: string; expiresIn: number }>;
  stepUpKey: (token: string) => string;
};

describe('account step-up service', () => {
  it('stores only a token hash and consumes the provider proof once', async () => {
    const values = new Map<string, string>();
    const redis = {
      set: vi.fn(async (key: string, value: string) => {
        values.set(key, value);
        return 'OK';
      }),
      getdel: vi.fn(async (key: string) => {
        const value = values.get(key) ?? null;
        values.delete(key);
        return value;
      }),
    };

    const issued = await issueAccountStepUp({
      redis,
      userId: 'u_1',
      providerVerificationRecordId: 'provider-proof',
      generateToken: () => 'opaque-step-up',
    });
    expect(issued).toEqual({ token: 'opaque-step-up', expiresIn: 300 });
    expect(redis.set).toHaveBeenCalledWith(
      stepUpKey('opaque-step-up'),
      expect.not.stringContaining('opaque-step-up'),
      'EX',
      300,
      'NX',
    );
    await expect(consumeAccountStepUp({ redis, token: issued.token, userId: 'u_1' })).resolves.toBe('provider-proof');
    await expect(consumeAccountStepUp({ redis, token: issued.token, userId: 'u_1' })).resolves.toBeNull();
  });

  it('rejects a proof issued for another account or purpose', async () => {
    const redis = {
      getdel: vi.fn(async () =>
        JSON.stringify({ userId: 'u_other', purpose: 'account-sensitive-action', providerVerificationRecordId: 'p' }),
      ),
    };
    await expect(consumeAccountStepUp({ redis, token: 'token', userId: 'u_1' })).resolves.toBeNull();
  });

  it('fails closed when the provider proof cannot be persisted', async () => {
    const redis = { set: vi.fn(async () => null) };
    await expect(issueAccountStepUp({ redis, userId: 'u_1', providerVerificationRecordId: 'proof' })).rejects.toThrow(
      'Unable to issue',
    );
  });
});
