import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SegmentedControl } from '../SegmentedControl';

describe('SegmentedControl accessibility', () => {
  it('keeps every option at the minimum touch-target size', () => {
    const html = renderToStaticMarkup(
      createElement(SegmentedControl, {
        options: [
          { value: 'trending', label: '趨勢' },
          { value: 'newest', label: '最新' },
        ],
        value: 'trending',
        onChange: () => {},
        ariaLabel: '排序',
        size: 'sm',
      }),
    );

    const optionClasses = [...html.matchAll(/<button[^>]+class="([^"]+)"/g)].map((match) => match[1]);

    expect(optionClasses).toHaveLength(2);
    expect(optionClasses.every((className) => className.includes('min-h-touch'))).toBe(true);
    expect(optionClasses.every((className) => className.includes('min-w-touch'))).toBe(true);
  });
});
