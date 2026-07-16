import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const nodeImage = 'node:22.22.2-alpine@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f';

describe('production Node image supply chain', () => {
  it('pins the base digest and installs the non-vulnerable npm toolchain', () => {
    for (const relativePath of ['Dockerfile', 'Dockerfile.migrate', 'Dockerfile.retention', 'api/Dockerfile']) {
      const dockerfile = readFileSync(resolve(root, relativePath), 'utf8');
      expect(dockerfile).toContain(`FROM ${nodeImage}`);
      expect(dockerfile).toContain('apk upgrade --no-cache');
      expect(dockerfile).toContain('npm install --global --prefix /opt/npm npm@12.0.1');
      expect(dockerfile).toContain('rm -rf /usr/local/lib/node_modules/npm');
    }
  });

  it('declares every API tracing module as a production dependency', () => {
    const manifest = JSON.parse(readFileSync(resolve(root, 'api/package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    const tracing = readFileSync(resolve(root, 'api/tracing.cjs'), 'utf8');
    for (const moduleName of [
      '@opentelemetry/sdk-node',
      '@opentelemetry/exporter-trace-otlp-http',
      '@opentelemetry/resources',
      '@opentelemetry/semantic-conventions',
      '@opentelemetry/instrumentation-http',
      '@opentelemetry/instrumentation-ioredis',
      '@opentelemetry/instrumentation-pg',
    ]) {
      expect(tracing).toContain(`require('${moduleName}')`);
      expect(manifest.dependencies).toHaveProperty(moduleName);
    }
  });
});

function runtimeSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : runtimeSourceFiles(path);
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
  });
}

function localCommonJsDependencies(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  return [...source.matchAll(/require\(['"](\.\.?\/[^'"]+)['"]\)/g)].map(([, dependency]) =>
    resolve(dirname(file), dependency),
  );
}

describe('game runtime image contract', () => {
  it('keeps shared host env files out of immutable release containers', () => {
    for (const composeFile of [
      'docker-compose.server4.yml',
      'docker-compose.server4-slot.yml',
      'docker-compose.server4-gateway.yml',
      'docker-compose.staging.yml',
    ]) {
      const compose = readFileSync(resolve(root, composeFile), 'utf8');
      expect(compose).not.toContain('env_file:');
    }
  });

  it('pins and de-privileges the repository-owned HAProxy gateway runtime', () => {
    const dockerfile = readFileSync(resolve(root, 'Dockerfile.gateway'), 'utf8');
    const compose = readFileSync(resolve(root, 'docker-compose.server4-gateway.yml'), 'utf8');
    expect(dockerfile).toMatch(/^FROM\s+\S+@sha256:[a-f0-9]{64}$/m);
    expect(dockerfile).toContain('USER haproxy');
    expect(compose).toContain('cap_drop:');
    expect(compose).toContain('no-new-privileges:true');
    expect(compose).toContain('host_ip: 127.0.0.1');
    expect(compose).toContain('uid=99,gid=99');
  });

  it('skips development lifecycle hooks in the production dependency layer', () => {
    const dockerfile = readFileSync(resolve(root, 'Dockerfile'), 'utf8');
    expect(dockerfile).toContain('RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force');
  });

  it('ships the server-owned deck helper despite the API source ignore rule', () => {
    const dockerfile = readFileSync(resolve(root, 'Dockerfile'), 'utf8');
    const dockerignore = readFileSync(resolve(root, '.dockerignore'), 'utf8');
    expect(dockerfile).toContain('COPY --from=builder /app/api/deckService.cjs ./api/deckService.cjs');
    expect(dockerignore).toContain('!api/deckService.cjs');
  });

  it('keeps the account-locked refresh session helper in API build contexts', () => {
    const apiDockerfile = readFileSync(resolve(root, 'api/Dockerfile'), 'utf8');
    const apiDockerignore = readFileSync(resolve(root, 'api/.dockerignore'), 'utf8');
    expect(apiDockerfile).toContain('COPY ./*.cjs ./');
    expect(apiDockerignore).not.toContain('*.cjs');
    expect(readFileSync(resolve(root, 'api/authSessionService.cjs'), 'utf8')).toContain('issueAccountRefreshToken');
  });

  it('ships the schema gate helper in the migration image', () => {
    const dockerfile = readFileSync(resolve(root, 'Dockerfile.migrate'), 'utf8');
    const dockerignore = readFileSync(resolve(root, '.dockerignore'), 'utf8');
    expect(dockerfile).toContain('COPY api/schemaGate.cjs ./api/schemaGate.cjs');
    expect(dockerfile).toContain('COPY api/runtimeSecurityConfig.cjs ./api/runtimeSecurityConfig.cjs');
    expect(dockerignore).toContain('!api/runtimeSecurityConfig.cjs');
    expect(dockerfile).toContain('COPY api/relationshipEvents.cjs ./api/relationshipEvents.cjs');
    expect(dockerfile).toContain('COPY api/relationshipOutbox.cjs ./api/relationshipOutbox.cjs');
    expect(dockerfile).toContain('COPY api/observability.cjs ./api/observability.cjs');
    expect(dockerfile).toContain('COPY api/matchmakingService.cjs ./api/matchmakingService.cjs');
    expect(dockerfile).toContain(
      'COPY scripts/relationship-outbox-pg-smoke.cjs ./scripts/relationship-outbox-pg-smoke.cjs',
    );
    expect(readFileSync(resolve(root, 'scripts/relationship-outbox-pg-smoke.cjs'), 'utf8')).toContain(
      'const redisOptions = { db: redisDb, maxRetriesPerRequest: 1 }',
    );
    expect(dockerfile).toContain(
      'COPY scripts/redrive-relationship-outbox.cjs ./scripts/redrive-relationship-outbox.cjs',
    );
    expect(dockerignore).toContain('!api/relationshipEvents.cjs');
    expect(dockerignore).toContain('!api/relationshipOutbox.cjs');
    expect(dockerignore).toContain('!api/observability.cjs');
    expect(dockerignore).toContain('!api/matchmakingService.cjs');
    expect(dockerfile).toContain('COPY scripts/postgres-role-gate.cjs ./scripts/postgres-role-gate.cjs');
    expect(dockerfile).toContain('COPY scripts/migration-order-compat.cjs ./scripts/migration-order-compat.cjs');
    expect(dockerfile).not.toContain('COPY data/card-');
    expect(dockerfile).not.toContain('COPY scripts/card-english-ocr-overrides.json');
    expect(dockerignore).toContain('data/card*.json');
    expect(dockerignore).toContain('scripts/card-english-*.json');
    expect(dockerfile).toContain('COPY scripts/audit-card-official-texts.ts ./scripts/audit-card-official-texts.ts');
    expect(dockerfile).toContain(
      'COPY scripts/import-card-official-texts-pg.ts ./scripts/import-card-official-texts-pg.ts',
    );
    expect(dockerfile).toContain('COPY scripts/release-card-data.cjs ./scripts/release-card-data.cjs');
    expect(dockerfile).toContain('COPY scripts/card-data-gate.cjs ./scripts/card-data-gate.cjs');
    expect(dockerfile).toContain('COPY scripts/verify-compose-role-env.mjs ./scripts/verify-compose-role-env.mjs');
    expect(dockerignore).toContain('!api/schemaGate.cjs');
  });

  it('ships every local module required by the admin credential CLI in the migration image', () => {
    const dockerfile = readFileSync(resolve(root, 'Dockerfile.migrate'), 'utf8');
    const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const cli = resolve(root, 'scripts/create-admin.cjs');

    for (const command of ['admin:create', 'admin:rotate', 'admin:recover']) {
      expect(packageJson.scripts[command]).toMatch(/^node scripts\/create-admin\.cjs --mode=/);
    }
    expect(dockerfile).toContain('COPY scripts/create-admin.cjs ./scripts/create-admin.cjs');

    for (const dependency of localCommonJsDependencies(cli)) {
      const relativeDependency = dependency.slice(root.length + 1);
      expect(dockerfile).toContain(`COPY ${relativeDependency} ./${relativeDependency}`);
    }
  });

  it('ships the runtime TLS/role contract in the retention image', () => {
    const dockerfile = readFileSync(resolve(root, 'Dockerfile.retention'), 'utf8');
    expect(dockerfile).toContain('COPY api/runtimeSecurityConfig.cjs ./api/runtimeSecurityConfig.cjs');
    const worker = readFileSync(resolve(root, 'scripts/run-retention.cjs'), 'utf8');
    expect(worker).toContain('PG_RETENTION_USER');
    expect(worker).toContain('poolConfig.ssl = postgresSslConfig(process.env)');
  });

  it('ships the shared schema gate helper in game and platform runtime images', () => {
    const dockerfile = readFileSync(resolve(root, 'Dockerfile'), 'utf8');
    const dockerignore = readFileSync(resolve(root, '.dockerignore'), 'utf8');
    expect(dockerfile).toContain('COPY --from=builder /app/api/schemaGate.cjs ./api/schemaGate.cjs');
    expect(dockerfile).toContain('COPY --from=builder /app/api/relationshipEvents.cjs ./api/relationshipEvents.cjs');
    expect(dockerignore).toContain('!api/relationshipEvents.cjs');
    expect(dockerfile).toContain('COPY --from=builder /app/api/accountMutationLock.cjs ./api/accountMutationLock.cjs');
    expect(dockerfile).toContain(
      'COPY --from=builder /app/api/backgroundWorkerConfig.cjs ./api/backgroundWorkerConfig.cjs',
    );
    expect(dockerignore).toContain('!api/accountMutationLock.cjs');
    expect(dockerignore).toContain('!api/backgroundWorkerConfig.cjs');
    expect(dockerfile).toContain('COPY --from=builder /app/api/relationshipOutbox.cjs ./api/relationshipOutbox.cjs');
    expect(dockerignore).toContain('!api/relationshipOutbox.cjs');
    expect(dockerfile).toContain(
      'COPY --from=builder /app/api/runtimeSecurityConfig.cjs ./api/runtimeSecurityConfig.cjs',
    );
    expect(dockerignore).toContain('!api/runtimeSecurityConfig.cjs');
    expect(dockerfile).toContain('COPY --from=builder /app/api/seasonResultService.cjs ./api/seasonResultService.cjs');
    expect(dockerignore).toContain('!api/seasonResultService.cjs');
  });

  it('ships every CommonJS API helper imported by a game or platform runtime source', () => {
    const dockerfile = readFileSync(resolve(root, 'Dockerfile'), 'utf8');
    const dockerignore = readFileSync(resolve(root, '.dockerignore'), 'utf8');
    const helpers = new Set(
      runtimeSourceFiles(resolve(root, 'src')).flatMap((file) =>
        [...readFileSync(file, 'utf8').matchAll(/(?:\.\.\/)+api\/([A-Za-z0-9_.-]+\.cjs)/g)].map(([, helper]) => helper),
      ),
    );
    expect(helpers.size).toBeGreaterThan(0);
    for (const helper of helpers) {
      expect(dockerfile).toContain(`COPY --from=builder /app/api/${helper} ./api/${helper}`);
      expect(dockerignore).toContain(`!api/${helper}`);
    }
  });

  it('declares every OpenTelemetry package required by the API tracing entrypoint', () => {
    const tracing = readFileSync(resolve(root, 'api/tracing.cjs'), 'utf8');
    const packageJson = JSON.parse(readFileSync(resolve(root, 'api/package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    const requiredPackages = [...tracing.matchAll(/require\('(@opentelemetry\/[^']+)'\)/g)].map(
      ([, packageName]) => packageName,
    );
    expect(requiredPackages.length).toBeGreaterThan(0);
    for (const packageName of requiredPackages) {
      expect(packageJson.dependencies).toHaveProperty(packageName);
    }
  });
});
