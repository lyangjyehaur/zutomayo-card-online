import { describe, expect, it } from 'vitest';
import { versionBattleAssetCssUrls } from '../battleAssetVersion';

describe('battle asset CSS versioning', () => {
  it('adds the build ID to quoted and unquoted battle asset URLs', () => {
    const css = [
      "--face: url('/battle/chronos.svg');",
      '--slot: url(/battle/chronos-slots/00.svg);',
      'background: url("/other/image.svg");',
    ].join('\n');

    expect(versionBattleAssetCssUrls(css, 'build/one')).toBe(
      [
        "--face: url('/battle/chronos.svg?v=build%2Fone');",
        '--slot: url(/battle/chronos-slots/00.svg?v=build%2Fone);',
        'background: url("/other/image.svg");',
      ].join('\n'),
    );
  });
});
