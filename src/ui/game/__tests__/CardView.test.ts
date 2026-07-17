import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initCards } from '../../../game/cards/loader';
import type { CardDef, CardInstance } from '../../../game/types';
import { t } from '../../../i18n';
import { CardView } from '../CardView';

const definition: CardDef = {
  id: 'a11y_card',
  name: 'Accessible Card',
  pack: 'test',
  song: 'test',
  illustrator: 'test',
  rarity: 'N',
  element: '闇',
  type: 'Character',
  clock: 1,
  attack: { night: 10, day: 10 },
  powerCost: 3,
  sendToPower: 1,
  effect: '',
  image: 'https://example.invalid/a11y-card.jpg',
  errata: '',
};
const card: CardInstance = { instanceId: 'instance-1', defId: definition.id, faceUp: true };

describe('CardView accessibility', () => {
  afterEach(() => initCards([]));

  it('gives duplicate selectable cards a cost, position, and pressed state', () => {
    initCards([definition]);
    const markup = renderToStaticMarkup(
      createElement(CardView, {
        card,
        state: 'selected',
        onActivate: vi.fn(),
        positionInSet: { index: 1, total: 4 },
        ariaPressed: true,
      }),
    );

    expect(markup).toContain('<button');
    expect(markup).toContain(`aria-label="Accessible Card · ${t('card.energy')} 3 · 2/4"`);
    expect(markup).toContain('aria-pressed="true"');
  });

  it('does not expose a toggle state for non-selectable card images', () => {
    initCards([definition]);
    const markup = renderToStaticMarkup(createElement(CardView, { card }));

    expect(markup).toContain('role="img"');
    expect(markup).toContain(`aria-label="Accessible Card · ${t('card.energy')} 3"`);
    expect(markup).not.toContain('aria-pressed');
  });
});
