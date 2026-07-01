import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ANONYMOUS_PLAYER_DEFAULT_NAME,
  formatAnonymousDisplayName,
  getRegistrationNickname,
  loadAnonymousIdentity,
  renameAnonymousIdentity,
  resetAnonymousIdentityForTests,
  saveAnonymousIdentity,
} from '../anonymousIdentity';

describe('anonymous identity', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetAnonymousIdentityForTests();
  });

  it('creates a default local identity with a four-digit suffix', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1234);

    expect(loadAnonymousIdentity()).toEqual({
      baseName: ANONYMOUS_PLAYER_DEFAULT_NAME,
      suffix: '1234',
    });
    expect(formatAnonymousDisplayName(loadAnonymousIdentity())).toBe('Player#1234');
  });

  it('sanitizes custom names and keeps the existing suffix when renaming', () => {
    saveAnonymousIdentity({ baseName: 'Player', suffix: '9876' });

    const renamed = renameAnonymousIdentity(' <Mayo#9999> ');

    expect(renamed).toEqual({ baseName: 'Mayo9999', suffix: '9876' });
    expect(formatAnonymousDisplayName(renamed)).toBe('Mayo9999#9876');
  });

  it('falls back to the default base name for blank custom names', () => {
    saveAnonymousIdentity({ baseName: 'Mayo', suffix: '0042' });

    expect(renameAnonymousIdentity('   ')).toEqual({
      baseName: ANONYMOUS_PLAYER_DEFAULT_NAME,
      suffix: '0042',
    });
  });

  it('uses only the base name when prefilling registration nickname', () => {
    saveAnonymousIdentity({ baseName: 'Mayo', suffix: '4567' });

    expect(getRegistrationNickname()).toBe('Mayo');
  });
});
