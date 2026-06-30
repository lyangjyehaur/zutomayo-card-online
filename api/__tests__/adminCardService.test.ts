import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

type Queryable = {
  query: ReturnType<typeof vi.fn<(sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>>>;
};

const require = createRequire(import.meta.url);
const { cardDefToDbParams, normalizeCardForUpsert, upsertCard, upsertCardI18n, upsertGameConfig } =
  require('../adminCardService.cjs') as {
    cardDefToDbParams: (card: Record<string, unknown>) => unknown[];
    normalizeCardForUpsert: (
      id: string,
      body: Record<string, unknown>,
      baseCard?: Record<string, unknown>,
    ) => Record<string, unknown> | null;
    upsertCard: (
      pool: Queryable,
      cardId: string,
      body: Record<string, unknown>,
    ) => Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; status: number; error: string }>;
    upsertCardI18n: (
      pool: Queryable,
      cardId: string,
      body: Record<string, unknown>,
    ) => Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; status: number; error: string }>;
    upsertGameConfig: (
      pool: Queryable,
      key: string,
      body: Record<string, unknown>,
    ) => Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; status: number; error: string }>;
  };

function poolWithRows(rows: unknown[] = []): Queryable {
  return {
    query: vi.fn(async () => ({ rows })),
  };
}

const baseCard = {
  id: 'c_1',
  name: 'Base',
  pack: 'pack-a',
  element: '闇',
  type: 'Character',
  attack: { night: 10, day: 20 },
};

describe('admin card service', () => {
  it('normalizes card upsert payloads over an existing base card', () => {
    expect(normalizeCardForUpsert('c_1', { name: 'Updated', attack: { day: 30 }, clock: '2' }, baseCard)).toMatchObject(
      {
        id: 'c_1',
        name: 'Updated',
        pack: 'pack-a',
        element: '闇',
        type: 'Character',
        clock: 2,
        attack: { night: 10, day: 30 },
      },
    );
    expect(normalizeCardForUpsert('bad', { name: 'Missing required fields' })).toBeNull();
  });

  it('converts card definitions to DB params', () => {
    expect(
      cardDefToDbParams({
        ...baseCard,
        enNameOfficial: 'Official',
        clock: 2,
        powerCost: 1,
        sendToPower: 2,
        effect: 'Effect',
        enEffectOfficial: 'EN Effect',
        image: 'image.png',
        errata: 'errata',
      }),
    ).toEqual([
      'c_1',
      'Base',
      'Official',
      'pack-a',
      '',
      '',
      '',
      '闇',
      'Character',
      2,
      10,
      20,
      1,
      2,
      'Effect',
      'EN Effect',
      'image.png',
      'errata',
    ]);
  });

  it('upserts card i18n and writes an audit log', async () => {
    const pool = poolWithRows();
    await expect(upsertCardI18n(pool, 'c_1', { lang: 'zhTW', effectText: '效果' })).resolves.toEqual({
      ok: true,
      body: { ok: true },
    });
    expect(pool.query).toHaveBeenNthCalledWith(1, expect.stringContaining('INSERT INTO card_effects_i18n'), [
      'c_1',
      'zh-TW',
      '效果',
    ]);
    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      'INSERT INTO admin_audit_log (action, target_type, target_id, details) VALUES ($1, $2, $3, $4::jsonb)',
      ['upsert_card_i18n', 'card_effects_i18n', 'c_1', JSON.stringify({ lang: 'zh-TW', effectText: '效果' })],
    );
  });

  it('rejects invalid card i18n payloads before writing', async () => {
    const pool = poolWithRows();
    await expect(upsertCardI18n(pool, 'c_1', { lang: 'xx', effectText: 'Effect' })).resolves.toMatchObject({
      ok: false,
      status: 400,
    });
    await expect(upsertCardI18n(pool, 'c_1', { lang: 'en' })).resolves.toMatchObject({ ok: false, status: 400 });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('upserts cards using existing DB rows as base data', async () => {
    const pool = poolWithRows([]);

    await expect(upsertCard(pool, 'c_1', { name: 'Updated' })).resolves.toMatchObject({
      ok: false,
      status: 400,
    });

    const existingPool = poolWithRows([
      {
        id: 'c_1',
        name: 'Base',
        pack: 'pack-a',
        element: '闇',
        type: 'Character',
        clock: 0,
        attack_night: 10,
        attack_day: 20,
      },
    ]);
    await expect(upsertCard(existingPool, 'c_1', { name: 'Updated' })).resolves.toMatchObject({
      ok: true,
      body: { id: 'c_1', name: 'Updated', pack: 'pack-a' },
    });
    expect(existingPool.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO cards'), expect.any(Array));
    expect(existingPool.query).toHaveBeenCalledWith(
      'INSERT INTO admin_audit_log (action, target_type, target_id, details) VALUES ($1, $2, $3, $4::jsonb)',
      expect.arrayContaining(['upsert_card', 'card', 'c_1']),
    );
  });

  it('upserts game config and rejects missing values', async () => {
    const invalidPool = poolWithRows();
    await expect(upsertGameConfig(invalidPool, 'turnSeconds', {})).resolves.toEqual({
      ok: false,
      status: 400,
      error: 'Config value required',
    });
    expect(invalidPool.query).not.toHaveBeenCalled();

    const pool = poolWithRows();
    await expect(upsertGameConfig(pool, 'turnSeconds', { value: 60, description: 'Timer' })).resolves.toEqual({
      ok: true,
      body: { key: 'turnSeconds', value: 60, description: 'Timer' },
    });
    expect(pool.query).toHaveBeenNthCalledWith(1, expect.stringContaining('INSERT INTO game_config'), [
      'turnSeconds',
      JSON.stringify(60),
      'Timer',
    ]);
  });
});
