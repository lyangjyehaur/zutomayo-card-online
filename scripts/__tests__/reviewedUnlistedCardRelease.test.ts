import { describe, expect, it } from 'vitest';
import {
  buildReviewedUnlistedRelease,
  REVIEWED_UNLISTED_LANGS,
  REVIEWED_UNLISTED_SOURCE_NOTE,
  type ReviewedUnlistedReleaseManifest,
} from '../reviewedUnlistedCardRelease';

const candidates = [
  { candidateId: '4th_105', cardId: '4th_105', playStatus: 'playable' },
  { candidateId: 'limited_001', cardId: 'bonus_001', playStatus: 'playable' },
  { candidateId: 'limited_013', cardId: 'collaboration_007', playStatus: 'display_only' },
] as const;

const sourceCards = candidates.map(({ candidateId, cardId }) => ({
  candidateId,
  expectedCardId: candidateId === cardId ? cardId : '',
  catalogStatus: candidateId.startsWith('4th_') ? 'pending_listing' : 'unlisted',
  distributionType: candidateId.startsWith('4th_') ? 'standard' : 'collaboration',
  sourcePageUrl: 'https://example.com/review',
  sourceSha256: 'a'.repeat(64),
}));

function completeTranslations(cardId: string) {
  return Object.fromEntries(
    REVIEWED_UNLISTED_LANGS.map((lang) => [lang, { name: `${cardId} ${lang}`, effect: `effect ${lang}` }]),
  );
}

function inputs() {
  const reviews = {
    '4th_105': {
      cardId: '4th_105',
      nameJa: 'CHIRITORI-OTOKO DA!!',
      nameEnOfficial: 'CHIRITORI-OTOKO DA!!',
      effectJa:
        'アビスのカードを8枚選び、裏向きにして混ぜ、デッキの底に置く。そうしない場合、ゲームに敗北する。お互いのパワーチャージャーのカードをすべてアビスに置く。',
      effectEnOfficial: 'Official effect',
      printedEffectStatus: 'present',
      playStatus: 'playable',
      playStatusReason: '',
      type: 'Character',
      rarity: 'SE',
      element: 'カオス',
      clock: '0',
      powerCost: '0',
      sendToPower: '0',
      attackNight: '0',
      attackDay: '250',
      song: '',
      illustrator: 'reviewed illustrator',
      pack: 'Fantasy Is Reality',
      imageReviewStatus: 'approved',
      textReviewStatus: 'verified',
      reviewedAt: '2026-07-30T00:00:00.000Z',
    },
    limited_001: {
      cardId: 'bonus_001',
      nameJa: '正しい偽りからの起床',
      nameEnOfficial: 'Tadashii Itsuwarikara no Kishou',
      effectJa: '相手のキャラクターカードの属性をバトルフィールドにいる間闇にする',
      effectEnOfficial: "The attribute of your opponent's character card changes to darkness.",
      printedEffectStatus: 'present',
      playStatus: 'playable',
      playStatusReason: '',
      type: 'Enchant',
      rarity: 'SR',
      element: '電気',
      clock: '0',
      powerCost: '3',
      sendToPower: '1',
      attackNight: '',
      attackDay: '',
      song: '',
      illustrator: 'reviewed illustrator',
      pack: 'ALL ALONG THE WATCHTOWER',
      imageReviewStatus: 'approved',
      textReviewStatus: 'verified',
      reviewedAt: '2026-07-30T00:00:00.000Z',
    },
    limited_013: {
      cardId: 'collaboration_007',
      nameJa: '仲間のドクロ',
      nameEnOfficial: 'Nakamano Dokuro',
      effectJa: '',
      effectEnOfficial: '',
      printedEffectStatus: 'none',
      playStatus: 'display_only',
      playStatusReason: 'No printed element or Power Cost',
      type: 'Character',
      rarity: 'SR',
      element: '',
      clock: '5',
      powerCost: '',
      sendToPower: '',
      attackNight: '2021',
      attackDay: '817',
      song: '',
      illustrator: 'Yosuke Torii',
      pack: '',
      imageReviewStatus: 'approved',
      textReviewStatus: 'verified',
      reviewedAt: '2026-07-30T00:00:00.000Z',
    },
  };
  const cards = candidates.map(({ candidateId, cardId, playStatus }) => ({
    candidateId,
    cardId,
    imageUrl: `https://r2.dan.tw/cards/reviewed-unlisted/zutomayocard_${cardId}.jpg`,
    catalogStatus: candidateId.startsWith('4th_') ? 'pending_listing' : 'unlisted',
    distributionType: candidateId.startsWith('4th_') ? 'standard' : 'collaboration',
    publicationStatus: 'published',
    playStatus,
    translations: completeTranslations(cardId),
  }));
  cards[0].translations = {
    'zh-TW': {
      name: 'CHIRITORI-OTOKO DA!!',
      effect:
        '選擇深淵中的8張卡牌，翻成背面朝上後洗混，放置於牌組底。若不如此做，則遊戲敗北。將雙方充能區的所有卡牌放置於深淵。',
    },
    'zh-CN': {
      name: 'CHIRITORI-OTOKO DA!!',
      effect:
        '选择深渊中的8张卡牌，翻成背面朝上后洗混，放置于牌组底。若不如此做，则游戏败北。将双方充能区的所有卡牌放置于深渊。',
    },
    'zh-HK': {
      name: 'CHIRITORI-OTOKO DA!!',
      effect:
        '選擇深淵中的8張卡牌，翻成背面朝上後洗混，放置於牌組底。若不如此做，則遊戲敗北。將雙方充能區的所有卡牌放置於深淵。',
    },
    ko: {
      name: 'CHIRITORI-OTOKO DA!!',
      effect:
        '어비스의 카드 8장을 선택하여 뒷면으로 섞은 뒤 덱 맨 아래에 놓는다. 그렇게 하지 않으면 게임에서 패배한다. 양쪽 플레이어의 파워 차저에 있는 카드를 모두 어비스에 놓는다.',
    },
  };
  cards[1].translations = {
    'zh-TW': { name: '從正確的謊言中醒來', effect: '將對手角色卡的屬性在戰鬥區期間變為闇。' },
    'zh-CN': { name: '从正确的谎言中醒来', effect: '将对手角色卡的属性在战斗区期间变为暗。' },
    'zh-HK': { name: '從正確的謊言中醒來', effect: '將對手角色卡的屬性在戰鬥區期間變為闇。' },
    ko: { name: '올바른 거짓에서 깨어남', effect: '상대 캐릭터 카드의 속성을 배틀 존에 있는 동안 어둠으로 변경한다.' },
  };
  return {
    sources: { cards: sourceCards },
    reviews: { reviews },
    manifest: {
      schemaVersion: 2,
      reviewedAt: '2026-07-30T00:00:00.000Z',
      reviewStatus: 'verified',
      cards,
    } as ReviewedUnlistedReleaseManifest,
  };
}

describe('reviewed unlisted card release', () => {
  it('builds mixed playable and display-only releases without inventing metadata', () => {
    const { sources, reviews, manifest } = inputs();
    const release = buildReviewedUnlistedRelease(sources, reviews, manifest);
    expect(release.cards.map((card) => card.id)).toEqual(candidates.map((card) => card.cardId));
    expect(release.cards.every((card) => card.sourceNote === REVIEWED_UNLISTED_SOURCE_NOTE)).toBe(true);
    expect(release.cards[0]).toMatchObject({ attack: { night: 0, day: 250 }, playStatus: 'playable' });
    expect(release.cards[1].translations).toEqual(manifest.cards[1].translations);
    expect(release.cards[2]).toMatchObject({
      id: 'collaboration_007',
      element: '',
      powerCost: null,
      sendToPower: null,
      playStatus: 'display_only',
    });
    expect(release.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects a partial set of reviewed translations', () => {
    const { sources, reviews, manifest } = inputs();
    delete (manifest.cards[0].translations as Record<string, unknown>)['zh-HK'];
    expect(() => buildReviewedUnlistedRelease(sources, reviews, manifest)).toThrow(
      'reviewed translations must be complete',
    );
  });

  it('rejects a published card without derived translations', () => {
    const { sources, reviews, manifest } = inputs();
    delete manifest.cards[2].translations;
    expect(() => buildReviewedUnlistedRelease(sources, reviews, manifest)).toThrow(
      'reviewed translations must be complete',
    );
  });

  it('rejects non-canonical terminology in reviewed effects', () => {
    const { sources, reviews, manifest } = inputs();
    const translation = manifest.cards[0].translations?.['zh-TW'];
    if (!translation) throw new Error('test fixture translation missing');
    translation.effect = '將克洛諾斯推進8格';
    expect(() => buildReviewedUnlistedRelease(sources, reviews, manifest)).toThrow(
      'non-canonical rules terminology (克洛諾斯 -> Chronos)',
    );
  });

  it('rejects reviewed effects that omit canonical terms present in the Japanese source', () => {
    const { sources, reviews, manifest } = inputs();
    const translation = manifest.cards[0].translations?.['zh-TW'];
    if (!translation) throw new Error('test fixture translation missing');
    translation.effect = translation.effect.replaceAll('卡牌', '卡');

    expect(() => buildReviewedUnlistedRelease(sources, reviews, manifest)).toThrow(
      'missing canonical rules terminology (カード -> 卡牌)',
    );
  });

  it('rejects untranslated character names in reviewed Chinese card names', () => {
    const { sources, reviews, manifest } = inputs();
    reviews.reviews.limited_001.nameJa = '肉まんうにぐり（ご当地うにぐりver.テクノプア）';
    const translation = manifest.cards[1].translations?.['zh-TW'];
    if (!translation) throw new Error('test fixture translation missing');
    translation.name = '肉包 UNIGURI（在地 UNIGURI ver. TECHNO POOR）';

    expect(() => buildReviewedUnlistedRelease(sources, reviews, manifest)).toThrow(
      'non-canonical card-name terminology (うにぐり -> 海膽栗子)',
    );
  });

  it('requires the canonical regional Chinese spelling for character names', () => {
    const { sources, reviews, manifest } = inputs();
    reviews.reviews.limited_001.nameJa = 'うにぐりくん';
    const translations = manifest.cards[1].translations;
    if (!translations) throw new Error('test fixture translations missing');
    translations['zh-TW']!.name = '海膽栗子君';
    translations['zh-HK']!.name = '海膽栗子君';
    translations['zh-CN']!.name = '海膽栗子君';

    expect(() => buildReviewedUnlistedRelease(sources, reviews, manifest)).toThrow(
      'non-canonical card-name terminology (うにぐり -> 海胆栗子)',
    );
  });

  it('accepts canonical character names and preserves every source occurrence', () => {
    const { sources, reviews, manifest } = inputs();
    reviews.reviews.limited_001.nameJa = '肉まんうにぐり（ご当地うにぐりver.テクノプア）';
    const translations = manifest.cards[1].translations;
    if (!translations) throw new Error('test fixture translations missing');
    translations['zh-TW']!.name = '肉包海膽栗子（在地海膽栗子 ver. TECHNO POOR）';
    translations['zh-HK']!.name = '肉包海膽栗子（在地海膽栗子 ver. TECHNO POOR）';
    translations['zh-CN']!.name = '肉包海胆栗子（当地海胆栗子 ver. TECHNO POOR）';
    translations.ko!.name = '니쿠만 우니구리 (지역 한정 우니구리 ver. TECHNO POOR)';

    expect(() => buildReviewedUnlistedRelease(sources, reviews, manifest)).not.toThrow();
  });

  it('rejects untranslated collection character names', () => {
    const { sources, reviews, manifest } = inputs();
    reviews.reviews.limited_001.nameJa = 'ご当地うにぐり ver. スナネコ';
    const translations = manifest.cards[1].translations;
    if (!translations) throw new Error('test fixture translations missing');
    translations['zh-TW']!.name = '在地海膽栗子 ver. SUNANEKO';
    translations['zh-CN']!.name = '当地海胆栗子 ver. 砂猫';
    translations['zh-HK']!.name = '在地海膽栗子 ver. 砂貓';
    translations.ko!.name = '지역 한정 우니구리 ver. 스나네코';

    expect(() => buildReviewedUnlistedRelease(sources, reviews, manifest)).toThrow(
      'non-canonical card-name terminology (スナネコ -> 砂貓)',
    );
  });

  it('rejects inconsistent established proper names in card names', () => {
    const { sources, reviews, manifest } = inputs();
    reviews.reviews.limited_001.nameJa = '喫茶 愛のペガサス';
    const translation = manifest.cards[1].translations?.['zh-TW'];
    if (!translation) throw new Error('test fixture translation missing');
    translation.name = '咖啡 愛之天馬';

    expect(() => buildReviewedUnlistedRelease(sources, reviews, manifest)).toThrow(
      'non-canonical card-name terminology (愛のペガサス -> 愛之飛馬)',
    );
  });

  it('rejects spacing that breaks the canonical NIRA name', () => {
    const { sources, reviews, manifest } = inputs();
    reviews.reviews.limited_001.nameJa = 'にらちゃん（ねんどろいど ver.）';
    const translation = manifest.cards[1].translations?.['zh-TW'];
    if (!translation) throw new Error('test fixture translation missing');
    translation.name = 'NIRA 醬（黏土人 ver.）';

    expect(() => buildReviewedUnlistedRelease(sources, reviews, manifest)).toThrow(
      'non-canonical card-name terminology (にらちゃん -> NIRA醬)',
    );
  });

  it('rejects inconsistent established proper names in card effects', () => {
    const { sources, reviews, manifest } = inputs();
    const review = reviews.reviews.limited_013;
    review.printedEffectStatus = 'present';
    review.effectJa = '喫茶 愛のペガサスで日替わりランチ。';
    review.effectEnOfficial = 'Have the daily lunch at Cafe Ai no Pegasus.';
    const translations = manifest.cards[2].translations;
    if (!translations) throw new Error('test fixture translations missing');
    translations['zh-TW']!.effect = '在咖啡 愛之天馬享用每日午餐。';
    translations['zh-CN']!.effect = '在咖啡 爱之飞马享用每日午餐。';
    translations['zh-HK']!.effect = '在咖啡 愛之飛馬享用每日午餐。';
    translations.ko!.effect = '킷사 사랑의 페가수스에서 오늘의 점심을 먹는다.';

    expect(() => buildReviewedUnlistedRelease(sources, reviews, manifest)).toThrow(
      'non-canonical card-effect proper name (愛のペガサス -> 愛之飛馬)',
    );
  });

  it('fails closed when the manifest omits a reviewed candidate', () => {
    const { sources, reviews, manifest } = inputs();
    manifest.cards.pop();
    expect(() => buildReviewedUnlistedRelease(sources, reviews, manifest)).toThrow(
      'release manifest must contain exactly',
    );
  });

  it('rejects unreviewed images and effects without an approved executor', () => {
    const unapproved = inputs();
    unapproved.reviews.reviews['4th_105'].imageReviewStatus = 'pending';
    expect(() => buildReviewedUnlistedRelease(unapproved.sources, unapproved.reviews, unapproved.manifest)).toThrow(
      'text and image reviews must be approved',
    );

    const unsupported = inputs();
    unsupported.reviews.reviews.limited_001.effectJa = '未対応の効果';
    expect(() => buildReviewedUnlistedRelease(unsupported.sources, unsupported.reviews, unsupported.manifest)).toThrow(
      'reviewed effect does not parse',
    );
  });

  it('keeps playable element and gameplay values mandatory', () => {
    const { sources, reviews, manifest } = inputs();
    reviews.reviews.limited_001.element = '';
    expect(() => buildReviewedUnlistedRelease(sources, reviews, manifest)).toThrow(
      'playable card has unsupported element',
    );
  });

  it('requires reviewed rarity for every released card', () => {
    const { sources, reviews, manifest } = inputs();
    reviews.reviews.limited_013.rarity = '';
    expect(() => buildReviewedUnlistedRelease(sources, reviews, manifest)).toThrow(
      'collaboration_007.rarity must be nonempty',
    );
  });

  it('rejects distribution classifications stored as packs', () => {
    const { sources, reviews, manifest } = inputs();
    reviews.reviews.limited_001.pack = '特典カード';
    expect(() => buildReviewedUnlistedRelease(sources, reviews, manifest)).toThrow(
      'bonus_001: unsupported pack 特典カード',
    );
  });

  it('accepts plus rarities and rejects unknown rarity labels', () => {
    const supported = inputs();
    supported.reviews.reviews.limited_001.rarity = 'UR+';
    expect(() => buildReviewedUnlistedRelease(supported.sources, supported.reviews, supported.manifest)).not.toThrow();

    const unsupported = inputs();
    unsupported.reviews.reviews.limited_001.rarity = 'PROMO';
    expect(() => buildReviewedUnlistedRelease(unsupported.sources, unsupported.reviews, unsupported.manifest)).toThrow(
      'bonus_001: unsupported rarity PROMO',
    );
  });

  it('allows only the known packless card to omit its pack', () => {
    const packless = inputs();
    expect(() => buildReviewedUnlistedRelease(packless.sources, packless.reviews, packless.manifest)).not.toThrow();

    const assigned = inputs();
    assigned.reviews.reviews.limited_013.pack = 'THE WORLD IS CHANGING';
    expect(() => buildReviewedUnlistedRelease(assigned.sources, assigned.reviews, assigned.manifest)).toThrow(
      'collaboration_007: pack must be empty',
    );

    const missing = inputs();
    missing.reviews.reviews.limited_001.pack = '';
    expect(() => buildReviewedUnlistedRelease(missing.sources, missing.reviews, missing.manifest)).toThrow(
      'bonus_001: unsupported pack',
    );
  });

  it('allows a playable card with no printed effect and empty reviewed effect translations', () => {
    const { sources, reviews, manifest } = inputs();
    reviews.reviews.limited_001.effectJa = '';
    reviews.reviews.limited_001.effectEnOfficial = '';
    reviews.reviews.limited_001.printedEffectStatus = 'none';
    manifest.cards[1].translations = completeTranslations('bonus_001');
    for (const translation of Object.values(manifest.cards[1].translations)) translation.effect = '';

    const release = buildReviewedUnlistedRelease(sources, reviews, manifest);

    expect(release.cards[1]).toMatchObject({
      id: 'bonus_001',
      effect: '',
      translations: manifest.cards[1].translations,
    });
  });
});
