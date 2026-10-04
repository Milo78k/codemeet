import { ApolloProvider } from '@apollo/client/react';
import { render } from '@testing-library/react';
import { useMemo, type PropsWithChildren, type ReactElement } from 'react';

import { createApolloClient } from '@/shared/api/client';

function ApiProvider({ children }: PropsWithChildren) {
  const client = useMemo(() => createApolloClient('http://127.0.0.1:4000/graphql'), []);
  return <ApolloProvider client={client}>{children}</ApolloProvider>;
}

export function renderWithApi(ui: ReactElement) {
  return render(ui, { wrapper: ApiProvider });
}
