import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import prettierConfig from 'eslint-config-prettier/flat';

export default [
  // Ignored paths
  {
    ignores: [
      'dist/',
      'dist-server/',
      'node_modules/',
      '.data/',
      'public/cards/',
      'scripts/db-migrate.cjs',
      'commitlint.config.cjs',
      'migrations/',
      '.claude/',
      '.git/',
      'coverage/',
      // Playwright E2E 測試使用專屬工具鏈，不納入專案 ESLint 規則
      'e2e/',
      'playwright.config.ts',
      'playwright-report/',
      'test-results/',
    ],
  },
  // Base recommended
  js.configs.recommended,
  // TypeScript-eslint recommended
  ...tseslint.configs.recommended,
  // React recommended (JSX runtime: automatic)
  react.configs.flat.recommended,
  react.configs.flat['jsx-runtime'],
  // React hooks recommended (flat config)
  reactHooks.configs['recommended-latest'],
  // React settings: detect version automatically
  {
    settings: {
      react: {
        version: 'detect',
      },
    },
  },
  // Node + browser globals for source and scripts
  {
    files: ['src/**/*.{js,jsx,ts,tsx}', 'scripts/**/*.{js,jsx,ts,tsx,mjs,cjs}'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  // The API entry point is CommonJS and intentionally remains a single file.
  // Keep it under the base no-undef rules so route typos cannot bypass CI.
  {
    files: ['api/server.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-undef': 'error',
      // The module intentionally imports node:crypto under the conventional
      // `crypto` name, which recent globals metadata also exposes globally.
      'no-redeclare': 'off',
    },
  },
  // Other API/admin entry points are also CommonJS. Keep the same runtime
  // globals and require policy so newly added services are linted rather than
  // silently ignored.
  {
    files: ['api/**/*.cjs', 'scripts/**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        URL: 'readonly',
        fetch: 'readonly',
        AbortSignal: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'no-undef': 'error',
      'no-redeclare': 'off',
    },
  },
  // Prettier: must be last to disable conflicting formatting rules
  prettierConfig,
];
