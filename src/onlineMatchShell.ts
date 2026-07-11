import { formatAnonymousDisplayName, type AnonymousIdentity } from './anonymousIdentity';
import { t } from './i18n';
import type { OnlineSession } from './onlineSession';
import type { OnlineRoomStatus } from './onlineRoomStatus';
import type { PlatformMatchShellJoinOptions } from './platformClient';

export function buildOnlineGameMatchShellJoinOptions({
  activeSession,
  matchID,
  reconnectStatus,
  spectatorMode,
  spectatorIdentity,
}: {
  activeSession: OnlineSession | null;
  matchID: string;
  reconnectStatus: OnlineRoomStatus;
  spectatorMode: boolean;
  spectatorIdentity?: AnonymousIdentity;
}): PlatformMatchShellJoinOptions | null {
  if (activeSession) {
    if (reconnectStatus !== 'ready') return null;
    return {
      boardgameMatchID: activeSession.matchID,
      userId: `match:${activeSession.matchID}:player:${activeSession.playerID}`,
      displayName: activeSession.playerID === '0' ? t('player.zero') : t('player.one'),
      role: 'player',
      boardgamePlayerID: activeSession.playerID,
      hasBoardgameCredentials: true,
    };
  }

  if (!spectatorMode || !matchID || reconnectStatus !== 'ready' || !spectatorIdentity) return null;

  return {
    boardgameMatchID: matchID,
    userId: `anon:${spectatorIdentity.suffix}`,
    displayName: formatAnonymousDisplayName(spectatorIdentity),
    role: 'spectator',
  };
}
