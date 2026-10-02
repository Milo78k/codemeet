import { setupServer } from 'msw/node';
import { graphql } from 'msw/graphql';
import { HttpResponse } from 'msw';

export const api = graphql.link('http://127.0.0.1:4000/graphql');
export const server = setupServer(
  api.query('GetCurrentParticipant', () =>
    HttpResponse.json({ data: { currentParticipant: null } }),
  ),
);
