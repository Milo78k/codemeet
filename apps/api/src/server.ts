import { createServer } from 'node:http';

import { prisma as defaultPrisma } from '@codemeet/db';
import { attachCollaborationWebSocket } from './collaboration/collaboration-server.js';
import { parseAllowedOrigins } from './config/origins.js';
import { createGraphQLYoga, type GraphQLYogaOptions } from './graphql/yoga.js';

export function createApiServer(options: GraphQLYogaOptions = {}) {
  const allowedOrigins =
    options.allowedOrigins ?? process.env.CORS_ALLOWED_ORIGINS?.split(',') ?? [];
  const yoga = createGraphQLYoga({ ...options, allowedOrigins });
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? 'development';
  const demoAuthEnabled = options.demoAuthEnabled ?? process.env.DEMO_AUTH_ENABLED === 'true';

  const server = createServer((request, response) => {
    const pathname = request.url?.split('?')[0];

    if (pathname === '/graphql') {
      void yoga(request, response);
      return;
    }

    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');

    if (pathname !== '/health') {
      response.writeHead(404);
      response.end(JSON.stringify({ error: 'NOT_FOUND' }));
      return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      response.writeHead(405);
      response.end(JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }));
      return;
    }

    response.writeHead(200);
    response.end(JSON.stringify({ service: 'codemeet-api', status: 'ok' }));
  });

  attachCollaborationWebSocket(server, {
    prisma: options.prisma ?? defaultPrisma,
    demoAuthEnabled,
    nodeEnv,
    allowedOrigins: [...parseAllowedOrigins(allowedOrigins)],
  });

  return server;
}
