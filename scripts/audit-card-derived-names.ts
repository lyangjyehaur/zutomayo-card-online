import { auditCardNames, loadCardNamesAuditInput } from './cardNameTranslations';

const sourcePath = process.argv[2] || process.env.CARD_NAME_I18N_SOURCE || 'data/card-names-i18n.json';
const songTitlesPath = process.env.CARD_SONG_I18N_SOURCE || 'data/card-song-titles-i18n.json';
const input = loadCardNamesAuditInput(sourcePath, songTitlesPath);
const problems = auditCardNames(input);

if (problems.length > 0) {
  console.error(`Derived card-name audit failed with ${problems.length} problem(s):`);
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}

console.log(
  `Derived card-name audit passed: ${Object.keys(input.names.cards).length} cards, ` +
    `${Object.keys(input.songs).length} songs, 1688 reviewed name translations.`,
);
