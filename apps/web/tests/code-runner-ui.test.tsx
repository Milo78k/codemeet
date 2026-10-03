import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { InterviewCodeEditor } from '@/features/interviews/editor/InterviewCodeEditor';
import { useInterviewDraftStore } from '@/features/interviews/editor/draft-store';
import { CodeOutput } from '@/features/code-runner/ui/CodeOutput';
import { roomIds, updateRemoteText } from './support/collaboration';
import { installTestCodeRunner, TestCodeRunnerWorker } from './support/code-runner';

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
  });

  test('runs the current Monaco/Y.Text snapshot and displays ordered output', async () => {
    const user = userEvent.setup();
    render(<Editor />);
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
    render(<Editor language="REACT_TSX" />);
    await screen.findByRole('textbox', { name: 'Code editor' });

    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
    expect(within(screen.getByLabelText('Code output')).getByRole('status')).toHaveTextContent(
      'Execution for React TSX is not supported',
    );
    expect(TestCodeRunnerWorker.instances).toHaveLength(0);
  });

  test('shows runtime errors in Output and does not expose an uncaught application error', async () => {
    const user = userEvent.setup();
    render(<Editor />);
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
    const user = userEvent.setup();
    const view = render(<Editor />);
    await screen.findByRole('textbox', { name: 'Code editor' });
    await user.click(screen.getByRole('button', { name: 'Run' }));
    const oldQuestionWorker = TestCodeRunnerWorker.instances[0];

    view.rerender(<Editor interviewQuestionId="question-b" />);
    await screen.findByRole('textbox', { name: 'Code editor' });
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
    const view = render(<Editor />);
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
