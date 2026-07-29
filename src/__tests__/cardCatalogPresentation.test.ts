import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('card catalog presentation', () => {
  it('keeps internal display-only review reasons out of the public catalog', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/pages/CardCatalogPage.tsx'), 'utf8');

    expect(source).not.toContain('selectedCard.playStatusReason');
    expect(source).toContain("t('cardCatalog.notPlayable')");
  });
});
