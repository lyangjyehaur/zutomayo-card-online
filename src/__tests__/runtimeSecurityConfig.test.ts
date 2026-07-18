import { describe, expect, it } from 'vitest';
import { Client } from 'pg';
import {
  postgresConnectionString,
  postgresSslConfig,
  requireSecret,
  resolveRedisConnectionConfig,
  secretByteLength,
  shouldUpgradeInsecureRequests,
  validateProductionRuntimeSecurity,
  websocketConnectSources,
} from '../runtimeSecurityConfig';

describe('runtime security connection contracts', () => {
  it('upgrades insecure subresources only for production HTTPS deployments', () => {
    expect(shouldUpgradeInsecureRequests({ NODE_ENV: 'production' })).toBe(true);
    expect(shouldUpgradeInsecureRequests({ NODE_ENV: 'test' })).toBe(false);
    expect(shouldUpgradeInsecureRequests({ NODE_ENV: 'development' })).toBe(false);
  });

  it('allows plaintext browser transports only outside production', () => {
    expect(websocketConnectSources({ NODE_ENV: 'test' })).toEqual(['ws:', 'wss:', 'http:', 'https:']);
    expect(websocketConnectSources({ NODE_ENV: 'production' })).toEqual(['wss:', 'https:']);
  });

  it('measures secret entropy by UTF-8 bytes and rejects short values', () => {
    expect(secretByteLength('密')).toBe(3);
    expect(() => requireSecret('JWT_SECRET', 'short')).toThrow('at least 32 bytes');
    expect(requireSecret('JWT_SECRET', 'a'.repeat(32))).toBe('a'.repeat(32));
  });

  it('allows local Redis defaults but rejects production fallback, plaintext, and passwordless URLs', () => {
    expect(resolveRedisConnectionConfig({ NODE_ENV: 'test' })).toEqual({
      url: 'redis://localhost:6379',
      tls: false,
      authenticated: false,
    });
    expect(() => resolveRedisConnectionConfig({ NODE_ENV: 'production' })).toThrow('REDIS_URL is required');
    expect(() =>
      resolveRedisConnectionConfig({
        NODE_ENV: 'production',
        REDIS_URL: 'rediss://:password@[::1]:6379',
      }),
    ).toThrow('localhost');
    expect(() =>
      resolveRedisConnectionConfig({
        NODE_ENV: 'production',
        REDIS_URL: 'rediss://:password@[::ffff:127.0.0.1]:6379',
      }),
    ).toThrow('localhost');
    for (const host of ['2130706434', '0x7f000002', '017700000001', '0x7f.0.0.1']) {
      expect(() =>
        resolveRedisConnectionConfig({ NODE_ENV: 'production', REDIS_URL: `rediss://:password@${host}:6379` }),
      ).toThrow('localhost');
    }
    expect(() =>
      resolveRedisConnectionConfig({ NODE_ENV: 'production', REDIS_URL: 'redis://redis.example:6379' }),
    ).toThrow('rediss://');
    expect(() =>
      resolveRedisConnectionConfig({
        NODE_ENV: 'production',
        REDIS_URL: 'rediss://:password@redis.example:6379?tls=false',
      }),
    ).toThrow('disable TLS');
    expect(
      resolveRedisConnectionConfig({
        NODE_ENV: 'production',
        REDIS_URL: 'rediss://:password@redis.example:6379?tls=true',
      }).url,
    ).toBe('rediss://:password@redis.example:6379');
    expect(() =>
      resolveRedisConnectionConfig({ NODE_ENV: 'production', REDIS_URL: 'rediss://redis.example:6379' }),
    ).toThrow('password in REDIS_URL');
    expect(() =>
      resolveRedisConnectionConfig({
        NODE_ENV: 'production',
        REDIS_URL: 'rediss://redis.example:6379',
        REDIS_PASSWORD: 'ignored-out-of-band-password',
      }),
    ).toThrow('password in REDIS_URL');
    expect(() =>
      resolveRedisConnectionConfig({ NODE_ENV: 'production', REDIS_URL: 'rediss://acl-user@redis.example:6379' }),
    ).toThrow('password in REDIS_URL');
    expect(
      resolveRedisConnectionConfig({
        NODE_ENV: 'production',
        REDIS_URL: 'rediss://:password@redis.example:6379',
      }),
    ).toMatchObject({ tls: true, authenticated: true });
  });

  it('requires verified PostgreSQL TLS in production', () => {
    expect(postgresSslConfig({ NODE_ENV: 'test' })).toBe(false);
    expect(() => postgresSslConfig({ NODE_ENV: 'production', PGSSLMODE: 'disable' })).toThrow('PGSSLMODE');
    expect(() => postgresSslConfig({ NODE_ENV: 'production', PGSSLMODE: 'require' })).toThrow('hostname verification');
    expect(postgresSslConfig({ NODE_ENV: 'production', PGSSLMODE: 'verify-full' })).toEqual({
      rejectUnauthorized: true,
    });
  });

  it('prevents DATABASE_URL query parameters from overriding verified PostgreSQL TLS', () => {
    const baseEnv = {
      NODE_ENV: 'production',
      PGSSLMODE: 'verify-full',
    };
    expect(() =>
      postgresConnectionString({
        ...baseEnv,
        DATABASE_URL: 'postgres://app:secret@db.example/game?sslmode=disable',
      }),
    ).toThrow('DATABASE_URL sslmode');
    expect(() =>
      postgresConnectionString({
        ...baseEnv,
        DATABASE_URL: 'postgres://app:secret@db.example/game?ssl=false',
      }),
    ).toThrow('DATABASE_URL ssl');

    const env = {
      ...baseEnv,
      DATABASE_URL: 'postgres://app:secret@db.example/game?sslmode=verify-full&application_name=game',
    };
    const connectionString = postgresConnectionString(env);
    expect(connectionString).toContain('application_name=game');
    expect(connectionString).not.toContain('sslmode=');
    const client = new Client({ connectionString, ssl: postgresSslConfig(env) });
    expect((client as unknown as { connectionParameters: { ssl: unknown } }).connectionParameters.ssl).toEqual({
      rejectUnauthorized: true,
    });
  });

  it('validates the complete production contract', () => {
    const env = {
      NODE_ENV: 'production',
      JWT_SECRET: '0123456789abcdef'.repeat(4),
      PLATFORM_SEAT_TOKEN_SECRET: 'fedcba9876543210'.repeat(4),
      REDIS_URL: 'rediss://:password@redis.example:6379',
      PGSSLMODE: 'verify-full',
    };
    expect(validateProductionRuntimeSecurity(env)).toBe(true);
    expect(() => validateProductionRuntimeSecurity({ ...env, JWT_SECRET: 'short' })).toThrow('JWT_SECRET');
    expect(() => validateProductionRuntimeSecurity({ ...env, JWT_SECRET: 'j'.repeat(64) })).toThrow(
      'estimated entropy',
    );
    expect(() => validateProductionRuntimeSecurity({ ...env, NODE_TLS_REJECT_UNAUTHORIZED: '0' })).toThrow(
      'NODE_TLS_REJECT_UNAUTHORIZED',
    );
    expect(() => validateProductionRuntimeSecurity({ ...env, PLATFORM_SEAT_TOKEN_SECRET: env.JWT_SECRET })).toThrow(
      'PLATFORM_SEAT_TOKEN_SECRET must be distinct',
    );
  });
});
