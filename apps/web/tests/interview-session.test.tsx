import { describe, expect, test } from '@jest/globals';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse } from 'msw';

import { InterviewDetailsPage } from '@/features/interviews/InterviewDetailsPage';
import { InterviewSessionPage } from '@/features/interviews/InterviewSessionPage';
import type {
  GetInterviewQuery,
  GetInterviewQueryVariables,
  SetActiveQuestionMutation,
  SetActiveQuestionMutationVariables,
} from '@/shared/api/generated/graphql';

import { apiError, deferred, interview, question, type InterviewResult } from './support/fixtures';
import { router } from './support/navigation';
import { renderWithApi } from './support/render';
import { storeParticipantSession } from '@/shared/api/participant-session';
import { api, server } from './support/server';

const interviewId = 'session-interview';
const firstTitle = 'Frozen Two Sum';
const secondTitle = 'Frozen Group By';
const firstCode = 'function twoSum(nums, target) {\n  // Preserve this starter code.\n}';
const secondCode = 'export function groupBy<T>(items: T[]) {\n  return items;\n}';

function sessionInterview(
  status: InterviewResult['status'] = 'IN_PROGRESS',
  overrides: Partial<InterviewResult> = {},
): InterviewResult {
  return {
    ...interview(interviewId, 'Frontend session', status, [
      question('question-1', firstTitle, {
        description: 'Find two numbers using the frozen interview requirements.',
        starterCode: firstCode,
      }),
      question('question-2', secondTitle, {
        description: 'Group items using the frozen interview requirements.',
        difficulty: 'MEDIUM',
        language: 'TYPESCRIPT',
        starterCode: secondCode,
        createdAt: '2024-01-01T09:00:00.000Z',
      }),
    ]),
    ...overrides,
  };
}

function currentInterviewHandler(value: InterviewResult | null, onRead?: () => void) {
  return api.query<GetInterviewQuery, GetInterviewQueryVariables>(
    'GetInterview',
    ({ variables }) => {
      expect(variables.id).toBe(interviewId);
      onRead?.();
      return HttpResponse.json({ data: { interview: value } });
    },
  );
}

function secondActive(value = sessionInterview()): InterviewResult {
  return { ...value, activeQuestion: value.questions[1]?.question ?? null };
}

function questionNavigation() {
  return screen.getByRole('navigation', { name: 'Questions' });
}

async function renderSession(value = sessionInterview()) {
  server.use(currentInterviewHandler(value));
  renderWithApi(<InterviewSessionPage interviewId={interviewId} />);
  await screen.findByRole('heading', { name: firstTitle });
}

describe('interview session', () => {
  test('renders the active snapshot and initializes the editor with captured starter code', async () => {
    await renderSession();
    expect(screen.getByRole('heading', { name: 'Frontend session' })).toBeInTheDocument();
    expect(screen.getByText('IN_PROGRESS')).toBeInTheDocument();
    expect(
      screen.getByText('Find two numbers using the frozen interview requirements.'),
    ).toBeInTheDocument();
    expect(await screen.findByRole('textbox', { name: 'Code editor' })).toHaveValue(firstCode);
  });

  test('renders questions in InterviewQuestion order rather than title or source creation date', async () => {
    await renderSession();
    const buttons = within(questionNavigation()).getAllByRole('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveAccessibleName(new RegExp(firstTitle));
    expect(buttons[1]).toHaveAccessibleName(new RegExp(secondTitle));
  });

  test('candidate session keeps task access but hides Finish and question switching controls', async () => {
    const candidate = sessionInterview('IN_PROGRESS', {
      createdBy: null,
      participants: [
        {
          __typename: 'InterviewParticipant',
          id: 'candidate-1',
          interviewId,
          displayName: 'Anton',
          role: 'CANDIDATE',
          joinedAt: '2026-10-02T10:00:00.000Z',
          user: null,
        },
      ],
    });
    server.use(
      currentInterviewHandler(candidate),
      api.query('GetCurrentParticipant', () =>
        HttpResponse.json({
          data: {
            currentParticipant: {
              __typename: 'InterviewParticipant',
              id: 'candidate-1',
              interviewId,
              displayName: 'Anton',
              role: 'CANDIDATE',
              joinedAt: '2026-10-02T10:00:00.000Z',
            },
          },
        }),
      ),
    );
    renderWithApi(<InterviewSessionPage interviewId={interviewId} />);

    expect(await screen.findByText('Joined as Anton')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Finish interview' })).not.toBeInTheDocument();
    expect(
      within(questionNavigation()).getByRole('button', { name: new RegExp(secondTitle) }),
    ).toBeDisabled();
    expect(await screen.findByRole('textbox', { name: 'Code editor' })).toHaveValue(firstCode);
  });

  test('restores candidate identity from sessionStorage on refresh and authenticates GraphQL', async () => {
    const token = 'r'.repeat(43);
    storeParticipantSession({
      role: 'candidate',
      token,
      interviewId,
      expiresAt: '2026-10-09T10:00:00.000Z',
    });
    server.use(
      currentInterviewHandler(sessionInterview('IN_PROGRESS', { createdBy: null })),
      api.query('GetCurrentParticipant', ({ request }) => {
        expect(request.headers.get('authorization')).toBe(`Bearer ${token}`);
        return HttpResponse.json({
          data: {
            currentParticipant: {
              __typename: 'InterviewParticipant',
              id: 'candidate-1',
              interviewId,
              displayName: 'Anton',
              role: 'CANDIDATE',
              joinedAt: '2026-10-02T10:00:00.000Z',
            },
          },
        });
      }),
    );
    renderWithApi(<InterviewSessionPage interviewId={interviewId} />);
    expect(await screen.findByText('Joined as Anton')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Finish interview' })).not.toBeInTheDocument();
  });

  test('switches through the typed mutation without requesting the interview again', async () => {
    let readCount = 0;
    let input: SetActiveQuestionMutationVariables | undefined;
    const current = sessionInterview();
    server.use(
      currentInterviewHandler(current, () => {
        readCount += 1;
      }),
      api.mutation<SetActiveQuestionMutation, SetActiveQuestionMutationVariables>(
        'SetActiveQuestion',
        ({ variables }) => {
          input = variables;
          return HttpResponse.json({ data: { setActiveQuestion: secondActive(current) } });
        },
      ),
    );
    const user = userEvent.setup();
    renderWithApi(<InterviewSessionPage interviewId={interviewId} />);
    await screen.findByRole('heading', { name: firstTitle });
    await user.click(
      within(questionNavigation()).getByRole('button', { name: new RegExp(secondTitle) }),
    );
    expect(await screen.findByRole('heading', { name: secondTitle })).toBeInTheDocument();
    expect(await screen.findByRole('textbox', { name: 'Code editor' })).toHaveValue(secondCode);
    expect(input).toEqual({ interviewId, questionId: 'question-2' });
    expect(readCount).toBe(1);
  });

  test('shows a controlled switching error and keeps the previously confirmed active task', async () => {
    server.use(
      currentInterviewHandler(sessionInterview()),
      api.mutation('SetActiveQuestion', () =>
        HttpResponse.json(apiError('This interview is no longer in progress.', 'INVALID_STATE')),
      ),
    );
    const user = userEvent.setup();
    renderWithApi(<InterviewSessionPage interviewId={interviewId} />);
    await screen.findByRole('heading', { name: firstTitle });
    await user.click(
      within(questionNavigation()).getByRole('button', { name: new RegExp(secondTitle) }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This interview is no longer in progress.',
    );
    expect(screen.getByRole('heading', { name: firstTitle })).toBeInTheDocument();
    expect(
      within(questionNavigation()).getByRole('button', { name: new RegExp(firstTitle) }),
    ).toHaveAttribute('aria-current', 'true');
  });

  test('keeps the server highlight until success and prevents rapid conflicting actions', async () => {
    const response = deferred();
    let mutationCount = 0;
    server.use(
      currentInterviewHandler(sessionInterview()),
      api.mutation('SetActiveQuestion', async () => {
        mutationCount += 1;
        await response.promise;
        return HttpResponse.json({ data: { setActiveQuestion: secondActive() } });
      }),
    );
    const user = userEvent.setup();
    renderWithApi(<InterviewSessionPage interviewId={interviewId} />);
    await screen.findByRole('heading', { name: firstTitle });
    const navigation = questionNavigation();
    const first = within(navigation).getByRole('button', { name: new RegExp(firstTitle) });
    const second = within(navigation).getByRole('button', { name: new RegExp(secondTitle) });
    await user.click(second);
    await waitFor(() => expect(mutationCount).toBe(1));
    expect(first).toHaveAttribute('aria-current', 'true');
    expect(second).not.toHaveAttribute('aria-current', 'true');
    expect(second).toBeDisabled();
    expect(screen.getByLabelText('Active question')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Finish interview' })).toBeDisabled();
    await user.click(second);
    expect(mutationCount).toBe(1);
    response.resolve();
    await screen.findByRole('heading', { name: secondTitle });
    expect(second).toHaveAttribute('aria-current', 'true');
    expect(first).not.toHaveAttribute('aria-current', 'true');
  });

  test.each(['DRAFT', 'READY'] as const)(
    '%s shows the not-started state and summary link',
    async (status) => {
      server.use(currentInterviewHandler(sessionInterview(status)));
      renderWithApi(<InterviewSessionPage interviewId={interviewId} />);
      expect(await screen.findByText('Interview has not started yet')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Back to interview' })).toHaveAttribute(
        'href',
        `/interviews/${interviewId}`,
      );
      expect(screen.queryByRole('button', { name: 'Finish interview' })).not.toBeInTheDocument();
      expect(screen.queryByRole('navigation', { name: 'Questions' })).not.toBeInTheDocument();
    },
  );

  test('FINISHED gives the interviewer a results link and removes session controls', async () => {
    server.use(currentInterviewHandler(sessionInterview('FINISHED')));
    renderWithApi(<InterviewSessionPage interviewId={interviewId} />);
    expect(await screen.findByText('Interview is finished')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View results' })).toHaveAttribute(
      'href',
      `/interviews/${interviewId}/results`,
    );
    expect(screen.queryByRole('button', { name: 'Finish interview' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Questions' })).not.toBeInTheDocument();
  });

  test('finished interviewer overview exposes the View results call to action', async () => {
    server.use(currentInterviewHandler(sessionInterview('FINISHED')));
    renderWithApi(<InterviewDetailsPage interviewId={interviewId} />);
    expect(await screen.findByRole('link', { name: 'View results' })).toHaveAttribute(
      'href',
      `/interviews/${interviewId}/results`,
    );
  });

  test('FINISHED candidate state does not expose the interviewer results route', async () => {
    const finished = sessionInterview('FINISHED', { createdBy: null });
    server.use(
      currentInterviewHandler(finished),
      api.query('GetCurrentParticipant', () =>
        HttpResponse.json({
          data: {
            currentParticipant: {
              __typename: 'InterviewParticipant',
              id: 'candidate-finished',
              interviewId,
              displayName: 'Candidate',
              role: 'CANDIDATE',
              joinedAt: '2026-10-02T10:00:00.000Z',
            },
          },
        }),
      ),
    );
    renderWithApi(<InterviewSessionPage interviewId={interviewId} />);
    expect(await screen.findByText('The interviewer has ended the session.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'View results' })).not.toBeInTheDocument();
  });

  test('missing interview shows a controlled state', async () => {
    server.use(currentInterviewHandler(null));
    renderWithApi(<InterviewSessionPage interviewId={interviewId} />);
    expect(await screen.findByText('Interview not found')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Questions' })).not.toBeInTheDocument();
  });

  test('finish requires confirmation and cancellation does not send a mutation', async () => {
    let finishCount = 0;
    server.use(
      api.mutation('FinishInterview', () => {
        finishCount += 1;
        return HttpResponse.json({ data: { finishInterview: sessionInterview('FINISHED') } });
      }),
    );
    const user = userEvent.setup();
    await renderSession();
    await user.click(screen.getByRole('button', { name: 'Finish interview' }));
    const dialog = await screen.findByRole('dialog', { name: 'Finish interview?' });
    expect(finishCount).toBe(0);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Finish interview?' })).not.toBeInTheDocument();
    expect(finishCount).toBe(0);
    expect(screen.getByRole('heading', { name: firstTitle })).toBeInTheDocument();
  });

  test('confirmed finish disables repeat submissions and redirects to summary on success', async () => {
    const response = deferred();
    let finishCount = 0;
    let receivedId: unknown;
    server.use(
      api.mutation('FinishInterview', async ({ variables }) => {
        finishCount += 1;
        receivedId = variables.interviewId;
        await response.promise;
        return HttpResponse.json({ data: { finishInterview: sessionInterview('FINISHED') } });
      }),
    );
    const user = userEvent.setup();
    await renderSession();
    await user.click(screen.getByRole('button', { name: 'Finish interview' }));
    const dialog = await screen.findByRole('dialog', { name: 'Finish interview?' });
    await user.click(within(dialog).getByRole('button', { name: 'Confirm finish' }));
    await waitFor(() => expect(finishCount).toBe(1));
    expect(
      within(dialog).getByRole('button', { name: /Finishing|Confirm finish/i }),
    ).toBeDisabled();
    expect(router.push).not.toHaveBeenCalled();
    response.resolve();
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/interviews/${interviewId}`));
    expect(receivedId).toBe(interviewId);
    expect(finishCount).toBe(1);
  });

  test('finish errors keep the session and show the controlled message', async () => {
    server.use(
      api.mutation('FinishInterview', () =>
        HttpResponse.json(apiError('This interview has already finished.', 'INVALID_STATE')),
      ),
    );
    const user = userEvent.setup();
    await renderSession();
    await user.click(screen.getByRole('button', { name: 'Finish interview' }));
    const dialog = await screen.findByRole('dialog', { name: 'Finish interview?' });
    await user.click(within(dialog).getByRole('button', { name: 'Confirm finish' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This interview has already finished.',
    );
    expect(screen.getByRole('heading', { name: firstTitle })).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });

  test('compact question navigation can switch the active server task', async () => {
    let receivedQuestionId: unknown;
    server.use(
      api.mutation('SetActiveQuestion', ({ variables }) => {
        receivedQuestionId = variables.questionId;
        return HttpResponse.json({ data: { setActiveQuestion: secondActive() } });
      }),
    );
    const user = userEvent.setup();
    await renderSession();
    const select = screen.getByRole('combobox', { name: 'Active question' });
    expect(select).toHaveValue('question-1');
    await user.selectOptions(select, 'question-2');
    expect(await screen.findByRole('heading', { name: secondTitle })).toBeInTheDocument();
    expect(select).toHaveValue('question-2');
    expect(receivedQuestionId).toBe('question-2');
  });

  test('shows loading while the authoritative interview response is pending', async () => {
    const response = deferred();
    server.use(
      api.query('GetInterview', async () => {
        await response.promise;
        return HttpResponse.json({ data: { interview: sessionInterview() } });
      }),
    );
    renderWithApi(<InterviewSessionPage interviewId={interviewId} />);
    expect(screen.getByRole('status')).toHaveTextContent(/Loading/i);
    response.resolve();
    expect(await screen.findByRole('heading', { name: firstTitle })).toBeInTheDocument();
  });

  test('missing active question shows a diagnostic fallback instead of selecting locally', async () => {
    server.use(currentInterviewHandler(sessionInterview('IN_PROGRESS', { activeQuestion: null })));
    renderWithApi(<InterviewSessionPage interviewId={interviewId} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/active question/i);
    expect(screen.getByRole('alert')).toHaveTextContent('ACTIVE_QUESTION_MISSING');
    expect(screen.queryByRole('heading', { name: firstTitle })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Active question' })).toHaveValue('');
    for (const button of within(questionNavigation()).getAllByRole('button')) {
      expect(button).not.toHaveAttribute('aria-current', 'true');
    }
  });

  test('active question outside attached questions shows a diagnostic fallback', async () => {
    server.use(
      currentInterviewHandler(
        sessionInterview('IN_PROGRESS', { activeQuestion: question('foreign', 'Foreign task') }),
      ),
    );
    renderWithApi(<InterviewSessionPage interviewId={interviewId} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('ACTIVE_QUESTION_INVALID');
    expect(screen.getByRole('alert')).toHaveTextContent(/does not belong/i);
    expect(screen.queryByRole('heading', { name: 'Foreign task' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Active question' })).toHaveValue('');
  });

  test.each([
    'snapshotTitle',
    'snapshotDescription',
    'snapshotDifficulty',
    'snapshotLanguage',
    'snapshotStarterCode',
    'snapshotCapturedAt',
  ] as const)(
    'missing %s shows a diagnostic fallback without live template content',
    async (field) => {
      const current = sessionInterview();
      current.questions = current.questions.map((entry, index) =>
        index === 0 ? { ...entry, [field]: null } : entry,
      );
      server.use(currentInterviewHandler(current));
      renderWithApi(<InterviewSessionPage interviewId={interviewId} />);
      expect(await screen.findByRole('alert')).toHaveTextContent(/snapshot/i);
      expect(screen.queryByRole('heading', { name: firstTitle })).not.toBeInTheDocument();
    },
  );

  test('interview without questions shows a diagnostic fallback', async () => {
    server.use(
      currentInterviewHandler(
        sessionInterview('IN_PROGRESS', { questions: [], activeQuestion: null }),
      ),
    );
    renderWithApi(<InterviewSessionPage interviewId={interviewId} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/questions/i);
    expect(screen.getByRole('alert')).toHaveTextContent('QUESTIONS_MISSING');
    expect(within(questionNavigation()).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: firstTitle })).not.toBeInTheDocument();
  });

  test('network failure shows a controlled message without internal details', async () => {
    server.use(api.query('GetInterview', () => HttpResponse.error()));
    renderWithApi(<InterviewSessionPage interviewId={interviewId} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to reach CodeMeet.');
    expect(screen.getByRole('alert')).not.toHaveTextContent(/stack|PrismaClient/i);
  });

  test('editing the reusable source cannot replace frozen session content', async () => {
    const current = sessionInterview();
    const changed = question('question-1', 'Edited reusable template', {
      description: 'A different mutable description.',
      language: 'REACT_TSX',
      difficulty: 'HARD',
      starterCode: 'const mutableTemplate = true;',
    });
    current.activeQuestion = changed;
    current.questions = current.questions.map((entry, index) =>
      index === 0 ? { ...entry, question: changed } : entry,
    );
    await renderSession(current);
    expect(await screen.findByRole('textbox', { name: 'Code editor' })).toHaveValue(firstCode);
    expect(screen.queryByText('Edited reusable template')).not.toBeInTheDocument();
    expect(screen.queryByText('A different mutable description.')).not.toBeInTheDocument();
    expect(screen.queryByText('const mutableTemplate = true;')).not.toBeInTheDocument();
  });

  test('an empty captured starter code remains a valid snapshot', async () => {
    const current = sessionInterview();
    current.questions = current.questions.map((entry, index) =>
      index === 0 ? { ...entry, snapshotStarterCode: '' } : entry,
    );
    await renderSession(current);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(await screen.findByRole('textbox', { name: 'Code editor' })).toHaveValue('');
  });

  test('finished summary also uses frozen attachment contents after source edits', async () => {
    const current = sessionInterview('FINISHED');
    const changed = question('question-1', 'Edited reusable template', {
      description: 'A different mutable description.',
      starterCode: 'const mutableTemplate = true;',
    });
    current.activeQuestion = changed;
    current.questions = current.questions.map((entry, index) =>
      index === 0 ? { ...entry, question: changed } : entry,
    );
    server.use(currentInterviewHandler(current));
    renderWithApi(<InterviewDetailsPage interviewId={interviewId} />);
    expect(await screen.findByRole('heading', { name: firstTitle })).toBeInTheDocument();
    expect(
      screen.getByText('Find two numbers using the frozen interview requirements.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Edited reusable template')).not.toBeInTheDocument();
    expect(screen.queryByText('A different mutable description.')).not.toBeInTheDocument();
  });
});
