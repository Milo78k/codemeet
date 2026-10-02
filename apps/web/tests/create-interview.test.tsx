import { describe, expect, test } from '@jest/globals';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse } from 'msw';

import { CreateInterviewPage } from '@/features/interviews/CreateInterviewPage';

import {
  apiError,
  interview,
  question,
  questionsData,
  type QuestionResult,
} from './support/fixtures';
import { router } from './support/navigation';
import { renderWithApi } from './support/render';
import { api, server } from './support/server';

const firstQuestion = question('question-1', 'Two Sum');
const secondQuestion = question('question-2', 'Group By');

function questionLibrary() {
  return api.query('GetQuestions', () =>
    HttpResponse.json({
      data: questionsData([firstQuestion, secondQuestion]),
    }),
  );
}

describe('create interview', () => {
  test('requires at least one selected question before creating an interview', async () => {
    let createCount = 0;
    server.use(
      questionLibrary(),
      api.mutation('CreateInterview', () => {
        createCount += 1;
        return HttpResponse.json({ data: { createInterview: interview() } });
      }),
    );
    const user = userEvent.setup();
    renderWithApi(<CreateInterviewPage />);
    await screen.findByRole('checkbox', { name: 'Two Sum' });
    await user.type(screen.getByLabelText('Interview title'), 'Frontend interview');
    await user.click(screen.getByRole('button', { name: 'Create interview' }));
    expect(await screen.findByText('Select at least one question.')).toBeInTheDocument();
    expect(createCount).toBe(0);
    expect(router.push).not.toHaveBeenCalled();
  });

  test('creates once on submit and attaches the chosen question to make the interview READY', async () => {
    const calls: string[] = [];
    let title: unknown;
    let attachedQuestionId: unknown;
    server.use(
      questionLibrary(),
      api.mutation('CreateInterview', ({ variables }) => {
        calls.push('create');
        title = variables.input?.title;
        return HttpResponse.json({
          data: {
            createInterview: interview('created-interview', 'Frontend interview', 'DRAFT', []),
          },
        });
      }),
      api.mutation('AddQuestionToInterview', ({ variables }) => {
        calls.push('attach');
        attachedQuestionId = variables.questionId;
        return HttpResponse.json({
          data: {
            addQuestionToInterview: interview('created-interview', 'Frontend interview', 'READY', [
              firstQuestion,
            ]),
          },
        });
      }),
    );
    const user = userEvent.setup();
    renderWithApi(<CreateInterviewPage />);
    await user.type(screen.getByLabelText('Interview title'), 'Frontend interview');
    await user.click(await screen.findByRole('checkbox', { name: 'Two Sum' }));
    expect(calls).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Create interview' }));
    await waitFor(() => expect(router.push).toHaveBeenCalled());
    expect(calls).toEqual(['create', 'attach']);
    expect(title).toBe('Frontend interview');
    expect(attachedQuestionId).toBe('question-1');
    expect(router.push).toHaveBeenCalledWith(expect.stringContaining('created-interview'));
  });

  test('shows a controlled backend creation error and allows correction', async () => {
    server.use(
      questionLibrary(),
      api.mutation('CreateInterview', () =>
        HttpResponse.json(apiError('The interview title is not allowed.')),
      ),
    );
    const user = userEvent.setup();
    renderWithApi(<CreateInterviewPage />);
    await user.type(screen.getByLabelText('Interview title'), 'Frontend interview');
    await user.click(await screen.findByRole('checkbox', { name: 'Two Sum' }));
    await user.click(screen.getByRole('button', { name: 'Create interview' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The interview title is not allowed.',
    );
    expect(screen.getByLabelText('Interview title')).toHaveValue('Frontend interview');
    expect(screen.getByRole('button', { name: 'Create interview' })).toBeEnabled();
    expect(router.push).not.toHaveBeenCalled();
  });

  test('partial failure identifies the existing interview and retries only remaining attachments', async () => {
    let createCount = 0;
    const attachmentCalls: unknown[] = [];
    const attachmentInterviewIds: unknown[] = [];
    const attached: QuestionResult[] = [];
    let retryAllowed = false;
    server.use(
      questionLibrary(),
      api.mutation('CreateInterview', () => {
        createCount += 1;
        return HttpResponse.json({
          data: {
            createInterview: interview('partial-interview', 'Frontend interview', 'DRAFT', []),
          },
        });
      }),
      api.query('GetInterview', () =>
        HttpResponse.json({
          data: {
            interview: interview('partial-interview', 'Frontend interview', 'READY', attached),
          },
        }),
      ),
      api.mutation('AddQuestionToInterview', ({ variables }) => {
        attachmentCalls.push(variables.questionId);
        attachmentInterviewIds.push(variables.interviewId);
        if (variables.questionId === 'question-2' && !retryAllowed) {
          return HttpResponse.json(
            apiError('Second question is temporarily unavailable.', 'NOT_FOUND'),
          );
        }
        attached.push(variables.questionId === 'question-1' ? firstQuestion : secondQuestion);
        return HttpResponse.json({
          data: {
            addQuestionToInterview: interview(
              'partial-interview',
              'Frontend interview',
              'READY',
              attached,
            ),
          },
        });
      }),
    );
    const user = userEvent.setup();
    renderWithApi(<CreateInterviewPage />);
    await user.type(screen.getByLabelText('Interview title'), 'Frontend interview');
    await user.click(await screen.findByRole('checkbox', { name: 'Two Sum' }));
    await user.click(screen.getByRole('checkbox', { name: 'Group By' }));
    await user.click(screen.getByRole('button', { name: 'Create interview' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('partial-interview');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This item could not be found. Refresh the page and try again.',
    );
    expect(screen.getByLabelText('Interview title')).toBeDisabled();
    expect(router.push).not.toHaveBeenCalled();
    retryAllowed = true;
    await user.click(screen.getByRole('button', { name: 'Retry remaining questions' }));
    await waitFor(() => expect(router.push).toHaveBeenCalled());
    expect(createCount).toBe(1);
    expect(attachmentCalls).toEqual(['question-1', 'question-2', 'question-2']);
    expect(attachmentInterviewIds).toEqual([
      'partial-interview',
      'partial-interview',
      'partial-interview',
    ]);
    expect(attached.map(({ id }) => id)).toEqual(['question-1', 'question-2']);
  });

  test('retry confirms a committed attachment after a lost response instead of adding it twice', async () => {
    let createCount = 0;
    let reconciliationCount = 0;
    const attachmentCalls: unknown[] = [];
    const attached: QuestionResult[] = [];
    server.use(
      questionLibrary(),
      api.mutation('CreateInterview', () => {
        createCount += 1;
        return HttpResponse.json({
          data: {
            createInterview: interview('recovered-interview', 'Frontend interview', 'DRAFT', []),
          },
        });
      }),
      api.query('GetInterview', ({ variables }) => {
        expect(variables.id).toBe('recovered-interview');
        reconciliationCount += 1;
        return HttpResponse.json({
          data: {
            interview: interview('recovered-interview', 'Frontend interview', 'READY', attached),
          },
        });
      }),
      api.mutation('AddQuestionToInterview', ({ variables }) => {
        expect(variables.interviewId).toBe('recovered-interview');
        attachmentCalls.push(variables.questionId);
        attached.push(variables.questionId === 'question-1' ? firstQuestion : secondQuestion);
        if (variables.questionId === 'question-1') return HttpResponse.error();
        return HttpResponse.json({
          data: {
            addQuestionToInterview: interview(
              'recovered-interview',
              'Frontend interview',
              'READY',
              attached,
            ),
          },
        });
      }),
    );
    const user = userEvent.setup();
    renderWithApi(<CreateInterviewPage />);
    await user.type(screen.getByLabelText('Interview title'), 'Frontend interview');
    await user.click(await screen.findByRole('checkbox', { name: 'Two Sum' }));
    await user.click(screen.getByRole('checkbox', { name: 'Group By' }));
    await user.click(screen.getByRole('button', { name: 'Create interview' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('recovered-interview');
    expect(router.push).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Retry remaining questions' }));
    await waitFor(() => expect(router.push).toHaveBeenCalled());
    expect(createCount).toBe(1);
    expect(reconciliationCount).toBeGreaterThan(0);
    expect(attachmentCalls).toEqual(['question-1', 'question-2']);
    expect(attached.map(({ id }) => id)).toEqual(['question-1', 'question-2']);
  });
});
