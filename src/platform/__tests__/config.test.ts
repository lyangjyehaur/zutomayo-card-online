import { describe, expect, it } from 'vitest';
import { resolvePlatformPublicAddress } from '../config';

describe('platform public address config', () => {
  it('keeps the address optional for local and test single-process runtimes', () => {
    expect(resolvePlatformPublicAddress(undefined, 'development')).toBeUndefined();
    expect(resolvePlatformPublicAddress('  ', 'test')).toBeUndefined();
  });

  it('requires an explicit process address in production', () => {
    expect(() => resolvePlatformPublicAddress(undefined, 'production')).toThrow(
      'PLATFORM_PUBLIC_ADDRESS is required in production',
    );
  });

  it('canonicalizes an absolute URL into the address format used by Colyseus reservations', () => {
    expect(resolvePlatformPublicAddress(' WSS://Platform-Blue.Example.Test:443/colyseus/blue/ ', 'production')).toEqual(
      {
        url: 'wss://platform-blue.example.test/colyseus/blue',
        colyseusAddress: 'platform-blue.example.test/colyseus/blue',
      },
    );
    expect(resolvePlatformPublicAddress('ws://127.0.0.1:3002/', 'development')).toEqual({
      url: 'ws://127.0.0.1:3002',
      colyseusAddress: '127.0.0.1:3002',
    });
  });

  it.each(['ws://localhost:3002', 'ws://127.0.0.1:3002', 'ws://[::1]:3002'])(
    'allows a production loopback address for local Compose: %s',
    (value) => {
      expect(resolvePlatformPublicAddress(value, 'production')?.url).toBe(value);
    },
  );

  it('requires TLS for non-loopback production addresses', () => {
    expect(() => resolvePlatformPublicAddress('ws://platform.example.test', 'production')).toThrow(
      'production PLATFORM_PUBLIC_ADDRESS must use wss:// unless it targets a loopback host',
    );
    expect(resolvePlatformPublicAddress('ws://platform.example.test', 'development')?.url).toBe(
      'ws://platform.example.test',
    );
  });

  it.each([
    ['relative host', 'platform.example.test'],
    ['HTTP scheme', 'https://platform.example.test'],
    ['credentials', 'wss://user:secret@platform.example.test'],
    ['query string', 'wss://platform.example.test/blue?slot=blue'],
    ['empty query string', 'wss://platform.example.test/blue?'],
    ['hash', 'wss://platform.example.test/blue#slot'],
  ])('rejects %s', (_label, value) => {
    expect(() => resolvePlatformPublicAddress(value, 'development')).toThrow(/PLATFORM_PUBLIC_ADDRESS/);
  });
});
