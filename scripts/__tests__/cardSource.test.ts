import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createE2ECardSeed } from '../create-e2e-card-seed';
import { loadSeedCardI18n, loadSeedCards } from '../cardSource';

const directory = mkdtempSync(resolve(tmpdir(), 'zutomayo-card-source-'));
const fixturePath = resolve(directory, 'synthetic.json');
const fixture = createE2ECardSeed();

beforeAll(() => {
  writeFileSync(fixturePath, JSON.stringify(fixture));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('E2E card seed fixture', () => {
  it('loads only an explicitly configured local synthetic fixture', async () => {
    vi.stubEnv('SEED_CARD_FIXTURE_FILE', fixturePath);

    await expect(loadSeedCards()).resolves.toEqual(fixture.cards);
    await expect(loadSeedCardI18n()).resolves.toEqual({});
  });

  it('keeps seed sources fail-closed when no source is configured', async () => {
    vi.stubEnv('SEED_CARD_FIXTURE_FILE', '');
    vi.stubEnv('SEED_CARDS_URL', '');
    vi.stubEnv('SEED_CARD_API_URL', '');
    vi.stubEnv('CARD_API_URL', '');

    await expect(loadSeedCards()).rejects.toThrow('Set SEED_CARDS_URL or SEED_CARD_API_URL');
  });
});
