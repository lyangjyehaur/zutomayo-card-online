import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require_ = createRequire(import.meta.url);
const { OFFICIAL_CARD_DATA_COMMANDS, officialCardDataRequired, runOfficialCardDataRelease } = require_(
  '../release-card-data.cjs',
) as {
  OFFICIAL_CARD_DATA_COMMANDS: Array<{ label: string; args: string[] }>;
  officialCardDataRequired: (env?: NodeJS.ProcessEnv) => boolean;
  runOfficialCardDataRelease: (options?: { env?: NodeJS.ProcessEnv; spawn?: ReturnType<typeof vi.fn> }) => boolean;
};

describe('official card data release runner', () => {
  it('requires the signed data path for every production migration release', () => {
    expect(() => officialCardDataRequired({ NODE_ENV: 'production' })).toThrow('mandatory');
    expect(() => officialCardDataRequired({ NODE_ENV: 'production', REQUIRE_OFFICIAL_CARD_DATA: 'true' })).toThrow(
      'RELEASE_SHA',
    );
    expect(
      officialCardDataRequired({
        NODE_ENV: 'production',
        REQUIRE_OFFICIAL_CARD_DATA: 'true',
        RELEASE_SHA: 'a'.repeat(40),
      }),
    ).toBe(true);
    expect(officialCardDataRequired({ NODE_ENV: 'test', REQUIRE_OFFICIAL_CARD_DATA: 'false' })).toBe(false);
    expect(() => officialCardDataRequired({ REQUIRE_OFFICIAL_CARD_DATA: 'sometimes' })).toThrow('true or false');
  });

  it('runs audit, import, and completeness gate in order', () => {
    const spawn = vi.fn().mockReturnValue({ status: 0 });
    expect(
      runOfficialCardDataRelease({
        env: { NODE_ENV: 'production', REQUIRE_OFFICIAL_CARD_DATA: 'true', RELEASE_SHA: 'a'.repeat(40) },
        spawn,
      }),
    ).toBe(true);
    expect(spawn).toHaveBeenCalledTimes(OFFICIAL_CARD_DATA_COMMANDS.length);
    expect(spawn.mock.calls.map(([, args]) => args)).toEqual(OFFICIAL_CARD_DATA_COMMANDS.map(({ args }) => args));
  });

  it('stops before a later command after any release data step fails', () => {
    const spawn = vi.fn().mockReturnValueOnce({ status: 0 }).mockReturnValueOnce({ status: 9 });
    expect(() =>
      runOfficialCardDataRelease({
        env: { NODE_ENV: 'production', REQUIRE_OFFICIAL_CARD_DATA: 'true', RELEASE_SHA: 'a'.repeat(40) },
        spawn,
      }),
    ).toThrow('official card-text import failed with exit code 9');
    expect(spawn).toHaveBeenCalledTimes(2);
  });
});
