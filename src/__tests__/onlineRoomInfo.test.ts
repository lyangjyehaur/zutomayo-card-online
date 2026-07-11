import { describe, expect, it } from 'vitest';
import {
  buildOnlineRoomPath,
  buildOnlineRoomUrl,
  buildOnlineSpectatorPath,
  buildOnlineSpectatorUrl,
} from '../components/OnlineRoomInfo';

describe('online room links', () => {
  it('builds encoded platform player and direct spectator paths for router navigation', () => {
    expect(buildOnlineRoomPath('match 1/2')).toBe('/online?room=match%201%2F2');
    expect(buildOnlineSpectatorPath('match 1/2')).toBe('/play/online/match%201%2F2?spectate=1');
  });

  it('builds encoded platform player and direct spectator links without a browser origin', () => {
    expect(buildOnlineRoomUrl('match 1/2')).toBe('/online?room=match%201%2F2');
    expect(buildOnlineSpectatorUrl('match 1/2')).toBe('/play/online/match%201%2F2?spectate=1');
  });
});
