import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AuthSection, PUBLIC_AUTH_ENTRYPOINTS_ENABLED } from '../AuthSection';

describe('AuthSection public entrypoints', () => {
  it('renders the login and register entrypoint as enabled while public auth is open', () => {
    const markup = renderToStaticMarkup(React.createElement(AuthSection, { onAuthChanged: () => {} }));

    expect(PUBLIC_AUTH_ENTRYPOINTS_ENABLED).toBe(true);
    expect(markup).not.toContain('disabled=""');
    expect(markup).toContain('aria-disabled="false"');
  });

  it('renders the compact header entrypoint as enabled while public auth is open', () => {
    const markup = renderToStaticMarkup(React.createElement(AuthSection, { onAuthChanged: () => {}, compact: true }));

    expect(markup).not.toContain('disabled=""');
    expect(markup).toContain('登入');
  });
});
