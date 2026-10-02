import { ApolloClient, HttpLink } from '@apollo/client';
import { SetContextLink } from '@apollo/client/link/context';

import { createCache } from './cache';
import { readParticipantAuthorization } from './participant-session';

export function createApolloClient(uri: string) {
  const url = new URL(uri);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('NEXT_PUBLIC_GRAPHQL_URL must be an absolute HTTP(S) URL.');
  }

  return new ApolloClient({
    cache: createCache(),
    link: new SetContextLink((previousContext) => {
      const authorization = readParticipantAuthorization();
      const headers = { ...previousContext.headers };
      if (authorization) headers.authorization = authorization;
      else delete headers.authorization;
      return {
        headers,
      };
    }).concat(new HttpLink({ uri: url.href, credentials: 'omit' })),
    ssrMode: typeof window === 'undefined',
    defaultOptions: {
      watchQuery: { fetchPolicy: 'cache-first', notifyOnNetworkStatusChange: true },
    },
  });
}
