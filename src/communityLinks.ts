const PLACEHOLDER_COMMUNITY_URLS = new Set(['https://discord.gg/', 'https://qm.qq.com/', 'https://t.me/']);

export function isActionableCommunityUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;

    const normalized = `${url.origin}${url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`}`;
    return !PLACEHOLDER_COMMUNITY_URLS.has(normalized) || Boolean(url.search || url.hash);
  } catch {
    return false;
  }
}
