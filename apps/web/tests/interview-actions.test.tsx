import { describe, expect, test } from '@jest/globals';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse } from 'msw';

import { InterviewDetailsPage } from '@/features/interviews/InterviewDetailsPage';

import { apiError, interview } from './support/fixtures';
import { renderWithApi } from './support/render';
import { api, server } from './support/server';

describe('interview status actions', () => {
  test('starting READY interview renders the returned IN_PROGRESS state', async () => {
    let sentInterviewId: unknown;
    server.use(
      api.query('GetInterview', () => HttpResponse.json({ data: { interview: interview() } })),
      api.mutation('StartInterview', ({ variables }) => {
        sentInterviewId = variables.interviewId;
        return HttpResponse.json({
          data: {
            startInterview: interview('interview-ready', 'Frontend interview', 'IN_PROGRESS'),
          },
        });
      }),
    );
    const user = userEvent.setup();
    renderWithApi(<InterviewDetailsPage interviewId="interview-ready" />);
    await user.click(await screen.findByRole('button', { name: 'Start interview' }));
    expect(await screen.findByText('IN_PROGRESS')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Finish interview' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start interview' })).not.toBeInTheDocument();
    expect(sentInterviewId).toBe('interview-ready');
  });

  test('invalid transition displays the controlled error and preserves the server state', async () => {
    server.use(
      api.query('GetInterview', () => HttpResponse.json({ data: { interview: interview() } })),
      api.mutation('StartInterview', () =>
        HttpResponse.json(apiError('This interview has already started.', 'INVALID_STATE')),
      ),
    );
    const user = userEvent.setup();
    renderWithApi(<InterviewDetailsPage interviewId="interview-ready" />);
    await user.click(await screen.findByRole('button', { name: 'Start interview' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This interview has already started.',
    );
    expect(screen.getByText('READY')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start interview' })).toBeEnabled();
  });

  test('finishing an IN_PROGRESS interview renders FINISHED and removes mutation actions', async () => {
    server.use(
      api.query('GetInterview', () =>
        HttpResponse.json({
          data: {
            interview: interview('interview-ready', 'Frontend interview', 'IN_PROGRESS'),
          },
        }),
      ),
      api.mutation('FinishInterview', () =>
        HttpResponse.json({
          data: {
            finishInterview: interview('interview-ready', 'Frontend interview', 'FINISHED'),
          },
        }),
      ),
    );
    const user = userEvent.setup();
    renderWithApi(<InterviewDetailsPage interviewId="interview-ready" />);
    await user.click(await screen.findByRole('button', { name: 'Finish interview' }));
    expect(await screen.findByText('FINISHED')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Finish interview' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start interview' })).not.toBeInTheDocument();
  });
});
