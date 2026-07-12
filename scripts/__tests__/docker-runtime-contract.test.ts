import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');

describe('game runtime image contract', () => {
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
    expect(dockerfile).toContain('COPY scripts/postgres-role-gate.cjs ./scripts/postgres-role-gate.cjs');
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
  });
});
