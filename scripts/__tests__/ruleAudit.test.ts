import { describe, expect, it } from 'vitest';
import type { CardDef } from '../../src/game/types';
import { auditRuleEffects, ruleAuditFailures, type RuleAuditReport } from '../rule-audit';

const card = (effect: string): CardDef => ({
  id: 'audit-card',
  name: 'Audit Card',
  pack: 'test',
  song: '',
  illustrator: '',
  rarity: 'N',
  element: '闇',
  type: 'Character',
  clock: 1,
  attack: { night: 10, day: 10 },
  powerCost: 0,
  sendToPower: 1,
  effect,
  image: '',
  errata: '',
});

describe('rule audit fail-closed policy', () => {
  it('passes a supported executable effect', () => {
    const report = auditRuleEffects([card('攻撃力+10')]);
    expect(report).toMatchObject({ effectLines: 1, parsedLines: 1, unparsedLines: 0, parsedButPartial: 0 });
    expect(ruleAuditFailures(report)).toEqual([]);
  });

  it.each([
    ['unparsedLines', 'not parsed'],
    ['parsedButPartial', 'not executable'],
    ['falseDraw', 'falsely parsed'],
  ] as const)('fails when %s is non-zero', (field, message) => {
    const report: RuleAuditReport = {
      totalCards: 1,
      effectCards: 1,
      effectLines: 1,
      parsedLines: 1,
      runtimeParsedEffects: 1,
      unparsedLines: 0,
      parsedButPartial: 0,
      falseDraw: 0,
      samples: { unparsed: [], parsedButPartial: [], falseDraw: [] },
      [field]: 1,
    };
    expect(ruleAuditFailures(report)).toEqual([expect.stringContaining(message)]);
  });
});
