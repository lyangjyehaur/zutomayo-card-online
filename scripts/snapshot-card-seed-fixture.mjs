import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const [baseUrl, outputPath = 'data/e2e-card-seed.json'] = process.argv.slice(2);
if (!baseUrl) {
  console.error('Usage: node scripts/snapshot-card-seed-fixture.mjs <card-api-base-url> [output-path]');
  process.exit(2);
}

function endpoint(path) {
  return new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
}

async function fetchJson(path) {
  const url = endpoint(path);
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${url} failed with HTTP ${response.status}`);
  return response.json();
}

const [cards, i18n] = await Promise.all([fetchJson('cards'), fetchJson('cards/i18n')]);
if (!Array.isArray(cards) || cards.length !== 422) {
  throw new Error(`Expected 422 cards, received ${Array.isArray(cards) ? cards.length : 'invalid data'}`);
}
if (!i18n || typeof i18n !== 'object' || Array.isArray(i18n)) {
  throw new Error('Card i18n endpoint returned invalid data');
}

const cardIds = new Set(cards.map((card) => card.id));
if (cardIds.size !== cards.length || cardIds.has(undefined))
  throw new Error('Card fixture contains invalid or duplicate IDs');

const fixture = { schemaVersion: 1, cards, i18n };
const target = resolve(process.cwd(), outputPath);
await writeFile(target, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
console.log(`Wrote ${cards.length} cards and ${Object.keys(i18n).length} i18n entries to ${target}`);
