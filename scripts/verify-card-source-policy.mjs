import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const requiredIgnoreRules = [
  'cards.json',
  'qa.json',
  'data/card*.json',
  'data/official-rulings-*.json',
  'data/e2e-card-seed.json',
  'scripts/card-english-*.json',
];
const trackedFiles = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const forbiddenTrackedPath =
  /^(?:cards\.json|qa\.json|data\/(?:card.*|official-rulings-.*|e2e-card-seed)\.json|scripts\/card-english-.*\.json)$/;
const rawMarkers = [
  /"japaneseEffect"\s*:/,
  /"enEffectOfficial"\s*:/,
  /"effectVerificationSource"\s*:/,
  /"correctedJapaneseText"\s*:/,
  /"zh-TW"\s*:/,
];
const problems = [];

for (const path of trackedFiles) {
  if (!existsSync(path)) continue;
  if (forbiddenTrackedPath.test(path)) problems.push(`${path}: source/review JSON must not be tracked`);
  if (!path.endsWith('.json')) continue;
  const source = readFileSync(path, 'utf8');
  if (rawMarkers.some((marker) => marker.test(source))) {
    problems.push(`${path}: tracked JSON contains card text source markers`);
  }
}

for (const ignoreFile of ['.gitignore', '.dockerignore']) {
  const rules = new Set(
    readFileSync(ignoreFile, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#')),
  );
  for (const required of requiredIgnoreRules) {
    if (!rules.has(required)) problems.push(`${ignoreFile}: missing ${required}`);
  }
}

if (problems.length > 0) {
  console.error(`Card source-data policy failed with ${problems.length} problem(s):`);
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}

console.log('source-data policy: no raw card or official-rulings JSON is tracked or copied into images');
