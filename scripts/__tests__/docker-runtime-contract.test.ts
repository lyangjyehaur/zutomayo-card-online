import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

describe('game runtime image contract', () => {
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

  it('ships the schema gate helper in the migration image', () => {
    const dockerfile = readFileSync(resolve(root, 'Dockerfile.migrate'), 'utf8');
    const dockerignore = readFileSync(resolve(root, '.dockerignore'), 'utf8');
    expect(dockerfile).toContain('COPY api/schemaGate.cjs ./api/schemaGate.cjs');
    expect(dockerfile).toContain('COPY api/runtimeSecurityConfig.cjs ./api/runtimeSecurityConfig.cjs');
    expect(dockerignore).toContain('!api/runtimeSecurityConfig.cjs');
    expect(dockerfile).toContain('COPY api/relationshipEvents.cjs ./api/relationshipEvents.cjs');
    expect(dockerfile).toContain('COPY api/relationshipOutbox.cjs ./api/relationshipOutbox.cjs');
    expect(dockerfile).toContain(
      'COPY scripts/relationship-outbox-pg-smoke.cjs ./scripts/relationship-outbox-pg-smoke.cjs',
    );
    expect(dockerfile).toContain(
      'COPY scripts/redrive-relationship-outbox.cjs ./scripts/redrive-relationship-outbox.cjs',
    );
    expect(dockerignore).toContain('!api/relationshipEvents.cjs');
    expect(dockerignore).toContain('!api/relationshipOutbox.cjs');
    expect(dockerfile).toContain('COPY scripts/postgres-role-gate.cjs ./scripts/postgres-role-gate.cjs');
    expect(dockerfile).toContain('COPY scripts/verify-compose-role-env.mjs ./scripts/verify-compose-role-env.mjs');
    expect(dockerignore).toContain('!api/schemaGate.cjs');
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
    expect(dockerignore).toContain('!api/accountMutationLock.cjs');
    expect(dockerfile).toContain('COPY --from=builder /app/api/relationshipOutbox.cjs ./api/relationshipOutbox.cjs');
    expect(dockerignore).toContain('!api/relationshipOutbox.cjs');
    expect(dockerfile).toContain(
      'COPY --from=builder /app/api/runtimeSecurityConfig.cjs ./api/runtimeSecurityConfig.cjs',
    );
    expect(dockerignore).toContain('!api/runtimeSecurityConfig.cjs');
    expect(dockerfile).toContain('COPY --from=builder /app/api/seasonResultService.cjs ./api/seasonResultService.cjs');
    expect(dockerignore).toContain('!api/seasonResultService.cjs');
  });
});

describe('API runtime image contract', () => {
  it('makes copied runtime inputs readable before dropping privileges', () => {
    const dockerfile = readFileSync(resolve(root, 'api/Dockerfile'), 'utf8');
    const chmod = 'RUN chmod 0444 package.json package-lock.json ./*.cjs';
    expect(dockerfile).toContain(chmod);
    expect(dockerfile.indexOf(chmod)).toBeLessThan(dockerfile.indexOf('USER node'));
  });
});
