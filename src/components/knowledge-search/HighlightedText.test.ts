import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HighlightedText } from './HighlightedText';

describe('HighlightedText', () => {
  it('renders text ranges as React markup and escapes untrusted text', () => {
    const html = renderToStaticMarkup(
      HighlightedText({ text: '<script>alert(1)</script>', ranges: [{ start: 0, end: 8 }] }),
    );
    expect(html).toContain('<mark');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('clamps, sorts, and merges overlapping ranges', () => {
    const html = renderToStaticMarkup(
      HighlightedText({
        text: 'Chronos',
        ranges: [
          { start: 3, end: 99 },
          { start: -10, end: 4 },
        ],
      }),
    );
    expect(html.match(/<mark/g)).toHaveLength(1);
    expect(html).toContain('Chronos</mark>');
  });
});
