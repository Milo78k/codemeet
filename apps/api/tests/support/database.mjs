import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createPrismaClient, seedDatabase } from '@codemeet/db';

const databasePackage = fileURLToPath(new URL('../../../../packages/db/', import.meta.url));
const prismaCli = fileURLToPath(
  new URL('../../../../packages/db/node_modules/prisma/build/index.js', import.meta.url),
);
const prismaSchema = fileURLToPath(
  new URL('../../../../packages/db/prisma/schema.prisma', import.meta.url),
);

export function getTestDatabaseUrl() {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) {
    throw new Error(
      'TEST_DATABASE_URL is required. Use a dedicated PostgreSQL database named codemeet_test or ending in _test.',
    );
  }

  const url = new URL(value);
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !/^[A-Za-z0-9_]+_test$/.test(databaseName)
  ) {
    throw new Error('Integration tests require a dedicated database whose name ends in _test.');
  }
  return url;
}

export function withSchema(url, schema) {
  const scopedUrl = new URL(url);
  scopedUrl.searchParams.set('schema', schema);
  return scopedUrl.toString();
}

function migrate(databaseUrl) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [prismaCli, 'migrate', 'deploy', '--schema', prismaSchema],
      {
        cwd: databasePackage,
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
          PRISMA_HIDE_UPDATE_MESSAGE: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 60_000,
      },
    );
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `Test migration failed (${code}): ${output.replaceAll(databaseUrl, '[test database]')}`,
          ),
        );
      }
    });
  });
}

export async function createTestDatabase() {
  const baseUrl = getTestDatabaseUrl();
  const schema = `cm_test_${randomUUID().replaceAll('-', '')}`;
  const admin = createPrismaClient(withSchema(baseUrl, 'public'));
  const databaseUrl = withSchema(baseUrl, schema);
  const prisma = createPrismaClient(databaseUrl);
  let schemaCreated = false;

  async function cleanup() {
    await prisma.$disconnect();
    try {
      if (schemaCreated) {
        // Identifiers are generated locally and validated before interpolation.
        // DROP never targets public, a user-supplied schema, or another test run.
        if (!/^cm_test_[a-f0-9]{32}$/.test(schema)) {
          throw new Error('Refusing to drop an unrecognized test schema.');
        }
        await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        schemaCreated = false;
      }
    } finally {
      await admin.$disconnect();
    }
  }

  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    await migrate(databaseUrl);
    await seedDatabase(prisma);
    return { prisma, databaseUrl, schema, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
