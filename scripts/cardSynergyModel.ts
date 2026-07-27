import { parseAllEffects } from '../src/game/effects/parser';
import type { Condition, ParsedEffect } from '../src/game/effects/types';
import type { CardDef } from '../src/game/types';

export type SynergyCard = Pick<CardDef, 'id' | 'name' | 'effect'> &
  Partial<Pick<CardDef, 'element' | 'type' | 'song' | 'powerCost' | 'sendToPower' | 'playStatus'>> & {
    source: 'postgres' | 'reviewed-extraction' | 'unlisted-review';
  };

export type SynergyFeature = {
  concept: string;
  evidence: string[];
};

export const SYNERGY_CATEGORIES = [
  'named_card_song',
  'element',
  'zone_resource',
  'chronos',
  'hp_damage',
  'hand_draw',
  'card_stats_type',
  'deck_flow',
  'area_enchant',
  'event_trigger',
  'other',
] as const;

export type SynergyCategory = (typeof SYNERGY_CATEGORIES)[number];

export const SYNERGY_CATEGORY_LABELS: Record<SynergyCategory, string> = {
  named_card_song: '指定歌曲／卡牌',
  element: '屬性相關',
  zone_resource: '深淵／充能區資源',
  chronos: 'Chronos／時間',
  hp_damage: 'HP／傷害／減傷',
  hand_draw: '手牌／抽牌',
  card_stats_type: 'Power Cost／卡牌種類',
  deck_flow: '牌組頂／SEND TO POWER 分流',
  area_enchant: '區域附魔卡',
  event_trigger: '進場／戰敗／受傷等事件',
  other: '其他',
};

export type SynergyProfile = {
  card: SynergyCard;
  outputs: SynergyFeature[];
  inputs: SynergyFeature[];
  blockers: SynergyFeature[];
  parsedEffectCount: number;
};

export type SynergyRelation = {
  sourceCardId: string;
  targetCardId: string;
  kind: 'enables' | 'conflicts';
  score: number;
  confidence: 'high' | 'medium' | 'low';
  concepts: string[];
  categories: SynergyCategory[];
  primaryCategory: SynergyCategory;
  rationale: string;
  evidence: string[];
  playabilityEligible: boolean;
  recommendationEligible: boolean;
  reviewStatus: 'candidate';
};

export type SynergyGroup = {
  id: string;
  concept: string;
  category: SynergyCategory;
  title: string;
  rationale: string;
  enablerCardIds: string[];
  payoffCardIds: string[];
  relationCount: number;
  reviewStatus: 'candidate';
};

export function synergyCategoriesForConcept(concept: string): SynergyCategory[] {
  if (concept.startsWith('named-card:')) return ['named_card_song'];
  if (/^(?:self-element:|opponent-element:|previous-element:|own-abyss-element:|own-power-element:)/u.test(concept)) {
    return ['element'];
  }
  if (/^(?:own|opponent)-(?:abyss|power)-stock$/u.test(concept)) return ['zone_resource'];
  if (concept === 'chronos-control' || concept === 'attack-time-control' || concept.startsWith('chronos-')) {
    return ['chronos'];
  }
  if (
    concept === 'damage-reduced' ||
    concept === 'hp-comparison' ||
    concept === 'opponent-hp-pressure' ||
    /^(?:own|opponent)-hp-(?:threshold|recovery)$/u.test(concept)
  ) {
    return ['hp_damage'];
  }
  if (['draw-event', 'hand-stock', 'hand-cycle-cost'].includes(concept)) return ['hand_draw'];
  if (
    concept === 'simultaneous-character' ||
    concept === 'extra-set-capacity' ||
    concept.startsWith('self-power-cost:') ||
    concept.startsWith('zone-entry-type:')
  ) {
    return ['card_stats_type'];
  }
  if (concept.startsWith('deck-top-')) return ['deck_flow'];
  if (concept.includes('area-enchant')) return ['area_enchant'];
  if (concept === 'battle-loss' || concept === 'damage-received' || concept.startsWith('zone-entry:')) {
    return ['event_trigger'];
  }
  return ['other'];
}

function categoriesForConcepts(concepts: string[]): SynergyCategory[] {
  const matched = new Set(concepts.flatMap(synergyCategoriesForConcept));
  return SYNERGY_CATEGORIES.filter((category) => matched.has(category));
}

type FeatureMap = Map<string, Set<string>>;

function normalizedName(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\s（）()「」『』・･_\-—―,，.。!！?？]/gu, '')
    .toLowerCase();
}

function addFeature(map: FeatureMap, concept: string, evidence: string): void {
  const values = map.get(concept) ?? new Set<string>();
  values.add(evidence);
  map.set(concept, values);
}

function conditionList(conditions: Condition[]): Condition[] {
  return conditions.flatMap((condition) =>
    condition.type === 'and' || condition.type === 'or' ? conditionList(condition.value) : [condition],
  );
}

function valueStrings(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(valueStrings);
  return typeof value === 'string' || typeof value === 'number' ? [String(value)] : [];
}

function numericConditionValues(condition: Condition, minimum = 0, maximum = 8): number[] {
  const values = valueStrings(condition.value).map(Number).filter(Number.isFinite);
  if (condition.operator === 'in') return values;
  const pivot = values[0];
  if (pivot === undefined) return [];
  if (condition.operator === 'gte') {
    const start = Math.max(minimum, pivot);
    return start > maximum ? [] : Array.from({ length: maximum - start + 1 }, (_, i) => start + i);
  }
  if (condition.operator === 'lte') {
    const end = Math.min(maximum, pivot);
    return end < minimum ? [] : Array.from({ length: end - minimum + 1 }, (_, i) => minimum + i);
  }
  return [pivot];
}

function collectConditionFeatures(effect: ParsedEffect, inputs: FeatureMap, blockers: FeatureMap): void {
  for (const condition of conditionList(effect.conditions)) {
    const evidence = `${condition.type}: ${valueStrings(condition.value).join(', ')}`;
    const ownerPrefix = condition.owner === 'opponent' ? 'opponent' : 'own';
    if (
      ['abyssCount', 'abyssElements', 'abyssElementCount', 'abyssAllSameElement', 'specificElements'].includes(
        condition.type,
      )
    ) {
      const zone = condition.target === 'powerCharger' ? 'power-stock' : 'abyss-stock';
      addFeature(inputs, `${ownerPrefix}-${zone}`, evidence);
    }
    if (['abyssElementCount', 'powerChargerElementCount'].includes(condition.type) && condition.element) {
      const zone = condition.type === 'powerChargerElementCount' ? 'power' : 'abyss';
      addFeature(inputs, `${ownerPrefix}-${zone}-element:${condition.element}`, evidence);
    }
    if (['abyssAllSameElement', 'powerChargerAllSameElement'].includes(condition.type)) {
      const zone = condition.type === 'powerChargerAllSameElement' ? 'power' : 'abyss';
      for (const element of valueStrings(condition.value)) {
        addFeature(inputs, `${ownerPrefix}-${zone}-element:${element}`, evidence);
      }
    }
    if (condition.type === 'specificElements') {
      const zone = condition.target === 'powerCharger' ? 'power' : 'abyss';
      for (const element of valueStrings(condition.value)) {
        addFeature(inputs, `${ownerPrefix}-${zone}-element:${element}`, evidence);
      }
    }
    if (condition.type === 'zoneHasElement') {
      const zone = condition.target === 'powerCharger' ? 'power-stock' : 'abyss-stock';
      addFeature(inputs, `${ownerPrefix}-${zone}`, evidence);
      for (const element of valueStrings(condition.value)) {
        addFeature(
          inputs,
          `${ownerPrefix}-${condition.target === 'powerCharger' ? 'power' : 'abyss'}-element:${element}`,
          evidence,
        );
      }
    }
    if (condition.type === 'noCardInAbyss') addFeature(blockers, `${ownerPrefix}-abyss-stock`, evidence);
    if (
      ['powerAtLeast', 'powerChargerElementCount', 'powerChargerAllSameElement'].includes(condition.type) ||
      (condition.type === 'zoneCountAtLeast' && condition.target === 'powerCharger')
    ) {
      addFeature(inputs, `${ownerPrefix}-power-stock`, evidence);
    }
    if (condition.type === 'zoneCountComparison') {
      const zone = condition.target === 'powerCharger' ? 'power-stock' : 'abyss-stock';
      addFeature(inputs, `${ownerPrefix}-${zone}`, evidence);
    }
    if (['handCount', 'handElements'].includes(condition.type)) addFeature(inputs, 'hand-stock', evidence);
    if (condition.type === 'drawOccurredThisEffect') addFeature(inputs, 'draw-event', evidence);
    if (['chronos', 'chronosPosition', 'chronosChanged', 'chronosTimeChanged'].includes(condition.type)) {
      addFeature(inputs, 'chronos-control', evidence);
      if (condition.type === 'chronos') addFeature(inputs, `chronos-window:${condition.value}`, evidence);
      if (condition.type === 'chronosPosition') addFeature(inputs, `chronos-position:${condition.value}`, evidence);
      if (condition.type === 'chronosTimeChanged')
        addFeature(inputs, `chronos-transition:${condition.value}`, evidence);
    }
    if (condition.type === 'hpLessOrEqual' || condition.type === 'hpComparison') {
      addFeature(inputs, `${condition.target === 'opponent' ? 'opponent' : 'own'}-hp-threshold`, evidence);
      if (condition.target === 'opponent' && condition.type === 'hpLessOrEqual') {
        addFeature(inputs, 'opponent-hp-pressure', evidence);
      }
      addFeature(blockers, `${condition.target === 'opponent' ? 'opponent' : 'own'}-hp-recovery`, evidence);
    }
    if (condition.type === 'hpLessThanOpponent') addFeature(inputs, 'hp-comparison', evidence);
    if (condition.type === 'hasAreaEnchant') {
      addFeature(
        inputs,
        condition.target === 'opponent' ? 'opponent-area-enchant-presence' : 'own-area-enchant-presence',
        evidence,
      );
    }
    if (['zoneEntered', 'zoneEnteredCardType'].includes(condition.type)) {
      addFeature(inputs, `zone-entry:${condition.target || 'any'}`, evidence);
    }
    if (condition.type === 'namedCardCondition' || condition.type === 'namedCardInBattleZone') {
      for (const name of valueStrings(condition.value)) {
        addFeature(inputs, `named-card:${normalizedName(name)}`, evidence);
      }
    }
    if (condition.type === 'selfPowerCost') {
      for (const value of numericConditionValues(condition)) addFeature(inputs, `self-power-cost:${value}`, evidence);
    }
    if (condition.type === 'previousCharElement') {
      for (const element of valueStrings(condition.value)) addFeature(inputs, `previous-element:${element}`, evidence);
    }
    if (condition.type === 'simultaneousCharacter') addFeature(inputs, 'simultaneous-character', evidence);
    if (condition.type === 'zoneEnteredCardType') {
      for (const type of valueStrings(condition.value)) addFeature(inputs, `zone-entry-type:${type}`, evidence);
    }
    if (condition.type === 'opponentElement') {
      for (const element of valueStrings(condition.value)) addFeature(inputs, `opponent-element:${element}`, evidence);
    }
    if (condition.type === 'selfElement') {
      for (const element of valueStrings(condition.value)) addFeature(inputs, `self-element:${element}`, evidence);
    }
    if (condition.type === 'battleLost') addFeature(inputs, 'battle-loss', evidence);
    if (condition.type === 'damageAtLeast') addFeature(inputs, 'damage-received', evidence);
  }
}

function collectActionFeatures(effect: ParsedEffect, outputs: FeatureMap, inputs: FeatureMap): void {
  const action = effect.action;
  const text = effect.rawText;
  const evidence = `${action.type}: ${text}`;
  if (action.type === 'millDeckToAbyss') {
    addFeature(outputs, action.params.target === 'opponent' ? 'opponent-abyss-stock' : 'own-abyss-stock', evidence);
  }
  if (action.type === 'sendToAbyss') {
    const target = action.params.target ?? action.params.targetOwner;
    addFeature(
      outputs,
      target === 'opponent' || text.includes('相手') ? 'opponent-abyss-stock' : 'own-abyss-stock',
      evidence,
    );
  }
  if (['recoverFromAbyss', 'useFromAbyss'].includes(action.type)) addFeature(inputs, 'own-abyss-stock', evidence);
  if (action.type === 'moveOwnDeckTopByPower') {
    addFeature(outputs, 'own-power-stock', evidence);
    addFeature(outputs, 'own-abyss-stock', evidence);
    addFeature(inputs, 'deck-top-power-hit', evidence);
    addFeature(inputs, 'deck-top-abyss-hit', evidence);
  }
  if (action.type === 'moveOpponentDeckTopByPowerCost') addFeature(outputs, 'opponent-power-stock', evidence);
  if (action.type === 'boostPower') addFeature(outputs, 'own-power-stock', evidence);
  if (action.type === 'drawCards') {
    addFeature(outputs, 'draw-event', evidence);
    addFeature(outputs, 'hand-stock', evidence);
  }
  if (action.type === 'handSizeModifier') addFeature(inputs, 'draw-event', evidence);
  if (action.type === 'damageReduce') addFeature(outputs, 'damage-reduced', evidence);
  if (action.type === 'directDamage' && action.params.value === 'reducedThisTurn') {
    addFeature(inputs, 'damage-reduced', evidence);
  }
  if (action.type === 'directDamage') addFeature(outputs, 'opponent-hp-pressure', evidence);
  if (action.type === 'heal') addFeature(outputs, 'own-hp-recovery', evidence);
  if (action.type === 'healOpponent') addFeature(outputs, 'opponent-hp-recovery', evidence);
  if (action.type === 'healBoth') {
    addFeature(outputs, 'own-hp-recovery', evidence);
    addFeature(outputs, 'opponent-hp-recovery', evidence);
  }
  if (
    [
      'clockReset',
      'clockRewindOpponentCharacter',
      'clockSet',
      'clockAdvance',
      'clockSetFromTurnStartMinusOpponentClock',
      'setAllCardClocks',
      'expandMidnightRange',
    ].includes(action.type)
  ) {
    addFeature(outputs, 'chronos-control', evidence);
  }
  if (action.type === 'clockSet') {
    const position = Number(action.params.value);
    if (position === 0) {
      addFeature(outputs, 'chronos-position:midnight', evidence);
      addFeature(outputs, 'chronos-window:night', evidence);
    }
    if (position === 6) {
      addFeature(outputs, 'chronos-position:noon', evidence);
      addFeature(outputs, 'chronos-window:day', evidence);
    }
  }
  if (action.type === 'expandMidnightRange') addFeature(outputs, 'chronos-position:midnight', evidence);
  if (action.type === 'setOpponentElement') {
    for (const element of valueStrings(action.params.element ?? action.params.value)) {
      addFeature(outputs, `opponent-element:${element}`, evidence);
    }
  }
  if (action.type === 'addSettableCard') addFeature(outputs, 'extra-set-capacity', evidence);
  if (action.type === 'moveSelfAreaEnchant') addFeature(outputs, 'area-enchant-turnover', evidence);
  if (action.type === 'forceOwnAttackTime' || action.type === 'swapAttack') {
    addFeature(outputs, 'attack-time-control', evidence);
  }
}

function collectTextFeatures(card: SynergyCard, outputs: FeatureMap, inputs: FeatureMap, blockers: FeatureMap): void {
  const text = card.effect || '';
  if (/相手のデッキの(?:一番)?上から[^。\n]*アビスに置く/u.test(text)) {
    addFeature(outputs, 'opponent-abyss-stock', text);
  } else if (/(?:自分の)?デッキの(?:一番)?上から[^。\n]*アビスに置く/u.test(text)) {
    addFeature(outputs, 'own-abyss-stock', text);
  }
  if (/手札から[^。\n]*アビスに置く/u.test(text)) addFeature(outputs, 'own-abyss-stock', text);
  if (
    /^(?!相手の).*アビスに(?:[^。\n]*)(?:[0-9０-９]+枚以上(?:の)?カードがある|カードが[0-9０-９]+枚以上)/u.test(text)
  ) {
    addFeature(inputs, 'own-abyss-stock', text);
  }
  if (/相手のアビスに(?:[^。\n]*)(?:[0-9０-９]+枚以上(?:の)?カードがある|カードが[0-9０-９]+枚以上)/u.test(text)) {
    addFeature(inputs, 'opponent-abyss-stock', text);
  }
  if (/^(?!相手の).*アビスにカードがないなら/u.test(text)) addFeature(blockers, 'own-abyss-stock', text);
  if (/相手のアビスにカードがないなら/u.test(text)) addFeature(blockers, 'opponent-abyss-stock', text);
  if (/相手のアビスにカードが置かれたとき/u.test(text)) addFeature(inputs, 'opponent-abyss-stock', text);
  if (/パワーチャージャーに(?:カードを置いた|置かれた)とき/u.test(text)) {
    addFeature(inputs, 'own-power-stock', text);
  }
  if (/手札[^。\n]*(?:アビスに置く|デッキの(?:一番下|底)に置く)/u.test(text)) {
    addFeature(outputs, 'hand-cycle-cost', text);
  }
  if (/カードを[0-9０-９]+枚引/u.test(text)) addFeature(outputs, 'draw-event', text);
  if (/(?:[0-9０-９]+ダメージ(?:を)?|ダメージ(?:を)?[0-9０-９]+)軽減/u.test(text)) {
    addFeature(outputs, 'damage-reduced', text);
  }
  if (/このターンに軽減した数値分のダメージ/u.test(text)) addFeature(inputs, 'damage-reduced', text);
  if (/エリアエンチャント/u.test(text) && card.type === 'Area Enchant') {
    addFeature(outputs, 'area-enchant-presence', `${card.id} is an Area Enchant`);
  }
  if (/バトルに負け/u.test(text)) addFeature(inputs, 'battle-loss', text);
  if (/自分がダメージを受け/u.test(text)) addFeature(inputs, 'damage-received', text);
}

function mapFeatures(map: FeatureMap): SynergyFeature[] {
  return [...map.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([concept, evidence]) => ({ concept, evidence: [...evidence] }));
}

export function deriveSynergyProfiles(cards: SynergyCard[]): SynergyProfile[] {
  const parsed = parseAllEffects(cards.map((card) => ({ id: card.id, effect: card.effect || '' })));
  return cards.map((card) => {
    const outputs: FeatureMap = new Map();
    const inputs: FeatureMap = new Map();
    const blockers: FeatureMap = new Map();
    addFeature(outputs, `named-card:${normalizedName(card.name)}`, `card name: ${card.name}`);
    for (const song of card.name.matchAll(/[（(]([^）)]+)[）)]/gu)) {
      addFeature(outputs, `named-card:${normalizedName(song[1])}`, `card name parenthetical: ${song[1]}`);
    }
    if (card.song) addFeature(outputs, `named-card:${normalizedName(card.song)}`, `card song: ${card.song}`);
    if (card.element) {
      addFeature(outputs, `own-abyss-element:${card.element}`, `card element: ${card.element}`);
      addFeature(outputs, `own-power-element:${card.element}`, `card element: ${card.element}`);
    }
    if (card.powerCost !== undefined && card.type === 'Character') {
      addFeature(outputs, `self-power-cost:${card.powerCost}`, `card Power Cost: ${card.powerCost}`);
    }
    if (card.sendToPower !== undefined) {
      addFeature(
        outputs,
        Number(card.sendToPower) > 0 ? 'deck-top-power-hit' : 'deck-top-abyss-hit',
        `card SEND TO POWER: ${card.sendToPower}`,
      );
    }
    if (card.type === 'Character') {
      addFeature(outputs, 'simultaneous-character', 'card type: Character');
      addFeature(outputs, 'zone-entry-type:Character', 'card type: Character');
      if (card.element) {
        addFeature(outputs, `self-element:${card.element}`, `card element: ${card.element}`);
        addFeature(outputs, `previous-element:${card.element}`, `card element: ${card.element}`);
      }
    }
    if (card.type === 'Area Enchant') addFeature(outputs, 'own-area-enchant-presence', 'card type: Area Enchant');
    for (const effect of parsed.get(card.id) ?? []) {
      collectConditionFeatures(effect, inputs, blockers);
      collectActionFeatures(effect, outputs, inputs);
      if (effect.expiry) {
        collectConditionFeatures(effect.expiry, inputs, blockers);
        collectActionFeatures(effect.expiry, outputs, inputs);
      }
    }
    collectTextFeatures(card, outputs, inputs, blockers);
    return {
      card,
      outputs: mapFeatures(outputs),
      inputs: mapFeatures(inputs),
      blockers: mapFeatures(blockers),
      parsedEffectCount: (parsed.get(card.id) ?? []).length,
    };
  });
}

const CONCEPT_LABELS: Record<string, string> = {
  'own-abyss-stock': '己方深淵資源',
  'opponent-abyss-stock': '對手深淵事件',
  'own-power-stock': '充能區資源',
  'opponent-power-stock': '對手充能區事件',
  'draw-event': '抽牌事件',
  'hand-stock': '手牌數量',
  'damage-reduced': '本回合減傷數值',
  'chronos-control': 'Chronos 時間控制',
  'own-hp-threshold': '己方 HP 閾值',
  'opponent-hp-threshold': '對手 HP 閾值',
  'opponent-hp-pressure': '壓低對手 HP',
  'own-hp-recovery': '己方 HP 回復',
  'opponent-hp-recovery': '對手 HP 回復',
  'hp-comparison': '雙方 HP 比較',
  'area-enchant-presence': '區域附魔卡在場',
  'own-area-enchant-presence': '己方區域附魔卡在場',
  'opponent-area-enchant-presence': '對手區域附魔卡在場',
  'battle-loss': '戰敗事件',
  'damage-received': '受到傷害事件',
  'simultaneous-character': '同時打出角色卡',
  'deck-top-power-hit': '牌組頂 SEND TO POWER 命中',
  'deck-top-abyss-hit': '牌組頂送入深淵',
};

const CONCEPT_BASE_SCORES: Record<string, number> = {
  'damage-reduced': 92,
  'area-enchant-presence': 86,
  'own-area-enchant-presence': 86,
  'opponent-area-enchant-presence': 86,
  'opponent-abyss-stock': 84,
  'opponent-power-stock': 84,
  'own-abyss-stock': 80,
  'own-power-stock': 78,
  'draw-event': 78,
  'battle-loss': 76,
  'damage-received': 76,
  'hand-stock': 70,
  'opponent-hp-pressure': 72,
  'own-hp-threshold': 66,
  'opponent-hp-threshold': 66,
  'hp-comparison': 62,
  'chronos-control': 60,
  'simultaneous-character': 74,
  'deck-top-power-hit': 72,
  'deck-top-abyss-hit': 72,
};

function relationScore(concepts: string[]): number {
  const strongest = Math.max(
    ...concepts.map((concept) => {
      if (concept.startsWith('named-card:')) return 96;
      if (concept.startsWith('opponent-element:')) return 88;
      if (concept.startsWith('self-element:')) return 78;
      if (concept.startsWith('zone-entry:')) return 82;
      if (concept.startsWith('own-abyss-element:') || concept.startsWith('own-power-element:')) return 76;
      if (concept.startsWith('chronos-position:')) return 90;
      if (concept.startsWith('chronos-window:')) return 86;
      if (concept.startsWith('chronos-transition:')) return 86;
      if (concept.startsWith('previous-element:')) return 80;
      if (concept.startsWith('self-power-cost:')) return 78;
      return CONCEPT_BASE_SCORES[concept] ?? 68;
    }),
  );
  return Math.min(98, strongest + Math.max(0, concepts.length - 1) * 4);
}

function confidenceForScore(score: number): SynergyRelation['confidence'] {
  if (score >= 85) return 'high';
  if (score >= 72) return 'medium';
  return 'low';
}

function conceptLabel(concept: string): string {
  if (CONCEPT_LABELS[concept]) return CONCEPT_LABELS[concept];
  if (concept.startsWith('named-card:')) return '指定卡牌／歌曲';
  if (concept.startsWith('opponent-element:')) return `對手屬性 ${concept.split(':')[1]}`;
  if (concept.startsWith('self-element:')) return `己方屬性 ${concept.split(':')[1]}`;
  if (concept.startsWith('zone-entry:')) return `${concept.split(':')[1]} 區域進場事件`;
  if (concept.startsWith('own-abyss-element:')) return `己方深淵 ${concept.split(':')[1]} 屬性`;
  if (concept.startsWith('own-power-element:')) return `己方充能區 ${concept.split(':')[1]} 屬性`;
  if (concept.startsWith('chronos-window:')) return `Chronos ${concept.split(':')[1]}時段`;
  if (concept.startsWith('chronos-position:')) return `Chronos ${concept.split(':')[1]}位置`;
  if (concept.startsWith('chronos-transition:')) return `Chronos ${concept.split(':')[1]}變化`;
  if (concept.startsWith('previous-element:')) return `前一回合角色卡 ${concept.split(':')[1]} 屬性`;
  if (concept.startsWith('self-power-cost:')) return `己方角色卡 Power Cost ${concept.split(':')[1]}`;
  return concept;
}

function featureMap(features: SynergyFeature[]): Map<string, SynergyFeature> {
  return new Map(features.map((feature) => [feature.concept, feature]));
}

function eligible(card: SynergyCard): boolean {
  return card.playStatus === undefined || card.playStatus === 'playable';
}

export function buildSynergyRelations(profiles: SynergyProfile[]): SynergyRelation[] {
  const consolidated = new Map<string, SynergyRelation>();
  for (const source of profiles) {
    const outputMap = featureMap(source.outputs);
    if (outputMap.size === 0) continue;
    for (const target of profiles) {
      if (source.card.id === target.card.id) continue;
      for (const input of target.inputs) {
        const output = outputMap.get(input.concept);
        if (!output) continue;
        const key = `enables:${source.card.id}:${target.card.id}`;
        const current = consolidated.get(key);
        const concepts = [...new Set([...(current?.concepts ?? []), input.concept])];
        const label = concepts.map(conceptLabel).join('、');
        const score = relationScore(concepts);
        const categories = categoriesForConcepts(concepts);
        consolidated.set(key, {
          sourceCardId: source.card.id,
          targetCardId: target.card.id,
          kind: 'enables',
          score,
          confidence: confidenceForScore(score),
          concepts,
          categories,
          primaryCategory: categories[0] ?? 'other',
          rationale: `${source.card.name}提供${label}，可啟動或強化${target.card.name}的條件／收益。`,
          evidence: [...new Set([...(current?.evidence ?? []), ...output.evidence, ...input.evidence])].slice(0, 8),
          playabilityEligible: eligible(source.card) && eligible(target.card),
          recommendationEligible: false,
          reviewStatus: 'candidate',
        });
      }
      for (const blocker of target.blockers) {
        const output = outputMap.get(blocker.concept);
        if (!output) continue;
        const key = `conflicts:${source.card.id}:${target.card.id}`;
        const categories = categoriesForConcepts([blocker.concept]);
        consolidated.set(key, {
          sourceCardId: source.card.id,
          targetCardId: target.card.id,
          kind: 'conflicts',
          score: 90,
          confidence: 'high',
          concepts: [blocker.concept],
          categories,
          primaryCategory: categories[0] ?? 'other',
          rationale: `${source.card.name}會增加${conceptLabel(blocker.concept)}，可能破壞${target.card.name}的成立條件。`,
          evidence: [...output.evidence, ...blocker.evidence].slice(0, 8),
          playabilityEligible: eligible(source.card) && eligible(target.card),
          recommendationEligible: false,
          reviewStatus: 'candidate',
        });
      }
    }
  }
  return [...consolidated.values()].sort(
    (left, right) => right.score - left.score || left.sourceCardId.localeCompare(right.sourceCardId),
  );
}

export function buildSynergyGroups(profiles: SynergyProfile[], relations: SynergyRelation[]): SynergyGroup[] {
  const profileById = new Map(profiles.map((profile) => [profile.card.id, profile]));
  const byConcept = new Map<string, SynergyRelation[]>();
  for (const relation of relations.filter((entry) => entry.kind === 'enables')) {
    for (const concept of relation.concepts) {
      const values = byConcept.get(concept) ?? [];
      values.push(relation);
      byConcept.set(concept, values);
    }
  }
  return [...byConcept.entries()]
    .map(([concept, entries]) => {
      const enablerCardIds = [...new Set(entries.map((entry) => entry.sourceCardId))];
      const payoffCardIds = [...new Set(entries.map((entry) => entry.targetCardId))];
      const examples = [...enablerCardIds, ...payoffCardIds]
        .slice(0, 4)
        .map((id) => profileById.get(id)?.card.name || id)
        .join('、');
      return {
        id: `synergy_${concept.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '')}`,
        concept,
        category: synergyCategoriesForConcept(concept)[0] ?? 'other',
        title: `${conceptLabel(concept)}聯動`,
        rationale: `以${conceptLabel(concept)}連接啟動卡與收益卡；候選成員例如${examples}。`,
        enablerCardIds,
        payoffCardIds,
        relationCount: entries.length,
        reviewStatus: 'candidate' as const,
      };
    })
    .filter((group) => group.enablerCardIds.length > 0 && group.payoffCardIds.length > 0)
    .sort((left, right) => right.relationCount - left.relationCount);
}
