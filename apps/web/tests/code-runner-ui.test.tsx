import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { InterviewCodeEditor } from '@/features/interviews/editor/InterviewCodeEditor';
import { useInterviewDraftStore } from '@/features/interviews/editor/draft-store';
import { CodeOutput } from '@/features/code-runner/ui/CodeOutput';
import { CODE_RUN_TIMEOUT_MS } from '@/features/code-runner/model/execution';
import { HttpResponse } from 'msw';

import type {
  GetCodeRunsQuery,
  GetCodeRunsQueryVariables,
  RecordCodeRunMutation,
  RecordCodeRunMutationVariables,
} from '@/shared/api/generated/graphql';

import { roomIds, updateRemoteText } from './support/collaboration';
import { installTestCodeRunner, TestCodeRunnerWorker } from './support/code-runner';
import { api, server } from './support/server';
import { renderWithApi } from './support/render';

const starterCode = 'console.log("starter")';
let restoreRunner: (() => void) | undefined;

function Editor({
  interviewQuestionId = 'question-a',
  language = 'JAVASCRIPT',
  canRun = true,
}: {
  interviewQuestionId?: string;
  language?: 'JAVASCRIPT' | 'TYPESCRIPT' | 'REACT_TSX';
  canRun?: boolean;
}) {
  const drafts = useInterviewDraftStore('runner-ui');
  return (
    <InterviewCodeEditor
      interviewId="runner-ui"
      interviewQuestionId={interviewQuestionId}
      language={language}
      starterCode={starterCode}
      canRun={canRun}
      drafts={drafts}
    />
  );
}

describe('code runner editor controls', () => {
  beforeEach(() => {
    restoreRunner = installTestCodeRunner();
  });

  afterEach(() => {
    restoreRunner?.();
    restoreRunner = undefined;
    jest.useRealTimers();
  });

  test('runs the current Monaco/Y.Text snapshot and displays ordered output', async () => {
    const user = userEvent.setup();
    renderWithApi(<Editor />);
    const editor = await screen.findByRole('textbox', { name: 'Code editor' });
    const workerRoomId = roomIds.at(-1);
    if (!workerRoomId) throw new Error('The collaborative question room was not created.');

    act(() => updateRemoteText(workerRoomId, 'console.log("remote snapshot")'));
    await waitFor(() => expect(editor).toHaveValue('console.log("remote snapshot")'));
    await user.click(screen.getByRole('button', { name: 'Run' }));

    const worker = TestCodeRunnerWorker.instances[0];
    expect(worker?.request?.source).toBe('console.log("remote snapshot")');
    expect(screen.getByRole('button', { name: 'Running…' })).toBeDisabled();
    expect(within(screen.getByLabelText('Code output')).getByRole('status')).toHaveTextContent(
      'Running',
    );

    act(() => updateRemoteText(workerRoomId, 'console.log("next snapshot")'));
    await waitFor(() => expect(editor).toHaveValue('console.log("next snapshot")'));
    expect(worker?.request?.source).toBe('console.log("remote snapshot")');

    act(() => {
      worker?.emit({
        type: 'log',
        runId: worker.request?.runId ?? '',
        interviewQuestionId: 'question-a',
        entry: { level: 'log', message: 'hello' },
      });
      worker?.complete();
    });
    expect(await screen.findByText('✓ Completed · 12 ms')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Execution logs' })).toHaveTextContent('hello');

    await user.click(screen.getByRole('button', { name: 'Run' }));
    expect(TestCodeRunnerWorker.instances[1]?.request?.source).toBe('console.log("next snapshot")');
  });

  test('shows React TSX as unsupported and disables Run', async () => {
    renderWithApi(<Editor language="REACT_TSX" />);
    await screen.findByRole('textbox', { name: 'Code editor' });

    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
    expect(within(screen.getByLabelText('Code output')).getByRole('status')).toHaveTextContent(
      'Execution for React TSX is not supported',
    );
    expect(TestCodeRunnerWorker.instances).toHaveLength(0);
  });

  test('shows runtime errors in Output and does not expose an uncaught application error', async () => {
    const user = userEvent.setup();
    renderWithApi(<Editor />);
    await screen.findByRole('textbox', { name: 'Code editor' });
    await user.click(screen.getByRole('button', { name: 'Run' }));
    const worker = TestCodeRunnerWorker.instances[0];

    act(() => worker?.complete('runtime_error', 'ReferenceError: boom'));

    expect(await screen.findByRole('alert')).toHaveTextContent('Runtime error · 12 ms');
    expect(screen.getByRole('list', { name: 'Execution logs' })).toHaveTextContent(
      'ReferenceError: boom',
    );
    expect(screen.queryByRole('alert', { name: /application/i })).not.toBeInTheDocument();
  });

  test('persists the exact Worker snapshot and its completed output', async () => {
    let recorded: RecordCodeRunMutationVariables | undefined;
    server.use(
      api.mutation<RecordCodeRunMutation, RecordCodeRunMutationVariables>(
        'RecordCodeRun',
        ({ variables }) => {
          recorded = variables;
          return HttpResponse.json({
            data: {
              recordCodeRun: {
                __typename: 'CodeRun',
                id: String(variables.input.runId),
                interviewId: String(variables.interviewId),
                interviewQuestionId: String(variables.input.interviewQuestionId),
                language: variables.input.language,
                status: variables.input.status,
                createdAt: '2026-10-03T12:00:00.000Z',
              },
            },
          });
        },
      ),
    );
    renderWithApi(<Editor />);
    const editor = await screen.findByRole('textbox', { name: 'Code editor' });
    const workerRoomId = roomIds.at(-1);
    if (!workerRoomId) throw new Error('The collaborative question room was not created.');
    act(() => updateRemoteText(workerRoomId, 'console.log("captured")'));
    await waitFor(() => expect(editor).toHaveValue('console.log("captured")'));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Run' }));

    const worker = TestCodeRunnerWorker.instances[0];
    expect(worker?.request?.source).toBe('console.log("captured")');
    act(() => updateRemoteText(workerRoomId, 'console.log("edited after Run")'));
    await waitFor(() => expect(editor).toHaveValue('console.log("edited after Run")'));
    act(() => {
      worker?.emit({
        type: 'log',
        runId: worker.request?.runId ?? '',
        interviewQuestionId: 'question-a',
        entry: { level: 'log', message: 'captured output' },
      });
      worker?.complete();
    });

    expect(await screen.findByText('Saved to run history.')).toBeInTheDocument();
    expect(recorded).toMatchObject({
      interviewId: 'runner-ui',
      input: {
        runId: worker?.request?.runId,
        interviewQuestionId: 'question-a',
        language: 'JAVASCRIPT',
        sourceSnapshot: 'console.log("captured")',
        status: 'SUCCESS',
        stdout: 'captured output',
        stderr: '',
        durationMs: 12,
      },
    });
  });

  test('keeps local output visible when saving history fails', async () => {
    server.use(
      api.mutation('RecordCodeRun', () =>
        HttpResponse.json({
          errors: [{ message: 'Unavailable', extensions: { code: 'INTERNAL_SERVER_ERROR' } }],
        }),
      ),
    );
    const user = userEvent.setup();
    renderWithApi(<Editor />);
    await screen.findByRole('textbox', { name: 'Code editor' });
    await user.click(screen.getByRole('button', { name: 'Run' }));
    act(() => TestCodeRunnerWorker.instances[0]?.complete());

    expect(await screen.findByText('✓ Completed · 12 ms')).toBeInTheDocument();
    expect(await screen.findByText(/Run history could not be saved/)).toBeInTheDocument();
    expect(screen.queryByText(/Runtime error ·/)).not.toBeInTheDocument();
  });

  test('persists runtime errors with their execution status and captured source', async () => {
    let recorded: RecordCodeRunMutationVariables | undefined;
    server.use(
      api.mutation<RecordCodeRunMutation, RecordCodeRunMutationVariables>(
        'RecordCodeRun',
        ({ variables }) => {
          recorded = variables;
          return HttpResponse.json({
            data: {
              recordCodeRun: {
                __typename: 'CodeRun',
                id: String(variables.input.runId),
                interviewId: String(variables.interviewId),
                interviewQuestionId: String(variables.input.interviewQuestionId),
                language: variables.input.language,
                status: variables.input.status,
                createdAt: '2026-10-03T12:00:00.000Z',
              },
            },
          });
        },
      ),
    );
    const user = userEvent.setup();
    renderWithApi(<Editor />);
    const editor = await screen.findByRole('textbox', { name: 'Code editor' });
    const roomId = roomIds.at(-1);
    if (!roomId) throw new Error('The collaborative question room was not created.');
    act(() => updateRemoteText(roomId, 'throw new Error("captured boom")'));
    await waitFor(() => expect(editor).toHaveValue('throw new Error("captured boom")'));
    await user.click(screen.getByRole('button', { name: 'Run' }));
    act(() => TestCodeRunnerWorker.instances[0]?.complete('runtime_error', 'Error: captured boom'));

    expect(await screen.findByText('Saved to run history.')).toBeInTheDocument();
    expect(recorded?.input).toMatchObject({
      sourceSnapshot: 'throw new Error("captured boom")',
      status: 'RUNTIME_ERROR',
      stderr: 'Error: captured boom',
    });
  });

  test('persists timeout only after the Worker deadline terminates it', async () => {
    let recorded: RecordCodeRunMutationVariables | undefined;
    server.use(
      api.mutation<RecordCodeRunMutation, RecordCodeRunMutationVariables>(
        'RecordCodeRun',
        ({ variables }) => {
          recorded = variables;
          return HttpResponse.json({
            data: {
              recordCodeRun: {
                __typename: 'CodeRun',
                id: String(variables.input.runId),
                interviewId: String(variables.interviewId),
                interviewQuestionId: String(variables.input.interviewQuestionId),
                language: variables.input.language,
                status: variables.input.status,
                createdAt: '2026-10-03T12:00:00.000Z',
              },
            },
          });
        },
      ),
    );
    renderWithApi(<Editor />);
    await screen.findByRole('textbox', { name: 'Code editor' });
    jest.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    const worker = TestCodeRunnerWorker.instances[0];
    await act(async () => {
      await jest.advanceTimersByTimeAsync(CODE_RUN_TIMEOUT_MS);
    });

    expect(worker?.terminateCount).toBe(1);
    expect(await screen.findByText('Saved to run history.')).toBeInTheDocument();
    expect(recorded?.input).toMatchObject({
      sourceSnapshot: starterCode,
      status: 'TIMEOUT',
      durationMs: CODE_RUN_TIMEOUT_MS,
    });
  });

  test('renders a timeout result in the Output panel', () => {
    render(
      <CodeOutput
        language="JAVASCRIPT"
        state={{
          status: 'complete',
          result: {
            runId: 'timeout-run',
            interviewQuestionId: 'question-a',
            status: 'timeout',
            entries: [{ level: 'error', message: 'Execution timed out after 5 seconds.' }],
            stdout: [],
            stderr: ['Execution timed out after 5 seconds.'],
            durationMs: 5_000,
          },
        }}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Execution timed out · 5000 ms');
    expect(screen.getByRole('list', { name: 'Execution logs' })).toHaveTextContent(
      'Execution timed out after 5 seconds.',
    );
  });

  test('cancels an active execution when the question changes or the editor becomes unavailable', async () => {
    const requestedQuestions: string[] = [];
    server.use(
      api.query<GetCodeRunsQuery, GetCodeRunsQueryVariables>('GetCodeRuns', ({ variables }) => {
        requestedQuestions.push(String(variables.interviewQuestionId));
        return HttpResponse.json({
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
        });
      }),
    );
    const user = userEvent.setup();
    const view = renderWithApi(<Editor />);
    await screen.findByRole('textbox', { name: 'Code editor' });
    await waitFor(() => expect(requestedQuestions).toContain('question-a'));
    await user.click(screen.getByRole('button', { name: 'Run' }));
    const oldQuestionWorker = TestCodeRunnerWorker.instances[0];

    view.rerender(<Editor interviewQuestionId="question-b" />);
    await screen.findByRole('textbox', { name: 'Code editor' });
    await waitFor(() => expect(requestedQuestions).toContain('question-b'));
    expect(oldQuestionWorker?.terminateCount).toBe(1);
    expect(screen.queryByText(/Completed/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Run' }));
    const finishingWorker = TestCodeRunnerWorker.instances[1];
    view.rerender(<Editor interviewQuestionId="question-b" canRun={false} />);
    expect(finishingWorker?.terminateCount).toBe(1);
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
  });

  test('restores starter code before a later Run and cleans up on unmount', async () => {
    const user = userEvent.setup();
    const view = renderWithApi(<Editor />);
    const editor = await screen.findByRole('textbox', { name: 'Code editor' });
    await user.clear(editor);
    await user.type(editor, 'console.log("changed")');
    await user.click(screen.getByRole('button', { name: 'Reset code' }));
    await screen.findByRole('dialog', { name: 'Reset code?' });
    await user.click(screen.getByRole('button', { name: 'Confirm reset' }));
    await waitFor(() => expect(editor).toHaveValue(starterCode));
    await user.click(screen.getByRole('button', { name: 'Run' }));

    const worker = TestCodeRunnerWorker.instances[0];
    expect(worker?.request?.source).toBe(starterCode);
    view.unmount();
    expect(worker?.terminateCount).toBe(1);
  });
});
