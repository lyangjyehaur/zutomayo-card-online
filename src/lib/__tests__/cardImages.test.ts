import { afterEach, describe, expect, it } from 'vitest';
import { initCards } from '../../game/cards/loader';
import type { CardDef } from '../../game/types';
import {
  getCardImageContextWidths,
  getCardImageSizes,
  getCardImageSource,
  getCardImageSrcSet,
  getCardImageUrl,
} from '../cardImages';

const card: CardDef = {
  id: 'test_1',
  name: 'Test Card',
  pack: 'test',
  song: 'test',
  illustrator: 'test',
  rarity: 'N',
  element: '闇',
  type: 'Character',
  clock: 1,
  attack: { night: 10, day: 20 },
  powerCost: 1,
  sendToPower: 1,
  effect: '',
  image: 'https://r2.dan.tw/cards/test/zutomayocard_test_1.jpg?version=1#front',
  errata: '',
};

describe('card image imgproxy builder', () => {
  afterEach(() => {
    initCards([]);
  });

  it('builds fit resize URLs from a card id', () => {
    initCards([card]);

    expect(getCardImageUrl('test_1', 320)).toBe(
      '/api/imgproxy/rs:fit:320:0/plain/https://r2.dan.tw/cards/test/zutomayocard_test_1.jpg%3Fversion=1%23front',
    );
  });

  it('exposes the original source for imgproxy failure fallback', () => {
    initCards([card]);

    expect(getCardImageSource('test_1', 'cardId')).toBe(
      'https://r2.dan.tw/cards/test/zutomayocard_test_1.jpg?version=1#front',
    );
    expect(getCardImageSource('https://r2.dan.tw/cards/test/direct.jpg', 'url')).toBe(
      'https://r2.dan.tw/cards/test/direct.jpg',
    );
  });

  it('supports modern output formats without changing the resize mode', () => {
    initCards([card]);

    expect(getCardImageUrl('test_1', 720, { format: 'avif' })).toBe(
      '/api/imgproxy/rs:fit:720:0/plain/https://r2.dan.tw/cards/test/zutomayocard_test_1.jpg%3Fversion=1%23front@avif',
    );
    expect(getCardImageUrl('test_1', 720, { format: 'webp' })).toBe(
      '/api/imgproxy/rs:fit:720:0/plain/https://r2.dan.tw/cards/test/zutomayocard_test_1.jpg%3Fversion=1%23front@webp',
    );
  });

  it('escapes source URL characters that would conflict with imgproxy output suffixes', () => {
    expect(getCardImageUrl('https://r2.dan.tw/cards/test/card@front.jpg', 320, { sourceKind: 'url' })).toBe(
      '/api/imgproxy/rs:fit:320:0/plain/https://r2.dan.tw/cards/test/card%40front.jpg',
    );
  });

  it('keeps context srcsets to the intended size buckets', () => {
    initCards([card]);

    const widths = getCardImageContextWidths('thumbnail');
    const srcSet = getCardImageSrcSet('test_1', { widths });

    expect(srcSet).toContain('/rs:fit:128:0/plain/');
    expect(srcSet).toContain('/rs:fit:192:0/plain/');
    expect(srcSet).toContain('/rs:fit:320:0/plain/');
    expect(srcSet).not.toContain('/rs:fit:960:0/plain/');
  });

  it('exposes responsive sizes per card image context', () => {
    expect(getCardImageSizes('detail')).toContain('720px');
  });
});
