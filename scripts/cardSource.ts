import { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { CardDef } from '../src/game/types';
import { postgresConnectionString, postgresSslConfig } from '../src/runtimeSecurityConfig';
import { E2E_SEED_CARDS, E2E_SEED_CARD_I18N } from './fixtures/e2eCards';

export type CardEffectsI18n = Record<string, Record<string, string>>;

type SeedCardFixture = {
  schemaVersion: 1;
  cards: CardDef[];
  i18n: CardEffectsI18n;
};

type CardRow = {
  id: string;
  name: string;
  en_name_official?: string | null;
  pack: string;
  song?: string | null;
  illustrator?: string | null;
  rarity?: string | null;
  element: CardDef['element'];
  type: CardDef['type'];
  clock?: number | null;
  attack_night?: number | null;
  attack_day?: number | null;
  power_cost?: number | null;
  send_to_power?: number | null;
  effect?: string | null;
  en_effect_official?: string | null;
  image?: string | null;
  errata?: string | null;
  has_official_errata?: boolean | null;
  official_errata_id?: string | null;
  official_errata_affects_name?: boolean | null;
  official_errata_affects_effect?: boolean | null;
  official_errata_url?: string | null;
};

const CARD_SELECT = `SELECT id, name, en_name_official, pack, song, illustrator, rarity, element, type, clock,
                    attack_night, attack_day, power_cost, send_to_power, effect,
                    en_effect_official, image, errata, has_official_errata, official_errata_id,
                    official_errata_affects_name, official_errata_affects_effect, official_errata_url
                    FROM cards ORDER BY id`;

function cardRowToDef(row: CardRow): CardDef {
  const def: CardDef = {
    id: row.id,
    name: row.name,
    pack: row.pack,
    song: row.song || '',
    illustrator: row.illustrator || '',
    rarity: row.rarity || '',
    element: row.element,
    type: row.type,
    clock: row.clock ?? 0,
    attack:
      row.attack_night === null ||
      row.attack_night === undefined ||
      row.attack_day === null ||
      row.attack_day === undefined
        ? null
        : { night: row.attack_night, day: row.attack_day },
    powerCost: row.power_cost ?? 0,
    sendToPower: row.send_to_power ?? 0,
    effect: row.effect || '',
    image: row.image || '',
    errata: row.errata || '',
    hasOfficialErrata: Boolean(row.has_official_errata),
    officialErrataAffectsName: Boolean(row.official_errata_affects_name),
    officialErrataAffectsEffect: Boolean(row.official_errata_affects_effect),
  };
  if (row.en_name_official) def.enNameOfficial = row.en_name_official;
  if (row.en_effect_official) def.enEffectOfficial = row.en_effect_official;
  if (row.official_errata_id) def.officialErrataId = row.official_errata_id;
  if (row.official_errata_url) def.officialErrataUrl = row.official_errata_url;
  return def;
}

function poolFromEnv(): Pool {
  const databaseUrl = postgresConnectionString(process.env);
  return new Pool({
    ...(databaseUrl
      ? { connectionString: databaseUrl }
      : {
          host: process.env.PG_HOST || 'localhost',
          port: Number(process.env.PG_PORT) || 5432,
          user: process.env.PG_USER || 'postgres',
          password: process.env.PG_PASSWORD || '',
          database: process.env.PG_DATABASE || 'postgres',
        }),
    ssl: postgresSslConfig(process.env),
  });
}

async function fetchJson<T>(url: string): Promise<T> {
  if (url.startsWith('fixture:')) {
    if (process.env.NODE_ENV !== 'test') {
      throw new Error('Synthetic seed fixtures are only available when NODE_ENV=test.');
    }
    if (url === 'fixture:e2e/cards') return structuredClone(E2E_SEED_CARDS) as T;
    if (url === 'fixture:e2e/cards/i18n') return structuredClone(E2E_SEED_CARD_I18N) as T;
    throw new Error(`Unknown synthetic seed fixture: ${url}`);
  }
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${url} failed with HTTP ${response.status}`);
  return (await response.json()) as T;
}

let seedFixturePromise: Promise<SeedCardFixture> | undefined;

function loadSeedFixture(filePath: string): Promise<SeedCardFixture> {
  seedFixturePromise ??= readFile(resolve(process.cwd(), filePath), 'utf8').then((source) => {
    const fixture = JSON.parse(source) as SeedCardFixture;
    if (fixture.schemaVersion !== 1 || !Array.isArray(fixture.cards) || fixture.cards.length === 0) {
      throw new Error(`Invalid card seed fixture: ${filePath}`);
    }
    if (!fixture.i18n || typeof fixture.i18n !== 'object' || Array.isArray(fixture.i18n)) {
      throw new Error(`Invalid card seed i18n fixture: ${filePath}`);
    }
    return fixture;
  });
  return seedFixturePromise;
}

function apiUrl(baseUrl: string, path: string): string {
  return new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
}

function sourceUrl(envName: string, path: string): string | null {
  const directUrl = process.env[envName];
  if (directUrl) return directUrl;
  const baseUrl = process.env.SEED_CARD_API_URL || process.env.CARD_API_URL;
  return baseUrl ? apiUrl(baseUrl, path) : null;
}

export async function loadCardsFromDatabase(): Promise<CardDef[]> {
  const pool = poolFromEnv();
  try {
    const rows = (await pool.query(CARD_SELECT)).rows as CardRow[];
    return rows.map(cardRowToDef);
  } finally {
    await pool.end();
  }
}

export async function loadCardsForScript(): Promise<CardDef[]> {
  const baseUrl = process.env.CARD_API_URL;
  const cards = baseUrl ? await fetchJson<CardDef[]>(apiUrl(baseUrl, 'cards')) : await loadCardsFromDatabase();
  if (!Array.isArray(cards) || cards.length === 0) {
    throw new Error('No card data loaded. Set CARD_API_URL or PG_* environment variables.');
  }
  return cards;
}

export async function loadSeedCards(): Promise<CardDef[]> {
  const fixturePath = process.env.SEED_CARD_FIXTURE_FILE;
  if (fixturePath) return (await loadSeedFixture(fixturePath)).cards;
  const url = sourceUrl('SEED_CARDS_URL', 'cards');
  if (!url) throw new Error('Set SEED_CARDS_URL or SEED_CARD_API_URL before running card seed.');
  const cards = await fetchJson<CardDef[]>(url);
  if (!Array.isArray(cards) || cards.length === 0) throw new Error('Seed card source returned no cards.');
  return cards;
}

export async function loadSeedCardI18n(): Promise<CardEffectsI18n> {
  const fixturePath = process.env.SEED_CARD_FIXTURE_FILE;
  if (fixturePath) return (await loadSeedFixture(fixturePath)).i18n;
  const url = sourceUrl('SEED_CARD_I18N_URL', 'cards/i18n');
  if (!url) throw new Error('Set SEED_CARD_I18N_URL or SEED_CARD_API_URL before running card seed.');
  const i18n = await fetchJson<CardEffectsI18n>(url);
  return i18n && typeof i18n === 'object' && !Array.isArray(i18n) ? i18n : {};
}
