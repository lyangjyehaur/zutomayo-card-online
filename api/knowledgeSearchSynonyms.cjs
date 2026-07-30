/* global module */

// These groups mirror the canonical RULES_TERMINOLOGY entries. The unit test
// compares every value with that dictionary so search terminology cannot drift.
const SEARCH_TERMINOLOGY_GROUPS = Object.freeze({
  character: ['キャラクター', '角色', '角色', '角色', 'Character', '캐릭터'],
  characterCard: ['キャラクターカード', '角色卡', '角色卡', '角色卡', 'Character card', '캐릭터 카드'],
  enchant: ['エンチャント', '附魔', '附魔', '附魔', 'Enchant', '인챈트'],
  areaEnchant: ['エリアエンチャント', '區域附魔', '区域附魔', '區域附魔', 'Area Enchant', '에리어 인챈트'],
  powerCost: ['パワーコスト', 'Power Cost', 'Power Cost', 'Power Cost', 'Power Cost', 'Power Cost'],
  powerCharger: ['パワーチャージャー', '充能區', '充能区', '充能區', 'Power Charger', '파워 차저'],
  abyss: ['アビス', '深淵', '深渊', '深淵', 'Abyss', '어비스'],
  battleZone: ['バトルゾーン', '戰鬥區', '战斗区', '戰鬥區', 'Battle Zone', '배틀 존'],
  setZone: ['セットゾーン', '設置區', '设置区', '設置區', 'Set Zone', '세트 존'],
  hand: ['手札', '手牌', '手牌', '手牌', 'Hand', '손패'],
  deck: ['デッキ', '牌組', '牌组', '牌組', 'Deck', '덱'],
  chronos: ['クロノス', 'Chronos', 'Chronos', 'Chronos', 'Chronos', '크로노스'],
  clock: ['時計', '時計', '时钟', '時計', 'Clock', '시계'],
  attackPower: ['攻撃力', '攻擊力', '攻击力', '攻擊力', 'Attack', '공격력'],
  card: ['カード', '卡牌', '卡牌', '卡牌', 'Card', '카드'],
  effect: ['効果', '效果', '效果', '效果', 'Effect', '효과'],
  damage: ['ダメージ', '傷害', '伤害', '傷害', 'Damage', '데미지'],
  damageReduction: ['ダメージ軽減', '傷害減免', '伤害减免', '傷害減免', 'Damage reduction', '데미지 감소'],
  recovery: ['回復', '回復', '恢复', '回復', 'Recovery', '회복'],
  mulligan: ['引き直し', '手牌重抽', '手牌重抽', '手牌重抽', 'Mulligan', '멀리건'],
  reveal: ['公開', '公開', '公开', '公開', 'Reveal', '공개'],
  timeAdvance: ['時間推進', '時間推進', '时间推进', '時間推進', 'Time advance', '시간 진행'],
  effectResolution: ['効果処理', '效果結算', '效果结算', '效果結算', 'Effect Resolution', '효과 처리'],
  damageCalculation: ['ダメージ計算', '傷害計算', '伤害计算', '傷害計算', 'Damage calculation', '데미지 계산'],
  nullify: ['無効', '無效', '无效', '無效', 'Nullify', '무효'],
  drawCard: ['カードを引く', '抽牌', '抽牌', '抽牌', 'Draw a card', '카드 뽑기'],
  victory: ['勝利', '勝利', '胜利', '勝利', 'Victory', '승리'],
  defeat: ['敗北', '敗北', '败北', '敗北', 'Defeat', '패배'],
});

function buildTerminologySynonyms(groups = SEARCH_TERMINOLOGY_GROUPS) {
  const synonyms = {};
  for (const values of Object.values(groups)) {
    const unique = [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
    for (const value of unique) synonyms[value] = unique.filter((candidate) => candidate !== value);
  }
  return synonyms;
}

module.exports = { SEARCH_TERMINOLOGY_GROUPS, buildTerminologySynonyms };
