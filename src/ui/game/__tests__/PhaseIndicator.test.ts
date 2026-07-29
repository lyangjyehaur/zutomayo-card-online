import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PhaseIndicator } from '../PhaseIndicator';

const instruction = {
  title: 'Reveal hand',
  body: 'Review the cards before continuing.',
  meta: [],
};

describe('PhaseIndicator actions', () => {
  it('keeps interactive actions outside the live status region', () => {
    const markup = renderToStaticMarkup(
      createElement(PhaseIndicator, {
        instruction,
        action: createElement('button', { type: 'button' }, 'Done'),
      }),
    );

    expect(markup).toContain('phaseindicator-with-action');
    expect(markup).toContain('role="status"');
    expect(markup.indexOf('role="status"')).toBeLessThan(markup.indexOf('</div><div class="phaseindicator-action"'));
    expect(markup).toContain('<button type="button">Done</button>');
  });
});
