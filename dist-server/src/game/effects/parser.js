"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseEffect = parseEffect;
exports.parseAllEffects = parseAllEffects;
// ===== Number parsing (handles both ASCII and fullwidth) =====
function parseNum(text) {
    const normalized = text.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
    return parseInt(normalized, 10) || 0;
}
// ===== Main Parser =====
function parseEffect(rawText) {
    if (!rawText || rawText.trim().length === 0)
        return null;
    const text = rawText
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<a[^>]*>.*?<\/a>/gi, '')
        .replace(/※.*$/gm, '')
        .trim();
    if (text.length === 0)
        return null;
    const conditions = [];
    let actionText = text;
    // "真夜中の前後Xマスも真夜中として扱う"
    if (text.includes('真夜中として扱う')) {
        return { trigger: 'onUse', conditions: [], action: { type: 'clockSet', params: { value: 'expand_midnight' } }, rawText };
    }
    // "同時に出したキャラクターカードを、変えなくてもよい"
    if (text.includes('変えなくてもよい')) {
        return { trigger: 'onUse', conditions: [], action: { type: 'addSettableCard', params: { optional: true } }, rawText };
    }
    // "パワーチャージャーからX枚まで選び、このカードの効果として使用する"
    if (text.includes('パワーチャージャーから') && text.includes('効果として使用')) {
        return { trigger: 'onUse', conditions: [], action: { type: 'recoverFromAbyss', params: { source: 'powerCharger' } }, rawText };
    }
    // "夜なら..."
    const chronosMatch = text.match(/^(夜|昼)なら(.+)$/);
    if (chronosMatch) {
        conditions.push({ type: 'chronos', value: chronosMatch[1] === '夜' ? 'night' : 'day' });
        actionText = chronosMatch[2];
    }
    // "相手の属性がXなら..."
    const oppElementMatch = text.match(/相手の(?:キャラクターカードの)?属性が(闇|炎|電気|風|カオス)なら(.+)$/);
    if (oppElementMatch) {
        conditions.push({ type: 'opponentElement', value: oppElementMatch[1] });
        actionText = oppElementMatch[2];
    }
    // "自分の属性がXなら..."
    const selfElementMatch = text.match(/自分の(?:キャラクターカードの)?属性が(闇|炎|電気|風|カオス)なら(.+)$/);
    if (selfElementMatch) {
        conditions.push({ type: 'selfElement', value: selfElementMatch[1] });
        actionText = selfElementMatch[2];
    }
    // "アビスにX種類の属性があると..."
    const abyssElementMatch = text.match(/アビスに(\d)種類の属性があると(.+)$/);
    if (abyssElementMatch) {
        conditions.push({ type: 'abyssElements', value: parseNum(abyssElementMatch[1]) });
        actionText = abyssElementMatch[2];
    }
    // "パワーチャージャーにX属性以上あるなら..."
    const pcElementMatch = text.match(/パワーチャージャーに(\d)属性以上あるなら(.+)$/);
    if (pcElementMatch) {
        conditions.push({ type: 'abyssElements', value: parseNum(pcElementMatch[1]), target: 'powerCharger' });
        actionText = pcElementMatch[2];
    }
    // "アビスにX枚以上カードがあるなら..."
    const abyssCountMatch = text.match(/アビスに(\d+)枚以上カードがあるなら(.+)$/);
    if (abyssCountMatch) {
        conditions.push({ type: 'abyssCount', value: parseNum(abyssCountMatch[1]) });
        actionText = abyssCountMatch[2];
    }
    // "HPがX以下なら..."
    const hpMatch = text.match(/HPが(\d+)以下(なら|の場合)(.+)$/);
    if (hpMatch) {
        conditions.push({ type: 'hpLessOrEqual', value: parseNum(hpMatch[1]) });
        actionText = hpMatch[3];
    }
    // "このターンにXのキャラクターと入れ替えていたなら..."
    const swappedMatch = text.match(/このターンに.+キャラクターと入れ替えていたなら(.+)$/);
    if (swappedMatch) {
        conditions.push({ type: 'chronosChanged', value: true });
        actionText = swappedMatch[1];
    }
    // "バトルゾーンのカードがXのキャラクターなら..."
    const namedCardMatch = text.match(/バトルゾーンのカードが.+キャラクターなら(.+)$/);
    if (namedCardMatch) {
        actionText = namedCardMatch[1];
    }
    // Parse action from the remaining text
    const action = parseAction(actionText);
    if (!action)
        return null;
    return {
        trigger: detectTrigger(text),
        conditions,
        action,
        rawText,
    };
}
// ===== Action Parser =====
function parseAction(text) {
    // "攻撃力+50"
    const boostMatch = text.match(/攻撃力[＋+](\d+)/);
    if (boostMatch)
        return { type: 'boostAttack', params: { value: parseNum(boostMatch[1]) } };
    // "攻撃力-30"
    const reduceMatch = text.match(/攻撃力[ー\-](\d+)/);
    if (reduceMatch)
        return { type: 'reduceAttack', params: { value: parseNum(reduceMatch[1]) } };
    // "HPをX回復"
    const healMatch = text.match(/HP[をが](\d+)回復/);
    if (healMatch)
        return { type: 'heal', params: { value: parseNum(healMatch[1]) } };
    // "HP+20" or "HP+50" (without を/が)
    const hpBoostMatch = text.match(/HP[＋+](\d+)/);
    if (hpBoostMatch)
        return { type: 'heal', params: { value: parseNum(hpBoostMatch[1]) } };
    // "相手のHP-20"
    const hpReduceMatch = text.match(/相手のHP[ー\-](\d+)/);
    if (hpReduceMatch)
        return { type: 'directDamage', params: { value: parseNum(hpReduceMatch[1]) } };
    // "Xダメージを軽減"
    const damageReduceMatch = text.match(/(\d+)ダメージ[を]?軽減/);
    if (damageReduceMatch)
        return { type: 'damageReduce', params: { value: parseNum(damageReduceMatch[1]) } };
    // "Xダメージ" (direct damage)
    const directDamageMatch = text.match(/(\d+)ダメージ/);
    if (directDamageMatch)
        return { type: 'directDamage', params: { value: parseNum(directDamageMatch[1]) } };
    // "カードをX枚引く"
    const drawMatch = text.match(/カード[をが](\d+)枚/);
    if (drawMatch)
        return { type: 'drawCards', params: { value: parseNum(drawMatch[1]) } };
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
        return { type: 'clockSet', params: { value: 'any' } };
    }
    // "効果を無効"
    if (text.includes('効果') && text.includes('無効')) {
        return { type: 'noEffect', params: {} };
    }
    // "ダメージは軽減されない"
    if (text.includes('ダメージ') && text.includes('軽減されない')) {
        return { type: 'directDamage', params: { value: -1, unreduceable: true } };
    }
    return null;
}
// ===== Trigger Detection =====
function detectTrigger(text) {
    if (text.includes('ダメージを受けたとき') || text.includes('ダメージを受けた時')) {
        return 'onDamageReceived';
    }
    if (text.includes('バトル'))
        return 'onBattle';
    return 'onUse';
}
// ===== Batch Parse =====
function parseAllEffects(cards) {
    const result = new Map();
    for (const card of cards) {
        if (!card.effect || card.effect.trim().length === 0)
            continue;
        const lines = card.effect.split('\n').filter(l => l.trim().length > 0);
        const effects = [];
        for (const line of lines) {
            const parsed = parseEffect(line);
            if (parsed)
                effects.push(parsed);
        }
        if (effects.length > 0) {
            result.set(card.id, effects);
        }
    }
    return result;
}
