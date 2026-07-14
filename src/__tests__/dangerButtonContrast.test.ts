import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readRepoFile(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

describe('danger button contrast', () => {
  it('uses the dedicated dark danger surface instead of the text accent', () => {
    const colorTokens = readRepoFile('src/ui/tokens/colors.css');
    const buttonSource = readRepoFile('src/ui/primitives/Button.tsx');

    expect(colorTokens).toContain('--accent-danger-surface: var(--rose-600)');
    expect(buttonSource).toContain('bg-accent-danger-surface text-content-primary');
    expect(buttonSource).not.toContain('bg-accent-danger text-content-primary');
  });
});
