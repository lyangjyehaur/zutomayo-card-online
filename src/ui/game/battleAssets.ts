import { APP_VERSION_INFO } from '../../version';

export function battleAssetUrl(pathname: string, buildId = APP_VERSION_INFO.buildId): string {
  const normalizedPath = pathname.startsWith('/battle/') ? pathname : `/battle/${pathname.replace(/^\/+/, '')}`;
  const separator = normalizedPath.includes('?') ? '&' : '?';
  return `${normalizedPath}${separator}v=${encodeURIComponent(buildId)}`;
}
