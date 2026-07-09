import { describe, expect, it } from 'vitest';
import { buildOnlineRoomUrl, buildOnlineSpectatorUrl } from '../components/OnlineRoomInfo';

describe('online room links', () => {
  it('builds encoded player and spectator links without a browser origin', () => {
    expect(buildOnlineRoomUrl('match 1/2')).toBe('/play/online/match%201%2F2');
    expect(buildOnlineSpectatorUrl('match 1/2')).toBe('/play/online/match%201%2F2?spectate=1');
  });
});
