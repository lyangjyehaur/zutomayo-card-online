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
});
