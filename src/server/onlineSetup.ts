import { createGameSeed } from '../game/rng';
import type { ZutomayoSetupData } from '../game/types';

export function authoritativeOnlineSetupData(
  setup: ZutomayoSetupData,
  rulesVersion: string,
  seedFactory: () => number = createGameSeed,
): ZutomayoSetupData {
  return {
    ...setup,
    rngSeed: seedFactory(),
    rulesVersion,
  };
}
