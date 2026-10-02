import { createPrismaClient, seedDatabase } from '../dist/index.js';

const client = createPrismaClient();

try {
  await seedDatabase(client);
  console.info(
    'Seed complete: demo interviewer, three questions, and demo interview are available.',
  );
} finally {
  await client.$disconnect();
}
