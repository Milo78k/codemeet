import { setupServer } from 'msw/node';
import { graphql } from 'msw/graphql';
import { HttpResponse } from 'msw';

export const api = graphql.link('http://127.0.0.1:4000/graphql');
export const server = setupServer(
  api.query('GetCurrentParticipant', () =>
    HttpResponse.json({ data: { currentParticipant: null } }),
  ),
  api.query('GetCodeRuns', ({ variables }) =>
    HttpResponse.json({
      data: {
        codeRuns: {
          __typename: 'CodeRunPage',
          items: [],
          pageInfo: {
            __typename: 'PageInfo',
            limit: variables.limit ?? 20,
            offset: variables.offset ?? 0,
            totalCount: 0,
            hasNextPage: false,
          },
        },
      },
    }),
  ),
  api.mutation('RecordCodeRun', ({ variables }) =>
    HttpResponse.json({
      data: {
        recordCodeRun: {
          __typename: 'CodeRun',
          id: variables.input.runId,
          interviewId: variables.interviewId,
          interviewQuestionId: variables.input.interviewQuestionId,
          language: variables.input.language,
          status: variables.input.status,
          createdAt: '2026-10-03T12:00:00.000Z',
        },
      },
    }),
  ),
);
