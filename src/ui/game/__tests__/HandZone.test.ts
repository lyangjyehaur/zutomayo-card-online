import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CardInstance } from '../../../game/types';
import { HandZone, type HandZoneProps } from '../HandZone';

vi.mock('../../../game/cards/loader', () => ({
  getCardDef: (id: string) => ({ id, type: 'Character', powerCost: 2 }),
}));

vi.mock('../CardView', () => ({
  CardView: ({ card }: { card: CardInstance }) => createElement('button', null, card.defId),
  CardCostTag: ({ card }: { card: CardInstance }) =>
    createElement('span', { className: 'card-cost-tag' }, `COST ${card.defId}`),
}));

const cards: CardInstance[] = [
  { instanceId: 'card-a-instance', defId: 'card-a', faceUp: true },
  { instanceId: 'card-b-instance', defId: 'card-b', faceUp: true },
];

function renderHand(overrides: Partial<HandZoneProps> = {}) {
  return renderToStaticMarkup(
    createElement(HandZone, {
      cards,
      variant: 'strip',
      selectedIndex: null,
      canAct: true,
      ...overrides,
    }),
  );
}

describe('HandZone cost visibility', () => {
  it('does not render a cost when no card has focus', () => {
    expect(renderHand()).not.toContain('card-cost-tag');
  });

  it('renders only the selected card cost', () => {
    const markup = renderHand({ selectedIndex: 1 });

    expect(markup).toContain('COST card-b');
    expect(markup).not.toContain('COST card-a');
  });
});
