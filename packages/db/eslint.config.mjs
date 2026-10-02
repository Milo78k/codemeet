import { nodeConfig } from '@codemeet/config/eslint';

export default [
  ...nodeConfig,
  { ignores: ['src/generated/**'] },
  {
    files: ['prisma.config.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
];
