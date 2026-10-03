import { prisma as defaultPrisma, type PrismaClient } from '@codemeet/db';
import { createYoga } from 'graphql-yoga';

import { createApiContext, type SessionEventPublisher } from './context.js';
import { maskApiError } from './errors.js';
import { schema } from './schema.js';
import { parseAllowedOrigins } from '../config/origins.js';

export interface GraphQLYogaOptions {
  prisma?: PrismaClient;
  demoAuthEnabled?: boolean;
  nodeEnv?: string;
  allowedOrigins?: readonly string[];
  publishSessionEvent?: SessionEventPublisher;
}

export function createGraphQLYoga(options: GraphQLYogaOptions = {}) {
  const prisma = options.prisma ?? defaultPrisma;
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? 'development';
  const demoAuthEnabled = options.demoAuthEnabled ?? process.env.DEMO_AUTH_ENABLED === 'true';
  const allowedOrigins = parseAllowedOrigins(
    options.allowedOrigins ?? process.env.CORS_ALLOWED_ORIGINS?.split(',') ?? [],
  );

  if (demoAuthEnabled && nodeEnv === 'production') {
    throw new Error('TEMP DEMO AUTH must not be enabled in production.');
  }

  return createYoga({
    schema,
    graphqlEndpoint: '/graphql',
    graphiql: nodeEnv === 'development',
    cors(request) {
      const origin = request.headers.get('origin');
      if (!origin || !allowedOrigins.has(origin)) return false;

      return {
        origin,
        methods: ['GET', 'POST'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        credentials: false,
      };
    },
    plugins: [
      {
        onResponse({ response }) {
          // The CORS builder varies even denied and preflight responses by Origin.
          response.headers.append('Vary', 'Origin');
        },
      },
    ],
    logging: false,
    context: ({ request }) =>
      createApiContext(
        prisma,
        demoAuthEnabled,
        request.headers.get('authorization'),
        options.publishSessionEvent,
      ),
    maskedErrors: {
      isDev: false,
      maskError(error) {
        const masked = maskApiError(error);
        if (masked !== error && nodeEnv === 'development') {
          console.error('[api] GraphQL operation failed:', error);
        }
        return masked;
      },
    },
  });
}
