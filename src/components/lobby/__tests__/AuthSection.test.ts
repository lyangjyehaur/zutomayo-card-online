import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AuthSection } from '../AuthSection';

describe('AuthSection release gating', () => {
  it('renders the login and register entrypoint as disabled while public auth is closed', () => {
    const markup = renderToStaticMarkup(React.createElement(AuthSection, { onAuthChanged: () => {} }));

    expect(markup).toContain('disabled=""');
    expect(markup).toContain('aria-disabled="true"');
  });
});
