import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createActionUrl, deliverAccountAction } = require('../accountNotificationService.cjs') as {
  createActionUrl: (input: Record<string, unknown>) => string;
  deliverAccountAction: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

describe('account notification service', () => {
  it('creates encoded verification and reset URLs', () => {
    expect(
      createActionUrl({ publicBaseUrl: 'https://game.example/', actionType: 'verify_email', token: 'a+b/c' }),
    ).toBe('https://game.example/verify-email?token=a%2Bb%2Fc');
    expect(
      createActionUrl({ publicBaseUrl: 'https://game.example', actionType: 'reset_password', token: 'reset' }),
    ).toBe('https://game.example/reset-password?token=reset');
  });

  it('fails closed when delivery is not configured', async () => {
    await expect(
      deliverAccountAction({ env: {}, actionType: 'verify_email', email: 'u@example.com', token: 'token' }),
    ).resolves.toEqual({ ok: false, status: 503, error: 'Account email delivery is not configured' });
  });

  it('does not send action tokens to an unauthenticated webhook', async () => {
    const fetchImpl = vi.fn();
    await expect(
      deliverAccountAction({
        env: {
          ACCOUNT_EMAIL_WEBHOOK_URL: 'https://mailer.example/actions',
          PUBLIC_BASE_URL: 'https://game.example',
        },
        fetchImpl,
        actionType: 'verify_email',
        email: 'u@example.com',
        token: 'token',
      }),
    ).resolves.toEqual({ ok: false, status: 503, error: 'Account email delivery is not configured' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends the action link to the configured authenticated webhook', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true }));
    await expect(
      deliverAccountAction({
        env: {
          ACCOUNT_EMAIL_WEBHOOK_URL: 'https://mailer.example/actions',
          ACCOUNT_EMAIL_WEBHOOK_SECRET: 'secret',
          PUBLIC_BASE_URL: 'https://game.example',
        },
        fetchImpl,
        actionType: 'reset_password',
        email: 'u@example.com',
        token: 'token',
        expiresIn: 1800,
      }),
    ).resolves.toEqual({ ok: true });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://mailer.example/actions',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer secret' },
        body: JSON.stringify({
          actionType: 'reset_password',
          email: 'u@example.com',
          actionUrl: 'https://game.example/reset-password?token=token',
          expiresIn: 1800,
        }),
      }),
    );
  });
});
