import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from './generated/client.js';

export function createPrismaClient(databaseUrl = process.env.DATABASE_URL): PrismaClient {
  if (!databaseUrl?.trim()) {
    throw new Error(
      'DATABASE_URL is required for database operations. Configure the root .env file.',
    );
  }

  const schema = new URL(databaseUrl).searchParams.get('schema') ?? 'public';
  const adapter = new PrismaPg({ connectionString: databaseUrl }, { schema });
  return new PrismaClient({ adapter });
}

// PrismaPg opens connections on the first database operation, not construction.
// This non-secret local fallback keeps health endpoints usable before DB setup.
export const prisma = createPrismaClient(
  process.env.DATABASE_URL?.trim() || 'postgresql://codemeet@127.0.0.1:5432/codemeet',
);
