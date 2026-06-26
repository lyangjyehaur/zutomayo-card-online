import type { ParsedEffect, Condition, EffectAction } from './types';

// ===== Number parsing (handles both ASCII and fullwidth) =====

function parseNum(text: string): number {
  const normalized = text.replace(/[０-９]/g, c =>
    String.fromCharCode(c.charCodeAt(0) - 0xFEE0)
  );
  return parseInt(normalized, 10) || 0;
}

function namedSong(text: string): string | null {
  return text.match(/[（(]([^（）()]+)[）)]/)?.[1].trim() ?? null;
}

function parseSendToPower(stars: string, digitText?: string): number {
  if (digitText) return parseNum(digitText);
  return stars.split('').filter(char => char === '★').length;
}

function parseStarReduction(stars: string, digitText?: string): number {
  if (digitText) return parseNum(digitText);
  return stars.split('').filter(char => char === '★').length;
}

const ELEMENTS = ['闇', '炎', '電気', '風', 'カオス'] as const;
const ELEMENT_PATTERN = '(闇|炎|電気|風|カオス)';

function comparisonOperator(text: string): 'eq' | 'gte' | 'lte' {
  if (text === '以上') return 'gte';
  if (text === '以下') return 'lte';
  return 'eq';
}

function cardOwner(prefix?: string): 'self' | 'opponent' {
  return prefix?.includes('相手') ? 'opponent' : 'self';
}

function parseElementList(text: string): string[] {
  return ELEMENTS.filter(element => text.includes(element));
}

function elementCondition(type: 'opponentElement' | 'selfElement', elements: string[]): Condition {
  if (elements.length === 1) return { type, value: elements[0] };
  return {
    type: 'or',
    value: elements.map(element => ({ type, value: element })),
  };
}

// ===== Main Parser =====

export function parseEffect(rawText: string): ParsedEffect | null {
  if (!rawText || rawText.trim().length === 0) return null;

  const normalizedText = rawText
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<a[^>]*>.*?<\/a>/gi, '')
    .trim();

  const handSizeMatch = normalizedText.match(/^※?(?:このカードを使用後|このカードの効果でカードを引いたなら)、?手札の数は(バトル終了|ゲーム終了)まで([0-9０-９]+)枚増える[。.]?$/);
  if (handSizeMatch) {
    return {
      trigger: 'onUse',
      conditions: [],
      action: {
        type: 'handSizeModifier',
        params: {
          value: parseNum(handSizeMatch[2]),
          duration: handSizeMatch[1] === 'ゲーム終了' ? 'game' : 'battle',
        },
      },
      rawText,
    };
  }

  const text = normalizedText
    .replace(/※.*$/gm, '')
    .trim();

  if (text.length === 0) return null;

  const namedReducedDamageTurnEndMatch = text.match(/^バトルゾーンのカードが[（(]([^）)]+)[）)]のキャラクターなら、?ターン終了時に、?$/);
  if (namedReducedDamageTurnEndMatch) {
    return {
      trigger: 'onUse',
      conditions: [{ type: 'namedCardCondition', value: namedReducedDamageTurnEndMatch[1].trim(), target: 'battleZone' }],
      action: { type: 'directDamage', params: { value: 'reducedThisTurn', timing: 'turnEnd' } },
      rawText,
    };
  }

  if (/^このターンに軽減した数値分のダメージを相手に与える[。.]?$/.test(text)) {
    return {
      trigger: 'onTurnEnd',
      conditions: [],
      action: { type: 'directDamage', params: { value: 'reducedThisTurn' } },
      rawText,
    };
  }

  const swappedDanglingMatch = text.match(/^このターンに[（(]([^）)]+)[）)]のキャラクターと入れ替えていたなら[、,]?$/);
  if (swappedDanglingMatch) {
    return {
      trigger: 'onUse',
      conditions: [{ type: 'namedCardCondition', value: swappedDanglingMatch[1].trim(), target: 'swappedThisTurn' }],
      action: { type: 'noEffect', params: {} },
      rawText,
    };
  }

  const opponentTurnStartDeckTopPowerCostMatch = text.match(/^相手はターンの開始時にデッキの一番上を公開する。パワーコストが([0-9０-９]+)以上のカードが山札から公開されたらパワーチャージャーに置く[。.]?$/);
  if (opponentTurnStartDeckTopPowerCostMatch) {
    return {
      trigger: 'onTurnStart',
      conditions: [],
      action: {
        type: 'moveOpponentDeckTopByPowerCost',
        params: { minPowerCost: parseNum(opponentTurnStartDeckTopPowerCostMatch[1]), destination: 'powerCharger' },
      },
      rawText,
    };
  }

  const opponentTurnStartDeckTopSendToPowerMatch = text.match(/^ターンの開始時に相手のデッキの一番上を公開する。相手のカードにSEND TO POWER(★+)([0-9０-９]+)?が無ければ自分の攻撃力[＋+]([0-9０-９]+)。SEND TO POWER\1\2?があったなら、?すぐにこのカードをパワーチャージャーに置く[。.]?$/);
  if (opponentTurnStartDeckTopSendToPowerMatch) {
    return {
      trigger: 'onTurnStart',
      conditions: [],
      action: {
        type: 'revealOpponentDeckTopBySendToPower',
        params: {
          minSendToPower: parseSendToPower(opponentTurnStartDeckTopSendToPowerMatch[1], opponentTurnStartDeckTopSendToPowerMatch[2]),
          boostIfMissing: parseNum(opponentTurnStartDeckTopSendToPowerMatch[3]),
        },
      },
      rawText,
    };
  }

  if (text.includes('お互いの自分のHPの分だけ攻撃力+')) {
    return withExpiry({
      trigger: detectTrigger(text),
      conditions: [],
      action: { type: 'boostBothAttackByOwnHp', params: {} },
      rawText,
    });
  }

  if (text.includes('相手のアビスにカードが置かれたとき') && /(アビス|パワーチャージャー)に置く/.test(text)) {
    return {
      trigger: 'onZoneEntered',
      conditions: [{ type: 'zoneEntered', value: 'abyss', target: 'opponent' }],
      action: { type: 'moveSelfAreaEnchant', params: { destination: text.includes('パワーチャージャーに置く') ? 'powerCharger' : 'abyss' } },
      rawText,
    };
  }

  if (text.includes('パワーチャージャーにカードを置いたとき') && /(アビス|パワーチャージャー)に置く/.test(text)) {
    return {
      trigger: 'onZoneEntered',
      conditions: [{ type: 'zoneEntered', value: 'powerCharger', target: 'any' }],
      action: { type: 'moveSelfAreaEnchant', params: { destination: text.includes('パワーチャージャーに置く') ? 'powerCharger' : 'abyss' } },
      rawText,
    };
  }

  if (text.includes('バトルに負けたとき') && /(アビス|パワーチャージャー)に置く/.test(text)) {
    return {
      trigger: 'onBattle',
      conditions: [{ type: 'battleLost', value: true }],
      action: { type: 'moveSelfAreaEnchant', params: { destination: text.includes('パワーチャージャーに置く') ? 'powerCharger' : 'abyss' } },
      rawText,
    };
  }

  const conditions: Condition[] = [];
  let actionText = text;
  let triggerOverride: ParsedEffect['trigger'] | null = null;

  // "真夜中の前後Xマスも真夜中として扱う"
  const midnightRangeMatch = text.match(/真夜中の前後([0-9０-９]+)マスも真夜中として扱う/);
  if (midnightRangeMatch) {
    return {
      trigger: 'onUse',
      conditions: [],
      action: { type: 'expandMidnightRange', params: { range: parseNum(midnightRangeMatch[1]) } },
      rawText,
    };
  }

  // "同時に出したキャラクターカードを、変えなくてもよい"
  if (text.includes('変えなくてもよい')) {
    return { trigger: 'onUse', conditions: [], action: { type: 'addSettableCard', params: { count: 1, optional: true } }, rawText };
  }

  // "パワーチャージャーからX枚まで選び、このカードの効果として使用する"
  const powerChargerRecoverMatch = text.match(/パワーチャージャー(?:から|にある)[（(]([^）)]+)[）)]のキャラクターを([0-9０-９]+)枚(?:まで)?選び、このカードの効果として使用する/);
  if (powerChargerRecoverMatch) {
    return {
      trigger: 'onUse',
      conditions: [],
      action: {
        type: 'useFromAbyss',
        params: {
          source: 'powerCharger',
          song: powerChargerRecoverMatch[1].trim(),
          cardType: 'Character',
          count: parseNum(powerChargerRecoverMatch[2]),
        },
      },
      rawText,
    };
  }

  if (text.includes('パワーチャージャーから') && text.includes('効果として使用')) {
    return { trigger: 'onUse', conditions: [], action: { type: 'useFromAbyss', params: { source: 'powerCharger', count: 1 } }, rawText };
  }

  const chronosTransitionMatch = actionText.match(/^(昼から夜|夜から昼)に変わると[、,]?(.+)$/);
  if (chronosTransitionMatch) {
    conditions.push({
      type: 'chronosTimeChanged',
      value: chronosTransitionMatch[1] === '昼から夜' ? 'dayToNight' : 'nightToDay',
    });
    actionText = chronosTransitionMatch[2];
    triggerOverride = 'onChronosChanged';
  }

  const chronosPositionMatch = text.match(/^(真夜中|正午)なら[、,]?(.+)$/);
  if (chronosPositionMatch) {
    conditions.push({ type: 'chronosPosition', value: chronosPositionMatch[1] === '真夜中' ? 'midnight' : 'noon' });
    actionText = chronosPositionMatch[2];
  }

  // "夜なら..."
  const chronosMatch = text.match(/^(夜|昼)なら[、,]?(.+)$/);
  if (chronosMatch) {
    conditions.push({ type: 'chronos', value: chronosMatch[1] === '夜' ? 'night' : 'day' });
    actionText = chronosMatch[2];
  }

  const turnEndChronosMatch = actionText.match(/^ターンの終了時に、?(夜|昼)なら[、,]?(.+?)(?:[。.].*)?$/);
  if (turnEndChronosMatch) {
    conditions.push({ type: 'chronos', value: turnEndChronosMatch[1] === '夜' ? 'night' : 'day' });
    actionText = turnEndChronosMatch[2];
    triggerOverride = 'onTurnEnd';
  }

  if (actionText.includes('同時に出した自分のキャラクターカード') || actionText.includes('同時にセットした自分のキャラクターカード')) {
    conditions.push({ type: 'simultaneousCharacter', value: true });
  }

  // "前のターンで使用したキャラクターカードの属性がXで、今が夜/昼なら..."
  const previousCharElementChronosMatch = actionText.match(/前のターンで使用したキャラクターカードの属性が(闇|炎|電気|風|カオス)で、今が(夜|昼)なら[、,]?(.+)$/);
  if (previousCharElementChronosMatch) {
    conditions.push({ type: 'previousCharElement', value: previousCharElementChronosMatch[1] });
    conditions.push({ type: 'chronos', value: previousCharElementChronosMatch[2] === '夜' ? 'night' : 'day' });
    actionText = previousCharElementChronosMatch[3];
  }

  // "前のターンで使用したキャラクターカードの属性がXなら..."
  const previousCharElementMatch = actionText.match(/前のターンで使用したキャラクターカードの属性が(闇|炎|電気|風|カオス)なら[、,]?(.+)$/);
  if (previousCharElementMatch) {
    conditions.push({ type: 'previousCharElement', value: previousCharElementMatch[1] });
    actionText = previousCharElementMatch[2];
  }

  const previousCharElementAndOpponentElementMatch = actionText.match(new RegExp(`^前のターンで使用したキャラクターカードの属性が${ELEMENT_PATTERN}かつ、?相手のキャラクターカードが((?:闇|炎|電気|風|カオス)(?:[・か](?:闇|炎|電気|風|カオス))*)なら[、,]?(.+)$`));
  if (previousCharElementAndOpponentElementMatch) {
    conditions.push({ type: 'previousCharElement', value: previousCharElementAndOpponentElementMatch[1] });
    conditions.push(elementCondition('opponentElement', parseElementList(previousCharElementAndOpponentElementMatch[2])));
    actionText = previousCharElementAndOpponentElementMatch[3];
  }

  const opponentElementListMatch = actionText.match(new RegExp(`^相手の(?:キャラクターカードの)?属性が((?:闇|炎|電気|風|カオス)(?:[・か](?:闇|炎|電気|風|カオス))+)なら[、,]?(.+)$`));
  if (opponentElementListMatch) {
    conditions.push(elementCondition('opponentElement', parseElementList(opponentElementListMatch[1])));
    actionText = opponentElementListMatch[2];
  }

  // "相手の属性がXなら..."
  const oppElementMatch = text.match(/相手の(?:キャラクターカードの)?属性が(闇|炎|電気|風|カオス)なら[、,]?(.+)$/);
  if (oppElementMatch) {
    conditions.push({ type: 'opponentElement', value: oppElementMatch[1] });
    actionText = oppElementMatch[2];
  }

  // "自分の属性がXなら..."
  const selfElementMatch = text.match(/自分の(?:キャラクターカードの)?属性が(闇|炎|電気|風|カオス)なら[、,]?(.+)$/);
  if (selfElementMatch) {
    conditions.push({ type: 'selfElement', value: selfElementMatch[1] });
    actionText = selfElementMatch[2];
  }

  const samePowerCostMatch = actionText.match(/^自分のキャラクターカードと相手のキャラクターカードが同じパワーコストなら[、,]?(.+)$/);
  if (samePowerCostMatch) {
    conditions.push({ type: 'selfPowerCost', value: 'sameAsOpponent' });
    actionText = samePowerCostMatch[1];
  }

  const opponentAttackMatch = actionText.match(/^相手のキャラクターの攻撃力が([0-9０-９]+)なら[、,]?(.+)$/);
  if (opponentAttackMatch) {
    conditions.push({ type: 'opponentAttack', value: parseNum(opponentAttackMatch[1]), operator: 'eq' });
    actionText = opponentAttackMatch[2];
  }

  const opponentSendToPowerMatch = actionText.match(/^相手のキャラクターのSEND TO POWERが?(★+)([0-9０-９]+)?なら[、,]?(.+)$/);
  if (opponentSendToPowerMatch) {
    conditions.push({
      type: 'opponentSendToPower',
      value: parseSendToPower(opponentSendToPowerMatch[1], opponentSendToPowerMatch[2]),
      operator: 'eq',
    });
    actionText = opponentSendToPowerMatch[3];
  }

  const powerCostRangePatterns: Array<{
    match: RegExpMatchArray | null;
    ownerIndex: number;
    valueIndex: number;
    opIndex: number;
    actionIndex: number;
  }> = [
    {
      match: actionText.match(/^(相手の|自分の)?キャラクターカードのパワーコストが★?([0-9０-９]+)(以上|以下)なら[、,]?(.+)$/),
      ownerIndex: 1,
      valueIndex: 2,
      opIndex: 3,
      actionIndex: 4,
    },
    {
      match: actionText.match(/^(相手の|自分の)?キャラクターカードがパワーコスト★?([0-9０-９]+)(以上|以下)なら[、,]?(.+)$/),
      ownerIndex: 1,
      valueIndex: 2,
      opIndex: 3,
      actionIndex: 4,
    },
    {
      match: actionText.match(/^(相手の|自分の)?キャラクターカードが★?([0-9０-９]+)コスト(以上|以下)なら[、,]?(.+)$/),
      ownerIndex: 1,
      valueIndex: 2,
      opIndex: 3,
      actionIndex: 4,
    },
  ];
  const powerCostRangeMatch = powerCostRangePatterns.find(item => item.match);
  if (powerCostRangeMatch?.match) {
    const owner = cardOwner(powerCostRangeMatch.match[powerCostRangeMatch.ownerIndex]);
    conditions.push({
      type: owner === 'opponent' ? 'opponentPowerCost' : 'selfPowerCost',
      value: parseNum(powerCostRangeMatch.match[powerCostRangeMatch.valueIndex]),
      operator: comparisonOperator(powerCostRangeMatch.match[powerCostRangeMatch.opIndex]),
    });
    actionText = powerCostRangeMatch.match[powerCostRangeMatch.actionIndex];
  }

  const powerCostInMatch = actionText.match(/^(相手の|自分の)?キャラクターカードのパワーコストが★?([0-9０-９]+)か★?([0-9０-９]+)なら[、,]?(.+)$/);
  if (powerCostInMatch) {
    const owner = cardOwner(powerCostInMatch[1]);
    conditions.push({
      type: owner === 'opponent' ? 'opponentPowerCost' : 'selfPowerCost',
      value: [parseNum(powerCostInMatch[2]), parseNum(powerCostInMatch[3])],
      operator: 'in',
    });
    actionText = powerCostInMatch[4];
  }

  // "アビスにX種類の属性があると..."
  const abyssElementMatch = text.match(/アビスに([0-9０-９]+)種類の属性があると(.+)$/);
  if (abyssElementMatch) {
    conditions.push({ type: 'abyssElements', value: parseNum(abyssElementMatch[1]) });
    actionText = abyssElementMatch[2];
  }

  const abyssDistinctElementMatch = actionText.match(/アビスに(?:.*?の)?([0-9０-９]+)属性のカードがあるなら[、,]?(.+)$/);
  if (abyssDistinctElementMatch) {
    conditions.push({ type: 'abyssElements', value: parseNum(abyssDistinctElementMatch[1]) });
    actionText = abyssDistinctElementMatch[2];
  }

  // "パワーチャージャーにX属性以上あるなら..."
  const pcElementMatch = text.match(/パワーチャージャーに([0-9０-９]+)属性以上あるなら[、,]?(.+)$/);
  if (pcElementMatch) {
    conditions.push({ type: 'abyssElements', value: parseNum(pcElementMatch[1]), target: 'powerCharger' });
    actionText = pcElementMatch[2];
  }

  const handElementDiversityMatch = actionText.match(/^手札を公開し、?([0-9０-９]+)属性以上あるなら[、,]?(.+)$/);
  if (handElementDiversityMatch) {
    conditions.push({ type: 'handElements', value: parseNum(handElementDiversityMatch[1]) });
    actionText = handElementDiversityMatch[2];
  }

  const zoneElementCountMatch = actionText.match(new RegExp(`^(相手の)?(アビス|パワーチャージャー)に(?:ある)?${ELEMENT_PATTERN}属性のカードが([0-9０-９]+)枚(以上|以下)あるなら[、,]?(.+)$`));
  if (zoneElementCountMatch) {
    const zone = zoneElementCountMatch[2] === 'パワーチャージャー' ? 'powerCharger' : 'abyss';
    conditions.push({
      type: zone === 'powerCharger' ? 'powerChargerElementCount' : 'abyssElementCount',
      value: parseNum(zoneElementCountMatch[4]),
      operator: comparisonOperator(zoneElementCountMatch[5]),
      element: zoneElementCountMatch[3] as typeof ELEMENTS[number],
      owner: cardOwner(zoneElementCountMatch[1]),
    });
    actionText = zoneElementCountMatch[6];
  }

  // "アビスにX属性のカードがあるなら..."
  const abyssHasElementMatch = text.match(/アビスに(闇|炎|電気|風|カオス)属性のカードがあるなら[、,]?(.+)$/);
  if (abyssHasElementMatch) {
    conditions.push({ type: 'zoneHasElement', value: abyssHasElementMatch[1], target: 'abyss' });
    actionText = abyssHasElementMatch[2];
  }

  const powerChargerHasElementMatch = actionText.match(/パワーチャージャーに(闇|炎|電気|風|カオス)属性のカードがあるなら[、,]?(.+)$/);
  if (powerChargerHasElementMatch) {
    conditions.push({ type: 'zoneHasElement', value: powerChargerHasElementMatch[1], target: 'powerCharger' });
    actionText = powerChargerHasElementMatch[2];
  }

  // "アビスにX枚以上カードがあるなら..."
  const abyssCountMatch = text.match(/アビスに([0-9０-９]+)枚以上の?カードがあるなら[、,]?(.+)$/);
  if (abyssCountMatch) {
    conditions.push({ type: 'abyssCount', value: parseNum(abyssCountMatch[1]) });
    actionText = abyssCountMatch[2];
  }

  const noCardInAbyssMatch = actionText.match(/^(相手の)?アビスにカードがないなら[、,]?(.+)$/);
  if (noCardInAbyssMatch) {
    conditions.push({ type: 'noCardInAbyss', value: true, owner: cardOwner(noCardInAbyssMatch[1]) });
    actionText = noCardInAbyssMatch[2];
  }

  const zoneCountComparisonMatch = actionText.match(/^(相手の)?(アビス|パワーチャージャー)(?:にカード|のカード)?が([0-9０-９]+)枚(以上|以下)(?:置かれている)?(?:ある)?なら[、,]?(.+)$/);
  if (zoneCountComparisonMatch) {
    conditions.push({
      type: 'zoneCountComparison',
      value: parseNum(zoneCountComparisonMatch[3]),
      operator: comparisonOperator(zoneCountComparisonMatch[4]),
      target: zoneCountComparisonMatch[2] === 'パワーチャージャー' ? 'powerCharger' : 'abyss',
      owner: cardOwner(zoneCountComparisonMatch[1]),
    });
    actionText = zoneCountComparisonMatch[5];
  }

  const zoneAllSameElementMatch = actionText.match(new RegExp(`^(相手の)?(アビス|パワーチャージャー)(?:(?:にある|の)カード|が)?が?${ELEMENT_PATTERN}属性だけ(?:だった)?なら[、,]?(.+)$`));
  if (zoneAllSameElementMatch) {
    const zone = zoneAllSameElementMatch[2] === 'パワーチャージャー' ? 'powerCharger' : 'abyss';
    conditions.push({
      type: zone === 'powerCharger' ? 'powerChargerAllSameElement' : 'abyssAllSameElement',
      value: zoneAllSameElementMatch[3],
      owner: cardOwner(zoneAllSameElementMatch[1]),
    });
    actionText = zoneAllSameElementMatch[4];
  }

  // "HPがX以下なら..."
  const hpMatch = text.match(/HPが([0-9０-９]+)以下(?:になった)?(なら|の場合)(.+)$/);
  if (hpMatch) {
    conditions.push({ type: 'hpLessOrEqual', value: parseNum(hpMatch[1]) });
    actionText = hpMatch[3];
  }

  const hpComparisonMatch = actionText.match(/^(相手の)?HPが([0-9０-９]+)なら[、,]?(.+)$/);
  if (hpComparisonMatch) {
    conditions.push({
      type: 'hpComparison',
      value: parseNum(hpComparisonMatch[2]),
      operator: 'eq',
      target: hpComparisonMatch[1] ? 'opponent' : 'self',
    });
    actionText = hpComparisonMatch[3];
  }

  const powerChargerCountMatch = text.match(/パワーチャージャーにカードが([0-9０-９]+)枚以上置かれているなら[、,]?(.+)$/);
  if (powerChargerCountMatch && !conditions.some(condition => condition.type === 'zoneCountComparison' && condition.target === 'powerCharger')) {
    conditions.push({ type: 'zoneCountAtLeast', value: parseNum(powerChargerCountMatch[1]), target: 'powerCharger' });
    actionText = powerChargerCountMatch[2];
  }

  const opponentAreaEnchantPlacedMatch = text.match(/相手のエリアエンチャントが置かれているなら[、,]?(.+)$/);
  if (opponentAreaEnchantPlacedMatch) {
    conditions.push({ type: 'hasAreaEnchant', value: true, target: 'opponent' });
    actionText = opponentAreaEnchantPlacedMatch[1];
  }

  const hpLessThanOpponentMatch = text.match(/HPが相手のHPより少ないなら[、,]?(.+)$/);
  if (hpLessThanOpponentMatch) {
    conditions.push({ type: 'hpLessThanOpponent', value: true });
    actionText = hpLessThanOpponentMatch[1];
  }

  // "このターンにXのキャラクターと入れ替えていたなら..."
  const swappedMatch = text.match(/このターンに[（(]([^）)]+)[）)]のキャラクターと入れ替えていたなら[、,]?(.+)$/);
  if (swappedMatch) {
    conditions.push({ type: 'namedCardCondition', value: swappedMatch[1].trim(), target: 'swappedThisTurn' });
    actionText = swappedMatch[2];
  }

  // "バトルゾーンのカードが（X）のキャラクターなら..."
  const battleZoneNamedCharacterMatch = actionText.match(/バトルゾーンの(?:カード|キャラクター)が[（(]([^）)]+)[）)](?:のキャラクター)?なら[、,]?(.+)$/);
  if (battleZoneNamedCharacterMatch) {
    conditions.push({ type: 'namedCardInBattleZone', value: battleZoneNamedCharacterMatch[1].trim() });
    actionText = battleZoneNamedCharacterMatch[2];
  } else if (actionText.includes('バトルゾーン') && actionText.includes('キャラクターなら')) {
    const song = namedSong(actionText);
    if (song) conditions.push({ type: 'namedCardInBattleZone', value: song });
  }

  const battleZoneChangedAwayMatch = actionText.match(/^バトルゾーンのキャラクターを[（(]([^）)]+)[）)]以外のキャラクターに入れ替えたら[、,]?(.+)$/);
  if (battleZoneChangedAwayMatch) {
    conditions.push({ type: 'namedCardCondition', value: battleZoneChangedAwayMatch[1].trim(), target: 'battleZoneNot' });
    actionText = battleZoneChangedAwayMatch[2];
    triggerOverride = 'onZoneEntered';
  }

  actionText = actionText.replace(/^[、,]/, '').trim();

  // Parse action from the remaining text
  const action = parseAction(actionText);
  if (!action) return null;
  const trigger = action.params.timing === 'turnEnd' ? 'onUse' : (triggerOverride ?? detectTrigger(text));

  return withExpiry({
    trigger,
    conditions,
    action,
    rawText,
  });
}

// ===== Action Parser =====

function parseAction(text: string): EffectAction | null {
  if (/^アビスにあるエンチャントカードの中から自由に[1１]枚選び、このカードの効果として使う[。.]?$/.test(text)) {
    return { type: 'useFromAbyss', params: { source: 'abyss', cardType: 'Enchant', count: 1 } };
  }

  if (text.includes('自分の攻撃力は常に昼の攻撃力')) {
    return { type: 'forceOwnAttackTime', params: { value: 'day' } };
  }
  if (text.includes('自分の攻撃力は常に夜の攻撃力')) {
    return { type: 'forceOwnAttackTime', params: { value: 'night' } };
  }

  const setAllCardClocksMatch = text.match(/^すべてのカードの時計を([0-9０-９]+)にする/);
  if (setAllCardClocksMatch) return { type: 'setAllCardClocks', params: { value: parseNum(setAllCardClocksMatch[1]) } };

  // "相手のデッキの上から、それと同じ枚数をアビスに置く"
  if (text === '相手のデッキの上から、それと同じ枚数をアビスに置く') {
    return { type: 'millDeckToAbyss', params: { target: 'opponent', countFromLastChoice: true } };
  }

  // "相手のデッキの一番上のカードをパワーの有無に関わらずアビスに置く"
  if (/^相手のデッキの一番上のカードをパワーの有無に関わらずアビスに置く[。.]?$/.test(text)) {
    return { type: 'millDeckToAbyss', params: { target: 'opponent', count: 1 } };
  }

  // "相手のデッキの上からX枚を相手のアビスに置く"
  const millDeckMatch = text.match(/^相手のデッキの上から([0-9０-９]+)枚を相手のアビスに置く[。.]?$/);
  if (millDeckMatch) {
    return { type: 'millDeckToAbyss', params: { target: 'opponent', count: parseNum(millDeckMatch[1]) } };
  }

  // "相手のエリアエンチャント(カード)を相手のデッキの上/底に置く"
  const returnAreaEnchantMatch = text.match(/^相手のエリアエンチャント(?:カード)?を(?:相手の)?デッキの(上|底)に(?:置く|戻し|戻す)/);
  if (returnAreaEnchantMatch) {
    return {
      type: 'returnAreaEnchantToDeck',
      params: {
        target: 'opponent',
        position: returnAreaEnchantMatch[1] === '上' ? 'top' : 'bottom',
        ...(text.includes('以後相手はエリアエンチャントをセットできない') ? { lockAreaEnchant: true } : {}),
      },
    };
  }

  const revealHandAttackBoostMatch = text.match(/^手札から[（(]([^）)]+)[）)]\s*のキャラクターを好きな枚数公開し、その数だけ攻撃力[＋+]([0-9０-９]+)[。.]?$/);
  if (revealHandAttackBoostMatch) {
    return {
      type: 'requestChoice',
      params: {
        choiceType: 'revealHandAttackBoost',
        filterSong: revealHandAttackBoostMatch[1].trim(),
        filterCardType: 'Character',
        boostPerCard: parseNum(revealHandAttackBoostMatch[2]),
      },
    };
  }

  const nameGuessRevealMatch = text.match(/^カード名を[1１]つ指定する[。.]相手の手札から[1１]枚を選んで公開し、そのカード名のカードなら攻撃力[＋+]([0-9０-９]+)[。.]?$/);
  if (nameGuessRevealMatch) {
    return {
      type: 'requestChoice',
      params: {
        choiceType: 'nameGuessOpponentHandReveal',
        attackBoost: parseNum(nameGuessRevealMatch[1]),
      },
    };
  }

  const zoneElementBoostMatch = text.match(/^(アビス|パワーチャージャー)の(闇|炎|電気|風|カオス)属性のカード[1１]枚につき、?(?:攻撃力|★)?[＋+]([0-9０-９]+)[。.]?/);
  if (zoneElementBoostMatch) {
    return {
      type: 'boostAttack',
      params: {
        value: parseNum(zoneElementBoostMatch[3]),
        perCount: true,
        per: 'zoneElementCount',
        zone: zoneElementBoostMatch[1] === 'パワーチャージャー' ? 'powerCharger' : 'abyss',
        element: zoneElementBoostMatch[2],
      },
    };
  }

  const zoneElementCountBoostMatch = text.match(/^(アビス|パワーチャージャー)にある(闇|炎|電気|風|カオス)属性のカードの数だけ、?(?:攻撃力|★)?[＋+]([0-9０-９]+)[。.]?/);
  if (zoneElementCountBoostMatch) {
    return {
      type: 'boostAttack',
      params: {
        value: parseNum(zoneElementCountBoostMatch[3]),
        perCount: true,
        per: 'zoneElementCount',
        zone: zoneElementCountBoostMatch[1] === 'パワーチャージャー' ? 'powerCharger' : 'abyss',
        element: zoneElementCountBoostMatch[2],
      },
    };
  }

  const zoneNamedCountBoostMatch = text.match(/^(アビス|パワーチャージャー)にある[（(]([^）)]+)[）)]のカードの数だけ、?攻撃力[＋+]([0-9０-９]+)[。.]?/);
  if (zoneNamedCountBoostMatch) {
    return {
      type: 'boostAttack',
      params: {
        value: parseNum(zoneNamedCountBoostMatch[3]),
        perCount: true,
        per: 'zoneSongCount',
        zone: zoneNamedCountBoostMatch[1] === 'パワーチャージャー' ? 'powerCharger' : 'abyss',
        song: zoneNamedCountBoostMatch[2].trim(),
      },
    };
  }

  const powerCostReductionMatch = text.match(/パワーコストを(★+)([0-9０-９]+)?減らす[。.]?$/);
  if (powerCostReductionMatch) {
    return {
      type: 'setPowerCost',
      params: { reduction: parseStarReduction(powerCostReductionMatch[1], powerCostReductionMatch[2]) },
    };
  }

  // "攻撃力+50"
  const boostMatch = text.match(/攻撃力(?:を)?[＋+]([0-9０-９]+)/);
  if (boostMatch) return { type: 'boostAttack', params: { value: parseNum(boostMatch[1]) } };

  const setOpponentAttackMatch = text.match(/^相手の攻撃力を([0-9０-９]+)にする[。.]?$/);
  if (setOpponentAttackMatch) return { type: 'setOpponentAttack', params: { value: parseNum(setOpponentAttackMatch[1]) } };

  const setOpponentElementMatch = text.match(/^相手のキャラクターカードの属性をバトルフィールドにいる間(闇|炎|電気|風|カオス)にする[。.]?$/);
  if (setOpponentElementMatch) return { type: 'setOpponentElement', params: { value: setOpponentElementMatch[1] } };

  // "攻撃力-30"
  const reduceMatch = text.match(/攻撃力(?:を)?[ー\-]([0-9０-９]+)/);
  if (reduceMatch) return { type: 'reduceAttack', params: { value: parseNum(reduceMatch[1]) } };

  // "お互いのHPをX回復"
  const healBothMatch = text.match(/お互いのHP[をが]?([0-9０-９]+)回復/);
  if (healBothMatch) return { type: 'healBoth', params: { value: parseNum(healBothMatch[1]) } };

  // "HPをX回復"
  const healMatch = text.match(/HP[をが]([0-9０-９]+)回復/);
  if (healMatch) return { type: 'heal', params: { value: parseNum(healMatch[1]) } };

  // "HP+20" or "HP+50" (without を/が)
  const hpBoostMatch = text.match(/HP[＋+]([0-9０-９]+)/);
  if (hpBoostMatch) return { type: 'heal', params: { value: parseNum(hpBoostMatch[1]) } };

  // "相手のHP-20"
  const hpReduceMatch = text.match(/相手のHP[ー\-]([0-9０-９]+)/);
  if (hpReduceMatch) return { type: 'directDamage', params: { value: parseNum(hpReduceMatch[1]) } };

  // "相手のHPを20減らす"
  const hpDecreaseMatch = text.match(/相手のHPを([0-9０-９]+)減らす/);
  if (hpDecreaseMatch) return { type: 'directDamage', params: { value: parseNum(hpDecreaseMatch[1]) } };

  // "Xダメージを軽減"
  const damageReduceMatch = text.match(/([0-9０-９]+)ダメージ[を]?軽減/);
  if (damageReduceMatch) return { type: 'damageReduce', params: { value: parseNum(damageReduceMatch[1]) } };

  // "Xダメージ" (direct damage)
  const reducedDamageMatch = text.match(/^(ターン終了時に、?)?このターンに軽減した数値分のダメージを相手に与える[。.]?$/);
  if (reducedDamageMatch) {
    return {
      type: 'directDamage',
      params: {
        value: 'reducedThisTurn',
        ...(reducedDamageMatch[1] ? { timing: 'turnEnd' } : {}),
      },
    };
  }

  const directDamageMatch = text.match(/([0-9０-９]+)ダメージ/);
  if (directDamageMatch) return { type: 'directDamage', params: { value: parseNum(directDamageMatch[1]) } };

  // "手札にある（Song）のキャラクターを1枚選び、パワーチャージャーに置いてもよい。そうしたなら、カードを1枚引く"
  const optionalNamedCharacterToPowerDrawMatch = text.match(/^手札にある[（(]([^）)]+)[）)]のキャラクターを[1１]枚選び、パワーチャージャーに置いてもよい[。.]そうしたなら、?カードを[1１]枚引く[。.]?$/);
  if (optionalNamedCharacterToPowerDrawMatch) {
    return {
      type: 'requestChoice',
      params: {
        choiceType: 'optionalHandMoveThenDraw',
        sourceOwner: 'self',
        sourceZone: 'hand',
        destinationOwner: 'self',
        destinationZone: 'powerCharger',
        drawCount: 1,
        filterCardType: 'Character',
        filterSong: optionalNamedCharacterToPowerDrawMatch[1].trim(),
      },
    };
  }

  // "手札からX属性のカードを1枚選び、アビスに置く。そうしたならカードを1枚引く"
  const optionalElementToAbyssDrawMatch = text.match(/^手札から(闇|炎|電気|風|カオス)属性のカードを[1１]枚選び、アビスに置く[。.]そうしたなら、?カードを[1１]枚引く[。.]?$/);
  if (optionalElementToAbyssDrawMatch) {
    return {
      type: 'requestChoice',
      params: {
        choiceType: 'optionalHandMoveThenDraw',
        sourceOwner: 'self',
        sourceZone: 'hand',
        destinationOwner: 'self',
        destinationZone: 'abyss',
        drawCount: 1,
        filterElement: optionalElementToAbyssDrawMatch[1],
      },
    };
  }

  // "手札からカードを好きな枚数選び、デッキの底に置く。そうしたなら、同じ数だけデッキからカードを引く"
  const optionalAnyToDeckBottomSelectedDrawMatch = text.match(/^手札からカードを好きな枚数選び、デッキの底に置く[。.]そうしたなら、?同じ数だけデッキからカードを引く[。.]?$/);
  if (optionalAnyToDeckBottomSelectedDrawMatch) {
    return {
      type: 'requestChoice',
      params: {
        choiceType: 'optionalHandMoveThenDraw',
        sourceOwner: 'self',
        sourceZone: 'hand',
        destinationOwner: 'self',
        destinationZone: 'deck',
        destinationPosition: 'bottom',
        drawCount: 'selected',
      },
    };
  }

  // "手札からX属性のカードを好きな枚数選び、アビスに置く。そうしたなら、同じ数だけカードを引く"
  const optionalElementToAbyssSelectedDrawMatch = text.match(/^手札から(闇|炎|電気|風|カオス)属性のカードを好きな枚数選び、アビスに置く[。.]そうしたなら、?同じ数だけカードを引く[。.]?$/);
  if (optionalElementToAbyssSelectedDrawMatch) {
    return {
      type: 'requestChoice',
      params: {
        choiceType: 'optionalHandMoveThenDraw',
        sourceOwner: 'self',
        sourceZone: 'hand',
        destinationOwner: 'self',
        destinationZone: 'abyss',
        drawCount: 'selected',
        filterElement: optionalElementToAbyssSelectedDrawMatch[1],
      },
    };
  }

  // "手札からパワーの有無に関わらずカードX枚を選び、アビスに置く"
  const handToAbyssMatch = text.match(/手札からパワーの有無に関わらずカード([0-9０-９]+)枚を選び、アビスに置く[。.]?$/);
  if (handToAbyssMatch) {
    return {
      type: 'requestChoice',
      params: {
        choiceType: 'cardMove',
        count: parseNum(handToAbyssMatch[1]),
        sourceOwner: 'self',
        sourceZone: 'hand',
        destinationOwner: 'self',
        destinationZone: 'abyss',
      },
    };
  }

  // "相手のアビスのカードをX枚選んでデッキの底に戻させる"
  const opponentAbyssToDeckBottomMatch = text.match(/相手のアビスのカードを([0-9０-９]+)枚選んでデッキの底に戻させる[。.]?$/);
  if (opponentAbyssToDeckBottomMatch) {
    return {
      type: 'requestChoice',
      params: {
        choiceType: 'cardMove',
        count: parseNum(opponentAbyssToDeckBottomMatch[1]),
        sourceOwner: 'opponent',
        sourceZone: 'abyss',
        destinationOwner: 'opponent',
        destinationZone: 'deck',
        destinationPosition: 'bottom',
      },
    };
  }

  // "相手のアビスにあるカードX枚を、相手のデッキの底に戻す"
  const opponentAbyssCardToDeckBottomMatch = text.match(/^相手のアビスにあるカード([0-9０-９]+)枚を、?相手のデッキの底に戻す[。.]?$/);
  if (opponentAbyssCardToDeckBottomMatch) {
    return {
      type: 'requestChoice',
      params: {
        choiceType: 'cardMove',
        count: parseNum(opponentAbyssCardToDeckBottomMatch[1]),
        sourceOwner: 'opponent',
        sourceZone: 'abyss',
        destinationOwner: 'opponent',
        destinationZone: 'deck',
        destinationPosition: 'bottom',
      },
    };
  }

  // "相手のパワーチャージャーからSEND TO POWER★★/★１のカードをX枚選び、相手のデッキの底に置く"
  const opponentPowerToDeckBottomMatch = text.match(/相手のパワーチャージャーからSEND TO POWER(★+)([0-9０-９]+)?のカードを([0-9０-９]+)枚選び、相手のデッキの底に置く[。.]?$/);
  if (opponentPowerToDeckBottomMatch) {
    return {
      type: 'requestChoice',
      params: {
        choiceType: 'cardMove',
        count: parseNum(opponentPowerToDeckBottomMatch[3]),
        sourceOwner: 'opponent',
        sourceZone: 'powerCharger',
        destinationOwner: 'opponent',
        destinationZone: 'deck',
        destinationPosition: 'bottom',
        filterSendToPower: parseSendToPower(opponentPowerToDeckBottomMatch[1], opponentPowerToDeckBottomMatch[2]),
      },
    };
  }

  if (text === '相手のパワーチャージャーのキャラクターを１枚選び、バトルゾーンのキャラクターと入れ替える。') {
    return {
      type: 'requestChoice',
      params: {
        choiceType: 'opponentPowerCharacterSwap',
      },
    };
  }

  // "相手のデッキの上からX枚を見て、好きな順番に入れ替えて戻す"
  const reorderOpponentDeckTopMatch = text.match(/^相手のデッキの上から([0-9０-９]+)枚を見て、好きな順番に入れ替えて戻す[。.]?$/);
  if (reorderOpponentDeckTopMatch) {
    return {
      type: 'requestChoice',
      params: {
        choiceType: 'reorderOpponentDeckTop',
        count: parseNum(reorderOpponentDeckTopMatch[1]),
      },
    };
  }

  if (text === 'この効果で出したキャラクターの効果は発動しない') {
    return {
      type: 'suppressEffectActivation',
      params: {
        scope: 'thisEffectSwappedInCharacter',
      },
    };
  }

  // "アビスのカードをX枚/1枚以上選び、(裏向きにして混ぜ、)デッキの底に置く。そうしない場合、ゲームに敗北する。"
  const abyssToDeckBottomOrLoseMatch = text.match(/^アビスのカードを([0-9０-９]+)枚(以上)?選び、(?:(裏向きにして)(混ぜ、)?)?デッキの底に置く[。.]そうしない場合、ゲームに敗北する[。.]?/);
  if (abyssToDeckBottomOrLoseMatch) {
    const count = parseNum(abyssToDeckBottomOrLoseMatch[1]);
    const variable = Boolean(abyssToDeckBottomOrLoseMatch[2]);
    const reorderFollowUpMatch = text.match(/そうしない場合、ゲームに敗北する[。.]相手のデッキの上から([0-9０-９]+)枚を見て、好きな順番に入れ替えて戻す[。.]?$/);
    return {
      type: 'requestChoice',
      params: {
        choiceType: 'abyssToDeckBottomOrLose',
        min: count,
        max: variable ? 'available' : count,
        faceDown: Boolean(abyssToDeckBottomOrLoseMatch[3]),
        shuffle: Boolean(abyssToDeckBottomOrLoseMatch[4]),
        ...(reorderFollowUpMatch ? {
          followUpChoiceType: 'reorderOpponentDeckTop',
          followUpCount: parseNum(reorderFollowUpMatch[1]),
        } : {}),
      },
    };
  }

  // "手札をX枚選んでデッキの底に置き、カードをY枚引く"
  const handBottomDrawMatch = text.match(/手札を([0-9０-９]+)枚選んでデッキの底に置き、カードを([0-9０-９]+)枚引く/);
  if (handBottomDrawMatch) {
    return {
      type: 'requestChoice',
      params: {
        choiceType: 'handToDeckBottomThenDraw',
        discardCount: parseNum(handBottomDrawMatch[1]),
        drawCount: parseNum(handBottomDrawMatch[2]),
      },
    };
  }

  if (/^相手の手札を公開する[。.]?$/.test(text)) {
    return { type: 'revealOpponentHand', params: {} };
  }

  if (/^手札[1１]枚とアビスの好きなカード[1１]枚を入れ替える[。.]?$/.test(text)) {
    return { type: 'requestChoice', params: { choiceType: 'handAbyssSwap' } };
  }

  // "デッキの一番上のカードをパワーがあればパワーチャージャーに、なければアビスに置く"
  if (/^デッキの一番上のカードをパワーがあればパワーチャージャーに、?なければアビスに置く[。.]?$/.test(text)) {
    return { type: 'moveOwnDeckTopByPower', params: {} };
  }

  // "カードをX枚引く"
  if (text.includes('選')) return null;
  const drawFromDeckMatch = text.match(/デッキから([0-9０-９]+)枚カードを引き、?手札に加える/);
  if (drawFromDeckMatch) return { type: 'drawCards', params: { value: parseNum(drawFromDeckMatch[1]) } };
  const drawMatch = text.match(/カード[をが]([0-9０-９]+)枚(?:引|ドロー)/);
  if (drawMatch) return { type: 'drawCards', params: { value: parseNum(drawMatch[1]) } };

  // "昼夜逆転"
  if (text.includes('昼夜逆転') || text.includes('昼夜を入れ替え')) {
    return { type: 'swapAttack', params: {} };
  }

  // "時計を無効"
  if (text.includes('時計を無効') || text.includes('時間に戻る')) {
    return { type: 'clockReset', params: {} };
  }

  // "クロノスを好きな時間にする"
  if (text.includes('クロノスを好きな時間')) {
    return { type: 'requestChoice', params: { choiceType: 'clockPosition' } };
  }

  if (/^このターンのはじまりの時間から相手の時計分、?時間が戻る[。.]?$/.test(text)) {
    return { type: 'clockSetFromTurnStartMinusOpponentClock', params: {} };
  }

  const clockAdvanceRangeMatch = text.match(/時計を([0-9０-９]+)～([0-9０-９]+)つまで進めてもよい/);
  if (clockAdvanceRangeMatch) {
    return {
      type: 'requestChoice',
      params: {
        choiceType: 'clockAdvance',
        min: parseNum(clockAdvanceRangeMatch[1]),
        max: parseNum(clockAdvanceRangeMatch[2]),
      },
    };
  }

  const clockAdvanceMatch = text.match(/時計を([0-9０-９]+)つ進める/);
  if (clockAdvanceMatch) return { type: 'clockAdvance', params: { value: parseNum(clockAdvanceMatch[1]) } };

  if (text.includes('時計が真夜中になる') || text.includes('時計を真夜中にする')) {
    return { type: 'clockSet', params: { value: 0 } };
  }

  if (text.includes('時計が正午になる') || text.includes('時計を真昼にする')) {
    return { type: 'clockSet', params: { value: 6 } };
  }

  // "効果を無効"
  if (text.includes('効果') && text.includes('無効')) {
    return { type: 'noEffect', params: {} };
  }

  // "ダメージは軽減されない"
  if (text.includes('ダメージ') && text.includes('軽減されない')) {
    return { type: 'directDamage', params: { value: -1, unreduceable: true } };
  }

  if (/^(?:すぐに)?アビスに置く[。.]?$/.test(text)) {
    return { type: 'moveSelfAreaEnchant', params: { destination: 'abyss' } };
  }

  if (/^(?:すぐに)?パワーチャージャーに置く[。.]?$/.test(text)) {
    return { type: 'moveSelfAreaEnchant', params: { destination: 'powerCharger' } };
  }

  return null;
}

// ===== Trigger Detection =====

function detectTrigger(text: string): 'onBattle' | 'onUse' | 'onTurnStart' | 'onTurnEnd' | 'onDamageReceived' | 'onChronosChanged' {
  const timingText = text.match(/^(ターンの開始時|ターン開始時|ターンの終了時|ターン終了時|自分がダメージを受けた|バトル)/)
    ? text
    : text.split(/[。.]/)[0];
  if (timingText.includes('昼から夜に変わる') || timingText.includes('夜から昼に変わる')) {
    return 'onChronosChanged';
  }
  if (timingText.includes('ターンの開始時') || timingText.includes('ターン開始時')) {
    return 'onTurnStart';
  }
  if (timingText.includes('ターンの終了時') || timingText.includes('ターン終了時')) {
    return 'onTurnEnd';
  }
  if (timingText.includes('ダメージを受けたとき') || timingText.includes('ダメージを受けた時')) {
    return 'onDamageReceived';
  }
  if (timingText.includes('バトル') && !timingText.includes('バトルゾーン')) return 'onBattle';
  return 'onUse';
}

// ===== Batch Parse =====

function parseAreaEnchantExpiry(rawText: string): ParsedEffect | null {
  const text = rawText.replace(/※.*$/gm, '').trim();
  if (!/(アビス|パワーチャージャー)に置く/.test(text)) return null;

  const destination = text.includes('パワーチャージャーに置く') ? 'powerCharger' : 'abyss';
  const damageThresholdMatch = text.match(/([0-9０-９]+)ダメージ以上を受けたなら、?すぐに(?:このカードを)?(?:アビス|パワーチャージャー)に置く/);
  if (damageThresholdMatch) {
    return {
      trigger: 'onDamageReceived',
      conditions: [{ type: 'damageAtLeast', value: parseNum(damageThresholdMatch[1]) }],
      action: { type: 'moveSelfAreaEnchant', params: { destination } },
      rawText,
    };
  }
  if (text.includes('相手のアビスにカードが置かれたとき')) {
    return {
      trigger: 'onZoneEntered',
      conditions: [{ type: 'zoneEntered', value: 'abyss', target: 'opponent' }],
      action: { type: 'moveSelfAreaEnchant', params: { destination } },
      rawText,
    };
  }
  if (text.includes('相手がアビスにカードを置いたターンの終了時')) {
    return {
      trigger: 'onTurnEnd',
      conditions: [{ type: 'zoneEntered', value: 'abyss', target: 'opponent' }],
      action: { type: 'moveSelfAreaEnchant', params: { destination } },
      rawText,
    };
  }
  if (text.includes('相手がエリアエンチャントを出したターンの終了時')) {
    return {
      trigger: 'onTurnEnd',
      conditions: [{ type: 'zoneEntered', value: 'setZoneC', target: 'opponent' }],
      action: { type: 'moveSelfAreaEnchant', params: { destination } },
      rawText,
    };
  }
  if (text.includes('キャラクターカードを自分のパワーチャージャーに置いたターンの終了時')) {
    return {
      trigger: 'onTurnEnd',
      conditions: [{ type: 'zoneEnteredCardType', value: 'Character' }],
      action: { type: 'moveSelfAreaEnchant', params: { destination } },
      rawText,
    };
  }
  const abyssCountTurnEndMatch = text.match(/アビスのカードが([0-9０-９]+)枚以上になったターンの終了時/);
  if (abyssCountTurnEndMatch) {
    return {
      trigger: 'onTurnEnd',
      conditions: [{ type: 'zoneCountAtLeast', value: parseNum(abyssCountTurnEndMatch[1]), target: 'abyss' }],
      action: { type: 'moveSelfAreaEnchant', params: { destination } },
      rawText,
    };
  }
  const opponentHpTurnEndMatch = text.match(/相手のHPが([0-9０-９]+)以下になったターンの終了時/);
  if (opponentHpTurnEndMatch) {
    return {
      trigger: 'onTurnEnd',
      conditions: [{ type: 'hpLessOrEqual', value: parseNum(opponentHpTurnEndMatch[1]), target: 'opponent' }],
      action: { type: 'moveSelfAreaEnchant', params: { destination } },
      rawText,
    };
  }
  const powerCostSelfMoveMatch = text.match(/(?:^|[。.])\s*(相手の)?キャラクターカードが([0-9０-９]+)コスト(以上|以下)なら(?:すぐに)?(アビス|パワーチャージャー)に置く/);
  if (powerCostSelfMoveMatch) {
    const owner = cardOwner(powerCostSelfMoveMatch[1]);
    return {
      trigger: 'onUse',
      conditions: [{
        type: owner === 'opponent' ? 'opponentPowerCost' : 'selfPowerCost',
        value: parseNum(powerCostSelfMoveMatch[2]),
        operator: comparisonOperator(powerCostSelfMoveMatch[3]),
      }],
      action: {
        type: 'moveSelfAreaEnchant',
        params: { destination: powerCostSelfMoveMatch[4] === 'パワーチャージャー' ? 'powerCharger' : 'abyss' },
      },
      rawText,
    };
  }
  if (text.includes('ターンの終了時に、相手のフィールドにエリアエンチャントがあるなら')) {
    return {
      trigger: 'onTurnEnd',
      conditions: [{ type: 'hasAreaEnchant', value: true, target: 'opponent' }],
      action: { type: 'moveSelfAreaEnchant', params: { destination } },
      rawText,
    };
  }
  if (text.includes('昼と夜が入れ替わったターンの終了時')) {
    return {
      trigger: 'onTurnEnd',
      conditions: [{ type: 'chronosTimeChanged', value: true }],
      action: { type: 'moveSelfAreaEnchant', params: { destination } },
      rawText,
    };
  }
  if (text.includes('ターンの終了時')) {
    return {
      trigger: 'onTurnEnd',
      conditions: [],
      action: { type: 'moveSelfAreaEnchant', params: { destination } },
      rawText,
    };
  }
  if (text.includes('夜じゃなくなったら')) {
    return {
      trigger: 'onChronosChanged',
      conditions: [{ type: 'chronos', value: 'day' }],
      action: { type: 'moveSelfAreaEnchant', params: { destination } },
      rawText,
    };
  }
  if (text.includes('昼じゃなくなったら')) {
    return {
      trigger: 'onChronosChanged',
      conditions: [{ type: 'chronos', value: 'night' }],
      action: { type: 'moveSelfAreaEnchant', params: { destination } },
      rawText,
    };
  }
  return null;
}

function withExpiry(effect: ParsedEffect): ParsedEffect {
  const expiry = parseAreaEnchantExpiry(effect.rawText);
  if (!expiry || parsedEffectKey(expiry) === parsedEffectKey(effect)) return effect;
  return { ...effect, expiry };
}

function parsedEffectKey(effect: ParsedEffect): string {
  return JSON.stringify({
    trigger: effect.trigger,
    conditions: effect.conditions,
    action: effect.action,
    rawText: effect.rawText,
  });
}

function parseSecondaryEffects(rawText: string): ParsedEffect[] {
  const effects: ParsedEffect[] = [];
  const normalizedText = rawText
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<a[^>]*>.*?<\/a>/gi, '')
    .replace(/※.*$/gm, '')
    .trim();

  const opponentElementOverrideMatch = normalizedText.match(/相手のキャラクターカードの属性をバトルフィールドにいる間(闇|炎|電気|風|カオス)にする/);
  if (opponentElementOverrideMatch) {
    effects.push({
      trigger: detectTrigger(normalizedText),
      conditions: [],
      action: { type: 'setOpponentElement', params: { value: opponentElementOverrideMatch[1] } },
      rawText,
    });
  }

  return effects;
}

export function parseAllEffects(cards: { id: string; effect: string }[]): Map<string, ParsedEffect[]> {
  const result = new Map<string, ParsedEffect[]>();

  for (const card of cards) {
    if (!card.effect || card.effect.trim().length === 0) continue;

    const lines = card.effect.split('\n').filter(l => l.trim().length > 0);
    const effects: ParsedEffect[] = [];

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const nextLine = lines[index + 1];
      const combinedLine = nextLine && /[、,]$/.test(line) ? `${line}${nextLine}` : null;
      const combined = combinedLine ? parseEffect(combinedLine) : null;
      const sourceLine = combined ? combinedLine! : line;
      const parsed = combined ?? parseEffect(line);
      if (parsed) effects.push(parsed);
      const expiry = parsed?.expiry ?? parseAreaEnchantExpiry(sourceLine);
      if (expiry && !effects.some(effect => parsedEffectKey(effect) === parsedEffectKey(expiry))) effects.push(expiry);
      for (const secondary of parseSecondaryEffects(sourceLine)) {
        if (!effects.some(effect => parsedEffectKey(effect) === parsedEffectKey(secondary))) effects.push(secondary);
      }
      if (combined) index++;
    }

    if (effects.length > 0) {
      result.set(card.id, effects);
    }
  }

  return result;
}
