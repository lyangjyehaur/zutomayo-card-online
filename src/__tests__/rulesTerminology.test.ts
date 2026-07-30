import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en';
import { ja } from '../i18n/ja';
import { ko } from '../i18n/ko';
import { zhCN } from '../i18n/zh-CN';
import { zhHK } from '../i18n/zh-HK';
import { zhTW, type TranslationKey } from '../i18n/zh-TW';
import { RULES_TERMINOLOGY, rulesTerminologySourceViolations, rulesTerminologyViolations } from '../rulesTerminology';

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

  it('rejects transliterated Chronos in Chinese rules text', () => {
    expect(rulesTerminologyViolations('zh-TW', '將克洛諾斯推進9格')).toEqual(['克洛諾斯 -> Chronos']);
    expect(rulesTerminologyViolations('zh-CN', '将克洛诺斯推进9格')).toEqual(['克洛诺斯 -> Chronos']);
    expect(rulesTerminologyViolations('zh-HK', '將 Chronos 推進9格')).toEqual([]);
  });

  it('rejects non-canonical zone and attribute terms used by incremental cards', () => {
    expect(rulesTerminologyViolations('zh-TW', '角色卡在戰場期間變為電氣')).toEqual([
      '戰場期間 -> 戰鬥區期間',
      '電氣 -> 電',
    ]);
    expect(rulesTerminologyViolations('zh-CN', '角色卡在战场期间变为电气')).toEqual([
      '战场期间 -> 战斗区期间',
      '电气 -> 电',
    ]);
    expect(rulesTerminologyViolations('ko', '배틀필드의 심연에서 태어난 혼돈')).toEqual(['배틀필드 -> 배틀 존']);
  });

  it('rejects the legacy Traditional Chinese HP recovery term', () => {
    expect(rulesTerminologyViolations('zh-TW', '恢復HP 20')).toEqual(['恢復 -> 回復']);
    expect(rulesTerminologyViolations('zh-HK', '恢復HP 20')).toEqual(['恢復 -> 回復']);
    expect(rulesTerminologyViolations('zh-CN', '恢复HP 20')).toEqual([]);
  });

  it('requires canonical target terms only when the source uses the corresponding rules term', () => {
    expect(
      rulesTerminologySourceViolations(
        'ja',
        'zh-TW',
        'カードをアビスに置く。HPを10回復。',
        '將卡放入深淵。恢復10 HP。',
      ),
    ).toEqual(['カード -> 卡牌', '回復 -> 回復', '置く -> 放置']);
    expect(
      rulesTerminologySourceViolations(
        'ja',
        'ko',
        'バトルフィールドにいる間、パワーチャージャーに置く。',
        '배틀 존에 있는 동안 파워 차저에 놓는다.',
      ),
    ).toEqual([]);
    expect(rulesTerminologySourceViolations('ja', 'ko', '深淵より生まれた混沌。', '심연에서 태어난 혼돈.')).toEqual([]);
    expect(rulesTerminologySourceViolations('ja', 'zh-TW', '時計を9進める', '將 Chronos 推進9格')).toEqual([]);
    expect(rulesTerminologySourceViolations('ja', 'ko', '時計を9進める', '시계를 9칸 전진시킨다')).toEqual([
      '時計を進める -> 크로노스',
    ]);
    expect(
      rulesTerminologySourceViolations('ja', 'zh-TW', '札幌市時計台で英気を養う。', '在札幌市鐘樓養精蓄銳。'),
    ).toEqual([]);
  });

  it('uses the official Japanese name for Chronos', () => {
    expect(RULES_TERMINOLOGY.ja.chronos).toBe('クロノス');
    expect(rulesTerminologyViolations('ja', 'クロノス')).toEqual([]);
    expect(rulesTerminologyViolations('ja', 'Chronos')).toEqual(['Chronos -> クロノス']);
  });
});
