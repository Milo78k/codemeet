import { copyFile, mkdir } from 'node:fs/promises';

const destination = new URL('../dist/graphql/schema.graphql', import.meta.url);
await mkdir(new URL('../dist/graphql/', import.meta.url), { recursive: true });
await copyFile(new URL('../src/graphql/schema.graphql', import.meta.url), destination);
