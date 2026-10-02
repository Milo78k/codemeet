import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export const baseConfig = [
  {
    ignores: ['**/node_modules/**', '**/.next/**', '**/dist/**', '**/next-env.d.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportDefaultDeclaration',
          message: 'Use named exports. Default exports are reserved for framework entry points.',
        },
        {
          selector: 'ExportNamedDeclaration > ExportSpecifier[exported.name="default"]',
          message: 'Use named exports. Do not re-export a default export.',
        },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['**/eslint.config.mjs', '**/jest.config.mjs'],
    rules: { 'no-restricted-syntax': 'off' },
  },
];

export const nodeConfig = [
  ...baseConfig,
  {
    files: ['**/*.{js,mjs,cjs,ts}'],
    languageOptions: { globals: globals.node },
  },
];

export const webConfig = [
  ...baseConfig,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    files: ['src/app/**/{page,layout,loading,error,not-found,global-error,template,default}.tsx'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    files: ['next.config.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
];
