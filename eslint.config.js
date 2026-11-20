import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'context/**',
      'design-system/**',
      'designs/**',
      'assets/**',
      '**/node_modules/**',
      '**/.next/**',
      '**/out/**',
      '**/.netlify/**', // the Netlify CLI's build cache (netlify deploy)
      '**/coverage/**',
      '**/test-results/**',
      '**/playwright-report/**',
      '**/next-env.d.ts',
      '**/*.local.mjs',
      '**/build/**',
      '**/.gradle/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      // noUncheckedIndexedAccess is on; `xs[i]!` after a bounds check is the idiomatic escape hatch.
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
