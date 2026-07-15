import fs from 'node:fs';

type ExtractedCard = {
  id: string;
  japaneseName: string;
  enNameOfficial: string;
  nameStatus: string;
  japaneseEffect: string;
  enEffectOfficial: string;
  effectStatus: string;
};

type Extraction = { cards: ExtractedCard[] };

const verifiedStatuses = new Set(['machine_verified', 'human_verified']);
const knownOfficialEnglishPrintDifferences = new Set(['4th_23']);
const suspiciousOcrArtifact = /\b(?:ff|retum|charaoter|opponet|nand|specily|electrig|attibute|immedlately)\b/i;

const source = process.argv[2] || 'data/card-english-extraction.json';
const extraction = JSON.parse(fs.readFileSync(source, 'utf8')) as Extraction;

const semanticTerms: Array<{ ja: RegExp; en: RegExp; label: string }> = [
  { ja: /闇/, en: /\b(darkness|dark)\b/i, label: 'darkness attribute' },
  { ja: /炎/, en: /\b(flame|fire)\b/i, label: 'flame attribute' },
  { ja: /電気/, en: /\b(electric|electro|lightning)\b/i, label: 'electric attribute' },
  { ja: /風/, en: /\bwind\b/i, label: 'wind attribute' },
  { ja: /アビス/, en: /\bAbyss\b/i, label: 'Abyss' },
  { ja: /パワーチャージャー/, en: /\bPower Charger\b/i, label: 'Power Charger' },
  { ja: /デッキ/, en: /\bdeck\b/i, label: 'deck' },
  { ja: /手札/, en: /\bhand\b/i, label: 'hand' },
  { ja: /エリアエンチャント/, en: /\bArea Enchant(?:ment)?\b/i, label: 'Area Enchantment' },
  { ja: /攻撃力/, en: /\bAttacks?(?: power)?\b/i, label: 'Attack' },
  { ja: /ダメージ/, en: /\bdamage\b/i, label: 'damage' },
  { ja: /回復/, en: /\b(recover|heal)|\bHP\s*\+/i, label: 'recover' },
  { ja: /公開/, en: /\b(reveal|show)s?\b/i, label: 'reveal' },
  { ja: /時計/, en: /\b(clocks?|time)\b/i, label: 'clock' },
];

function normalizeJapanese(value: string): string {
  return value.normalize('NFKC');
}

function mechanicNumbers(value: string, lang: 'ja' | 'en'): string[] {
  let normalized = value.normalize('NFKC').toLowerCase();
  if (lang === 'ja') {
    normalized = normalized
      .replace(/★(?=\d)/g, '')
      .replace(/★+/g, (stars) => ` ${stars.length} `)
      .replace(/1(?=枚|つ|個)/g, '');
  } else {
    const words: Record<string, string> = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6' };
    normalized = normalized
      .replace(/◆+/g, (symbols) => ` ${symbols.length} `)
      .replace(/★+/g, (symbols) => ` ${symbols.length} `)
      .replace(/\+{2,}/g, (symbols) => ` ${symbols.length} `)
      .replace(/\b(one(?!'s)|two|three|four|five|six)\b/g, (word) => words[word])
      .replace(/\b(?:1|a|an)\s+(?=cards?|characters?)/g, '');
  }
  return [
    ...new Set(
      [...normalized.matchAll(/\d+/g)].map((match) => String(Number(match[0]))).filter((number) => number !== '1'),
    ),
  ].sort();
}

function attackAdjustment(value: string, lang: 'ja' | 'en'): string | null {
  const match =
    lang === 'ja' ? value.match(/攻撃力\s*([+-])\s*(\d+)/) : value.match(/\bAttack(?: Power)?\s*([+-])\s*(\d+)/i);
  return match ? `${match[1]}${Number(match[2])}` : null;
}

const problems: string[] = [];
const ids = new Set<string>();
const seenPrintDifferences = new Set<string>();
for (const card of extraction.cards) {
  if (ids.has(card.id)) problems.push(`${card.id}: duplicate id`);
  ids.add(card.id);
  if (!verifiedStatuses.has(card.nameStatus) || !card.enNameOfficial.trim()) {
    problems.push(`${card.id}: official English name is not verified`);
  }
  if (/[\u3040-\u309f\u30a0-\u30fa\u31f0-\u31ff\u3400-\u9fff]/u.test(card.enNameOfficial)) {
    problems.push(`${card.id}: official English name contains Japanese text`);
  }
  const openingParens = (card.enNameOfficial.match(/\(/g) || []).length;
  const closingParens = (card.enNameOfficial.match(/\)/g) || []).length;
  if (openingParens !== closingParens) {
    problems.push(`${card.id}: official English name has unbalanced parentheses`);
  }
  if (suspiciousOcrArtifact.test(card.enNameOfficial)) {
    problems.push(`${card.id}: official English name contains a suspicious OCR artifact`);
  }
  const japaneseEffect = normalizeJapanese(card.japaneseEffect.trim());
  const englishEffect = card.enEffectOfficial.trim();
  if (!japaneseEffect) {
    if (englishEffect) problems.push(`${card.id}: English effect exists while Japanese effect is empty`);
    if (card.effectStatus !== 'not_applicable') {
      problems.push(`${card.id}: no-effect card must use not_applicable effect status`);
    }
    continue;
  }
  if (!verifiedStatuses.has(card.effectStatus) || !englishEffect) {
    problems.push(`${card.id}: official English effect is not verified`);
    continue;
  }
  if (/[\u3040-\u309f\u30a0-\u30fa\u31f0-\u31ff\u3400-\u9fff]/u.test(englishEffect)) {
    problems.push(`${card.id}: official English effect contains Japanese text`);
  }
  if (suspiciousOcrArtifact.test(englishEffect)) {
    problems.push(`${card.id}: official English effect contains a suspicious OCR artifact`);
  }
  const japaneseAttack = attackAdjustment(japaneseEffect, 'ja');
  const englishAttack = attackAdjustment(englishEffect, 'en');
  if (japaneseAttack && englishAttack && japaneseAttack !== englishAttack) {
    if (knownOfficialEnglishPrintDifferences.has(card.id)) seenPrintDifferences.add(card.id);
    else problems.push(`${card.id}: attack adjustment mismatch ja=${japaneseAttack} en=${englishAttack}`);
  }
  const jaNumbers = mechanicNumbers(japaneseEffect, 'ja');
  const enNumbers = mechanicNumbers(englishEffect, 'en');
  if (JSON.stringify(jaNumbers) !== JSON.stringify(enNumbers)) {
    problems.push(`${card.id}: numeric mismatch ja=[${jaNumbers}] en=[${enNumbers}]`);
  }
  for (const term of semanticTerms) {
    const listsAllAttributes =
      /闇/.test(japaneseEffect) &&
      /炎/.test(japaneseEffect) &&
      /電気/.test(japaneseEffect) &&
      /風/.test(japaneseEffect);
    if (
      term.label.endsWith('attribute') &&
      listsAllAttributes &&
      /\b(4|four) different attributes\b/i.test(englishEffect)
    ) {
      continue;
    }
    if (term.ja.test(japaneseEffect) && !term.en.test(englishEffect)) {
      problems.push(`${card.id}: missing English semantic term ${term.label}`);
    }
  }
}

for (const cardId of knownOfficialEnglishPrintDifferences) {
  if (!seenPrintDifferences.has(cardId)) {
    problems.push(`${cardId}: expected documented official English print difference was not found`);
  }
}

if (extraction.cards.length !== 422) problems.push(`expected 422 cards, got ${extraction.cards.length}`);

if (problems.length > 0) {
  console.error(`Official card-text audit failed with ${problems.length} problem(s):`);
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}

const humanNames = extraction.cards.filter((card) => card.nameStatus === 'human_verified').length;
const effectCards = extraction.cards.filter((card) => card.japaneseEffect.trim());
const humanEffects = effectCards.filter((card) => card.effectStatus === 'human_verified').length;
console.log(
  `Official card-text audit passed: ${extraction.cards.length} cards, ${ids.size} unique IDs; ` +
    `human-reviewed names ${humanNames}/${extraction.cards.length}, effects ${humanEffects}/${effectCards.length}.`,
);
