// @ts-check
import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', '**/migrations/**', '**/public/**', '**/*.config.*', '**/next-env.d.ts', '**/.test-storage/**', '**/storage-data/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['apps/*-web/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, '@next/next': nextPlugin },
    rules: { ...reactHooks.configs.recommended.rules, ...nextPlugin.configs.recommended.rules, '@next/next/no-html-link-for-pages': 'off', '@next/next/no-page-custom-font': 'off' },
  },
  { files: ['**/scripts/**', '**/test/**', '**/testing/**'], rules: { 'no-console': 'off' } },
);
