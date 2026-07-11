import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readRepoFile(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

describe('platform deployment config', () => {
  it('enables durable platform stores in production compose', () => {
    const compose = readRepoFile('docker-compose.yml');

    expect(compose).toContain('PLATFORM_REDIS_MODE=redis');
    expect(compose).toContain('PLATFORM_FRIEND_STORE=postgres');
    expect(compose).toContain('PLATFORM_MATCH_PARTICIPANT_STORE=postgres');
    expect(compose).toContain('PLATFORM_CHAT_PREVIEW_STORE=postgres');
  });

  it('keeps local platform stores dependency-light in env example', () => {
    const envExample = readRepoFile('.env.example');

    expect(envExample).toContain('PLATFORM_REDIS_MODE=memory');
    expect(envExample).toContain('PLATFORM_FRIEND_STORE=none');
    expect(envExample).toContain('PLATFORM_MATCH_PARTICIPANT_STORE=none');
    expect(envExample).toContain('PLATFORM_CHAT_PREVIEW_STORE=none');
  });
});
