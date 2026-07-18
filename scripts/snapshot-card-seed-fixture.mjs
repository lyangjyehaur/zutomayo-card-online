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

const [cards, texts] = await Promise.all([fetchJson('cards'), fetchJson('cards/texts')]);
if (!Array.isArray(cards) || cards.length !== 422) {
  throw new Error(`Expected 422 cards, received ${Array.isArray(cards) ? cards.length : 'invalid data'}`);
}
if (!texts || typeof texts !== 'object' || Array.isArray(texts)) {
  throw new Error('Card text endpoint returned invalid data');
}

const cardIds = new Set(cards.map((card) => card.id));
if (cardIds.size !== cards.length || cardIds.has(undefined))
  throw new Error('Card fixture contains invalid or duplicate IDs');

const fixture = { schemaVersion: 2, cards, texts };
const target = resolve(process.cwd(), outputPath);
await writeFile(target, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
console.log(`Wrote ${cards.length} cards and ${Object.keys(texts).length} text entries to ${target}`);
