import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateRenderedRoleEnvironment } from '../verify-compose-role-env.mjs';

const hasJq = spawnSync('jq', ['--version'], { encoding: 'utf8' }).status === 0;

function service(
  roleUserVariable: string,
  roleUser: string,
  rolePassword: string,
  password: string,
): { environment: Record<string, string> } {
  return {
    environment: {
      PG_USER: roleUser,
      PG_PASSWORD: password,
      [roleUserVariable]: roleUser,
      [rolePassword]: password,
      DATABASE_URL: '',
      PGSSLMODE: 'verify-full',
      REDIS_URL: '',
    },
  };
}

function validConfig() {
  const services = {
    migrate: service('PG_MIGRATION_USER', 'zutomayo_migrator', 'PG_MIGRATION_PASSWORD', 'migration-secret'),
    game: service('PG_GAME_USER', 'zutomayo_game', 'PG_GAME_PASSWORD', 'game-secret'),
    api: service('PG_API_USER', 'zutomayo_api', 'PG_API_PASSWORD', 'api-secret'),
    platform: service('PG_PLATFORM_USER', 'zutomayo_platform', 'PG_PLATFORM_PASSWORD', 'platform-secret'),
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

  it('requires each named role user to match its canonical PG user', () => {
    const missingNamedUser = validConfig();
    delete missingNamedUser.services.migrate.environment.PG_MIGRATION_USER;
    expect(() => validateRenderedRoleEnvironment(missingNamedUser)).toThrow('PG_MIGRATION_USER');

    const mismatchedNamedPassword = validConfig();
    mismatchedNamedPassword.services.game.environment.PG_GAME_PASSWORD = 'wrong-secret';
    expect(() => validateRenderedRoleEnvironment(mismatchedNamedPassword)).toThrow('PG_GAME_PASSWORD');
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

  it.skipIf(!hasJq)('projects only redacted role data before entering the migration container', () => {
    const config = validConfig();
    const jwtSecret = 'jwt-secret-marker-at-least-32-characters';
    const seatSecret = 'seat-secret-marker-at-least-32-characters';
    config.services.game.environment.JWT_SECRET = jwtSecret;
    config.services.api.environment.JWT_SECRET = jwtSecret;
    config.services.platform.environment.JWT_SECRET = jwtSecret;
    config.services.game.environment.PLATFORM_SEAT_TOKEN_SECRET = seatSecret;
    config.services.platform.environment.PLATFORM_SEAT_TOKEN_SECRET = seatSecret;
    config.services.api.environment.ADMIN_TOTP_ENCRYPTION_KEY = 'admin-secret-marker-at-least-32-characters';
    config.services.api.environment.OAUTH_TOKEN_ENCRYPTION_KEY = 'oauth-secret-marker-at-least-32-characters';
    config.services.api.environment.LOGTO_APP_SECRET = 'api-owned-marker-must-not-leave-host';
    for (const serviceName of ['game', 'api', 'platform'] as const) {
      config.services[serviceName].environment.REDIS_URL = `rediss://:${serviceName}-redis-secret@redis.example:6380`;
    }

    const result = spawnSync('jq', ['-c', '-f', resolve('scripts/project-compose-role-env.jq')], {
      encoding: 'utf8',
      input: JSON.stringify(config),
    });
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain('secret-marker');
    expect(result.stdout).not.toContain('redis-secret');
    expect(result.stdout).not.toContain('api-owned-marker');
    expect(
      validateRenderedRoleEnvironment(result.stdout, { requiredPgSslMode: 'verify-full', requireRediss: true }),
    ).toBe(true);
  });

  it.skipIf(!hasJq)('projects platform-p1 as the canonical platform role for parallel slots', () => {
    const config = validConfig();
    const jwtSecret = 'jwt-secret-marker-at-least-32-characters';
    const platform = config.services.platform;
    delete (config.services as Partial<typeof config.services>).platform;
    const parallelServices = config.services as typeof config.services & { 'platform-p1': typeof platform };
    parallelServices['platform-p1'] = platform;
    config.services.game.environment.JWT_SECRET = jwtSecret;
    config.services.api.environment.JWT_SECRET = jwtSecret;
    parallelServices['platform-p1'].environment.JWT_SECRET = jwtSecret;
    config.services.game.environment.PLATFORM_SEAT_TOKEN_SECRET = 'seat-secret-marker-at-least-32-characters';
    parallelServices['platform-p1'].environment.PLATFORM_SEAT_TOKEN_SECRET =
      'seat-secret-marker-at-least-32-characters';
    config.services.api.environment.ADMIN_TOTP_ENCRYPTION_KEY = 'admin-secret-marker-at-least-32-characters';
    config.services.api.environment.OAUTH_TOKEN_ENCRYPTION_KEY = 'oauth-secret-marker-at-least-32-characters';
    for (const service of [config.services.game, config.services.api, parallelServices['platform-p1']]) {
      service.environment.REDIS_URL = 'rediss://:redacted@redis.example:6380';
    }

    const result = spawnSync('jq', ['-c', '-f', resolve('scripts/project-compose-role-env.jq')], {
      encoding: 'utf8',
      input: JSON.stringify(config),
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(validateRenderedRoleEnvironment(result.stdout, { requireRediss: true })).toBe(true);
  });

  it.skipIf(!hasJq)('rejects security drift between explicit platform processes', () => {
    const config = validConfig();
    const platform = config.services.platform;
    delete (config.services as Partial<typeof config.services>).platform;
    const parallelServices = config.services as typeof config.services & {
      'platform-p1': typeof platform;
      'platform-p2': typeof platform;
    };
    parallelServices['platform-p1'] = structuredClone(platform);
    parallelServices['platform-p1'].environment.PLATFORM_PUBLIC_ADDRESS = 'wss://game.example/blue/p1';
    parallelServices['platform-p2'] = structuredClone(platform);
    parallelServices['platform-p2'].environment.PLATFORM_PUBLIC_ADDRESS = 'wss://game.example/blue/p2';
    parallelServices['platform-p2'].environment.JWT_SECRET = 'drifted-platform-secret';

    const result = spawnSync('jq', ['-c', '-f', resolve('scripts/project-compose-role-env.jq')], {
      encoding: 'utf8',
      input: JSON.stringify(config),
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('must have identical runtime/security environments');
  });

  it.skipIf(!hasJq)('rejects secret ownership violations before redaction', () => {
    const config = validConfig();
    const jwtSecret = 'jwt-secret-marker-at-least-32-characters';
    config.services.game.environment.JWT_SECRET = jwtSecret;
    config.services.api.environment.JWT_SECRET = jwtSecret;
    config.services.platform.environment.JWT_SECRET = jwtSecret;
    config.services.game.environment.PLATFORM_SEAT_TOKEN_SECRET = 'seat-secret-marker-at-least-32-characters';
    config.services.platform.environment.PLATFORM_SEAT_TOKEN_SECRET = 'seat-secret-marker-at-least-32-characters';
    config.services.api.environment.ADMIN_TOTP_ENCRYPTION_KEY = 'admin-secret-marker-at-least-32-characters';
    config.services.api.environment.OAUTH_TOKEN_ENCRYPTION_KEY = 'oauth-secret-marker-at-least-32-characters';
    config.services.game.environment.LOGTO_APP_SECRET = 'do-not-print-this-secret';

    const result = spawnSync('jq', ['-c', '-f', resolve('scripts/project-compose-role-env.jq')], {
      encoding: 'utf8',
      input: JSON.stringify(config),
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('game must not receive API-owned LOGTO_APP_SECRET');
    expect(result.stderr).not.toContain('do-not-print-this-secret');
  });
});
