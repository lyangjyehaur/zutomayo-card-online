#!/usr/bin/env node
// Generate effect descriptions in 6 languages from parsed effect structure
// Much better than word-by-word translation — produces grammatically correct sentences

import { readFileSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
import { parseEffect } from '../src/game/effects/parser.ts';

const require = createRequire(import.meta.url);
const cards: any[] = require('../cards.json');

// ===== Language-specific templates =====

interface Templates {
  boostAttack: (v: number) => string;
  reduceAttack: (v: number) => string;
  heal: (v: number) => string;
  damageReduce: (v: number) => string;
  directDamage: (v: number) => string;
  drawCards: (v: number) => string;
  swapAttack: () => string;
  clockReset: () => string;
  noEffect: () => string;
  // Conditions
  condNight: () => string;
  condDay: () => string;
  condOppElement: (el: string) => string;
  condSelfElement: (el: string) => string;
  condPowerAtLeast: (v: number) => string;
  condHpLessOrEqual: (v: number) => string;
  condPreviousChar: (el: string) => string;
  condNamedCard: (name: string) => string;
  // Combinators
  ifThen: (cond: string, action: string) => string;
  separator: string;
}

const ELEMENT_NAMES: Record<string, Record<string, string>> = {
  '闇': { 'zh-TW': '闇', 'zh-HK': '闇', 'zh-CN': '暗', 'ja': '闇', 'en': 'Dark', 'ko': '어둠' },
  '炎': { 'zh-TW': '炎', 'zh-HK': '炎', 'zh-CN': '火', 'ja': '炎', 'en': 'Flame', 'ko': '불꽃' },
  '電気': { 'zh-TW': '電', 'zh-HK': '電', 'zh-CN': '电', 'ja': '電気', 'en': 'Electric', 'ko': '전기' },
  '風': { 'zh-TW': '風', 'zh-HK': '風', 'zh-CN': '风', 'ja': '風', 'en': 'Wind', 'ko': '바람' },
  'カオス': { 'zh-TW': '混沌', 'zh-HK': '混沌', 'zh-CN': '混沌', 'ja': 'カオス', 'en': 'Chaos', 'ko': '카오스' },
};

const TEMPLATES: Record<string, Templates> = {
  'zh-TW': {
    boostAttack: (v) => `攻擊力+${v}`,
    reduceAttack: (v) => `攻擊力-${v}`,
    heal: (v) => `回復 ${v} HP`,
    damageReduce: (v) => `減傷 ${v}`,
    directDamage: (v) => `造成 ${v} 點傷害`,
    drawCards: (v) => `抽 ${v} 張卡`,
    swapAttack: () => `晝夜逆轉`,
    clockReset: () => `時鐘歸零`,
    noEffect: () => `效果無效`,
    condNight: () => `夜間`,
    condDay: () => `晝間`,
    condOppElement: (el) => `對手屬性為${el}`,
    condSelfElement: (el) => `自己屬性為${el}`,
    condPowerAtLeast: (v) => `能量≥${v}`,
    condHpLessOrEqual: (v) => `HP≤${v}`,
    condPreviousChar: (el) => `上回合角色屬性為${el}`,
    condNamedCard: (name) => `角色為「${name}」`,
    ifThen: (cond, action) => `若${cond}，${action}`,
    separator: '。',
  },
  'zh-HK': {
    boostAttack: (v) => `攻擊力+${v}`,
    reduceAttack: (v) => `攻擊力-${v}`,
    heal: (v) => `回復 ${v} HP`,
    damageReduce: (v) => `減傷 ${v}`,
    directDamage: (v) => `造成 ${v} 點傷害`,
    drawCards: (v) => `抽 ${v} 張卡`,
    swapAttack: () => `晝夜逆轉`,
    clockReset: () => `時鐘歸零`,
    noEffect: () => `效果無效`,
    condNight: () => `夜間`,
    condDay: () => `晝間`,
    condOppElement: (el) => `對手屬性為${el}`,
    condSelfElement: (el) => `自己屬性為${el}`,
    condPowerAtLeast: (v) => `能量≥${v}`,
    condHpLessOrEqual: (v) => `HP≤${v}`,
    condPreviousChar: (el) => `上回合角色屬性為${el}`,
    condNamedCard: (name) => `角色為「${name}」`,
    ifThen: (cond, action) => `若${cond}，${action}`,
    separator: '。',
  },
  'zh-CN': {
    boostAttack: (v) => `攻击力+${v}`,
    reduceAttack: (v) => `攻击力-${v}`,
    heal: (v) => `恢复 ${v} HP`,
    damageReduce: (v) => `减伤 ${v}`,
    directDamage: (v) => `造成 ${v} 点伤害`,
    drawCards: (v) => `抽 ${v} 张卡`,
    swapAttack: () => `昼夜逆转`,
    clockReset: () => `时钟归零`,
    noEffect: () => `效果无效`,
    condNight: () => `夜间`,
    condDay: () => `昼间`,
    condOppElement: (el) => `对手属性为${el}`,
    condSelfElement: (el) => `自己属性为${el}`,
    condPowerAtLeast: (v) => `能量≥${v}`,
    condHpLessOrEqual: (v) => `HP≤${v}`,
    condPreviousChar: (el) => `上回合角色属性为${el}`,
    condNamedCard: (name) => `角色为「${name}」`,
    ifThen: (cond, action) => `若${cond}，${action}`,
    separator: '。',
  },
  'ja': {
    boostAttack: (v) => `攻撃力+${v}`,
    reduceAttack: (v) => `攻撃力-${v}`,
    heal: (v) => `HPを${v}回復`,
    damageReduce: (v) => `${v}ダメージ軽減`,
    directDamage: (v) => `${v}ダメージ`,
    drawCards: (v) => `カードを${v}枚引く`,
    swapAttack: () => `昼夜逆転`,
    clockReset: () => `時計を無効`,
    noEffect: () => `効果を無効`,
    condNight: () => `夜なら`,
    condDay: () => `昼なら`,
    condOppElement: (el) => `相手の属性が${el}なら`,
    condSelfElement: (el) => `自分の属性が${el}なら`,
    condPowerAtLeast: (v) => `パワーコストが${v}以上`,
    condHpLessOrEqual: (v) => `HPが${v}以下`,
    condPreviousChar: (el) => `前のターンのキャラクターが${el}`,
    condNamedCard: (name) => `キャラクターが（${name}）`,
    ifThen: (cond, action) => `${cond}、${action}`,
    separator: '。',
  },
  'en': {
    boostAttack: (v) => `Attack +${v}`,
    reduceAttack: (v) => `Attack -${v}`,
    heal: (v) => `Recover ${v} HP`,
    damageReduce: (v) => `Reduce damage by ${v}`,
    directDamage: (v) => `Deal ${v} damage`,
    drawCards: (v) => `Draw ${v} card(s)`,
    swapAttack: () => `Swap day/night`,
    clockReset: () => `Reset clock`,
    noEffect: () => `Nullify effect`,
    condNight: () => `if Night`,
    condDay: () => `if Day`,
    condOppElement: (el) => `if opponent is ${el}`,
    condSelfElement: (el) => `if self is ${el}`,
    condPowerAtLeast: (v) => `if Power ≥ ${v}`,
    condHpLessOrEqual: (v) => `if HP ≤ ${v}`,
    condPreviousChar: (el) => `if previous turn character was ${el}`,
    condNamedCard: (name) => `if character is "${name}"`,
    ifThen: (cond, action) => `${action} ${cond}`,
    separator: '. ',
  },
  'ko': {
    boostAttack: (v) => `공격력 +${v}`,
    reduceAttack: (v) => `공격력 -${v}`,
    heal: (v) => `HP ${v} 회복`,
    damageReduce: (v) => `데미지 ${v} 경감`,
    directDamage: (v) => `${v} 데미지`,
    drawCards: (v) => `카드 ${v}장 드로우`,
    swapAttack: () => `낮/밤 전환`,
    clockReset: () => `시계 초기화`,
    noEffect: () => `효과 무효`,
    condNight: () => `밤이면`,
    condDay: () => `낮이면`,
    condOppElement: (el) => `상대 속성이 ${el}이면`,
    condSelfElement: (el) => `자신 속성이 ${el}이면`,
    condPowerAtLeast: (v) => `파워 ≥ ${v}`,
    condHpLessOrEqual: (v) => `HP ≤ ${v}`,
    condPreviousChar: (el) => `이전 턴 캐릭터가 ${el}`,
    condNamedCard: (name) => `캐릭터가 "${name}"`,
    ifThen: (cond, action) => `${cond}，${action}`,
    separator: '. ',
  },
};

function generateDescription(parsed: any, lang: string): string {
  const t = TEMPLATES[lang];
  if (!t) return '';

  const action = parsed.action;
  if (!action) return '';

  // Generate action text
  let actionText = '';
  switch (action.type) {
    case 'boostAttack': actionText = t.boostAttack(action.params?.value ?? 0); break;
    case 'reduceAttack': actionText = t.reduceAttack(action.params?.value ?? 0); break;
    case 'heal': actionText = t.heal(action.params?.value ?? 0); break;
    case 'damageReduce': actionText = t.damageReduce(action.params?.value ?? 0); break;
    case 'directDamage': actionText = t.directDamage(action.params?.value ?? 0); break;
    case 'drawCards': actionText = t.drawCards(action.params?.value ?? 0); break;
    case 'swapAttack': actionText = t.swapAttack(); break;
    case 'clockReset': actionText = t.clockReset(); break;
    case 'noEffect': actionText = t.noEffect(); break;
    default: return ''; // Unknown action type
  }

  // Generate condition text
  const conditions = parsed.conditions || [];
  if (conditions.length === 0) return actionText;

  const condTexts: string[] = [];
  for (const cond of conditions) {
    const elemName = cond.value ? (ELEMENT_NAMES[cond.value]?.[lang] || cond.value) : '';
    switch (cond.type) {
      case 'chronos': condTexts.push(cond.value === 'night' ? t.condNight() : t.condDay()); break;
      case 'opponentElement': condTexts.push(t.condOppElement(elemName)); break;
      case 'selfElement': condTexts.push(t.condSelfElement(elemName)); break;
      case 'powerAtLeast': condTexts.push(t.condPowerAtLeast(cond.value)); break;
      case 'hpLessOrEqual': condTexts.push(t.condHpLessOrEqual(cond.value)); break;
      case 'previousCharElement': condTexts.push(t.condPreviousChar(elemName)); break;
      case 'namedCardCondition': condTexts.push(t.condNamedCard(cond.value)); break;
      default: break;
    }
  }

  if (condTexts.length === 0) return actionText;
  return t.ifThen(condTexts.join(lang === 'en' ? ' and ' : '、'), actionText);
}

// ===== Main =====
const effectCards = cards.filter((c: any) => c.effect?.trim());
const LOCALES = ['zh-TW', 'zh-HK', 'zh-CN', 'ja', 'en', 'ko'];
const translations: Record<string, Record<string, string>> = {};

let fullCount = 0;
let fallbackCount = 0;

for (const card of effectCards) {
  const parsed = parseEffect(card.effect);
  translations[card.id] = { ja: card.effect };

  if (parsed) {
    for (const lang of LOCALES) {
      if (lang === 'ja') continue;
      const desc = generateDescription(parsed, lang);
      translations[card.id][lang] = desc || card.effect; // fallback to Japanese
      if (desc) fullCount++;
      else fallbackCount++;
    }
  } else {
    // Unparsed — use Japanese for all languages
    for (const lang of LOCALES) {
      if (lang === 'ja') continue;
      translations[card.id][lang] = card.effect;
      fallbackCount++;
    }
  }
}

writeFileSync('data/card-effects-i18n.json', JSON.stringify(translations, null, 2));

console.log(`Generated: ${fullCount} descriptions`);
console.log(`Fallback to Japanese: ${fallbackCount}`);
console.log(`Total cards: ${effectCards.length}`);
console.log(`Saved to data/card-effects-i18n.json`);

// Show samples
const samples = ['1st_5', '1st_7', '1st_25', '1st_37'];
for (const id of samples) {
  if (translations[id]) {
    console.log(`\n[${id}]`);
    console.log(`  ja:    ${translations[id].ja}`);
    console.log(`  zh-TW: ${translations[id]['zh-TW']}`);
    console.log(`  en:    ${translations[id].en}`);
  }
}
