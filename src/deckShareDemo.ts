import type { DeckShareDetail, DeckSharePage, DeckShareSort } from './api/client';
import { translate, type Locale, type TranslationKey } from './i18n';
import { APP_VERSION_INFO } from './version';

export const LOCAL_DECK_SHARE_DEMO_ID = 'local-preview-chronos-tempo';

interface LocalDeckShareDemoDefinition {
  id: string;
  nameKey: TranslationKey;
  elements: string[];
  characterCount: number;
  representativeCardIds: string[];
  uniqueCardIds: string[];
  likeCount: number;
  copyCount: number;
  ageHours: number;
}

const LOCAL_DEMO_DEFINITIONS: LocalDeckShareDemoDefinition[] = [
  {
    id: LOCAL_DECK_SHARE_DEMO_ID,
    nameKey: 'deckShare.demoName',
    elements: ['炎', '風'],
    characterCount: 12,
    representativeCardIds: ['1st_14', '1st_22', '1st_28'],
    uniqueCardIds: [
      '1st_13',
      '1st_14',
      '1st_15',
      '1st_21',
      '1st_22',
      '1st_23',
      '1st_28',
      '1st_31',
      '1st_32',
      '1st_100',
    ],
    likeCount: 32,
    copyCount: 14,
    ageHours: 1,
  },
  {
    id: 'local-preview-dark-electric-control',
    nameKey: 'deckShare.demoNameDarkElectric',
    elements: ['闇', '電気'],
    characterCount: 14,
    representativeCardIds: ['1st_11', '1st_18', '1st_29'],
    uniqueCardIds: ['1st_1', '1st_10', '1st_11', '1st_33', '1st_34', '1st_17', '1st_18', '1st_25', '1st_29', '1st_59'],
    likeCount: 47,
    copyCount: 9,
    ageHours: 5,
  },
  {
    id: 'local-preview-flame-rush',
    nameKey: 'deckShare.demoNameFire',
    elements: ['炎'],
    characterCount: 12,
    representativeCardIds: ['1st_105', '1st_40', '1st_57'],
    uniqueCardIds: [
      '1st_105',
      '1st_38',
      '1st_39',
      '1st_40',
      '1st_41',
      '1st_42',
      '1st_27',
      '1st_56',
      '1st_57',
      '1st_58',
    ],
    likeCount: 18,
    copyCount: 27,
    ageHours: 26,
  },
  {
    id: 'local-preview-chaos-wind-toolbox',
    nameKey: 'deckShare.demoNameChaosWind',
    elements: ['カオス', '風'],
    characterCount: 14,
    representativeCardIds: ['4th_27', '1st_49', '1st_101'],
    uniqueCardIds: [
      '4th_27',
      '4th_28',
      '4th_6',
      '4th_88',
      '1st_48',
      '1st_49',
      '1st_50',
      '1st_100',
      '1st_101',
      '1st_102',
    ],
    likeCount: 24,
    copyCount: 19,
    ageHours: 74,
  },
];

export function isLocalDeckShareDemo(shareId: string): boolean {
  return LOCAL_DEMO_DEFINITIONS.some((demo) => demo.id === shareId);
}

export function shouldUseLocalDeckShareDemo(): boolean {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false;
  return window.localStorage.getItem('zutomayo_deck_share_demo_disabled') !== 'true';
}

function createLocalDeckShareDemo(definition: LocalDeckShareDemoDefinition, locale: Locale): DeckShareDetail {
  const timestamp = new Date(Date.now() - definition.ageHours * 60 * 60 * 1000).toISOString();
  return {
    id: definition.id,
    name: translate(locale, definition.nameKey),
    visibility: 'public',
    publicationStatus: 'published',
    moderationStatus: 'visible',
    publishedRulesVersion: APP_VERSION_INFO.rulesVersion,
    publishedAt: timestamp,
    updatedAt: timestamp,
    owner: {
      userId: 'local-preview',
      nickname: translate(locale, 'deckShare.demoAuthor'),
    },
    elements: [...definition.elements],
    characterCount: definition.characterCount,
    representativeCardIds: [...definition.representativeCardIds],
    likeCount: definition.likeCount,
    copyCount: definition.copyCount,
    viewerHasLiked: false,
    cardIds: definition.uniqueCardIds.flatMap((cardId) => [cardId, cardId]),
  };
}

export function getLocalDeckShareDemos(locale: Locale): DeckShareDetail[] {
  return LOCAL_DEMO_DEFINITIONS.map((definition) => createLocalDeckShareDemo(definition, locale));
}

export function getLocalDeckShareDemo(shareId: string, locale: Locale): DeckShareDetail | null {
  const definition = LOCAL_DEMO_DEFINITIONS.find((demo) => demo.id === shareId);
  return definition ? createLocalDeckShareDemo(definition, locale) : null;
}

export function getLocalDeckShareDemoPage(
  locale: Locale,
  filters: { q?: string; element?: string; sort?: DeckShareSort } = {},
): DeckSharePage {
  const demos = getLocalDeckShareDemos(locale);
  const needle = filters.q?.trim().toLocaleLowerCase(locale) ?? '';
  const shares = demos.filter((demo) => {
    const matchesQuery =
      !needle ||
      [demo.name, demo.owner.nickname, ...demo.elements].join('\n').toLocaleLowerCase(locale).includes(needle);
    return matchesQuery && (!filters.element || demo.elements.includes(filters.element));
  });

  if (filters.sort === 'popular') shares.sort((a, b) => b.likeCount - a.likeCount);
  else if (filters.sort === 'most-copied') shares.sort((a, b) => b.copyCount - a.copyCount);
  else shares.sort((a, b) => Date.parse(b.updatedAt ?? '') - Date.parse(a.updatedAt ?? ''));

  return {
    shares,
    nextCursor: null,
  };
}
