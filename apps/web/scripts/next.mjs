import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

// Load the shared root env without passing env-file flags to Next.js workers.
try {
  loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch (error) {
  if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
}

await import('next/dist/bin/next');
