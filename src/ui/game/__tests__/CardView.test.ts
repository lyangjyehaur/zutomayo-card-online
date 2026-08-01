import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CardInstance } from '../../../game/types';
import { CardCostTag } from '../CardView';

vi.mock('../../../game/cards/loader', () => ({
  getCardDef: (id: string) => (id === 'known-card' ? { id, powerCost: 7 } : undefined),
}));

const card: CardInstance = { instanceId: 'known-instance', defId: 'known-card', faceUp: true };

describe('CardCostTag', () => {
  it('renders the original cost outside the card with an accessible label', () => {
    const markup = renderToStaticMarkup(createElement(CardCostTag, { card }));

    expect(markup).toContain('class="card-cost-tag"');
    expect(markup).toContain('>COST</span>');
    expect(markup).toContain('>7</strong>');
    expect(markup).toMatch(/aria-label="[^"]*: 7"/);
  });

  it('marks insufficient power without changing the displayed cost', () => {
    const markup = renderToStaticMarkup(createElement(CardCostTag, { card, insufficient: true }));

    expect(markup).toContain('data-insufficient="true"');
    expect(markup).toContain('>7</strong>');
  });

  it('does not reveal cost for a facedown card', () => {
    expect(renderToStaticMarkup(createElement(CardCostTag, { card: { ...card, faceUp: false } }))).toBe('');
  });
});
