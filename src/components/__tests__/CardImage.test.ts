import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CardImage } from '../CardImage';

describe('CardImage', () => {
  it('renders card artwork through the same-origin imgproxy route by default', () => {
    const markup = renderToStaticMarkup(
      createElement(CardImage, {
        src: 'https://r2.dan.tw/cards/test/zutomayocard_test_1.jpg',
        context: 'detail',
        alt: 'Test card',
      }),
    );

    expect(markup).toContain('data-card-image-delivery="imgproxy"');
    expect(markup).toContain('src="/api/imgproxy/');
    expect(markup).not.toContain('src="https://r2.dan.tw/cards/');
  });

  it('renders an explicitly reviewed bundled tutorial asset without imgproxy', () => {
    const markup = renderToStaticMarkup(
      createElement(CardImage, {
        src: '/tutorial/cards/2nd_40.jpg',
        bundledAsset: true,
        bundledAssetReason: 'Reviewed fixed CH.02 tutorial example',
        alt: 'Tutorial card',
      }),
    );

    expect(markup).toContain('data-card-image-delivery="bundled-asset"');
    expect(markup).toContain('src="/tutorial/cards/2nd_40.jpg"');
    expect(markup).not.toContain('/api/imgproxy/');
  });

  it('fails closed when bundled delivery receives a non-local source', () => {
    const markup = renderToStaticMarkup(
      createElement(CardImage, {
        src: 'https://r2.dan.tw/cards/test/zutomayocard_test_1.jpg',
        bundledAsset: true,
        bundledAssetReason: 'Invalid test source',
        alt: 'Invalid bundled card',
      }),
    );

    expect(markup).toContain('data-card-image-delivery="missing"');
    expect(markup).not.toContain('src=');
    expect(markup).not.toContain('r2.dan.tw');
  });
});
