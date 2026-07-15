import { afterEach, describe, expect, it, vi } from 'vitest';
import officialErrataSource from '../../data/card-official-errata.json';
import { TUTORIAL_DECK0_IDS, TUTORIAL_DECK1_IDS } from '../../src/data/tutorialScenario';
import { loadSeedCardI18n, loadSeedCards } from '../cardSource';
import { E2E_OFFICIAL_ERRATA_CARDS, E2E_SEED_CARDS } from '../fixtures/e2eCards';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('E2E card seed fixture', () => {
  it('contains unique, valid cards and every tutorial card ID', () => {
    const ids = E2E_SEED_CARDS.map((card) => card.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const tutorialId of new Set([...TUTORIAL_DECK0_IDS, ...TUTORIAL_DECK1_IDS])) {
      expect(ids).toContain(tutorialId);
    }

    for (const card of E2E_SEED_CARDS) {
      expect(card.id).not.toBe('');
      expect(card.name).not.toBe('');
      expect(card.pack).not.toBe('');
      expect(['Character', 'Enchant', 'Area Enchant']).toContain(card.type);
      if (card.type === 'Character') expect(card.attack).not.toBeNull();
      else expect(card.attack).toBeNull();
    }
  });

  it.each(['闇', '炎', '電気', '風'] as const)('has enough %s cards for every random preset composition', (element) => {
    const cards = E2E_SEED_CARDS.filter((card) => card.element === element);
    expect(cards).toHaveLength(25);
    expect(cards.filter((card) => card.type === 'Character')).toHaveLength(15);
    expect(cards.filter((card) => card.type !== 'Character')).toHaveLength(10);
  });

  it('covers all official errata without changing preset or gameplay fixtures', () => {
    const officialIds = officialErrataSource.errata.map((entry) => entry.cardId);
    const errataById = new Map(E2E_OFFICIAL_ERRATA_CARDS.map((card) => [card.id, card]));

    expect(E2E_OFFICIAL_ERRATA_CARDS).toHaveLength(12);
    expect(E2E_OFFICIAL_ERRATA_CARDS.map((card) => card.id)).toEqual(officialIds);
    expect(E2E_SEED_CARDS.slice(-officialIds.length)).toEqual(E2E_OFFICIAL_ERRATA_CARDS);
    expect(E2E_OFFICIAL_ERRATA_CARDS.every((card) => card.element === 'カオス')).toBe(true);

    for (const element of ['闇', '炎', '電気', '風'] as const) {
      const presetCandidates = E2E_SEED_CARDS.filter((card) => card.element === element).slice(0, 20);
      expect(presetCandidates.every((card) => !errataById.has(card.id))).toBe(true);
    }

    for (const entry of officialErrataSource.errata) {
      const card = errataById.get(entry.cardId);
      expect(card).toMatchObject({
        officialErrataId: entry.errataId,
        hasOfficialErrata: true,
        officialErrataAffectsName: entry.fields.includes('name'),
        officialErrataAffectsEffect: entry.fields.includes('effect'),
      });
      expect(entry.fields.includes('name') ? card?.name : card?.effect).toBe(entry.correctedJapaneseText);
      if (entry.correctedEnglishSource === 'official_card_print_unaffected') {
        expect(entry.fields.includes('name') ? card?.enNameOfficial : card?.enEffectOfficial).toBe(
          entry.correctedEnglishText,
        );
      }
    }
  });

  it('loads only the explicitly configured test fixture URLs', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('SEED_CARDS_URL', 'fixture:e2e/cards');
    vi.stubEnv('SEED_CARD_I18N_URL', 'fixture:e2e/cards/i18n');

    await expect(loadSeedCards()).resolves.toEqual(E2E_SEED_CARDS);
    await expect(loadSeedCardI18n()).resolves.toEqual({});
  });

  it('rejects synthetic fixtures outside the test environment', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SEED_CARDS_URL', 'fixture:e2e/cards');

    await expect(loadSeedCards()).rejects.toThrow('only available when NODE_ENV=test');
  });

  it('keeps seed sources fail-closed when no URL is configured', async () => {
    vi.stubEnv('SEED_CARDS_URL', '');
    vi.stubEnv('SEED_CARD_API_URL', '');
    vi.stubEnv('CARD_API_URL', '');

    await expect(loadSeedCards()).rejects.toThrow('Set SEED_CARDS_URL or SEED_CARD_API_URL');
  });
});
