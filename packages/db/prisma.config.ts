import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node --env-file-if-exists=../../.env --import tsx prisma/seed.ts',
  },
  datasource: {
    // A non-secret local placeholder lets generate/validate work without a database.
    // Commands that connect to PostgreSQL still need the real DATABASE_URL.
    url: process.env.DATABASE_URL?.trim() || 'postgresql://codemeet@127.0.0.1:5432/codemeet',
  },
});
