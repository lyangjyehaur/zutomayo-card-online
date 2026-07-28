import { describe, expect, it } from 'vitest';
import { createOnlineRematchSetupData } from '../onlineRematch';
import { APP_VERSION_INFO } from '../../version';

function cards(prefix: string, count: number) {
  return Array.from({ length: count }, (_, index) => ({ defId: `${prefix}_${index}` }));
}

describe('online rematch setup', () => {
  it('reconstructs both complete decks from the trusted initial state', () => {
    const setup = createOnlineRematchSetupData(
      {
        G: {
          players: [
            { deck: cards('p0_deck', 15), hand: cards('p0_hand', 5) },
            { deck: cards('p1_deck', 15), hand: cards('p1_hand', 5) },
          ],
        },
      },
      { setupData: { deck0Version: 'deck-a-v3', deck1Version: 'deck-b-v2' } },
      APP_VERSION_INFO,
      APP_VERSION_INFO.rulesVersion,
    );

    expect(setup.deck0Ids).toHaveLength(20);
    expect(setup.deck1Ids).toHaveLength(20);
    expect(setup).toMatchObject({
      deck0Version: 'deck-a-v3',
      deck1Version: 'deck-b-v2',
      clientVersion: APP_VERSION_INFO,
      rulesVersion: APP_VERSION_INFO.rulesVersion,
    });
  });

  it('rejects a rematch when either trusted deck is incomplete', () => {
    expect(() =>
      createOnlineRematchSetupData(
        {
          G: {
            players: [
              { deck: cards('p0_deck', 14), hand: cards('p0_hand', 5) },
              { deck: cards('p1_deck', 15), hand: cards('p1_hand', 5) },
            ],
          },
        },
        {},
        APP_VERSION_INFO,
        APP_VERSION_INFO.rulesVersion,
      ),
    ).toThrow('Previous match decks are incomplete');
  });
});
