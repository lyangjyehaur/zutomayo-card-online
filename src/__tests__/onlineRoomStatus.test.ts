import { describe, expect, it } from 'vitest';
import { hasOnlineOpponent } from '../onlineRoomStatus';

describe('online room opponent detection', () => {
  const players = [
    { id: 0, name: 'Host' },
    { id: 1, name: 'Guest' },
  ];

  it('detects the opposite occupied seat for either player', () => {
    expect(hasOnlineOpponent(players, '0')).toBe(true);
    expect(hasOnlineOpponent(players, '1')).toBe(true);
  });

  it('does not treat the local occupied seat as an opponent', () => {
    expect(hasOnlineOpponent([{ id: 0, name: 'Host' }, { id: 1 }], '0')).toBe(false);
    expect(hasOnlineOpponent([{ id: 0 }, { id: 1, name: 'Guest' }], '1')).toBe(false);
  });
});
