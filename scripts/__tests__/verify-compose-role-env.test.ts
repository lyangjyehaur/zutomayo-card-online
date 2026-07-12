import { describe, expect, it } from 'vitest';
import { validateRenderedRoleEnvironment } from '../verify-compose-role-env.mjs';

function service(roleUser: string, rolePassword: string, password: string) {
  const rolePasswords = {
    PG_MIGRATION_PASSWORD: '',
    PG_APP_PASSWORD: '',
    PG_API_PASSWORD: '',
    PG_GAME_PASSWORD: '',
    PG_PLATFORM_PASSWORD: '',
    PG_RETENTION_PASSWORD: '',
    PG_MONITOR_PASSWORD: '',
    PG_BACKUP_PASSWORD: '',
    PG_WAL_PASSWORD: '',
  };
  rolePasswords[rolePassword as keyof typeof rolePasswords] = password;
  return {
    environment: {
      PG_USER: roleUser,
      PG_PASSWORD: password,
      [rolePassword]: password,
      ...rolePasswords,
      DATABASE_URL: '',
      PGSSLMODE: 'verify-full',
      REDIS_URL: '',
    },
  };
}

function validConfig() {
  const services = {
    migrate: service('zutomayo_migrator', 'PG_MIGRATION_PASSWORD', 'migration-secret'),
    game: service('zutomayo_game', 'PG_GAME_PASSWORD', 'game-secret'),
    api: service('zutomayo_api', 'PG_API_PASSWORD', 'api-secret'),
    platform: service('zutomayo_platform', 'PG_PLATFORM_PASSWORD', 'platform-secret'),
  };
  return { services };
}

describe('rendered PostgreSQL role environment gate', () => {
  it('accepts distinct role credentials with non-own passwords masked', () => {
    expect(validateRenderedRoleEnvironment(validConfig(), { requiredPgSslMode: 'verify-full' })).toBe(true);
  });

  it('rejects a runtime service that receives another role password', () => {
    const config = validConfig();
    config.services.game.environment.PG_API_PASSWORD = 'api-secret';
    expect(() => validateRenderedRoleEnvironment(config)).toThrow('PG_API_PASSWORD');
  });

  it('rejects aliased role credentials and an unexpected TLS mode', () => {
    const config = validConfig();
    config.services.platform.environment.PG_PASSWORD = config.services.api.environment.PG_PASSWORD;
    config.services.platform.environment.PG_PLATFORM_PASSWORD = config.services.api.environment.PG_PASSWORD;
    expect(() => validateRenderedRoleEnvironment(config, { requiredPgSslMode: 'verify-full' })).toThrow(
      'pairwise distinct',
    );

    const tlsConfig = validConfig();
    tlsConfig.services.api.environment.PGSSLMODE = 'disable';
    expect(() => validateRenderedRoleEnvironment(tlsConfig, { requiredPgSslMode: 'verify-full' })).toThrow('PGSSLMODE');
  });

  it('requires TLS Redis URLs for release-candidate staging runtimes', () => {
    const config = validConfig();
    config.services.game.environment.REDIS_URL = 'rediss://game@redis.example.test:6380';
    config.services.api.environment.REDIS_URL = 'rediss://api@redis.example.test:6380';
    config.services.platform.environment.REDIS_URL = 'rediss://platform@redis.example.test:6380';
    expect(validateRenderedRoleEnvironment(config, { requireRediss: true })).toBe(true);

    config.services.api.environment.REDIS_URL = 'redis://redis.example.test:6379';
    expect(() => validateRenderedRoleEnvironment(config, { requireRediss: true })).toThrow('rediss://');
  });
});
