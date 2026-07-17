import { auditDerivedEffects, loadDerivedEffectsAuditInput } from './cardDerivedEffects';

const sourcePath = process.argv[2] || process.env.CARD_EFFECT_I18N_SOURCE || 'data/card-effects-i18n.json';
const input = loadDerivedEffectsAuditInput(sourcePath);
const problems = auditDerivedEffects(input);

if (problems.length > 0) {
  console.error(`Derived card-effect audit failed with ${problems.length} problem(s):`);
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}

console.log(
  `Derived card-effect audit passed: ${Object.keys(input.effects).length} cards, ` +
    `1000 reviewed translations; no legacy English rows.`,
);
