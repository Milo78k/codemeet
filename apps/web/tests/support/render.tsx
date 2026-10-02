import { ApolloProvider } from '@apollo/client/react';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';

import { createApolloClient } from '@/shared/api/client';

export function renderWithApi(ui: ReactElement) {
  const client = createApolloClient('http://127.0.0.1:4000/graphql');
  return render(<ApolloProvider client={client}>{ui}</ApolloProvider>);
}
