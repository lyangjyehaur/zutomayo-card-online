import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FormField, Input } from '../Input';

describe('FormField accessibility', () => {
  it('associates its label with an unlabeled control', () => {
    const html = renderToStaticMarkup(
      createElement(FormField, { label: 'Nickname' }, createElement(Input, { name: 'nickname' })),
    );
    const controlId = html.match(/<label[^>]+for="([^"]+)"/)?.[1];

    expect(controlId).toBeTruthy();
    expect(html).toMatch(new RegExp(`<input[^>]+id="${controlId}"`));
  });

  it('connects validation errors to the control', () => {
    const html = renderToStaticMarkup(
      createElement(FormField, { label: 'Nickname', error: 'Required' }, createElement(Input, { id: 'nickname' })),
    );

    expect(html).toMatch(/<label[^>]+for="nickname"[^>]*>Nickname<\/label>/);
    expect(html).toContain('id="nickname"');
    expect(html).toContain('aria-describedby="nickname-description"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('id="nickname-description"');
  });
});
