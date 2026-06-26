#!/usr/bin/env node
// Translate card effects using comprehensive word/phrase dictionary
import { readFileSync, writeFileSync } from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const cards: any[] = require('../cards.json');

// ===== Comprehensive Phrase Dictionary =====
// Order matters: longer phrases first to avoid partial matches

const DICT: Record<string, Record<string, string>> = {
  // Card types
  'キャラクターカード': { 'zh-TW': '角色卡', 'zh-HK': '角色卡', 'zh-CN': '角色卡', 'en': 'Character card', 'ko': '캐릭터 카드' },
  'エリアエンチャント': { 'zh-TW': '區域附魔', 'zh-HK': '區域附魔', 'zh-CN': '区域附魔', 'en': 'Area Enchant', 'ko': '에리어 인챈트' },
  'エンチャントカード': { 'zh-TW': '附魔卡', 'zh-HK': '附魔卡', 'zh-CN': '附魔卡', 'en': 'Enchant card', 'ko': '인챈트 카드' },
  'エンチャント': { 'zh-TW': '附魔', 'zh-HK': '附魔', 'zh-CN': '附魔', 'en': 'Enchant', 'ko': '인챈트' },

  // Field zones
  'パワーチャージャー': { 'zh-TW': '充能區', 'zh-HK': '充能區', 'zh-CN': '充能区', 'en': 'Power Charger', 'ko': '파워 차저' },
  'バトルゾーン': { 'zh-TW': '戰鬥區', 'zh-HK': '戰鬥區', 'zh-CN': '战斗区', 'en': 'Battle Zone', 'ko': '배틀 존' },
  'セットゾーン': { 'zh-TW': '設置區', 'zh-HK': '設置區', 'zh-CN': '设置区', 'en': 'Set Zone', 'ko': '세트 존' },
  'フィールド': { 'zh-TW': '場地', 'zh-HK': '場地', 'zh-CN': '场地', 'en': 'field', 'ko': '필드' },

  // Game terms
  'パワーコスト': { 'zh-TW': '能量消耗', 'zh-HK': '能量消耗', 'zh-CN': '能量消耗', 'en': 'Power Cost', 'ko': '파워 코스트' },
  '攻撃力': { 'zh-TW': '攻擊力', 'zh-HK': '攻擊力', 'zh-CN': '攻击力', 'en': 'Attack', 'ko': '공격력' },
  'ダメージ軽減': { 'zh-TW': '減傷', 'zh-HK': '減傷', 'zh-CN': '减伤', 'en': 'damage reduction', 'ko': '데미지 경감' },
  'ダメージ': { 'zh-TW': '傷害', 'zh-HK': '傷害', 'zh-CN': '伤害', 'en': 'damage', 'ko': '데미지' },
  '時計': { 'zh-TW': '時鐘', 'zh-HK': '時鐘', 'zh-CN': '时钟', 'en': 'clock', 'ko': '시계' },
  '手札': { 'zh-TW': '手牌', 'zh-HK': '手牌', 'zh-CN': '手牌', 'en': 'hand', 'ko': '핸드' },
  'デッキ': { 'zh-TW': '牌組', 'zh-HK': '牌組', 'zh-CN': '牌组', 'en': 'deck', 'ko': '덱' },
  'アビス': { 'zh-TW': '深淵', 'zh-HK': '深淵', 'zh-CN': '深渊', 'en': 'Abyss', 'ko': '어비스' },
  'ターン': { 'zh-TW': '回合', 'zh-HK': '回合', 'zh-CN': '回合', 'en': 'turn', 'ko': '턴' },
  '相手': { 'zh-TW': '對手', 'zh-HK': '對手', 'zh-CN': '对手', 'en': 'opponent', 'ko': '상대' },
  '自分': { 'zh-TW': '自己', 'zh-HK': '自己', 'zh-CN': '自己', 'en': 'self', 'ko': '자신' },
  'お互い': { 'zh-TW': '雙方', 'zh-HK': '雙方', 'zh-CN': '双方', 'en': 'both', 'ko': '양쪽' },

  // Elements
  '闇属性': { 'zh-TW': '闇屬性', 'zh-HK': '闇屬性', 'zh-CN': '暗属性', 'en': 'Dark', 'ko': '어둠 속성' },
  '炎属性': { 'zh-TW': '炎屬性', 'zh-HK': '炎屬性', 'zh-CN': '火属性', 'en': 'Flame', 'ko': '불꽃 속성' },
  '電気属性': { 'zh-TW': '電屬性', 'zh-HK': '電屬性', 'zh-CN': '电属性', 'en': 'Electric', 'ko': '전기 속성' },
  '風属性': { 'zh-TW': '風屬性', 'zh-HK': '風屬性', 'zh-CN': '风属性', 'en': 'Wind', 'ko': '바람 속성' },

  // Phrases
  '昼夜逆転': { 'zh-TW': '晝夜逆轉', 'zh-HK': '晝夜逆轉', 'zh-CN': '昼夜逆转', 'en': 'Swap day/night', 'ko': '낮/밤 전환' },
  '時計を無効': { 'zh-TW': '時鐘無效', 'zh-HK': '時鐘無效', 'zh-CN': '时钟无效', 'en': 'Nullify clock', 'ko': '시계 무효' },
  'すぐに': { 'zh-TW': '立即', 'zh-HK': '立即', 'zh-CN': '立即', 'en': 'immediately', 'ko': '즉시' },
  'ターンの終了時に': { 'zh-TW': '回合結束時', 'zh-HK': '回合結束時', 'zh-CN': '回合结束时', 'en': 'at end of turn', 'ko': '턴 종료 시' },
  'ターンのはじまり': { 'zh-TW': '回合開始', 'zh-HK': '回合開始', 'zh-CN': '回合开始', 'en': 'start of turn', 'ko': '턴 시작' },
  'このカードの効果': { 'zh-TW': '此卡效果', 'zh-HK': '此卡效果', 'zh-CN': '此卡效果', 'en': "this card's effect", 'ko': '이 카드의 효과' },
  '使用中': { 'zh-TW': '使用中', 'zh-HK': '使用中', 'zh-CN': '使用中', 'en': 'while in use', 'ko': '사용 중' },
  '使用後': { 'zh-TW': '使用後', 'zh-HK': '使用後', 'zh-CN': '使用后', 'en': 'after use', 'ko': '사용 후' },
  '攻撃力を': { 'zh-TW': '攻擊力', 'zh-HK': '攻擊力', 'zh-CN': '攻击力', 'en': 'attack', 'ko': '공격력' },
  '回復': { 'zh-TW': '回復', 'zh-HK': '回復', 'zh-CN': '恢复', 'en': 'recover', 'ko': '회복' },
  '与える': { 'zh-TW': '造成', 'zh-HK': '造成', 'zh-CN': '造成', 'en': 'deal', 'ko': '부여' },
  '与え': { 'zh-TW': '造成', 'zh-HK': '造成', 'zh-CN': '造成', 'en': 'deal', 'ko': '부여' },
  '受ける': { 'zh-TW': '受到', 'zh-HK': '受到', 'zh-CN': '受到', 'en': 'receive', 'ko': '받다' },
  '受けた': { 'zh-TW': '受到', 'zh-HK': '受到', 'zh-CN': '受到', 'en': 'received', 'ko': '받은' },
  '選ぶ': { 'zh-TW': '選擇', 'zh-HK': '選擇', 'zh-CN': '选择', 'en': 'choose', 'ko': '선택' },
  '選び': { 'zh-TW': '選擇', 'zh-HK': '選擇', 'zh-CN': '选择', 'en': 'choose', 'ko': '선택' },
  '選んで': { 'zh-TW': '選擇', 'zh-HK': '選擇', 'zh-CN': '选择', 'en': 'choose', 'ko': '선택' },
  '置く': { 'zh-TW': '放置', 'zh-HK': '放置', 'zh-CN': '放置', 'en': 'place', 'ko': '놓다' },
  '置いた': { 'zh-TW': '放置', 'zh-HK': '放置', 'zh-CN': '放置', 'en': 'placed', 'ko': '놓은' },
  '引く': { 'zh-TW': '抽牌', 'zh-HK': '抽牌', 'zh-CN': '抽牌', 'en': 'draw', 'ko': '드로우' },
  '引け': { 'zh-TW': '抽', 'zh-HK': '抽', 'zh-CN': '抽', 'en': 'draw', 'ko': '드로우' },
  '出す': { 'zh-TW': '打出', 'zh-HK': '打出', 'zh-CN': '打出', 'en': 'play', 'ko': '내다' },
  '出した': { 'zh-TW': '打出', 'zh-HK': '打出', 'zh-CN': '打出', 'en': 'played', 'ko': '낸' },
  '入れ替える': { 'zh-TW': '交換', 'zh-HK': '交換', 'zh-CN': '交换', 'en': 'swap', 'ko': '교체' },
  '入れ替え': { 'zh-TW': '交換', 'zh-HK': '交換', 'zh-CN': '交换', 'en': 'swap', 'ko': '교체' },
  '戻す': { 'zh-TW': '返回', 'zh-HK': '返回', 'zh-CN': '返回', 'en': 'return', 'ko': '반환' },
  '戻し': { 'zh-TW': '返回', 'zh-HK': '返回', 'zh-CN': '返回', 'en': 'return', 'ko': '반환' },
  '公開する': { 'zh-TW': '公開', 'zh-HK': '公開', 'zh-CN': '公开', 'en': 'reveal', 'ko': '공개' },
  '公開': { 'zh-TW': '公開', 'zh-HK': '公開', 'zh-CN': '公开', 'en': 'reveal', 'ko': '공개' },
  '追加で': { 'zh-TW': '額外', 'zh-HK': '額外', 'zh-CN': '额外', 'en': 'additional', 'ko': '추가로' },
  'さらに': { 'zh-TW': '額外', 'zh-HK': '額外', 'zh-CN': '额外', 'en': 'additionally', 'ko': '추가로' },
  '自由に': { 'zh-TW': '任意', 'zh-HK': '任意', 'zh-CN': '任意', 'en': 'freely', 'ko': '자유롭게' },
  '好きな': { 'zh-TW': '任意', 'zh-HK': '任意', 'zh-CN': '任意', 'en': 'any', 'ko': '원하는' },
  '枚': { 'zh-TW': '張', 'zh-HK': '張', 'zh-CN': '张', 'en': '', 'ko': '장' },
  'つ': { 'zh-TW': '個', 'zh-HK': '個', 'zh-CN': '个', 'en': '', 'ko': '개' },
  'まで': { 'zh-TW': '最多', 'zh-HK': '最多', 'zh-CN': '最多', 'en': 'up to', 'ko': '까지' },
  '以上': { 'zh-TW': '以上', 'zh-HK': '以上', 'zh-CN': '以上', 'en': 'or more', 'ko': '이상' },
  '以下': { 'zh-TW': '以下', 'zh-HK': '以下', 'zh-CN': '以下', 'en': 'or less', 'ko': '이하' },
  'ない': { 'zh-TW': '沒有', 'zh-HK': '沒有', 'zh-CN': '没有', 'en': 'no', 'ko': '없다' },
  'ある': { 'zh-TW': '有', 'zh-HK': '有', 'zh-CN': '有', 'en': 'has', 'ko': '있다' },
  'なら': { 'zh-TW': '的話', 'zh-HK': '的話', 'zh-CN': '的话', 'en': 'if', 'ko': '이면' },
  'そうしたなら': { 'zh-TW': '若如此', 'zh-HK': '若如此', 'zh-CN': '若如此', 'en': 'if so', 'ko': '그렇게 하면' },
  'すぐにこのカードを': { 'zh-TW': '立即將此卡', 'zh-HK': '立即將此卡', 'zh-CN': '立即将此卡', 'en': 'immediately', 'ko': '즉시 이 카드를' },
  'すぐにアビスに置く': { 'zh-TW': '立即送入深淵', 'zh-HK': '立即送入深淵', 'zh-CN': '立即送入深渊', 'en': 'send to Abyss immediately', 'ko': '즉시 어비스로' },
  'すぐにパワーチャージャーに置く': { 'zh-TW': '立即送入充能區', 'zh-HK': '立即送入充能區', 'zh-CN': '立即送入充能区', 'en': 'send to Power Charger immediately', 'ko': '즉시 파워 차저로' },
  '効果を無効': { 'zh-TW': '效果無效', 'zh-HK': '效果無效', 'zh-CN': '效果无效', 'en': 'nullify effect', 'ko': '효과 무효' },
  '効果': { 'zh-TW': '效果', 'zh-HK': '效果', 'zh-CN': '效果', 'en': 'effect', 'ko': '효과' },
  '発動': { 'zh-TW': '發動', 'zh-HK': '發動', 'zh-CN': '发动', 'en': 'activate', 'ko': '발동' },
  '属性': { 'zh-TW': '屬性', 'zh-HK': '屬性', 'zh-CN': '属性', 'en': 'element', 'ko': '속성' },
  '同じ': { 'zh-TW': '相同', 'zh-HK': '相同', 'zh-CN': '相同', 'en': 'same', 'ko': '같은' },
  '異なる': { 'zh-TW': '不同', 'zh-HK': '不同', 'zh-CN': '不同', 'en': 'different', 'ko': '다른' },
  'すべて': { 'zh-TW': '全部', 'zh-HK': '全部', 'zh-CN': '全部', 'en': 'all', 'ko': '모든' },
  '場所': { 'zh-TW': '位置', 'zh-HK': '位置', 'zh-CN': '位置', 'en': 'position', 'ko': '위치' },
  'このターン': { 'zh-TW': '本回合', 'zh-HK': '本回合', 'zh-CN': '本回合', 'en': 'this turn', 'ko': '이번 턴' },
  '前のターン': { 'zh-TW': '上回合', 'zh-HK': '上回合', 'zh-CN': '上回合', 'en': 'previous turn', 'ko': '이전 턴' },
  '次のターン': { 'zh-TW': '下回合', 'zh-HK': '下回合', 'zh-CN': '下回合', 'en': 'next turn', 'ko': '다음 턴' },
  'ターン終了時': { 'zh-TW': '回合結束時', 'zh-HK': '回合結束時', 'zh-CN': '回合结束时', 'en': 'at end of turn', 'ko': '턴 종료 시' },
  '真夜中': { 'zh-TW': '真夜中', 'zh-HK': '真夜中', 'zh-CN': '真夜中', 'en': 'midnight', 'ko': '한밤중' },
  '真昼': { 'zh-TW': '真晝', 'zh-HK': '真晝', 'zh-CN': '真昼', 'en': 'noon', 'ko': '한낮' },
  '夜': { 'zh-TW': '夜', 'zh-HK': '夜', 'zh-CN': '夜', 'en': 'Night', 'ko': '밤' },
  '昼': { 'zh-TW': '晝', 'zh-HK': '晝', 'zh-CN': '昼', 'en': 'Day', 'ko': '낮' },
};

// Sort dictionary by key length (longest first) to avoid partial matches
const sortedDict = Object.entries(DICT).sort((a, b) => b[0].length - a[0].length);

const LOCALES = ['zh-TW', 'zh-HK', 'zh-CN', 'en', 'ko'] as const;

function translateEffect(effectJa: string, lang: string): string {
  if (lang === 'ja') return effectJa;

  let result = effectJa;
  for (const [ja, translations] of sortedDict) {
    if (result.includes(ja) && translations[lang]) {
      result = result.replaceAll(ja, translations[lang]);
    }
  }
  return result;
}

// ===== Main =====
const effectCards = cards.filter((c: any) => c.effect && c.effect.trim());
const translations: Record<string, Record<string, string>> = {};

let fullCount = 0;
let partialCount = 0;

for (const card of effectCards) {
  translations[card.id] = { ja: card.effect };
  for (const lang of LOCALES) {
    translations[card.id][lang] = translateEffect(card.effect, lang);
  }
  // Check quality: remaining Japanese chars in zh-TW
  const remaining = (translations[card.id]['zh-TW'].match(/[\u3040-\u309F\u30A0-\u30FF]/g) || []).length;
  const total = card.effect.match(/[\u3040-\u309F\u30A0-\u30FF]/g)?.length || 1;
  if (remaining / total < 0.3) fullCount++;
  else partialCount++;
}

writeFileSync('data/card-effects-i18n.json', JSON.stringify(translations, null, 2));

console.log(`Full translation: ${fullCount}/${effectCards.length}`);
console.log(`Partial (>70% translated): ${partialCount}`);
console.log(`Saved to data/card-effects-i18n.json`);

// Show sample
const sampleId = effectCards[0].id;
console.log(`\nSample [${sampleId}]:`);
console.log(`  ja: ${translations[sampleId].ja}`);
console.log(`  zh-TW: ${translations[sampleId]['zh-TW']}`);
console.log(`  en: ${translations[sampleId].en}`);
