import { readFileSync } from 'node:fs';

import { createSchema } from 'graphql-yoga';

import type { ApiContext } from './context.js';
import { resolvers } from './resolvers.js';

export const typeDefs = readFileSync(new URL('./schema.graphql', import.meta.url), 'utf8');

export const schema = createSchema<ApiContext>({ typeDefs, resolvers });
