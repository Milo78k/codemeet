import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { WebApolloProvider } from '../shared/api/ApolloProvider';
import { AppShell } from './AppShell';

import './globals.css';

export const metadata: Metadata = {
  title: 'CodeMeet',
  description: 'Your question library and technical interviews, organized.',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <WebApolloProvider>
          <AppShell>{children}</AppShell>
        </WebApolloProvider>
      </body>
    </html>
  );
}
