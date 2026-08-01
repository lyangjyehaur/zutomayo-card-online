import { describe, expect, it } from 'vitest';
import { isPwaUpdateSafePath, PWA_LAST_BOOT_RELEASE_STORAGE_KEY, recordRunningRelease } from '../../pwaUpdatePolicy';
import { formatBuildStamp, formatReleaseLabel, normalizeVersionInfo, shortBuildId } from '../../version';

describe('PWA release identity', () => {
  it('uses one compact version, short build ID, and browser-local build stamp format', () => {
    const release = {
      appVersion: '0.2.6',
      buildId: 'fec950161424bb00ef6fca7e1ce46fa52ff2b093',
      rulesVersion: '0.2.6',
      builtAt: '2026-08-01T12:34:56.000Z',
    };
    const localBuildDate = new Date(release.builtAt);
    const pad = (part: number) => String(part).padStart(2, '0');
    const expectedBuildStamp = `${String(localBuildDate.getFullYear()).slice(-2)}${pad(
      localBuildDate.getMonth() + 1,
    )}${pad(localBuildDate.getDate())}${pad(localBuildDate.getHours())}${pad(localBuildDate.getMinutes())}`;

    expect(shortBuildId(release.buildId)).toBe('fec9501');
    expect(formatBuildStamp(release.builtAt)).toBe(expectedBuildStamp);
    expect(formatBuildStamp('invalid')).toBeNull();
    expect(formatReleaseLabel(release)).toBe(`v0.2.6 · fec9501 · ${expectedBuildStamp}`);
    expect(formatReleaseLabel(release)).not.toContain(release.buildId);
  });

  it('preserves build time while accepting legacy version responses', () => {
    expect(
      normalizeVersionInfo({
        appVersion: '0.2.6',
        buildId: 'build-1',
        rulesVersion: '0.2.6',
        builtAt: '2026-08-01T12:34:56Z',
      }),
    ).toEqual({
      appVersion: '0.2.6',
      buildId: 'build-1',
      rulesVersion: '0.2.6',
      builtAt: '2026-08-01T12:34:56Z',
    });
    expect(normalizeVersionInfo({ appVersion: '0.2.5', buildId: 'legacy-build', rulesVersion: '0.2.5' })).toEqual({
      appVersion: '0.2.5',
      buildId: 'legacy-build',
      rulesVersion: '0.2.5',
    });
  });

  it('only treats the home lobby as safe for an automatic update reload', () => {
    expect(isPwaUpdateSafePath('/')).toBe(true);
    expect(isPwaUpdateSafePath('/online')).toBe(false);
    expect(isPwaUpdateSafePath('/play/online/match-1')).toBe(false);
    expect(isPwaUpdateSafePath('/play/ai')).toBe(false);
    expect(isPwaUpdateSafePath('/deck-builder')).toBe(false);
  });

  it('records the first boot and reports a release transition only once', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    const oldRelease = { buildId: 'build-same', builtAt: '2026-08-01T12:00:00Z' };
    const rebuiltRelease = { buildId: 'build-same', builtAt: '2026-08-01T12:34:56Z' };

    expect(recordRunningRelease(storage, oldRelease)).toBe('first-visit');
    expect(values.get(PWA_LAST_BOOT_RELEASE_STORAGE_KEY)).toBe('build-same@2026-08-01T12:00:00Z');
    expect(recordRunningRelease(storage, rebuiltRelease)).toBe('updated');
    expect(recordRunningRelease(storage, rebuiltRelease)).toBe('same-build');
  });
});
