import { describe, expect, it } from 'vitest';
import { ZutomayoCard, ZutomayoOnlineCard } from '../Game';
import { APP_VERSION_INFO } from '../../version';

describe('online version guard', () => {
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
