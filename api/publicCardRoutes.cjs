'use strict';

const cardDataService = require('./cardDataService.cjs');

function noStore(res) {
  res.setHeader('Cache-Control', 'no-store');
}

async function handlePublicCardRoute({
  pathname,
  method,
  url,
  res,
  json,
  pool,
  deckSharingEnabled,
  services = cardDataService,
}) {
  if (method !== 'GET') return false;

  if (pathname === '/api/cards') {
    noStore(res);
    json(await services.getPublicCards(pool, url.searchParams));
    return true;
  }

  if (pathname === '/api/catalog/cards') {
    noStore(res);
    json(await services.getCatalogCards(pool, url.searchParams));
    return true;
  }

  const catalogRecommendationsRoute = pathname.match(/^\/api\/catalog\/cards\/([^/]+)\/recommendations$/);
  if (catalogRecommendationsRoute) {
    const cardId = decodeURIComponent(catalogRecommendationsRoute[1]);
    noStore(res);
    const result = await services.getCardRecommendations(pool, cardId, url.searchParams.get('limit'));
    if (!result.ok) json({ error: result.error }, result.status);
    else json(result.body);
    return true;
  }

  if (pathname === '/api/cards/texts') {
    noStore(res);
    json(await services.getAllCardTextsI18n(pool));
    return true;
  }

  const publicCardTextsRoute = pathname.match(/^\/api\/cards\/([^/]+)\/texts$/);
  if (publicCardTextsRoute) {
    const cardId = decodeURIComponent(publicCardTextsRoute[1]);
    noStore(res);
    json(await services.getCardTextsI18n(pool, cardId));
    return true;
  }

  const publicCardRoute = pathname.match(/^\/api\/cards\/([^/]+)$/);
  if (publicCardRoute) {
    const cardId = decodeURIComponent(publicCardRoute[1]);
    const result = await services.getPublicCard(pool, cardId);
    if (!result.ok) json({ error: result.error }, result.status);
    else {
      noStore(res);
      json(result.body);
    }
    return true;
  }

  if (pathname === '/api/config') {
    noStore(res);
    json({ ...(await services.getGameConfig(pool)), deck_sharing_enabled: deckSharingEnabled });
    return true;
  }

  if (pathname === '/api/preset-decks') {
    noStore(res);
    json(await services.getPresetDecks(pool));
    return true;
  }

  return false;
}

module.exports = { handlePublicCardRoute };
