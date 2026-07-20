import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import {
  BookOpenText,
  CheckCircle2,
  Circle,
  CircleDot,
  ExternalLink,
  Layers3,
  MoonStar,
  Play,
  ShieldCheck,
  Swords,
  Target,
} from 'lucide-react';
import { CardImage } from './CardImage';
import { TutorialBattlefieldPreview } from './TutorialBattlefieldPreview';
import {
  TUTORIAL_SHOWCASE_CARDS,
  TUTORIAL_SHOWCASE_CARD_TEXTS,
  type TutorialShowcaseCardId,
} from '../data/tutorialShowcaseCards';
import { getLocalizedCardEffect, getLocalizedCardName } from '../game/cards/i18n';
import type { CardDef } from '../game/types';
import { t, useLocale, type Locale, type TranslationKey } from '../i18n';
import { AppHeader, Badge, Button, PageShell, Panel } from '../ui';

const TUTORIAL_PROGRESS_KEY = 'zutomayo_tutorial_chapters_v3';
const TUTORIAL_EXPLORATION_KEY = 'zutomayo_tutorial_exploration_v1';
const OFFICIAL_START_GUIDE_URL = 'https://zutomayocard.net/start-guide/';

type ChapterId = 'overview' | 'cards' | 'field' | 'preparation' | 'flow';

const CHAPTERS: Array<{
  id: ChapterId;
  number: string;
  title: TranslationKey;
  subtitle: TranslationKey;
  Icon: typeof BookOpenText;
}> = [
  {
    id: 'overview',
    number: '01',
    title: 'tutorial.chapter.overview.title',
    subtitle: 'tutorial.chapter.overview.subtitle',
    Icon: BookOpenText,
  },
  {
    id: 'cards',
    number: '02',
    title: 'tutorial.chapter.cards.title',
    subtitle: 'tutorial.chapter.cards.subtitle',
    Icon: CircleDot,
  },
  {
    id: 'field',
    number: '03',
    title: 'tutorial.chapter.field.title',
    subtitle: 'tutorial.chapter.field.subtitle',
    Icon: Layers3,
  },
  {
    id: 'preparation',
    number: '04',
    title: 'tutorial.chapter.preparation.title',
    subtitle: 'tutorial.chapter.preparation.subtitle',
    Icon: ShieldCheck,
  },
  {
    id: 'flow',
    number: '05',
    title: 'tutorial.chapter.flow.title',
    subtitle: 'tutorial.chapter.flow.subtitle',
    Icon: Swords,
  },
];

function readCompletedChapters(): ChapterId[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(TUTORIAL_PROGRESS_KEY) || '[]');
    return Array.isArray(parsed)
      ? parsed.filter((value): value is ChapterId => CHAPTERS.some((c) => c.id === value))
      : [];
  } catch {
    return [];
  }
}

export function markTutorialChapterComplete(chapter: ChapterId) {
  const completed = new Set(readCompletedChapters());
  completed.add(chapter);
  localStorage.setItem(TUTORIAL_PROGRESS_KEY, JSON.stringify([...completed]));
}

function ChapterNavigation({
  active,
  completed,
  onSelect,
}: {
  active: ChapterId;
  completed: Set<ChapterId>;
  onSelect: (chapter: ChapterId) => void;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const activeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const list = listRef.current;
    const button = activeButtonRef.current;
    if (!list || !button || list.scrollWidth <= list.clientWidth || typeof list.scrollTo !== 'function') return;
    list.scrollTo({ left: button.offsetLeft - (list.clientWidth - button.clientWidth) / 2 });
  }, [active]);

  return (
    <nav aria-label={t('tutorial.hub.progress')} data-testid="tutorial-chapter-navigation">
      <ol
        ref={listRef}
        className="flex snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain pb-2 sm:grid sm:snap-none sm:grid-cols-2 sm:overflow-visible sm:pb-0 lg:grid-cols-3 xl:grid-cols-5"
        data-testid="tutorial-chapter-list"
      >
        {CHAPTERS.map(({ id, number, title, subtitle, Icon }) => {
          const isActive = active === id;
          const isComplete = completed.has(id);
          return (
            <li key={id} className="shrink-0 snap-start sm:shrink">
              <button
                ref={isActive ? activeButtonRef : undefined}
                type="button"
                className={`flex h-20 min-w-32 flex-col items-start gap-1.5 rounded-md border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--focus-ring-color] sm:h-full sm:min-h-28 sm:w-full sm:min-w-0 sm:gap-2 sm:p-4 ${
                  isActive
                    ? 'border-accent-primary/70 bg-accent-primary/10'
                    : 'border-border-soft bg-surface-base/55 hover:border-accent-primary/40 hover:bg-surface-base/80'
                }`}
                aria-current={isActive ? 'step' : undefined}
                data-testid={`tutorial-chapter-tab-${id}`}
                onClick={() => onSelect(id)}
              >
                <span className="flex w-full items-center justify-between gap-3">
                  <span className="font-mono text-caption text-accent-primary/75">CH.{number}</span>
                  {isComplete ? (
                    <>
                      <CheckCircle2 className="size-4 text-accent-success" aria-hidden="true" />
                      <span className="sr-only">{t('tutorial.hub.completed')}</span>
                    </>
                  ) : (
                    <Icon className="size-4 text-content-dim" aria-hidden="true" />
                  )}
                </span>
                <strong className="font-display text-body-sm text-content-primary sm:text-body-lg">{t(title)}</strong>
                <span className="hidden text-caption leading-relaxed text-content-muted sm:block">{t(subtitle)}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function getShowcaseCard(id: TutorialShowcaseCardId): CardDef {
  // 固定教學示例必須由審核過的定義驅動，不能被同 ID 的測試種子或不完整 API 資料覆蓋。
  return TUTORIAL_SHOWCASE_CARDS[id];
}

type CardHotspotId = 'type' | 'name' | 'element' | 'clock' | 'attack' | 'effect' | 'powerCost' | 'sendToPower';
type FieldZone = 'battle' | 'chronos' | 'set' | 'power' | 'deck' | 'abyss' | 'hp';

type TutorialExplorationState = {
  cardTypes: Set<TutorialShowcaseCardId>;
  cardFacts: Set<CardHotspotId>;
  fieldZones: Set<FieldZone>;
};

const EMPTY_EXPLORATION: TutorialExplorationState = {
  cardTypes: new Set(),
  cardFacts: new Set(),
  fieldZones: new Set(),
};

function readExploration(): TutorialExplorationState {
  try {
    const parsed = JSON.parse(localStorage.getItem(TUTORIAL_EXPLORATION_KEY) || '{}') as Record<string, unknown>;
    const cardTypes = Array.isArray(parsed.cardTypes)
      ? parsed.cardTypes.filter((value): value is TutorialShowcaseCardId => value in TUTORIAL_SHOWCASE_CARDS)
      : [];
    const factIds = new Set<CardHotspotId>([
      'type',
      'name',
      'element',
      'clock',
      'attack',
      'effect',
      'powerCost',
      'sendToPower',
    ]);
    const fieldIds = new Set<FieldZone>(['battle', 'chronos', 'set', 'power', 'deck', 'abyss', 'hp']);
    return {
      cardTypes: new Set(cardTypes),
      cardFacts: new Set(
        Array.isArray(parsed.cardFacts)
          ? parsed.cardFacts.filter((value): value is CardHotspotId => factIds.has(value as CardHotspotId))
          : [],
      ),
      fieldZones: new Set(
        Array.isArray(parsed.fieldZones)
          ? parsed.fieldZones.filter((value): value is FieldZone => fieldIds.has(value as FieldZone))
          : [],
      ),
    };
  } catch {
    return {
      cardTypes: new Set(EMPTY_EXPLORATION.cardTypes),
      cardFacts: new Set(EMPTY_EXPLORATION.cardFacts),
      fieldZones: new Set(EMPTY_EXPLORATION.fieldZones),
    };
  }
}

function writeExploration(state: TutorialExplorationState) {
  localStorage.setItem(
    TUTORIAL_EXPLORATION_KEY,
    JSON.stringify({
      version: 1,
      cardTypes: [...state.cardTypes],
      cardFacts: [...state.cardFacts],
      fieldZones: [...state.fieldZones],
    }),
  );
}

const CARD_HOTSPOTS: Array<{
  id: CardHotspotId;
  label: TranslationKey;
  left: string;
  top: string;
  width: string;
  height: string;
  cardTypes?: CardDef['type'][];
  characterGeometry?: Pick<CSSProperties, 'left' | 'top' | 'width' | 'height'>;
}> = [
  {
    id: 'type',
    label: 'tutorial.chapter.cards.fact.type.title',
    left: '79%',
    top: '85.7%',
    width: '28%',
    height: '8%',
  },
  {
    id: 'name',
    label: 'tutorial.chapter.cards.fact.name.title',
    left: '50%',
    top: '70.2%',
    width: '86%',
    height: '7%',
  },
  {
    id: 'element',
    label: 'tutorial.chapter.cards.fact.element.title',
    left: '90%',
    top: '9.5%',
    width: '13%',
    height: '11%',
  },
  {
    id: 'clock',
    label: 'tutorial.chapter.cards.fact.clock.title',
    left: '13.5%',
    top: '9.5%',
    width: '16%',
    height: '12%',
  },
  {
    id: 'attack',
    label: 'tutorial.chapter.cards.fact.attack.title',
    left: '35%',
    top: '78.7%',
    width: '55%',
    height: '6%',
    cardTypes: ['Character'],
  },
  {
    id: 'effect',
    label: 'tutorial.chapter.cards.fact.effect.title',
    left: '36.5%',
    top: '83%',
    width: '59%',
    height: '14%',
    characterGeometry: { left: '35%', top: '85.7%', width: '55%', height: '8%' },
  },
  {
    id: 'powerCost',
    label: 'tutorial.chapter.cards.fact.powerCost.title',
    left: '79%',
    top: '78.6%',
    width: '28%',
    height: '7%',
  },
  {
    id: 'sendToPower',
    label: 'tutorial.chapter.cards.fact.sendToPower.title',
    left: '94.5%',
    top: '55%',
    width: '9%',
    height: '23%',
  },
];

const CARD_ELEMENT_PROFILES = [
  {
    element: '闇',
    label: 'card.element.dark',
    src: '/tutorial/card-elements/darkness.png',
    description: 'tutorial.chapter.cards.fact.element.profile.dark',
  },
  {
    element: '炎',
    label: 'card.element.flame',
    src: '/tutorial/card-elements/flame.png',
    description: 'tutorial.chapter.cards.fact.element.profile.flame',
  },
  {
    element: '電気',
    label: 'card.element.electric',
    src: '/tutorial/card-elements/electric.png',
    description: 'tutorial.chapter.cards.fact.element.profile.electric',
  },
  {
    element: '風',
    label: 'card.element.wind',
    src: '/tutorial/card-elements/wind.png',
    description: 'tutorial.chapter.cards.fact.element.profile.wind',
  },
  {
    element: 'カオス',
    label: 'card.element.chaos',
    src: '/tutorial/card-elements/chaos.png',
    description: 'tutorial.chapter.cards.fact.element.profile.chaos',
  },
] as const satisfies ReadonlyArray<{
  element: CardDef['element'];
  label: TranslationKey;
  src: string;
  description: TranslationKey;
}>;

function formatCardFact(key: TranslationKey, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((text, [name, value]) => text.split(`{${name}}`).join(String(value)), t(key));
}

function getCardTypeLabel(card: CardDef): string {
  return t(
    card.type === 'Character'
      ? 'tutorial.chapter.cards.character.title'
      : card.type === 'Enchant'
        ? 'tutorial.chapter.cards.enchant.title'
        : 'tutorial.chapter.cards.area.title',
  );
}

function getCardTypeRule(card: CardDef): string {
  return t(
    card.type === 'Character'
      ? 'tutorial.chapter.cards.character.body'
      : card.type === 'Enchant'
        ? 'tutorial.chapter.cards.enchant.body'
        : 'tutorial.chapter.cards.area.body',
  );
}

function getCardElementLabel(card: CardDef): string {
  return t(
    card.element === '闇'
      ? 'card.element.dark'
      : card.element === '炎'
        ? 'card.element.flame'
        : card.element === '電気'
          ? 'card.element.electric'
          : card.element === '風'
            ? 'card.element.wind'
            : 'card.element.chaos',
  );
}

function getTutorialCardText(card: CardDef, locale: Locale): { name: string; effect: string } {
  const id = card.id as keyof typeof TUTORIAL_SHOWCASE_CARD_TEXTS;
  return (
    TUTORIAL_SHOWCASE_CARD_TEXTS[id]?.[locale] ?? {
      name: getLocalizedCardName(card, locale),
      effect: getLocalizedCardEffect(card, locale),
    }
  );
}

function getPrintedCardNumber(card: CardDef): string {
  const rawNumber = card.id.split('_').at(-1) ?? card.id;
  const numericNumber = Number.parseInt(rawNumber, 10);
  return Number.isFinite(numericNumber) ? `${String(numericNumber).padStart(3, '0')}/104` : rawNumber;
}

function getCardHotspotValue(card: CardDef, id: CardHotspotId, locale: Locale): string {
  switch (id) {
    case 'type':
      return `${getCardTypeLabel(card)} · ${getPrintedCardNumber(card)}`;
    case 'name':
      return getTutorialCardText(card, locale).name;
    case 'element':
      return getCardElementLabel(card);
    case 'clock':
      return String(card.clock);
    case 'attack':
      return card.attack ? `${card.attack.night} / ${card.attack.day}` : '—';
    case 'effect':
      return getTutorialCardText(card, locale).effect || t('tutorial.chapter.cards.fact.effect.empty');
    case 'powerCost':
      return String(card.powerCost);
    case 'sendToPower':
      return String(card.sendToPower);
  }
}

function getCardHotspotDescription(card: CardDef, id: CardHotspotId, locale: Locale): string {
  const localizedText = getTutorialCardText(card, locale);
  const name = localizedText.name;

  switch (id) {
    case 'type':
      return formatCardFact('tutorial.chapter.cards.fact.type.example', {
        printedType: card.type,
        type: getCardTypeLabel(card),
        number: getPrintedCardNumber(card),
        pack: card.pack,
        typeRule: getCardTypeRule(card),
      });
    case 'name':
      return formatCardFact('tutorial.chapter.cards.fact.name.example', { name });
    case 'element':
      return formatCardFact('tutorial.chapter.cards.fact.element.example', { element: getCardElementLabel(card) });
    case 'clock':
      return formatCardFact('tutorial.chapter.cards.fact.clock.example', { clock: card.clock });
    case 'attack':
      return formatCardFact('tutorial.chapter.cards.fact.attack.example', {
        night: card.attack?.night ?? 0,
        day: card.attack?.day ?? 0,
      });
    case 'effect':
      return t(
        card.type === 'Character'
          ? 'tutorial.chapter.cards.fact.effect.example'
          : card.type === 'Enchant'
            ? 'tutorial.chapter.cards.fact.effect.enchantExample'
            : 'tutorial.chapter.cards.fact.effect.areaExample',
      );
    case 'powerCost':
      return formatCardFact(
        card.powerCost === 0
          ? 'tutorial.chapter.cards.fact.powerCost.zeroExample'
          : card.type === 'Character'
            ? 'tutorial.chapter.cards.fact.powerCost.characterExample'
            : 'tutorial.chapter.cards.fact.powerCost.otherExample',
        { cost: card.powerCost },
      );
    case 'sendToPower':
      return formatCardFact(
        card.sendToPower === 0
          ? 'tutorial.chapter.cards.fact.sendToPower.zeroExample'
          : 'tutorial.chapter.cards.fact.sendToPower.example',
        { power: card.sendToPower },
      );
  }
}

function splitCardFactParagraphs(description: string): string[] {
  return (description.match(/[^。！？.!?]+[。！？.!?]+|[^。！？.!?]+$/gu) ?? [description])
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function splitFieldDescriptionParagraphs(description: string): string[] {
  return (description.match(/[^。！？.!?；;]+[。！？.!?；;]+|[^。！？.!?；;]+$/gu) ?? [description])
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function CardsChapter({
  onExploreCardType,
  onExploreFact,
}: {
  onExploreCardType: (id: TutorialShowcaseCardId) => void;
  onExploreFact: (id: CardHotspotId) => void;
}) {
  const cardTypes = [
    ['2nd_40', 'tutorial.chapter.cards.character.title'],
    ['1st_100', 'tutorial.chapter.cards.enchant.title'],
    ['2nd_86', 'tutorial.chapter.cards.area.title'],
  ] as const;
  const locale = useLocale();
  const [selectedId, setSelectedId] = useState<TutorialShowcaseCardId>('2nd_40');
  const [selectedHotspot, setSelectedHotspot] = useState<CardHotspotId>('type');
  const factDetailRef = useRef<HTMLDivElement>(null);
  const selectedCard = getShowcaseCard(selectedId);
  const selectedCardType = cardTypes.find(([id]) => id === selectedId);
  const selectedCardText = getTutorialCardText(selectedCard, locale);
  const availableHotspots = CARD_HOTSPOTS.filter(
    ({ cardTypes: supportedTypes }) => !supportedTypes || supportedTypes.includes(selectedCard.type),
  );
  const selectedHotspotData = availableHotspots.find(({ id }) => id === selectedHotspot) ?? availableHotspots[0];
  const selectedHotspotParagraphs = splitCardFactParagraphs(
    getCardHotspotDescription(selectedCard, selectedHotspotData.id, locale),
  );
  const selectCard = (id: TutorialShowcaseCardId) => {
    setSelectedId(id);
    setSelectedHotspot('type');
    onExploreCardType(id);
    onExploreFact('type');
  };
  const selectHotspot = (id: CardHotspotId) => {
    setSelectedHotspot(id);
    onExploreFact(id);
    window.requestAnimationFrame(() => {
      const detail = factDetailRef.current;
      if (!detail || window.innerWidth >= 1024) return;
      const rect = detail.getBoundingClientRect();
      if (rect.top >= 0 && rect.top < window.innerHeight * 0.72) return;
      detail.scrollIntoView({
        block: 'start',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      });
    });
  };

  const handleCardTypeKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (index + 1) % cardTypes.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (index - 1 + cardTypes.length) % cardTypes.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = cardTypes.length - 1;
    }

    if (nextIndex === null) return;

    event.preventDefault();
    const nextId = cardTypes[nextIndex][0];
    selectCard(nextId);
    document.getElementById(`tutorial-card-tab-${nextId}`)?.focus();
  };

  return (
    <div className="grid gap-5">
      <p className="text-body-sm text-content-muted">{t('tutorial.chapter.cards.interaction')}</p>
      <div className="grid grid-cols-3 gap-2" role="tablist" aria-label={t('tutorial.chapter.cards.title')}>
        {cardTypes.map(([id, title], index) => {
          const isSelected = selectedId === id;
          return (
            <button
              type="button"
              key={id}
              id={`tutorial-card-tab-${id}`}
              role="tab"
              aria-selected={isSelected}
              aria-controls="tutorial-card-panel"
              tabIndex={isSelected ? 0 : -1}
              data-testid={`tutorial-card-selector-${id}`}
              onClick={() => selectCard(id)}
              onKeyDown={(event) => handleCardTypeKeyDown(event, index)}
              className={`min-h-12 rounded-sm border px-3 py-2 text-center text-body-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--focus-ring-color] sm:min-h-14 sm:text-body ${
                isSelected
                  ? 'border-accent-primary/75 bg-accent-primary/10 text-content-primary'
                  : 'border-border-soft bg-surface-base/40 text-content-muted hover:border-accent-primary/50 hover:text-content-primary'
              }`}
            >
              {t(title)}
            </button>
          );
        })}
      </div>
      <div
        id="tutorial-card-panel"
        role="tabpanel"
        aria-labelledby={`tutorial-card-tab-${selectedId}`}
        className="grid gap-5 rounded-sm border border-border-soft bg-surface-canvas/35 p-4 lg:grid-cols-[minmax(15rem,0.55fr)_minmax(0,1fr)]"
      >
        <div className="mx-auto w-full max-w-72">
          <div
            className="relative aspect-[5/7] w-full"
            role="group"
            aria-label={t('tutorial.chapter.cards.hotspotsLabel')}
            data-testid="tutorial-card-hotspot-map"
          >
            <CardImage
              src={selectedCard.image}
              alt={`${t(selectedCardType?.[1] ?? 'tutorial.chapter.cards.character.title')} — ${selectedCardText.name}`}
              context="detail"
              className="h-full w-full rounded-sm object-cover shadow-floating"
              data-testid="tutorial-card-example"
            />
            {availableHotspots.map((hotspot) => {
              const isSelected = selectedHotspot === hotspot.id;
              const geometry =
                selectedCard.type === 'Character' && hotspot.characterGeometry
                  ? hotspot.characterGeometry
                  : {
                      left: hotspot.left,
                      top: hotspot.top,
                      width: hotspot.width,
                      height: hotspot.height,
                    };
              return (
                <button
                  key={hotspot.id}
                  type="button"
                  aria-label={`${t(hotspot.label)}: ${getCardHotspotValue(selectedCard, hotspot.id, locale)}`}
                  aria-pressed={isSelected}
                  aria-controls="tutorial-card-fact-detail"
                  data-testid={`tutorial-card-hotspot-${hotspot.id}`}
                  data-marker-style="contrast-frame"
                  onClick={() => selectHotspot(hotspot.id)}
                  style={geometry}
                  className={`group absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-[2px] border-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--focus-ring-color] ${
                    isSelected
                      ? 'border-accent-primary shadow-[0_0_0_2px_rgba(8,8,8,0.95),0_0_0_4px_rgba(255,255,255,0.95),0_0_16px_rgba(216,177,89,0.9)]'
                      : 'border-white/90 shadow-[0_0_0_1px_rgba(8,8,8,0.95)] hover:border-accent-primary hover:shadow-[0_0_0_2px_rgba(8,8,8,0.95),0_0_0_4px_rgba(255,255,255,0.9)]'
                  }`}
                />
              );
            })}
          </div>
        </div>
        <div className="grid content-start gap-4">
          <div>
            <h3 className="font-display text-title-sm font-bold text-content-primary">
              {t(selectedCardType?.[1] ?? 'tutorial.chapter.cards.character.title')}
            </h3>
          </div>
          <div
            className="order-2 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:order-1"
            role="group"
            aria-label={t('tutorial.chapter.cards.hotspotsLabel')}
          >
            {availableHotspots.map((hotspot) => {
              const isSelected = selectedHotspot === hotspot.id;
              return (
                <button
                  key={hotspot.id}
                  type="button"
                  aria-pressed={isSelected}
                  aria-controls="tutorial-card-fact-detail"
                  data-testid={`tutorial-card-fact-${hotspot.id}`}
                  onClick={() => selectHotspot(hotspot.id)}
                  className={`grid min-h-12 content-center rounded-sm border px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--focus-ring-color] ${
                    isSelected
                      ? 'border-accent-primary/70 bg-accent-primary/10'
                      : 'border-border-soft bg-surface-base/40 hover:border-accent-primary/45'
                  }`}
                >
                  <span className="line-clamp-2 text-caption font-semibold leading-tight text-content-primary">
                    {t(hotspot.label)}
                  </span>
                </button>
              );
            })}
          </div>
          <div
            ref={factDetailRef}
            id="tutorial-card-fact-detail"
            aria-live="polite"
            className="order-1 scroll-mt-24 border-l-2 border-accent-primary/55 bg-surface-base/40 p-4 lg:order-2"
          >
            <p className="font-display text-body-lg font-bold text-content-primary">{t(selectedHotspotData.label)}</p>
            <div className="mt-2 grid gap-2">
              {selectedHotspotParagraphs.map((paragraph, index) => (
                <p
                  key={`${selectedHotspotData.id}-${index}`}
                  className="text-body-sm leading-relaxed text-content-muted"
                >
                  {paragraph}
                </p>
              ))}
            </div>
            {selectedHotspotData.id === 'element' ? (
              <div className="mt-4">
                <p className="text-caption font-semibold text-content-primary">
                  {t('tutorial.chapter.cards.fact.element.profilesLabel')}
                </p>
                <p className="mt-1 text-caption leading-relaxed text-content-dim">
                  {t('tutorial.chapter.cards.fact.element.profilesNote')}
                </p>
                <dl
                  className="mt-2 divide-y divide-border-soft/60"
                  aria-label={t('tutorial.chapter.cards.elementsLabel')}
                >
                  {CARD_ELEMENT_PROFILES.map((item) => {
                    const isCurrent = selectedCard.element === item.element;
                    return (
                      <div key={item.element} className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-3 py-2">
                        <dt
                          className={`flex items-center gap-2 text-body-sm font-semibold ${
                            isCurrent ? 'text-accent-primary' : 'text-content-primary'
                          }`}
                        >
                          <img
                            src={item.src}
                            alt=""
                            aria-hidden="true"
                            loading="lazy"
                            className={`size-7 shrink-0 object-contain transition ${
                              isCurrent ? 'scale-105 opacity-100' : 'opacity-75'
                            }`}
                          />
                          <span>{t(item.label)}</span>
                        </dt>
                        <dd className="text-body-sm leading-relaxed text-content-muted">{t(item.description)}</dd>
                      </div>
                    );
                  })}
                </dl>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

const FIELD_ZONES = [
  ['battle', 'tutorial.game.zone.battle.title', 'tutorial.game.zone.battle.body', 'border-accent-action/55'],
  ['chronos', 'tutorial.game.chronos.title', 'tutorial.game.chronos.body', 'border-time-night/55'],
  ['set', 'tutorial.game.zone.set.title', 'tutorial.game.zone.set.body', 'border-accent-primary/55'],
  ['power', 'tutorial.game.resources.title', 'tutorial.game.resources.body', 'border-time-day/55'],
  ['deck', 'tutorial.chapter.field.deck', 'tutorial.game.zone.deck.body', 'border-content-dim/55'],
  ['abyss', 'tutorial.game.zone.abyss.title', 'tutorial.game.zone.abyss.body', 'border-content-dim/55'],
  ['hp', 'tutorial.game.zone.hp.title', 'tutorial.game.zone.hp.body', 'border-accent-action/55'],
] as const;

function FieldChapter({
  exploration,
  onExploreZone,
}: {
  exploration: TutorialExplorationState;
  onExploreZone: (zone: FieldZone) => void;
}) {
  const [selectedZone, setSelectedZone] = useState<FieldZone>('battle');
  const selected = FIELD_ZONES.find(([id]) => id === selectedZone) ?? FIELD_ZONES[0];
  const selectedDescriptionParagraphs = splitFieldDescriptionParagraphs(t(selected[2]));
  const selectZone = (zone: FieldZone) => {
    setSelectedZone(zone);
    onExploreZone(zone);
  };

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body-sm text-content-muted">{t('tutorial.chapter.field.interaction')}</p>
        <Badge tone="gold">
          {exploration.fieldZones.size} / {FIELD_ZONES.length}
        </Badge>
      </div>
      <TutorialBattlefieldPreview
        selectedZone={selectedZone}
        exploredZones={exploration.fieldZones}
        onSelectZone={selectZone}
      />
      <details
        className={`rounded-sm border-l-2 ${selected[3]} bg-surface-base/55 p-4 md:hidden`}
        data-testid="tutorial-field-context"
        aria-live="polite"
        open
      >
        <summary className="cursor-pointer font-semibold text-content-primary">{t(selected[1])}</summary>
        <p className="mt-2 text-body-sm leading-relaxed text-content-muted">{selectedDescriptionParagraphs[0]}</p>
      </details>
      <section className={`rounded-sm border-l-2 ${selected[3]} bg-surface-base/40 p-4`} aria-live="polite">
        <p className="font-mono text-caption uppercase tracking-[var(--tracking-label)] text-accent-primary">
          {t(selected[1])}
        </p>
        <div className="mt-2 grid gap-2" data-testid="tutorial-field-description">
          {selectedDescriptionParagraphs.map((paragraph, index) => (
            <p key={`${selectedZone}-${index}`} className="text-body leading-relaxed text-content-muted">
              {paragraph}
            </p>
          ))}
        </div>
      </section>
    </div>
  );
}

function NumberedSteps({ keys }: { keys: TranslationKey[] }) {
  return (
    <ol className="grid gap-3">
      {keys.map((key, index) => (
        <li key={key} className="flex gap-4 rounded-sm border border-border-soft bg-surface-base/40 p-4">
          <span className="grid size-8 shrink-0 place-items-center rounded-full border border-accent-primary/50 font-mono text-caption text-accent-primary">
            {index + 1}
          </span>
          <p className="pt-1 text-body leading-relaxed text-content-muted">{t(key)}</p>
        </li>
      ))}
    </ol>
  );
}

function OverviewChapter() {
  return (
    <section aria-label={t('tutorial.chapter.overview.title')} className="grid gap-8 md:grid-cols-2">
      <OverviewConcept Icon={Swords} title="tutorial.chapter.overview.objective.title">
        <p>{t('tutorial.chapter.overview.objective.body')}</p>
      </OverviewConcept>
      <OverviewConcept Icon={Target} title="tutorial.chapter.overview.turn.title">
        <p>{t('tutorial.chapter.overview.turn.body')}</p>
      </OverviewConcept>
      <OverviewConcept Icon={Layers3} title="tutorial.chapter.deckPreparation.title">
        <p data-testid="tutorial-deck-rules">{t('tutorial.chapter.deckPreparation.interaction')}</p>
      </OverviewConcept>
      <OverviewConcept Icon={MoonStar} title="tutorial.chapter.overview.nightDay.title">
        <p>{t('tutorial.chapter.overview.nightDay.body')}</p>
      </OverviewConcept>
    </section>
  );
}

function OverviewConcept({
  Icon,
  title,
  children,
}: {
  Icon: typeof Swords;
  title: TranslationKey;
  children: ReactNode;
}) {
  return (
    <article className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-4">
      <span className="grid size-10 place-items-center border border-accent-primary/35 text-accent-primary">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <h3 className="font-display text-body-lg font-bold text-content-primary">{t(title)}</h3>
        <div className="mt-3 text-body-sm leading-relaxed text-content-muted">{children}</div>
      </div>
    </article>
  );
}

function BattlePreparationChapter() {
  return (
    <NumberedSteps
      keys={[
        'tutorial.chapter.preparation.side',
        'tutorial.chapter.preparation.opening',
        'tutorial.chapter.preparation.mulligan',
        'tutorial.chapter.preparation.initial',
      ]}
    />
  );
}

function FlowChapter() {
  return (
    <div className="grid gap-6" data-testid="tutorial-flow-chapter">
      <section
        className="grid gap-3 rounded-sm border border-accent-primary/35 bg-accent-primary/5 p-4 sm:p-5"
        data-testid="tutorial-flow-first-turn"
      >
        <h3 className="font-display text-body-lg font-bold text-content-primary">
          {t('tutorial.chapter.flow.firstTurn.title')}
        </h3>
        <p className="text-body-sm leading-relaxed text-content-muted">{t('tutorial.chapter.flow.firstTurn.body')}</p>
      </section>

      <section className="grid gap-3" data-testid="tutorial-flow-following-turns">
        <h3 className="font-display text-body-lg font-bold text-content-primary">
          {t('tutorial.chapter.flow.followingTurns.title')}
        </h3>
        <NumberedSteps
          keys={[
            'tutorial.chapter.flow.set',
            'tutorial.chapter.flow.reveal',
            'tutorial.chapter.flow.clock',
            'tutorial.chapter.flow.effects',
            'tutorial.chapter.flow.battle',
            'tutorial.chapter.flow.draw',
          ]}
        />
      </section>

      <div className="rounded-sm border border-accent-action/35 bg-accent-action/5 p-4">
        <h3 className="font-display text-body-lg font-bold text-content-primary">{t('tutorial.game.victory.title')}</h3>
        <p className="mt-2 text-body-sm leading-relaxed text-content-muted">{t('tutorial.game.victory.body')}</p>
      </div>
    </div>
  );
}

export function TutorialChapterHub({
  onStartBattle,
  onExit,
  initialChapter,
}: {
  onStartBattle: (chapter: 'preparation' | 'flow') => void;
  onExit: () => void;
  initialChapter?: ChapterId;
}) {
  const [activeChapter, setActiveChapter] = useState<ChapterId>(() => {
    if (initialChapter) return initialChapter;
    const completed = new Set(readCompletedChapters());
    return CHAPTERS.find((chapter) => !completed.has(chapter.id))?.id || 'flow';
  });
  const [completed, setCompleted] = useState(() => new Set(readCompletedChapters()));
  const [exploration, setExploration] = useState<TutorialExplorationState>(() => readExploration());
  const panelHeadingRef = useRef<HTMLDivElement>(null);
  const hasSelectedChapterRef = useRef(false);
  const activeIndex = CHAPTERS.findIndex((chapter) => chapter.id === activeChapter);
  const active = CHAPTERS[activeIndex];

  const requiredCardFacts = new Set<CardHotspotId>(['type', 'clock', 'powerCost', 'sendToPower', 'effect']);
  const missingCardTypes = Math.max(0, 3 - exploration.cardTypes.size);
  const missingCardFacts = [...requiredCardFacts].filter((id) => !exploration.cardFacts.has(id)).length;
  const missingFieldZones = Math.max(0, FIELD_ZONES.length - exploration.fieldZones.size);
  const canCompleteActive =
    activeChapter === 'cards'
      ? missingCardTypes === 0 && missingCardFacts === 0
      : activeChapter === 'field'
        ? missingFieldZones === 0
        : true;

  const updateExploration = (update: (current: TutorialExplorationState) => TutorialExplorationState) => {
    setExploration((current) => {
      const next = update(current);
      writeExploration(next);
      return next;
    });
  };

  useEffect(() => {
    if (activeChapter !== 'cards' && activeChapter !== 'field') return;
    setExploration((current) => {
      if (activeChapter === 'cards' && current.cardTypes.has('2nd_40') && current.cardFacts.has('type')) {
        return current;
      }
      if (activeChapter === 'field' && current.fieldZones.has('battle')) return current;
      const next =
        activeChapter === 'cards'
          ? {
              ...current,
              cardTypes: new Set(current.cardTypes).add('2nd_40' as TutorialShowcaseCardId),
              cardFacts: new Set(current.cardFacts).add('type' as CardHotspotId),
            }
          : { ...current, fieldZones: new Set(current.fieldZones).add('battle' as FieldZone) };
      writeExploration(next);
      return next;
    });
  }, [activeChapter]);

  const selectChapter = (chapter: ChapterId) => {
    hasSelectedChapterRef.current = true;
    setActiveChapter(chapter);
  };

  useEffect(() => {
    if (!hasSelectedChapterRef.current) return;
    window.requestAnimationFrame(() => {
      panelHeadingRef.current?.scrollIntoView({
        block: 'start',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      });
    });
  }, [activeChapter]);

  const completeAndContinue = () => {
    if (!canCompleteActive) return;
    markTutorialChapterComplete(activeChapter);
    setCompleted(new Set(readCompletedChapters()));
    const next = CHAPTERS[activeIndex + 1];
    if (next) selectChapter(next.id);
  };

  return (
    <PageShell variant="scroll" glow={{ color: 'gold', size: 'md' }}>
      <AppHeader title={t('tutorial.hub.title')} subtitle={t('tutorial.hub.subtitle')} backTo="/" />
      <main className="relative z-[var(--z-dropdown)] px-4 pb-12 pt-20 md:pt-24">
        <div className="mx-auto grid w-full max-w-6xl gap-5">
          <header className="grid gap-3 pt-3">
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone="gold">
                {completed.size} / {CHAPTERS.length}
              </Badge>
              <span className="text-caption text-content-muted">{t('tutorial.hub.progress')}</span>
            </div>
            <h1 className="font-display text-title-lg font-bold text-content-primary">{t('tutorial.hub.title')}</h1>
            <p className="max-w-3xl text-body leading-relaxed text-content-muted">{t('tutorial.hub.body')}</p>
          </header>

          <ChapterNavigation active={activeChapter} completed={completed} onSelect={selectChapter} />

          <Panel size="lg">
            <div
              ref={panelHeadingRef}
              className="mb-6 flex scroll-mt-24 flex-wrap items-start justify-between gap-3 border-b border-border-soft pb-5"
            >
              <div>
                <p className="font-mono text-caption text-accent-primary">CH.{active.number}</p>
                <h2 className="mt-2 font-display text-title-md font-bold">{t(active.title)}</h2>
                <p className="mt-2 text-body text-content-muted">{t(active.subtitle)}</p>
              </div>
              {completed.has(activeChapter) ? (
                <Badge tone="jade" className="gap-1">
                  <CheckCircle2 className="size-3" aria-hidden="true" /> {t('tutorial.hub.completed')}
                </Badge>
              ) : (
                <Badge tone="neutral" className="gap-1">
                  <Circle className="size-3" aria-hidden="true" /> {t('tutorial.hub.notCompleted')}
                </Badge>
              )}
            </div>

            {activeChapter === 'overview' && <OverviewChapter />}
            {activeChapter === 'cards' && (
              <CardsChapter
                onExploreCardType={(id) =>
                  updateExploration((current) => ({ ...current, cardTypes: new Set(current.cardTypes).add(id) }))
                }
                onExploreFact={(id) =>
                  updateExploration((current) => ({ ...current, cardFacts: new Set(current.cardFacts).add(id) }))
                }
              />
            )}
            {activeChapter === 'field' && (
              <FieldChapter
                exploration={exploration}
                onExploreZone={(zone) =>
                  updateExploration((current) => ({ ...current, fieldZones: new Set(current.fieldZones).add(zone) }))
                }
              />
            )}
            {activeChapter === 'preparation' && <BattlePreparationChapter />}
            {activeChapter === 'flow' && <FlowChapter />}

            <div className="mt-7 flex flex-col-reverse gap-3 border-t border-border-soft pt-5 sm:flex-row sm:items-center sm:justify-between">
              <a
                className="inline-flex min-h-11 items-center gap-2 text-control text-content-muted underline-offset-4 hover:text-accent-primary hover:underline"
                href={OFFICIAL_START_GUIDE_URL}
                target="_blank"
                rel="noreferrer"
              >
                {t('tutorial.hub.officialGuide')}
                <ExternalLink className="size-4" aria-hidden="true" />
              </a>
              <div className="flex flex-col gap-2 sm:flex-row">
                {activeChapter === 'preparation' || activeChapter === 'flow' ? (
                  <Button
                    variant="primary"
                    leftIcon={<Play className="size-4" aria-hidden="true" />}
                    onClick={() => {
                      onStartBattle(activeChapter);
                    }}
                  >
                    {t(activeChapter === 'preparation' ? 'tutorial.hub.startPreparation' : 'tutorial.hub.startBattle')}
                  </Button>
                ) : (
                  <Button variant="primary" onClick={completeAndContinue} disabled={!canCompleteActive}>
                    {t('tutorial.hub.nextChapter')}
                  </Button>
                )}
                <Button variant="ghost" onClick={onExit}>
                  {t('common.backToLobby')}
                </Button>
              </div>
            </div>
            {!canCompleteActive && activeChapter === 'cards' && (
              <p className="mt-3 text-right text-caption text-content-muted" role="status">
                {t('tutorial.hub.cardsRemaining')} {missingCardTypes} / {missingCardFacts}
              </p>
            )}
            {!canCompleteActive && activeChapter === 'field' && (
              <p className="mt-3 text-right text-caption text-content-muted" role="status">
                {t('tutorial.hub.fieldRemaining')} {missingFieldZones}
              </p>
            )}
          </Panel>
        </div>
      </main>
    </PageShell>
  );
}
