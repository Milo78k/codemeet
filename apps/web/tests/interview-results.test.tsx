import { describe, expect, test } from '@jest/globals';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse } from 'msw';

import { InterviewResultsPage } from '@/features/interviews/InterviewResultsPage';
import type {
  GetCodeRunsQuery,
  GetInterviewResultsQuery,
  GetInterviewResultsQueryVariables,
} from '@/shared/api/generated/graphql';

import { api, server } from './support/server';
import { renderWithApi } from './support/render';
import { formatDateTime } from '@/shared/lib/format';

type Results = GetInterviewResultsQuery['interviewResults'];
const runId = 'run-latest';
const sourceSnapshot = 'const answer = 42;\nconsole.log(answer);';

function interviewResults(overrides: Partial<Results> = {}): Results {
  return {
    __typename: 'InterviewResults',
    id: 'results-interview',
    title: 'PHASE 11 Results Manual Smoke',
    status: 'FINISHED',
    available: true,
    startedAt: '2026-10-04T12:00:00.000Z',
    finishedAt: '2026-10-04T12:32:00.000Z',
    durationMs: 32 * 60 * 1000,
    candidateName: 'Phase 10 Candidate',
    interviewerName: 'Demo Interviewer',
    totalQuestions: 2,
    totalRuns: 1,
    hasMoreTimelineEvents: false,
    questions: [
      {
        __typename: 'InterviewQuestionResult',
        interviewQuestionId: 'question-attachment-1',
        order: 0,
        snapshotTitle: 'Frozen Two Sum',
        snapshotLanguage: 'JAVASCRIPT',
        snapshotDifficulty: 'EASY',
        runCount: 1,
        lastRun: {
          __typename: 'InterviewResultsRun',
          id: runId,
          status: 'SUCCESS',
          sourceSnapshot,
          stdout: '42',
          stderr: '',
          durationMs: 23,
          createdAt: '2026-10-04T12:12:00.000Z',
        },
      },
      {
        __typename: 'InterviewQuestionResult',
        interviewQuestionId: 'question-attachment-2',
        order: 1,
        snapshotTitle: 'Frozen Group By',
        snapshotLanguage: 'TYPESCRIPT',
        snapshotDifficulty: 'MEDIUM',
        runCount: 0,
        lastRun: null,
      },
    ],
    timeline: [
      {
        __typename: 'InterviewTimelineEvent',
        id: 'event-start',
        type: 'INTERVIEW_STARTED',
        createdAt: '2026-10-04T12:00:00.000Z',
        questionTitle: 'Frozen Two Sum',
        previousQuestionTitle: null,
        participantName: null,
      },
      {
        __typename: 'InterviewTimelineEvent',
        id: 'event-finish',
        type: 'INTERVIEW_FINISHED',
        createdAt: '2026-10-04T12:32:00.000Z',
        questionTitle: null,
        previousQuestionTitle: null,
        participantName: null,
      },
    ],
    ...overrides,
  };
}

function resultsHandler(value: Results, onRead?: () => void) {
  return api.query<GetInterviewResultsQuery, GetInterviewResultsQueryVariables>(
    'GetInterviewResults',
    () => {
      onRead?.();
      return HttpResponse.json({ data: { interviewResults: value } });
    },
  );
}

function historyHandler(onRead?: () => void) {
  const history: GetCodeRunsQuery['codeRuns'] = {
    __typename: 'CodeRunPage',
    items: [
      {
        __typename: 'CodeRun',
        id: runId,
        interviewId: 'results-interview',
        interviewQuestionId: 'question-attachment-1',
        language: 'JAVASCRIPT',
        sourceSnapshot,
        status: 'SUCCESS',
        stdout: '42',
        stderr: '',
        durationMs: 23,
        createdAt: '2026-10-04T12:12:00.000Z',
        createdByParticipant: null,
      },
    ],
    pageInfo: {
      __typename: 'PageInfo',
      limit: 20,
      offset: 0,
      totalCount: 1,
      hasNextPage: false,
    },
  };
  return api.query('GetCodeRuns', () => {
    onRead?.();
    return HttpResponse.json({ data: { codeRuns: history } });
  });
}

describe('interview results page', () => {
  test('renders the persisted summary, candidate, totals and questions in snapshot order', async () => {
    server.use(resultsHandler(interviewResults()));
    renderWithApi(<InterviewResultsPage interviewId="results-interview" />);

    const title = await screen.findByRole('heading', { name: 'PHASE 11 Results Manual Smoke' });
    expect(title.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    expect(screen.getByText('Phase 10 Candidate')).toBeInTheDocument();
    expect(screen.getByText('Demo Interviewer')).toBeInTheDocument();
    expect(screen.getByText('32 min 0 sec')).toBeInTheDocument();
    expect(screen.getByText(formatDateTime('2026-10-04T12:00:00.000Z'))).toBeInTheDocument();
    expect(screen.getByText(formatDateTime('2026-10-04T12:32:00.000Z'))).toBeInTheDocument();
    expect(screen.getByText(/not an automated candidate score/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Run$/ })).not.toBeInTheDocument();
    const totals = screen.getByRole('region', { name: 'Interview totals' });
    expect(within(totals).getByText('2')).toBeInTheDocument();
    expect(within(totals).getByText('1')).toBeInTheDocument();
    const orderedQuestions = screen.getByRole('list', { name: 'Questions' });
    const questions = within(orderedQuestions).getAllByRole('heading', { level: 3 });
    expect(questions.map((heading) => heading.textContent)).toEqual([
      'Frozen Two Sum',
      'Frozen Group By',
    ]);
    expect(screen.getByText('1 run')).toBeInTheDocument();
    expect(screen.getByText('0 runs')).toBeInTheDocument();
  });

  test('shows last run status, duration and read-only source snapshot', async () => {
    server.use(resultsHandler(interviewResults()));
    renderWithApi(<InterviewResultsPage interviewId="results-interview" />);

    expect(await screen.findByText('Last run: SUCCESS')).toBeInTheDocument();
    expect(screen.getByText('23 ms')).toBeInTheDocument();
    expect(
      screen.getByText(formatDateTime('2026-10-04T12:12:00.000Z', 'compact')),
    ).toBeInTheDocument();
    await userEvent.setup().click(screen.getByText('Latest source snapshot · read-only'));
    expect(screen.getByLabelText('Latest source snapshot')).toHaveTextContent(
      'const answer = 42; console.log(answer);',
    );
    expect(screen.getByRole('region', { name: 'Output' })).toHaveTextContent('42');
    expect(screen.queryByRole('region', { name: 'Errors' })).not.toBeInTheDocument();
  });

  test('renders latest runtime errors only in Errors when there is no stdout', async () => {
    const failed = interviewResults({
      totalRuns: 1,
      questions: [
        {
          __typename: 'InterviewQuestionResult',
          interviewQuestionId: 'question-attachment-1',
          order: 0,
          snapshotTitle: 'Frozen Two Sum',
          snapshotLanguage: 'JAVASCRIPT',
          snapshotDifficulty: 'EASY',
          runCount: 1,
          lastRun: {
            __typename: 'InterviewResultsRun',
            id: 'runtime-error-run',
            status: 'RUNTIME_ERROR',
            sourceSnapshot: 'throw new Error("boom")',
            stdout: '',
            stderr: 'Error: boom',
            durationMs: 12,
            createdAt: '2026-10-04T12:12:00.000Z',
          },
        },
      ],
    });
    server.use(resultsHandler(failed));
    renderWithApi(<InterviewResultsPage interviewId="results-interview" />);

    expect(await screen.findByText('Last run: RUNTIME_ERROR')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByText('Latest source snapshot · read-only'));
    expect(screen.getByRole('region', { name: 'Errors' })).toHaveTextContent('Error: boom');
    expect(screen.queryByRole('region', { name: 'Output' })).not.toBeInTheDocument();
    expect(screen.queryByText('No output.')).not.toBeInTheDocument();
  });

  test('shows unavailable values for missing or invalid timestamps without rendering Invalid Date', async () => {
    const invalid = interviewResults({
      startedAt: null,
      finishedAt: 'not-a-date',
      durationMs: null,
      timeline: [
        {
          __typename: 'InterviewTimelineEvent',
          id: 'bad-event',
          type: 'INTERVIEW_FINISHED',
          createdAt: 'not-a-date',
          questionTitle: null,
          previousQuestionTitle: null,
          participantName: null,
        },
      ],
      questions: [
        {
          __typename: 'InterviewQuestionResult',
          interviewQuestionId: 'question-with-bad-run',
          order: 0,
          snapshotTitle: 'Bad run timestamp',
          snapshotLanguage: 'JAVASCRIPT',
          snapshotDifficulty: 'EASY',
          runCount: 1,
          lastRun: {
            __typename: 'InterviewResultsRun',
            id: 'bad-run',
            status: 'SUCCESS',
            sourceSnapshot: '',
            stdout: '',
            stderr: '',
            durationMs: null,
            createdAt: 'not-a-date',
          },
        },
      ],
    });
    server.use(resultsHandler(invalid));
    renderWithApi(<InterviewResultsPage interviewId="results-interview" />);

    expect(await screen.findAllByText('—')).toHaveLength(6);
    expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument();
  });

  test('renders a sub-second persisted interview duration without rounding it down to zero', async () => {
    server.use(resultsHandler(interviewResults({ durationMs: 389 })));
    renderWithApi(<InterviewResultsPage interviewId="results-interview" />);
    expect(await screen.findByText('389 ms')).toBeInTheDocument();
    expect(screen.queryByText('0 sec')).not.toBeInTheDocument();
  });

  test('question without runs has a clear empty state and no source snapshot', async () => {
    server.use(resultsHandler(interviewResults()));
    renderWithApi(<InterviewResultsPage interviewId="results-interview" />);

    expect(await screen.findByText('No runs for this question.')).toBeInTheDocument();
    expect(screen.queryByText('Language unavailable')).not.toBeInTheDocument();
    expect(screen.queryByText('Solved')).not.toBeInTheDocument();
  });

  test('loads paginated read-only run history only when the question history is expanded', async () => {
    let historyReads = 0;
    server.use(
      resultsHandler(interviewResults()),
      historyHandler(() => (historyReads += 1)),
    );
    renderWithApi(<InterviewResultsPage interviewId="results-interview" />);
    await screen.findByRole('heading', { name: 'PHASE 11 Results Manual Smoke' });
    expect(historyReads).toBe(0);
    const user = userEvent.setup();
    await user.click(screen.getAllByRole('button', { name: 'View run history' })[0]!);
    expect(await screen.findByRole('heading', { name: 'Run history' })).toBeInTheDocument();
    expect(historyReads).toBe(1);
    expect(screen.getByText('View run details')).toBeInTheDocument();
    await user.click(screen.getByText('View run details'));
    expect(screen.getByLabelText('Source snapshot')).toHaveTextContent(
      'const answer = 42; console.log(answer);',
    );
    expect(screen.getAllByLabelText('Output content')).toHaveLength(2);
    expect(screen.getAllByLabelText('Output content')[1]).toHaveTextContent('42');
    expect(screen.queryByText('No stderr.')).not.toBeInTheDocument();
    expect(screen.queryByText('No stdout.')).not.toBeInTheDocument();
    expect(screen.getAllByRole('region', { name: 'Output' })).toHaveLength(2);
    expect(screen.queryByRole('region', { name: 'Errors' })).not.toBeInTheDocument();
  });

  test('renders timeline in chronological order and handles no events', async () => {
    server.use(resultsHandler(interviewResults()));
    const view = renderWithApi(<InterviewResultsPage interviewId="results-interview" />);
    const timeline = await screen.findByRole('list', { name: 'Interview timeline' });
    expect(within(timeline).getByText('Interview started · Frozen Two Sum')).toBeInTheDocument();
    expect(within(timeline).getByText('Interview finished')).toBeInTheDocument();
    expect(
      within(timeline).getByText(formatDateTime('2026-10-04T12:00:00.000Z', 'compact')),
    ).toBeInTheDocument();
    expect(
      within(timeline).getByText(formatDateTime('2026-10-04T12:32:00.000Z', 'compact')),
    ).toBeInTheDocument();

    server.use(resultsHandler(interviewResults({ timeline: [] })));
    view.unmount();
    renderWithApi(<InterviewResultsPage interviewId="results-interview" />);
    expect(await screen.findByText('No timeline events were recorded.')).toBeInTheDocument();
  });

  test('shows an explicit unavailable state for an unfinished interview', async () => {
    server.use(
      resultsHandler(
        interviewResults({ status: 'IN_PROGRESS', available: false, questions: [], totalRuns: 0 }),
      ),
    );
    renderWithApi(<InterviewResultsPage interviewId="results-interview" />);
    expect(
      await screen.findByText('Interview results are available after the interview is finished.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(sourceSnapshot)).not.toBeInTheDocument();
  });

  test('shows a controlled error state for unauthorized or unavailable access', async () => {
    server.use(
      api.query('GetInterviewResults', () =>
        HttpResponse.json({
          errors: [
            {
              message: 'This operation is not available to candidates.',
              extensions: { code: 'FORBIDDEN' },
            },
          ],
        }),
      ),
    );
    renderWithApi(<InterviewResultsPage interviewId="results-interview" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You do not have permission to make this change.',
    );
    expect(screen.queryByText(sourceSnapshot)).not.toBeInTheDocument();
  });

  test('reloads results from the GraphQL query after a fresh page mount', async () => {
    let reads = 0;
    server.use(resultsHandler(interviewResults(), () => (reads += 1)));
    const first = renderWithApi(<InterviewResultsPage interviewId="results-interview" />);
    await screen.findByRole('heading', { name: 'PHASE 11 Results Manual Smoke' });
    first.unmount();
    renderWithApi(<InterviewResultsPage interviewId="results-interview" />);
    await waitFor(() => expect(reads).toBe(2));
  });
});
