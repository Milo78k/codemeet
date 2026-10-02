import { describe, expect, test } from '@jest/globals';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse } from 'msw';

import { InterviewSessionPage } from '@/features/interviews/InterviewSessionPage';
import { getModelUri } from '@/features/interviews/editor/language';
import type {
  SetActiveQuestionMutation,
  SetActiveQuestionMutationVariables,
} from '@/shared/api/generated/graphql';

import { apiError, interview, question } from './support/fixtures';
import { editorRuntime, failActiveEditorAdapter, setEditorAdapterMode } from './support/monaco';
import { renderWithApi } from './support/render';
import { api, server } from './support/server';

const interviewId = 'editor-session';
const firstCode = 'const starterA = 1;';
const secondCode = 'const starterB = 2;';
const firstDraft = 'const draftA = 10;';
const secondDraft = 'const draftB = 20;';

function editorInterview(status: 'IN_PROGRESS' | 'FINISHED' = 'IN_PROGRESS') {
  return interview(interviewId, 'Editable interview', status, [
    question('question-a', 'Question A', { starterCode: firstCode }),
    question('question-b', 'Question B', { starterCode: secondCode, language: 'TYPESCRIPT' }),
  ]);
}

function sessionApi() {
  let current = editorInterview();
  const switches: SetActiveQuestionMutationVariables[] = [];
  server.use(
    api.query('GetInterview', () => HttpResponse.json({ data: { interview: current } })),
    api.mutation<SetActiveQuestionMutation, SetActiveQuestionMutationVariables>(
      'SetActiveQuestion',
      ({ variables }) => {
        switches.push(variables);
        current = {
          ...current,
          activeQuestion:
            current.questions.find((entry) => entry.question.id === variables.questionId)
              ?.question ?? null,
        };
        return HttpResponse.json({ data: { setActiveQuestion: current } });
      },
    ),
  );
  return switches;
}

async function renderEditorSession() {
  renderWithApi(<InterviewSessionPage interviewId={interviewId} />);
  return screen.findByRole('textbox', { name: 'Code editor' });
}

async function replaceCode(user: ReturnType<typeof userEvent.setup>, value: string) {
  const editor = screen.getByRole('textbox', { name: 'Code editor' });
  await user.clear(editor);
  await user.type(editor, value);
}

async function selectQuestion(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.click(
    within(screen.getByRole('navigation', { name: 'Questions' })).getByRole('button', {
      name: new RegExp(title),
    }),
  );
  await screen.findByRole('heading', { name: title });
  return screen.findByRole('textbox', { name: 'Code editor' });
}

describe('editable interview session', () => {
  test('passes captured starter code to the editor on first open', async () => {
    sessionApi();
    expect(await renderEditorSession()).toHaveValue(firstCode);
    expect(screen.getByText('Unmodified')).toBeInTheDocument();
  });

  test('editing marks the active question Modified without sending code to GraphQL', async () => {
    const switches = sessionApi();
    const user = userEvent.setup();
    await renderEditorSession();
    await replaceCode(user, firstDraft);
    expect(screen.getByText('Modified')).toBeInTheDocument();
    expect(screen.queryByText('Unmodified')).not.toBeInTheDocument();
    expect(switches).toEqual([]);
    expect(screen.getByRole('textbox', { name: 'Code editor' })).toHaveValue(firstDraft);
  });

  test('switching A to B and back preserves the local draft of A', async () => {
    const switches = sessionApi();
    const user = userEvent.setup();
    await renderEditorSession();
    await replaceCode(user, firstDraft);
    expect(await selectQuestion(user, 'Question B')).toHaveValue(secondCode);
    expect(await selectQuestion(user, 'Question A')).toHaveValue(firstDraft);
    expect(screen.getByText('Modified')).toBeInTheDocument();
    expect(switches).toEqual([
      { interviewId, questionId: 'question-b' },
      { interviewId, questionId: 'question-a' },
    ]);
  });

  test('two question drafts remain independent when both are edited', async () => {
    sessionApi();
    const user = userEvent.setup();
    await renderEditorSession();
    await replaceCode(user, firstDraft);
    await selectQuestion(user, 'Question B');
    await replaceCode(user, secondDraft);
    expect(await selectQuestion(user, 'Question A')).toHaveValue(firstDraft);
    expect(await selectQuestion(user, 'Question B')).toHaveValue(secondDraft);
  });

  test('reset requires confirmation and Cancel preserves the current draft', async () => {
    sessionApi();
    const user = userEvent.setup();
    await renderEditorSession();
    await replaceCode(user, firstDraft);
    await user.click(screen.getByRole('button', { name: 'Reset code' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reset code?' });
    expect(screen.getByRole('textbox', { name: 'Code editor' })).toHaveValue(firstDraft);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Reset code?' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Code editor' })).toHaveValue(firstDraft);
    expect(screen.getByText('Modified')).toBeInTheDocument();
  });

  test('confirmed reset restores snapshot starter code and removes Modified', async () => {
    sessionApi();
    const user = userEvent.setup();
    await renderEditorSession();
    await replaceCode(user, firstDraft);
    await user.click(screen.getByRole('button', { name: 'Reset code' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reset code?' });
    await user.click(within(dialog).getByRole('button', { name: 'Confirm reset' }));
    expect(screen.getByRole('textbox', { name: 'Code editor' })).toHaveValue(firstCode);
    expect(screen.getByText('Unmodified')).toBeInTheDocument();
    expect(screen.queryByText('Modified')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Reset code?' })).not.toBeInTheDocument();
  });

  test('resetting one question does not reset another question draft', async () => {
    sessionApi();
    const user = userEvent.setup();
    await renderEditorSession();
    await replaceCode(user, firstDraft);
    await selectQuestion(user, 'Question B');
    await replaceCode(user, secondDraft);
    await user.click(screen.getByRole('button', { name: 'Reset code' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reset code?' });
    await user.click(within(dialog).getByRole('button', { name: 'Confirm reset' }));
    expect(screen.getByRole('textbox', { name: 'Code editor' })).toHaveValue(secondCode);
    expect(await selectQuestion(user, 'Question A')).toHaveValue(firstDraft);
  });

  test('a controlled active-question error leaves the existing draft intact', async () => {
    sessionApi();
    server.use(
      api.mutation('SetActiveQuestion', () =>
        HttpResponse.json(apiError('This interview is no longer in progress.', 'INVALID_STATE')),
      ),
    );
    const user = userEvent.setup();
    await renderEditorSession();
    await replaceCode(user, firstDraft);
    await user.click(
      within(screen.getByRole('navigation', { name: 'Questions' })).getByRole('button', {
        name: /Question B/,
      }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This interview is no longer in progress.',
    );
    expect(screen.getByRole('heading', { name: 'Question A' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Code editor' })).toHaveValue(firstDraft);
    expect(screen.getByText('Modified')).toBeInTheDocument();
  });

  test('a finished interview does not mount the editor or expose its controls', async () => {
    server.use(
      api.query('GetInterview', () =>
        HttpResponse.json({ data: { interview: editorInterview('FINISHED') } }),
      ),
    );
    renderWithApi(<InterviewSessionPage interviewId={interviewId} />);
    expect(await screen.findByText('Interview is finished')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Code editor' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset code' })).not.toBeInTheDocument();
  });

  test('editor failure shows a controlled fallback and Retry can load the editor', async () => {
    setEditorAdapterMode('error');
    sessionApi();
    const user = userEvent.setup();
    renderWithApi(<InterviewSessionPage interviewId={interviewId} />);
    expect(await screen.findByText('Code editor could not be loaded.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Code editor' })).not.toBeInTheDocument();
    setEditorAdapterMode('ready');
    await user.click(screen.getByRole('button', { name: 'Retry editor' }));
    expect(await screen.findByRole('textbox', { name: 'Code editor' })).toHaveValue(firstCode);
    await waitFor(() =>
      expect(screen.queryByText('Code editor could not be loaded.')).not.toBeInTheDocument(),
    );
  });

  test('a browser editor failure after editing preserves the draft through Retry', async () => {
    sessionApi();
    const user = userEvent.setup();
    await renderEditorSession();
    await replaceCode(user, firstDraft);
    await selectQuestion(user, 'Question B');
    await replaceCode(user, secondDraft);
    expect(await selectQuestion(user, 'Question A')).toHaveValue(firstDraft);
    const firstUri = editorRuntime.monaco.Uri.parse(
      getModelUri(interviewId, `${interviewId}-attachment-question-a`, 'JAVASCRIPT'),
    );
    const secondUri = editorRuntime.monaco.Uri.parse(
      getModelUri(interviewId, `${interviewId}-attachment-question-b`, 'TYPESCRIPT'),
    );
    const previousFirst = editorRuntime.monaco.editor.getModel(firstUri);
    const previousSecond = editorRuntime.monaco.editor.getModel(secondUri);
    if (!previousFirst || !previousSecond)
      throw new Error('Both edited question models must exist.');
    const beforeRecovery = editorRuntime.metrics();
    expect(beforeRecovery).toMatchObject({ liveModels: 2, liveListeners: 2 });
    act(failActiveEditorAdapter);
    expect(await screen.findByText('Code editor could not be loaded.')).toBeInTheDocument();
    expect(screen.getByText('Modified')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Code editor' })).not.toBeInTheDocument();
    expect(editorRuntime.metrics()).toMatchObject({ liveModels: 2, liveListeners: 0 });
    await user.click(screen.getByRole('button', { name: 'Retry editor' }));
    expect(await screen.findByRole('textbox', { name: 'Code editor' })).toHaveValue(firstDraft);
    expect(screen.getByText('Modified')).toBeInTheDocument();
    expect(previousFirst.isDisposed()).toBe(true);
    expect(previousSecond.isDisposed()).toBe(true);
    const recoveredFirst = editorRuntime.monaco.editor.getModel(firstUri);
    expect(recoveredFirst).not.toBe(previousFirst);
    expect(recoveredFirst?.uri.toString()).toBe(firstUri.toString());
    expect(recoveredFirst?.getValue()).toBe(firstDraft);
    expect(editorRuntime.metrics()).toMatchObject({
      liveModels: 1,
      liveListeners: 2,
      createdModels: beforeRecovery.createdModels + 1,
      disposedModels: beforeRecovery.disposedModels + 2,
    });
    expect(await selectQuestion(user, 'Question B')).toHaveValue(secondDraft);
    expect(screen.getByText('Modified')).toBeInTheDocument();
    expect(editorRuntime.monaco.editor.getModel(secondUri)).not.toBe(previousSecond);
  });
});
