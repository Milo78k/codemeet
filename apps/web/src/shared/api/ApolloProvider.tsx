'use client';

import { ApolloProvider } from '@apollo/client/react';
import { useState, type ReactNode } from 'react';

import { createApolloClient } from './client';

export function WebApolloProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => {
    const uri = process.env.NEXT_PUBLIC_GRAPHQL_URL;
    if (!uri) return null;
    try {
      return createApolloClient(uri);
    } catch {
      return null;
    }
  });

  if (!client) {
    return (
      <main role="alert">
        <h1>CodeMeet needs an API endpoint</h1>
        <p>
          Set NEXT_PUBLIC_GRAPHQL_URL in the root .env file and restart the development server.
          Rebuild for production.
        </p>
      </main>
    );
  }

  return <ApolloProvider client={client}>{children}</ApolloProvider>;
}
