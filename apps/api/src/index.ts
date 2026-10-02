import { prisma } from '@codemeet/db';

import { createApiServer } from './server.js';

const host = process.env.API_HOST ?? '127.0.0.1';
const port = Number(process.env.API_PORT ?? '4000');

if (!host.trim() || !Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error(
    'API_HOST must be non-empty and API_PORT must be an integer between 1 and 65535.',
  );
}

const server = createApiServer();

server.once('error', (error) => {
  console.error('[api] Server failed:', error.message);
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.info(`[api] Listening on http://${host}:${port}`);
});

let shuttingDown = false;

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;

  server.close((error) => {
    if (error) {
      console.error('[api] Shutdown failed:', error.message);
      process.exitCode = 1;
    }

    void prisma.$disconnect().catch((disconnectError: unknown) => {
      console.error('[api] Database disconnect failed:', disconnectError);
      process.exitCode = 1;
    });
  });

  setTimeout(() => server.closeAllConnections(), 5_000).unref();
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
