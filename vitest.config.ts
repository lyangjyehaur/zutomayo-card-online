import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts', 'api/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Keep the Node/Vitest gate focused on production modules exercised by
      // unit tests. Browser-only pages/components are covered by Playwright;
      // API CommonJS is intentionally included rather than excluded.
      include: [
        'src/game/**/*.{ts,tsx}',
        'src/platform/**/*.{ts,tsx}',
        'src/chat/**/*.ts',
        'src/server/**/*.ts',
        'src/online*.ts',
        'src/anonymousIdentity.ts',
        'src/api/**/*.ts',
        'src/hooks/online*.ts',
        'src/lib/**/*.ts',
        'api/**/*.cjs',
      ],
      exclude: ['**/.DS_Store', '**/__tests__/**', '**/*.test.ts', '**/node_modules/**', '**/dist/**'],
      thresholds: {
        lines: 50,
        functions: 50,
        branches: 40,
        statements: 50,
      },
    },
  },
});
