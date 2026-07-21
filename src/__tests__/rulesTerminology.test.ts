import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en';
import { ja } from '../i18n/ja';
import { ko } from '../i18n/ko';
import { zhCN } from '../i18n/zh-CN';
import { zhHK } from '../i18n/zh-HK';
import { zhTW, type TranslationKey } from '../i18n/zh-TW';
import { RULES_TERMINOLOGY, rulesTerminologyViolations } from '../rulesTerminology';

const dictionaries = { ja, 'zh-TW': zhTW, 'zh-CN': zhCN, 'zh-HK': zhHK, en, ko } as const;

const glossaryKeys: Array<[TranslationKey, keyof (typeof RULES_TERMINOLOGY)['zh-TW']]> = [
  ['card.type.character', 'character'],
  ['card.type.enchant', 'enchant'],
  ['card.type.areaEnchant', 'areaEnchant'],
  ['card.element.dark', 'dark'],
  ['card.element.flame', 'flame'],
  ['card.element.electric', 'electric'],
  ['card.element.wind', 'wind'],
  ['card.element.chaos', 'chaos'],
  ['card.night', 'night'],
  ['card.day', 'day'],
  ['card.clock', 'clock'],
  ['card.energy', 'powerCost'],
  ['card.charge', 'sendToPower'],
  ['board.powerCharger', 'powerCharger'],
  ['board.abyss', 'abyss'],
  ['board.battleZone', 'battleZone'],
  ['board.setZoneCompact', 'setZone'],
  ['board.deckZone', 'deckZone'],
  ['board.hand', 'hand'],
  ['board.deck', 'deck'],
  ['board.hp', 'hp'],
  ['board.mulligan', 'mulligan'],
  ['board.turn', 'turn'],
  ['board.phaseTrack.set', 'set'],
  ['board.phaseTrack.battle', 'battle'],
  ['board.damage', 'damage'],
  ['board.result.victory', 'victory'],
  ['board.result.defeat', 'defeat'],
  ['board.result.draw', 'draw'],
];

describe('rules terminology glossary', () => {
  it('defines the same complete term set for every locale', () => {
    const expectedKeys = Object.keys(RULES_TERMINOLOGY.ja).sort();
    for (const [locale, terminology] of Object.entries(RULES_TERMINOLOGY)) {
      expect(Object.keys(terminology).sort(), locale).toEqual(expectedKeys);
    }
  });

  it('keeps standalone UI labels aligned with the canonical glossary', () => {
    for (const [locale, dictionary] of Object.entries(dictionaries)) {
      for (const [translationKey, glossaryKey] of glossaryKeys) {
        expect(dictionary[translationKey], `${locale}/${translationKey}`).toBe(
          RULES_TERMINOLOGY[locale as keyof typeof dictionaries][glossaryKey],
        );
      }
    }
  });

  it('rejects legacy or untranslated rules terms in interface copy', () => {
    for (const [locale, dictionary] of Object.entries(dictionaries)) {
      const violations = rulesTerminologyViolations(
        locale as keyof typeof dictionaries,
        Object.values(dictionary).join('\n'),
      );
      expect(violations, locale).toEqual([]);
    }
  });

  it('uses the Korean canonical name for Chronos', () => {
    expect(RULES_TERMINOLOGY.ko.chronos).toBe('크로노스');
    expect(rulesTerminologyViolations('ko', '크로노스 시계')).toEqual([]);
    expect(rulesTerminologyViolations('ko', 'Chronos 시계')).toEqual(['Chronos -> 크로노스']);
  });

  it('uses the official Japanese name for Chronos', () => {
    expect(RULES_TERMINOLOGY.ja.chronos).toBe('クロノス');
    expect(rulesTerminologyViolations('ja', 'クロノス')).toEqual([]);
    expect(rulesTerminologyViolations('ja', 'Chronos')).toEqual(['Chronos -> クロノス']);
  });
});
