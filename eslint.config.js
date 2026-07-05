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
      'api/server.cjs',
      '.claude/',
      '.git/',
      'coverage/',
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
  // Prettier: must be last to disable conflicting formatting rules
  prettierConfig,
];
