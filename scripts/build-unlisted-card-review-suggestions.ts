import fs from 'node:fs/promises';
import path from 'node:path';

import { toHalfwidthAscii } from './reviewTextNormalization';

type SourceCard = {
  candidateId: string;
  expectedCardId?: string;
  name: string;
  pack: string;
  distributionType: string;
};

type SourceManifest = { cards: SourceCard[] };

type OCRLine = {
  text: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

type OCRCard = {
  candidateId: string;
  imageWidth: number;
  imageHeight: number;
  lines: OCRLine[];
  error?: string;
};

type OCROutput = { cards: OCRCard[] };

type Suggestion = {
  review: Record<string, string>;
  evidence: {
    engine: 'apple-vision';
    imageWidth: number;
    imageHeight: number;
    ocrLines: OCRLine[];
    note: string;
  };
};

const root = process.cwd();
const manifestPath = path.join(root, 'data', 'card-unlisted-sources.json');
const ocrPath = path.join(root, 'data', 'card-unlisted-ocr.json');
const outputPath = path.join(root, 'data', 'card-unlisted-review-suggestions.json');

function hasJapanese(value: string): boolean {
  return /[\u3040-\u30ff\u3400-\u9fff]/u.test(value);
}

function latinCount(value: string): number {
  return (value.match(/[A-Za-z]/g) || []).length;
}

function isMetadata(value: string): boolean {
  return /(?:POWER|ROWER|POIWER|COST|NIGHT|DAY|Enchant|Character|Bat\w*\s+B\w*|ZUTT?OMAYO|Illustrator|Photographer|Release|PREMIUM|NOT FOR SALE|©)/iu.test(
    value,
  );
}

function normalizedWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function englishName(lines: OCRLine[]): string {
  const candidates = lines.filter(
    (line) =>
      line.y >= 0.18 &&
      line.y <= 0.32 &&
      latinCount(line.text) >= 4 &&
      !hasJapanese(line.text) &&
      !isMetadata(line.text),
  );
  const groups: OCRLine[][] = [];
  for (const line of candidates) {
    const group = groups.find((entry) => Math.abs(entry[0].y - line.y) <= 0.022);
    if (group) group.push(line);
    else groups.push([line]);
  }
  const values = groups.map((group) => {
    const unique = [...new Set(group.sort((left, right) => left.x - right.x).map((line) => line.text.trim()))];
    return normalizedWhitespace(unique.join(' '));
  });
  return values.sort((left, right) => latinCount(right) - latinCount(left))[0] || '';
}

function effectLines(lines: OCRLine[], language: 'ja' | 'en'): string {
  const minimumY = language === 'ja' ? 0.09 : 0.065;
  const maximumY = language === 'ja' ? 0.205 : 0.145;
  return normalizedWhitespace(
    lines
      .filter((line) => {
        if (line.x > 0.62 || line.y < minimumY || line.y > maximumY) return false;
        if (isMetadata(line.text)) return false;
        if (language === 'ja') {
          const japaneseCharacters = (line.text.match(/[\u3040-\u30ff\u3400-\u9fff]/gu) || []).length;
          return japaneseCharacters >= 2 && !/^\d{4}[./-]/u.test(line.text);
        }
        return !hasJapanese(line.text) && latinCount(line.text) >= 4;
      })
      .sort((left, right) => right.y - left.y || left.x - right.x)
      .map((line) => line.text)
      .join(language === 'ja' ? '' : ' '),
  );
}

function cardType(card: SourceCard, lines: OCRLine[]): string {
  if (card.candidateId === '4th_105') return 'Character';
  const values = lines.map((line) => line.text.toLowerCase());
  if (values.some((value) => value.includes('area enchant'))) return 'Area Enchant';
  if (values.some((value) => value.includes('enchant'))) return 'Enchant';
  if (values.some((value) => value.includes('haracter'))) return 'Character';
  return '';
}

function rarity(lines: OCRLine[]): string {
  const bottom = lines.filter((line) => line.y < 0.075).map((line) => line.text.trim().toUpperCase());
  for (const value of bottom) {
    if (/^SE(?:\b|[^A-Z])/u.test(value)) return 'SE';
    if (/^UR(?:\b|[^A-Z])/u.test(value)) return 'UR';
    if (/^SR(?:\b|[^A-Z])/u.test(value)) return 'SR';
    if (/^R(?:\b|[^A-Z])/u.test(value)) return 'R';
    if (/^N(?:\b|[^A-Z])/u.test(value) && !value.startsWith('NOT')) return 'N';
  }
  return '';
}

function printedNumber(card: SourceCard, lines: OCRLine[]): string {
  const fourthSet = card.expectedCardId?.match(/^4th_(10[5-7])$/)?.[1];
  if (fourthSet) return `${fourthSet}/104`;
  const sourceIndex = Number(card.candidateId.match(/(\d+)$/)?.[1] || 0);
  if (sourceIndex >= 1 && sourceIndex <= 7) return `${String(sourceIndex).padStart(3, '0')}/007`;
  if (sourceIndex >= 17 && sourceIndex <= 38) return `${String(sourceIndex - 16).padStart(2, '0')}/20`;
  if (sourceIndex >= 39 && sourceIndex <= 61) return `${String(sourceIndex - 38).padStart(3, '0')}/023`;

  const candidates = lines
    .filter((line) => line.y < 0.17 && line.x > 0.55)
    .map((line) => line.text.replace(/[＊]/gu, '*'));
  for (const value of candidates) {
    const match = value.match(/(\d{1,3})\s*\/\s*([0-9+*]{2,5})/u);
    if (match) {
      const numerator = match[2].includes('+') && match[1].length < 2 ? match[1].padStart(2, '0') : match[1];
      return `${numerator}/${match[2]}`;
    }
  }
  return '';
}

function generatedCardId(card: SourceCard): string {
  if (card.expectedCardId) return card.expectedCardId;
  const sourceIndex = Number(card.candidateId.match(/(\d+)$/)?.[1] || 0);
  const groups: Array<[number, number, string]> = [
    [1, 7, 'bonus'],
    [8, 14, 'collaboration'],
    [15, 16, 'live'],
    [17, 38, 'technopoor'],
    [39, 61, 'sunaneko'],
  ];
  const group = groups.find(([start, end]) => sourceIndex >= start && sourceIndex <= end);
  if (!group) return card.candidateId;
  return `${group[2]}_${String(sourceIndex - group[0] + 1).padStart(3, '0')}`;
}

function illustrator(lines: OCRLine[]): string {
  const line = lines.find(
    (entry) => entry.y < 0.08 && /(?:illustrator|lustrator|llustrator|hllustrator|photographer)/iu.test(entry.text),
  );
  if (!line) return '';
  const value = line.text.replace(
    /^.*?(?:illustrator|lustrator|llustrator|hllustrator|photographer)\s*[:：]?\s*/iu,
    '',
  );
  return normalizedWhitespace(value.split(/\s+\d{4}[./-]/u)[0]);
}

function suggestion(card: SourceCard, ocr: OCRCard): Suggestion {
  const type = cardType(card, ocr.lines);
  const japaneseEffect = effectLines(ocr.lines, 'ja');
  const officialEnglishEffect =
    type === 'Character' && !japaneseEffect ? '' : toHalfwidthAscii(effectLines(ocr.lines, 'en'));
  const printedEffectStatus =
    japaneseEffect || officialEnglishEffect ? 'present' : type === 'Character' ? 'none' : 'unknown';
  const review: Record<string, string> = {
    cardId: generatedCardId(card),
    printedNumber: printedNumber(card, ocr.lines),
    nameJa: card.name,
    nameEnOfficial: toHalfwidthAscii(
      !hasJapanese(card.name) && latinCount(card.name) >= 4 ? card.name : englishName(ocr.lines),
    ),
    effectJa: japaneseEffect,
    effectEnOfficial: officialEnglishEffect,
    printedEffectStatus,
    type,
    rarity: rarity(ocr.lines),
    illustrator: illustrator(ocr.lines),
    pack: card.pack,
  };
  if (card.candidateId === '4th_105') {
    review.attackNight = '0';
    review.attackDay = '250';
  }
  return {
    review,
    evidence: {
      engine: 'apple-vision',
      imageWidth: ocr.imageWidth,
      imageHeight: ocr.imageHeight,
      ocrLines: ocr.lines,
      note: 'Machine-generated draft. Every field requires human comparison with the card image.',
    },
  };
}

async function main(): Promise<void> {
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as SourceManifest;
  const ocr = JSON.parse(await fs.readFile(ocrPath, 'utf8')) as OCROutput;
  const ocrById = new Map(ocr.cards.map((card) => [card.candidateId, card]));
  const cards = Object.fromEntries(
    manifest.cards.map((card) => {
      const record = ocrById.get(card.candidateId);
      if (!record || record.error) throw new Error(`Missing usable OCR record for ${card.candidateId}`);
      return [card.candidateId, suggestion(card, record)];
    }),
  );
  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    cardCount: manifest.cards.length,
    cards,
  };
  await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${manifest.cards.length} machine suggestions to ${outputPath}`);
}

await main();
