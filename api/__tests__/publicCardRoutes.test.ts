import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

type ServiceResult = { ok: true; body: unknown } | { ok: false; status: number; error: string };
type Services = {
  getPublicCards: ReturnType<typeof vi.fn>;
  getCatalogCards: ReturnType<typeof vi.fn>;
  getCardRecommendations: ReturnType<typeof vi.fn<() => Promise<ServiceResult>>>;
  getAllCardTextsI18n: ReturnType<typeof vi.fn>;
  getCardTextsI18n: ReturnType<typeof vi.fn>;
  getPublicCard: ReturnType<typeof vi.fn<() => Promise<ServiceResult>>>;
  getGameConfig: ReturnType<typeof vi.fn>;
  getPresetDecks: ReturnType<typeof vi.fn>;
};
type RouteInput = {
  pathname: string;
  method: string;
  url: URL;
  res: { setHeader: ReturnType<typeof vi.fn> };
  json: ReturnType<typeof vi.fn>;
  pool: object;
  deckSharingEnabled: boolean;
  services: Services;
};

const require = createRequire(import.meta.url);
const { handlePublicCardRoute } = require('../publicCardRoutes.cjs') as {
  handlePublicCardRoute: (input: RouteInput) => Promise<boolean>;
};

function route(pathname: string, method = 'GET') {
  const url = new URL(pathname, 'https://staging.example.test');
  const services: Services = {
    getPublicCards: vi.fn(async () => [{ id: 'card-1' }]),
    getCatalogCards: vi.fn(async () => [{ id: 'catalog-1' }]),
    getCardRecommendations: vi.fn(async () => ({ ok: true as const, body: [{ id: 'card-2' }] })),
    getAllCardTextsI18n: vi.fn(async () => ({ 'card-1': {} })),
    getCardTextsI18n: vi.fn(async () => ({ 'zh-TW': { name: '卡牌' } })),
    getPublicCard: vi.fn(async () => ({ ok: true as const, body: { id: 'card-1' } })),
    getGameConfig: vi.fn(async () => ({ rules_version: '1.0.0' })),
    getPresetDecks: vi.fn(async () => [{ id: 'dark' }]),
  };
  const input: RouteInput = {
    pathname: url.pathname,
    method,
    url,
    res: { setHeader: vi.fn() },
    json: vi.fn(),
    pool: {},
    deckSharingEnabled: true,
    services,
  };
  return { input, services };
}

describe('handlePublicCardRoute', () => {
  it('leaves unknown and non-GET routes to the main handler', async () => {
    const unknown = route('/api/unknown');
    const write = route('/api/cards', 'POST');

    await expect(handlePublicCardRoute(unknown.input)).resolves.toBe(false);
    await expect(handlePublicCardRoute(write.input)).resolves.toBe(false);
    expect(unknown.input.json).not.toHaveBeenCalled();
    expect(write.services.getPublicCards).not.toHaveBeenCalled();
  });

  it.each([
    ['/api/cards?pack=1', 'getPublicCards', [{ id: 'card-1' }]],
    ['/api/catalog/cards?rarity=UR', 'getCatalogCards', [{ id: 'catalog-1' }]],
    ['/api/cards/texts', 'getAllCardTextsI18n', { 'card-1': {} }],
    ['/api/preset-decks', 'getPresetDecks', [{ id: 'dark' }]],
  ] as const)('maps %s to %s with no-store caching', async (path, service, body) => {
    const { input, services } = route(path);

    await expect(handlePublicCardRoute(input)).resolves.toBe(true);
    expect(services[service]).toHaveBeenCalledOnce();
    expect(input.res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(input.json).toHaveBeenCalledWith(body);
  });

  it('decodes card ids and forwards the recommendation limit', async () => {
    const { input, services } = route('/api/catalog/cards/card%201/recommendations?limit=6');

    await handlePublicCardRoute(input);

    expect(services.getCardRecommendations).toHaveBeenCalledWith(input.pool, 'card 1', '6');
    expect(input.json).toHaveBeenCalledWith([{ id: 'card-2' }]);
  });

  it('maps service failures without changing their status', async () => {
    const { input, services } = route('/api/cards/missing');
    services.getPublicCard.mockResolvedValue({ ok: false, status: 404, error: 'Card not found' });

    await expect(handlePublicCardRoute(input)).resolves.toBe(true);

    expect(input.json).toHaveBeenCalledWith({ error: 'Card not found' }, 404);
    expect(input.res.setHeader).not.toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  it('keeps per-card texts and deck-sharing config response shapes', async () => {
    const texts = route('/api/cards/card%201/texts');
    const config = route('/api/config');
    config.input.deckSharingEnabled = false;

    await handlePublicCardRoute(texts.input);
    await handlePublicCardRoute(config.input);

    expect(texts.services.getCardTextsI18n).toHaveBeenCalledWith(texts.input.pool, 'card 1');
    expect(config.input.json).toHaveBeenCalledWith({ rules_version: '1.0.0', deck_sharing_enabled: false });
  });
});
