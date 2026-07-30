const STATIC_FILE_PATH = /\/(?:[^/]*\.)[^/]+$/;

export function shouldServeSpaFallback(pathname: string): boolean {
  return !pathname.startsWith('/games/') && !STATIC_FILE_PATH.test(pathname);
}
