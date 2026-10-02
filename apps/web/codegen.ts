import type { CodegenConfig } from '@graphql-codegen/cli';

const config: CodegenConfig = {
  schema: '../api/src/graphql/schema.graphql',
  documents: ['src/features/**/api/*.graphql'],
  ignoreNoDocuments: false,
  generates: {
    'src/shared/api/generated/graphql.ts': {
      plugins: ['typescript-operations', 'typed-document-node'],
      config: {
        nonOptionalTypename: true,
        skipTypeNameForRoot: true,
        namingConvention: { enumValues: 'keep' },
        useTypeImports: true,
      },
    },
  },
};

export default config;
