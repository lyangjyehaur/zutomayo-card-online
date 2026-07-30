export function versionBattleAssetCssUrls(css: string, buildId: string): string {
  const version = encodeURIComponent(buildId);
  return css.replace(/url\((['"]?)(\/battle\/[^'")?]+)\1\)/g, `url($1$2?v=${version}$1)`);
}
