import { describe, expect, it } from 'vitest';
import { classifyCiChanges, isLowRiskPath } from '../classify-ci-changes.mjs';

describe('CI change classification', () => {
  it('uses the documentation fast path for documentation-only changes', () => {
    expect(classifyCiChanges(['README.md', 'docs/DEPLOYMENT.md', 'LICENSE'])).toEqual({
      tier: 'docs',
      docsOnly: true,
      e2eRequired: false,
    });
  });

  it('uses standard verification for low-risk non-runtime changes', () => {
    expect(
      classifyCiChanges([
        '.env.example',
        'src/i18n/ja.ts',
        'src/components/Button.test.tsx',
        'api/__tests__/service.test.ts',
        '.github/ISSUE_TEMPLATE/bug.yml',
      ]),
    ).toEqual({ tier: 'standard', docsOnly: false, e2eRequired: false });
  });

  it('keeps E2E specs out of the low-risk test allowlist', () => {
    expect(isLowRiskPath('e2e/smoke.spec.ts')).toBe(false);
    expect(classifyCiChanges(['e2e/smoke.spec.ts'])).toEqual({
      tier: 'full',
      docsOnly: false,
      e2eRequired: true,
    });
  });

  it.each(['src/i18n/index.ts', 'src/game/cards/i18n.ts', 'scripts/cardNameTranslations.ts'])(
    'requires full verification for translation runtime logic in %s',
    (path) => {
      expect(classifyCiChanges([path])).toEqual({
        tier: 'full',
        docsOnly: false,
        e2eRequired: true,
      });
    },
  );

  it('does not normalize unusual changed filenames into the allowlist', () => {
    expect(classifyCiChanges([' src/i18n/ja.ts'])).toEqual({
      tier: 'full',
      docsOnly: false,
      e2eRequired: true,
    });
  });

  it.each([
    'src/App.tsx',
    'api/server.cjs',
    'migrations/000031_example.js',
    'Dockerfile',
    'package-lock.json',
    '.github/workflows/ci.yml',
  ])('requires full verification for %s', (path) => {
    expect(classifyCiChanges([path]).tier).toBe('full');
  });

  it('escalates mixed changes to the highest risk tier', () => {
    expect(classifyCiChanges(['README.md', 'src/App.tsx'])).toEqual({
      tier: 'full',
      docsOnly: false,
      e2eRequired: true,
    });
  });

  it('fails closed when no changed path is available', () => {
    expect(classifyCiChanges([])).toEqual({ tier: 'full', docsOnly: false, e2eRequired: true });
  });
});
