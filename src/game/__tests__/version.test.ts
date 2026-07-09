import { describe, expect, it } from 'vitest';
import packageJson from '../../../package.json';
import { ZutomayoCard, ZutomayoOnlineCard } from '../Game';
import { APP_VERSION_INFO } from '../../version';

describe('online version guard', () => {
  it('defaults version identity from the root package version', () => {
    const expectedAppVersion = process.env.VITE_APP_VERSION || process.env.APP_VERSION || packageJson.version;
    const expectedBuildId = process.env.VITE_APP_BUILD_ID || process.env.APP_BUILD_ID || expectedAppVersion;
    const expectedRulesVersion =
      process.env.VITE_GAME_RULES_VERSION || process.env.GAME_RULES_VERSION || expectedAppVersion;

    expect(APP_VERSION_INFO).toEqual({
      appVersion: expectedAppVersion,
      buildId: expectedBuildId,
      rulesVersion: expectedRulesVersion,
    });
  });

  it('rejects online match setup without a matching client version', () => {
    expect(ZutomayoOnlineCard.validateSetupData?.({ deck0Name: 'dark', deck1Name: 'flame' }, 2)).toMatch(
      /Client version/,
    );
  });

  it('accepts matching client version for online match setup', () => {
    expect(
      ZutomayoOnlineCard.validateSetupData?.(
        { deck0Name: 'dark', deck1Name: 'flame', clientVersion: APP_VERSION_INFO },
        2,
      ),
    ).toBeUndefined();
  });

  it('keeps local game setup usable without online version metadata', () => {
    expect(ZutomayoCard.validateSetupData?.({ deck0Name: 'dark', deck1Name: 'flame' }, 2)).toBeUndefined();
  });
});
