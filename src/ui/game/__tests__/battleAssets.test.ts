import { describe, expect, it } from 'vitest';
import { battleAssetUrl } from '../battleAssets';

describe('battleAssetUrl', () => {
  it('versions battle assets with the deployed build ID', () => {
    expect(battleAssetUrl('/battle/chronos.svg', 'build/one')).toBe('/battle/chronos.svg?v=build%2Fone');
  });

  it('normalizes relative asset names and preserves existing queries', () => {
    expect(battleAssetUrl('chronos-slots/00.svg', 'release')).toBe('/battle/chronos-slots/00.svg?v=release');
    expect(battleAssetUrl('/battle/medal.png?variant=night', 'release')).toBe(
      '/battle/medal.png?variant=night&v=release',
    );
  });
});
