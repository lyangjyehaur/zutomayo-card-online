/* global module, require */

const { getAllCardTextsI18n, getCatalogCards, getGameConfig } = require('./cardDataService.cjs');
const { getPublicRuleDocument } = require('./officialRuleDocumentsService.cjs');
const { listPublicErrata, listPublicQa } = require('./officialRulingsService.cjs');

const KNOWLEDGE_SEARCH_LOCALES = Object.freeze(['ja', 'zh-TW', 'zh-CN', 'zh-HK', 'en', 'ko']);
const KNOWLEDGE_SEARCH_TYPES = Object.freeze(['card', 'qa', 'rule', 'errata', 'deck']);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function stringArray(value) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function uniqueStrings(values) {
  return [
    ...new Set(
      values
        .flatMap((value) => (Array.isArray(value) ? value : [value]))
        .map(text)
        .filter(Boolean),
    ),
  ];
}

function timestamp(value) {
  const parsed = value instanceof Date ? value : new Date(value || 0);
  return Number.isFinite(parsed.getTime()) ? parsed.getTime() : 0;
}

function safeUidPart(value) {
  return text(value).replace(/[^A-Za-z0-9_-]+/g, '_');
}

function documentUid(type, sourceId, locale) {
  return `${safeUidPart(type)}__${safeUidPart(sourceId)}__${safeUidPart(locale)}`;
}

function baseDocument({ type, locale, sourceId, title, subtitle = '', body = '', aliases = [], ...fields }) {
  return {
    uid: documentUid(type, sourceId, locale),
    type,
    locale,
    sourceId: text(sourceId),
    title: text(title),
    subtitle: text(subtitle),
    body: text(body),
    aliases: uniqueStrings(aliases),
    tags: uniqueStrings(fields.tags || []),
    keywords: uniqueStrings(fields.keywords || []),
    relatedCardIds: uniqueStrings(fields.relatedCardIds || []),
    url: text(fields.url),
    image: text(fields.image),
    pack: text(fields.pack),
    rarity: text(fields.rarity),
    element: text(fields.element),
    cardType: text(fields.cardType),
    distributionType: text(fields.distributionType),
    documentId: text(fields.documentId),
    sortNumber: Number.isFinite(fields.sortNumber) ? fields.sortNumber : 0,
    publishedAt: timestamp(fields.publishedAt),
    updatedAt: timestamp(fields.updatedAt),
  };
}

function publicCardText(card, translations, locale) {
  if (locale === 'ja') return { name: text(card.name), effect: text(card.effect) };
  if (locale === 'en') {
    return {
      name: text(card.enNameOfficial) || text(card.name),
      effect: text(card.enEffectOfficial) || text(card.effect),
    };
  }
  const translated = translations?.[locale];
  if (translated && translated.reviewStatus !== 'pending_review') {
    return {
      name: text(translated.name) || text(card.enNameOfficial) || text(card.name),
      effect: text(translated.effect) || text(card.enEffectOfficial) || text(card.effect),
    };
  }
  return {
    name: text(card.enNameOfficial) || text(card.name),
    effect: text(card.enEffectOfficial) || text(card.effect),
  };
}

function localizedSongTitles(card, songTitleConfig) {
  const configured = songTitleConfig?.[card.song];
  return Object.fromEntries(
    KNOWLEDGE_SEARCH_LOCALES.map((locale) => [
      locale,
      locale === 'ja' ? text(card.song) : text(configured?.[locale]) || text(card.song),
    ]),
  );
}

function cardSortNumber(cardId) {
  const match = text(cardId).match(/(\d+)(?!.*\d)/);
  return match ? Number(match[1]) : 0;
}

async function buildCardDocuments(pool) {
  const [cards, translations, gameConfig] = await Promise.all([
    getCatalogCards(pool),
    getAllCardTextsI18n(pool),
    getGameConfig(pool),
  ]);
  const songTitleConfig = gameConfig.card_song_titles_i18n || {};
  const localizedCards = new Map();
  const documents = [];

  for (const card of cards) {
    const texts = Object.fromEntries(
      KNOWLEDGE_SEARCH_LOCALES.map((locale) => [locale, publicCardText(card, translations[card.id], locale)]),
    );
    localizedCards.set(card.id, texts);
    const songs = localizedSongTitles(card, songTitleConfig);
    const aliases = uniqueStrings([
      card.id,
      ...Object.values(texts).flatMap((entry) => [entry.name, entry.effect]),
      ...Object.values(songs),
    ]);
    for (const locale of KNOWLEDGE_SEARCH_LOCALES) {
      documents.push(
        baseDocument({
          type: 'card',
          locale,
          sourceId: card.id,
          title: texts[locale].name,
          subtitle: songs[locale],
          body: texts[locale].effect,
          aliases,
          tags: [card.pack, card.rarity, card.element, card.type, card.distributionType],
          keywords: [card.id, card.pack, card.rarity, card.element, card.type, card.distributionType],
          relatedCardIds: [card.id],
          url: `/cards/${encodeURIComponent(card.id)}`,
          image: card.image,
          pack: card.pack,
          rarity: card.rarity,
          element: card.element,
          cardType: card.type,
          distributionType: card.distributionType || 'standard',
          sortNumber: cardSortNumber(card.id),
        }),
      );
    }
  }
  return { documents, localizedCards };
}

async function localizedServiceItems(locales, load) {
  const entries = await Promise.all(
    locales.map(async (locale) => {
      const result = await load(locale);
      return [locale, result?.ok ? result.body?.items || [] : []];
    }),
  );
  return Object.fromEntries(entries);
}

function groupBySourceId(itemsByLocale, sourceId) {
  const groups = new Map();
  for (const [locale, items] of Object.entries(itemsByLocale)) {
    for (const item of items) {
      const id = text(sourceId(item));
      if (!id) continue;
      const group = groups.get(id) || {};
      group[locale] = item;
      groups.set(id, group);
    }
  }
  return groups;
}

async function buildQaDocuments(pool) {
  const itemsByLocale = await localizedServiceItems(KNOWLEDGE_SEARCH_LOCALES, (locale) =>
    listPublicQa({ pool, language: locale }),
  );
  const groups = groupBySourceId(itemsByLocale, (item) => item.number);
  const documents = [];
  for (const [sourceId, localized] of groups) {
    const fallback = localized.ja || Object.values(localized)[0];
    const aliases = uniqueStrings(
      Object.values(localized).flatMap((item) => [
        item.localized?.question,
        item.localized?.answer,
        item.source?.question,
        item.source?.answer,
        ...stringArray(item.tags),
      ]),
    );
    for (const locale of KNOWLEDGE_SEARCH_LOCALES) {
      const item = localized[locale] || fallback;
      if (!item) continue;
      documents.push(
        baseDocument({
          type: 'qa',
          locale,
          sourceId,
          title: item.localized.question,
          subtitle: `Q.${item.number}`,
          body: item.localized.answer,
          aliases,
          tags: [...stringArray(item.tagIds), ...stringArray(item.tags)],
          keywords: [`Q.${item.number}`],
          relatedCardIds: item.relatedCardIds,
          url: `/rules/qa/${encodeURIComponent(String(item.number))}`,
          sortNumber: Number(item.number) || 0,
          publishedAt: item.publishedAt,
          updatedAt: item.lastSyncedAt,
        }),
      );
    }
  }
  return documents;
}

async function buildErrataDocuments(pool) {
  const itemsByLocale = await localizedServiceItems(KNOWLEDGE_SEARCH_LOCALES, (locale) =>
    listPublicErrata({ pool, language: locale }),
  );
  const groups = groupBySourceId(itemsByLocale, (item) => item.errataId);
  const documents = [];
  for (const [sourceId, localized] of groups) {
    const fallback = localized.ja || Object.values(localized)[0];
    const aliases = uniqueStrings(
      Object.values(localized).flatMap((item) => [
        item.cardId,
        item.cardName,
        item.cardNameJa,
        ...Object.values(item.source || {}),
        ...Object.values(item.localized || {}),
      ]),
    );
    for (const locale of KNOWLEDGE_SEARCH_LOCALES) {
      const item = localized[locale] || fallback;
      if (!item) continue;
      const localizedText = item.localized || {};
      documents.push(
        baseDocument({
          type: 'errata',
          locale,
          sourceId,
          title: `${item.cardId} ${item.cardName}`,
          subtitle: `ERRATA ${item.errataId}`,
          body: uniqueStrings([
            localizedText.incorrectText,
            localizedText.correctedText,
            localizedText.reason,
            localizedText.replacementPolicy,
            localizedText.usagePolicy,
          ]).join('\n'),
          aliases,
          tags: [item.pack, item.rarity, item.affectsName ? 'name' : '', item.affectsEffect ? 'effect' : ''],
          keywords: [item.cardId, item.cardNumber],
          relatedCardIds: [item.cardId],
          url: `/rules/errata/${encodeURIComponent(item.errataId)}`,
          pack: item.pack,
          rarity: item.rarity,
          sortNumber: Number(item.errataId) || 0,
          publishedAt: item.publishedAt,
          updatedAt: item.lastSyncedAt,
        }),
      );
    }
  }
  return documents;
}

function ruleAnchor(sectionId) {
  return `rule-${text(sectionId).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

function buildRuleSummaryDocuments(localized, fallback, documentId) {
  const aliases = uniqueStrings(
    Object.values(localized).flatMap((document) => [
      document.source?.title,
      document.source?.summary,
      document.localized?.title,
      document.localized?.summary,
    ]),
  );
  return KNOWLEDGE_SEARCH_LOCALES.flatMap((locale) => {
    const document = localized[locale] || fallback;
    if (!document) return [];
    return [
      baseDocument({
        type: 'rule',
        locale,
        sourceId: `${documentId}:__document__`,
        title: document.localized.title,
        body: document.localized.summary,
        aliases,
        tags: [documentId, 'document'],
        keywords: [document.id, document.version],
        url: `/rules/${documentId}`,
        documentId,
        sortNumber: -1,
        publishedAt: document.publishedAt,
        updatedAt: document.sourceCheckedAt,
      }),
    ];
  });
}

async function buildRuleDocuments(pool) {
  const documents = [];
  for (const documentId of ['grand', 'floor']) {
    const localized = {};
    await Promise.all(
      KNOWLEDGE_SEARCH_LOCALES.map(async (locale) => {
        const result = await getPublicRuleDocument({ pool, language: locale, documentId });
        if (result?.ok) localized[locale] = result.body.document;
      }),
    );
    const fallback = localized.ja || Object.values(localized)[0];
    if (!fallback) continue;
    documents.push(...buildRuleSummaryDocuments(localized, fallback, documentId));
    const sections = new Map();
    for (const [locale, document] of Object.entries(localized)) {
      for (const section of document.sections) {
        const group = sections.get(section.id) || {};
        group[locale] = section;
        sections.set(section.id, group);
      }
    }
    for (const [sourceId, sectionLocales] of sections) {
      const sectionFallback = sectionLocales.ja || Object.values(sectionLocales)[0];
      const aliases = uniqueStrings(
        Object.values(sectionLocales).flatMap((section) => [
          section.number,
          section.source?.title,
          section.source?.body,
          section.localized?.title,
          section.localized?.body,
        ]),
      );
      for (const locale of KNOWLEDGE_SEARCH_LOCALES) {
        const section = sectionLocales[locale] || sectionFallback;
        const document = localized[locale] || fallback;
        if (!section || !document) continue;
        documents.push(
          baseDocument({
            type: 'rule',
            locale,
            sourceId: `${documentId}:${sourceId}`,
            title: section.localized.title,
            subtitle: uniqueStrings([document.localized.title, section.number]).join(' · '),
            body: section.localized.body,
            aliases,
            tags: [documentId, section.number],
            keywords: [section.number],
            url: `/rules/${documentId}#${ruleAnchor(section.id)}`,
            documentId,
            sortNumber: Number(section.order) || 0,
            publishedAt: document.publishedAt,
            updatedAt: document.sourceCheckedAt,
          }),
        );
      }
    }
  }
  return documents;
}

async function buildDeckDocuments(pool, localizedCards) {
  const rows = (
    await pool.query(
      `SELECT ds.id, ds.name, ds.card_ids, ds.published_at, ds.updated_at,
              owner.nickname AS owner_nickname
         FROM deck_shares ds
         JOIN users owner ON owner.id = ds.owner_user_id
        WHERE ds.publication_status = 'published'
          AND ds.moderation_status = 'visible'
          AND ds.visibility = 'public'
        ORDER BY ds.id`,
    )
  ).rows;
  const documents = [];
  for (const row of rows) {
    const cardIds = stringArray(row.card_ids);
    const allCardNames = uniqueStrings(
      cardIds.flatMap((cardId) => Object.values(localizedCards.get(cardId) || {}).map((entry) => entry.name)),
    );
    for (const locale of KNOWLEDGE_SEARCH_LOCALES) {
      const cardNames = uniqueStrings(cardIds.map((cardId) => localizedCards.get(cardId)?.[locale]?.name));
      documents.push(
        baseDocument({
          type: 'deck',
          locale,
          sourceId: row.id,
          title: row.name,
          subtitle: row.owner_nickname,
          body: cardNames.join('\n'),
          aliases: [row.name, row.owner_nickname, ...cardIds, ...allCardNames],
          keywords: cardIds,
          relatedCardIds: cardIds,
          url: `/deck-shares/${encodeURIComponent(row.id)}`,
          publishedAt: row.published_at,
          updatedAt: row.updated_at,
        }),
      );
    }
  }
  return documents;
}

async function buildKnowledgeDocuments(pool) {
  const { documents: cardDocuments, localizedCards } = await buildCardDocuments(pool);
  const [qaDocuments, ruleDocuments, errataDocuments, deckDocuments] = await Promise.all([
    buildQaDocuments(pool),
    buildRuleDocuments(pool),
    buildErrataDocuments(pool),
    buildDeckDocuments(pool, localizedCards),
  ]);
  return [...cardDocuments, ...qaDocuments, ...ruleDocuments, ...errataDocuments, ...deckDocuments];
}

module.exports = {
  KNOWLEDGE_SEARCH_LOCALES,
  KNOWLEDGE_SEARCH_TYPES,
  baseDocument,
  buildCardDocuments,
  buildDeckDocuments,
  buildErrataDocuments,
  buildKnowledgeDocuments,
  buildQaDocuments,
  buildRuleDocuments,
  buildRuleSummaryDocuments,
  documentUid,
  publicCardText,
  ruleAnchor,
  uniqueStrings,
};
