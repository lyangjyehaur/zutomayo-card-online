import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const typography = readFileSync('src/ui/tokens/typography.css', 'utf8');
const viteConfig = readFileSync('vite.config.ts', 'utf8');

describe('display font delivery', () => {
  it('loads compact UI faces before complete same-design fallbacks', () => {
    expect(typography).toContain("font-family: 'Uoq Mun Then Khung UI'");
    expect(typography).toContain("font-family: 'Jiangcheng Jiexing UI'");
    expect(typography).toContain("'Uoq Mun Then Khung UI', 'Uoq Mun Then Khung'");
    expect(typography).toContain("'Jiangcheng Jiexing UI', 'Jiangcheng Jiexing'");
    expect(typography).not.toContain('font-display: optional');
  });

  it.each([
    ['public/fonts/uoq-mun-then-khung-ui-v1.woff2', 'public/fonts/uoq-mun-then-khung-regular.woff2'],
    ['public/fonts/jiangcheng-jiexing-ui-v1.woff2', 'public/fonts/jiangcheng-jiexing-v1.3.woff2'],
  ])('keeps %s substantially smaller than its complete face', (subsetPath, completePath) => {
    const subsetBytes = statSync(subsetPath).size;
    const completeBytes = statSync(completePath).size;
    expect(subsetBytes).toBeLessThan(600_000);
    expect(subsetBytes).toBeLessThan(completeBytes / 3);
  });

  it('precaches UI subsets while runtime-caching complete fallback faces', () => {
    expect(viteConfig).toContain("'fonts/uoq-mun-then-khung-regular.woff2'");
    expect(viteConfig).toContain("'fonts/jiangcheng-jiexing-v1.3.woff2'");
    expect(viteConfig).toContain("cacheName: 'display-fonts-complete'");
  });
});
