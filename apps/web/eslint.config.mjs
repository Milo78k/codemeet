import nextVitals from 'eslint-config-next/core-web-vitals';
import { webConfig } from '@codemeet/config/eslint';

const config = [
  { ignores: ['src/shared/api/generated/**', 'public/monaco/**', 'public/code-runner/**'] },
  ...nextVitals,
  ...webConfig,
  { files: ['codegen.ts'], rules: { 'no-restricted-syntax': 'off' } },
];

export default config;
