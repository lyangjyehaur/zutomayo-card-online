import { describe, expect, it } from 'vitest';
import { isActionableCommunityUrl } from '../communityLinks';

describe('isActionableCommunityUrl', () => {
  it.each(['', 'not-a-url', 'http://discord.gg/invite', 'https://discord.gg/', 'https://t.me/', 'https://qm.qq.com/'])(
    'rejects missing, unsafe, or placeholder community URL %s',
    (url) => {
      expect(isActionableCommunityUrl(url)).toBe(false);
    },
  );

  it.each([
    'https://discord.gg/zutomayo',
    'https://t.me/zutomayo_card',
    'https://qm.qq.com/q/WzqrKo57W4',
    'https://community.example.com/',
  ])('accepts actionable HTTPS community URL %s', (url) => {
    expect(isActionableCommunityUrl(url)).toBe(true);
  });
});
