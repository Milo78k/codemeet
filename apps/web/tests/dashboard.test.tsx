import { expect, test } from '@jest/globals';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse } from 'msw';

import { DashboardPage } from '@/features/interviews/DashboardPage';
import type { GetInterviewsQueryVariables } from '@/shared/api/generated/graphql';

import { interview, interviewsData, question, questionsData } from './support/fixtures';
import { renderWithApi } from './support/render';
import { api, server } from './support/server';

test('dashboard renders API data and omits a blank status on initial load and after clearing', async () => {
  const requests: GetInterviewsQueryVariables[] = [];
  server.use(
    api.query('GetQuestions', () =>
      HttpResponse.json({ data: questionsData([question()], 0, 23, 1) }),
    ),
    api.query('GetInterviews', ({ variables }) => {
      requests.push(variables);
      expect(variables.status).not.toBeNull();
      const offset = typeof variables.offset === 'number' ? variables.offset : 0;
      const filtered = variables.status === 'FINISHED';
      return HttpResponse.json({
        data: interviewsData(
          [
            interview(
              offset ? 'next-interview' : filtered ? 'finished-interview' : 'all-interview',
              offset ? 'Next interview' : filtered ? 'Finished interview' : 'Recent interview',
              filtered ? 'FINISHED' : 'READY',
            ),
          ],
          offset,
          7,
        ),
      });
    }),
  );
  const user = userEvent.setup();
  renderWithApi(<DashboardPage />);
  expect(await screen.findByRole('link', { name: 'Recent interview' })).toBeInTheDocument();
  expect(await screen.findByText('23')).toBeInTheDocument();
  expect(screen.getByText('READY')).toBeInTheDocument();
  expect(requests[0]).toEqual({ limit: 6, offset: 0 });
  await user.selectOptions(screen.getByLabelText('Status'), 'FINISHED');
  await screen.findByRole('link', { name: 'Finished interview' });
  expect(requests.at(-1)?.status).toBe('FINISHED');
  await user.selectOptions(screen.getByLabelText('Status'), '');
  await screen.findByRole('link', { name: 'Recent interview' });
  await user.click(screen.getByRole('button', { name: 'Load more interviews' }));
  expect(await screen.findByRole('link', { name: 'Next interview' })).toBeInTheDocument();
  expect(requests.at(-1)).toEqual({ limit: 6, offset: 6 });
  expect(screen.getByRole('link', { name: 'Recent interview' })).toBeInTheDocument();
});
