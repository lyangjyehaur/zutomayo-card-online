import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { decryptAdminTotpSecret, encryptAdminTotpSecret, randomBase32 } = require('../adminSecretCrypto.cjs') as {
  decryptAdminTotpSecret: (value: string, key: string) => string;
  encryptAdminTotpSecret: (value: string, key: string) => string;
  randomBase32: () => string;
};

describe('admin TOTP secret crypto', () => {
  it('round-trips an authenticated encrypted secret', () => {
    const key = 'this-is-a-long-admin-encryption-key-123456';
    const encrypted = encryptAdminTotpSecret('JBSWY3DPEHPK3PXP', key);
    expect(encrypted).toMatch(/^v1\./);
    expect(encrypted).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decryptAdminTotpSecret(encrypted, key)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('rejects tampered ciphertext and weak keys', () => {
    const key = 'this-is-a-long-admin-encryption-key-123456';
    const encrypted = encryptAdminTotpSecret('JBSWY3DPEHPK3PXP', key);
    expect(() => decryptAdminTotpSecret(`${encrypted}x`, key)).toThrow();
    expect(() => encryptAdminTotpSecret('secret', 'short')).toThrow(/at least 32/);
  });

  it('generates a base32-compatible TOTP secret', () => {
    expect(randomBase32()).toMatch(/^[A-Z2-7]{32}$/);
  });
});
