import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  assertPostgresExpectedRole,
  postgresConnectionString,
  postgresSslConfig,
  requireSecret,
  resolveOAuthPublicBaseUrl,
  resolveRedisConnectionConfig,
  validateProductionRuntimeSecurity,
} = require('../runtimeSecurityConfig.cjs') as {
  assertPostgresExpectedRole: (env: NodeJS.ProcessEnv, expectedRoleVariable: string) => string;
  postgresConnectionString: (env: NodeJS.ProcessEnv) => string | undefined;
  postgresSslConfig: (env: NodeJS.ProcessEnv) => false | { rejectUnauthorized: boolean };
  requireSecret: (name: string, value: unknown) => string;
  resolveOAuthPublicBaseUrl: (env: NodeJS.ProcessEnv) => string;
  resolveRedisConnectionConfig: (env: NodeJS.ProcessEnv) => {
    url: string;
    tls: boolean;
    authenticated: boolean;
  };
  validateProductionRuntimeSecurity: (env: NodeJS.ProcessEnv) => true;
};

describe('API runtime security connection contracts', () => {
  it('rejects short secrets', () => {
    expect(() => requireSecret('JWT_SECRET', 'short')).toThrow('at least 32 bytes');
    expect(requireSecret('JWT_SECRET', 'a'.repeat(32))).toBe('a'.repeat(32));
  });

  it('requires authenticated TLS Redis in production', () => {
    expect(() => resolveRedisConnectionConfig({ NODE_ENV: 'production' })).toThrow('REDIS_URL is required');
    expect(() =>
      resolveRedisConnectionConfig({
        NODE_ENV: 'production',
        REDIS_URL: 'rediss://:secret@[::1]:6379',
      }),
    ).toThrow('localhost');
    expect(() =>
      resolveRedisConnectionConfig({ NODE_ENV: 'production', REDIS_URL: 'redis://redis.example:6379' }),
    ).toThrow('rediss://');
    expect(() =>
      resolveRedisConnectionConfig({
        NODE_ENV: 'production',
        REDIS_URL: 'rediss://:secret@redis.example:6379?tls=false',
      }),
    ).toThrow('disable TLS');
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
        REDIS_URL: 'rediss://:secret@redis.example:6379',
      }),
    ).toMatchObject({ tls: true, authenticated: true });
  });

  it('rejects disabled or unverified PostgreSQL TLS in production', () => {
    expect(() => postgresSslConfig({ NODE_ENV: 'production', PGSSLMODE: 'disable' })).toThrow('PGSSLMODE');
    expect(() => postgresSslConfig({ NODE_ENV: 'production', PGSSLMODE: 'require' })).toThrow('hostname verification');
    expect(postgresSslConfig({ NODE_ENV: 'production', PGSSLMODE: 'verify-full' })).toEqual({
      rejectUnauthorized: true,
    });
    expect(() =>
      postgresConnectionString({
        NODE_ENV: 'production',
        PGSSLMODE: 'verify-full',
        DATABASE_URL: 'postgres://app:secret@db.example/game?sslmode=no-verify',
      }),
    ).toThrow('DATABASE_URL sslmode');
    expect(() =>
      postgresConnectionString({
        NODE_ENV: 'production',
        PGSSLMODE: 'verify-full',
        DATABASE_URL: 'postgres://app:secret@db.example/game?ssl=no-verify',
      }),
    ).toThrow('DATABASE_URL ssl');
  });

  it('binds production PostgreSQL URLs and PG_USER to the expected operational role', () => {
    const baseEnv = {
      NODE_ENV: 'production',
      PGSSLMODE: 'verify-full',
      PG_MIGRATION_USER: 'zutomayo_migrator',
    };
    expect(
      assertPostgresExpectedRole(
        {
          ...baseEnv,
          PG_USER: 'zutomayo_migrator',
          DATABASE_URL: 'postgres://zutomayo_migrator:secret@db.example/zutomayo?sslmode=verify-full',
        },
        'PG_MIGRATION_USER',
      ),
    ).toBe('zutomayo_migrator');
    expect(() =>
      assertPostgresExpectedRole(
        { ...baseEnv, DATABASE_URL: 'postgres://zutomayo_api:secret@db.example/zutomayo' },
        'PG_MIGRATION_USER',
      ),
    ).toThrow('DATABASE_URL username must match PG_MIGRATION_USER');
    expect(() => assertPostgresExpectedRole({ ...baseEnv, PG_USER: 'zutomayo_api' }, 'PG_MIGRATION_USER')).toThrow(
      'PG_USER must match PG_MIGRATION_USER',
    );
    expect(() =>
      assertPostgresExpectedRole(
        { NODE_ENV: 'production', PGSSLMODE: 'verify-full', PG_USER: 'zutomayo_migrator' },
        'PG_MIGRATION_USER',
      ),
    ).toThrow('PG_MIGRATION_USER is required');
  });

  it('validates the complete production contract', () => {
    expect(
      validateProductionRuntimeSecurity({
        NODE_ENV: 'production',
        JWT_SECRET: '0123456789abcdef'.repeat(4),
        PLATFORM_SEAT_TOKEN_SECRET: 'fedcba9876543210'.repeat(4),
        REDIS_URL: 'rediss://:secret@redis.example:6379',
        PGSSLMODE: 'verify-full',
        OAUTH_PUBLIC_BASE_URL: 'https://game.example',
      }),
    ).toBe(true);
    expect(() =>
      validateProductionRuntimeSecurity({
        NODE_ENV: 'production',
        JWT_SECRET: '0123456789abcdef'.repeat(4),
        REDIS_URL: 'rediss://:secret@redis.example:6379',
        PGSSLMODE: 'verify-full',
        OAUTH_PUBLIC_BASE_URL: 'https://game.example',
        NODE_TLS_REJECT_UNAUTHORIZED: '0',
      }),
    ).toThrow('NODE_TLS_REJECT_UNAUTHORIZED');
    expect(() =>
      validateProductionRuntimeSecurity({
        NODE_ENV: 'production',
        JWT_SECRET: 'j'.repeat(64),
        REDIS_URL: 'rediss://:secret@redis.example:6379',
        PGSSLMODE: 'verify-full',
        OAUTH_PUBLIC_BASE_URL: 'https://game.example',
      }),
    ).toThrow('estimated entropy');
  });

  it('requires a canonical HTTPS OAuth origin in production', () => {
    expect(() => resolveOAuthPublicBaseUrl({ NODE_ENV: 'production' })).toThrow('required in production');
    expect(() =>
      resolveOAuthPublicBaseUrl({ NODE_ENV: 'production', OAUTH_PUBLIC_BASE_URL: 'http://game.example' }),
    ).toThrow('must use HTTPS');
    expect(() =>
      resolveOAuthPublicBaseUrl({ NODE_ENV: 'production', OAUTH_PUBLIC_BASE_URL: 'https://game.example/app' }),
    ).toThrow('without a path');
    expect(resolveOAuthPublicBaseUrl({ NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://game.example/' })).toBe(
      'https://game.example',
    );
  });
});
