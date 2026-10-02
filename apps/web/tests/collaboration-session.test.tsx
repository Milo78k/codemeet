import { describe, expect, test } from '@jest/globals';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse } from 'msw';

import { InterviewSessionPage } from '@/features/interviews/InterviewSessionPage';
import { createCollaborationRoomId } from '@codemeet/shared';

import { interview, question } from './support/fixtures';
import {
  collaborationTestMetrics,
  roomIds,
  setProviderStatus,
  updateRemoteText,
} from './support/collaboration';
import { renderWithApi } from './support/render';
import { api, server } from './support/server';

const interviewId = 'collaboration-session';
const firstCode = 'const starterA = 1;';
const secondCode = 'const starterB = 2;';

function session(status: 'IN_PROGRESS' | 'FINISHED' = 'IN_PROGRESS') {
  return interview(interviewId, 'Collaborative interview', status, [
    question('question-a', 'Question A', { starterCode: firstCode }),
    question('question-b', 'Question B', { starterCode: secondCode, language: 'TYPESCRIPT' }),
  ]);
}

function mockSession(current = session()) {
  server.use(
    api.query('GetInterview', () => HttpResponse.json({ data: { interview: current } })),
    api.mutation('SetActiveQuestion', ({ variables }) => {
      const next = current.questions.find((entry) => entry.question.id === variables.questionId);
      if (next) current = { ...current, activeQuestion: next.question };
      return HttpResponse.json({ data: { setActiveQuestion: current } });
    }),
  );
}

describe('collaborative interview editor integration', () => {
  test('opens the active attachment room and reflects remote edits in code and dirty state', async () => {
    mockSession();
    renderWithApi(<InterviewSessionPage interviewId={interviewId} />);
    const editor = await screen.findByRole('textbox', { name: 'Code editor' });
    await screen.findByText('Connected');
    const roomId = createCollaborationRoomId({
      interviewId,
      interviewQuestionId: `${interviewId}-attachment-question-a`,
    });
    expect(roomIds).toContain(roomId);
    expect(editor).toHaveValue(firstCode);

    act(() => updateRemoteText(roomId, 'const remoteEdit = true;'));
    await waitFor(() => expect(editor).toHaveValue('const remoteEdit = true;'));
    expect(screen.getByText('Modified')).toBeInTheDocument();
  });

  test('switching attachment destroys its provider and reset is shared through Y.Text', async () => {
    mockSession();
    const user = userEvent.setup();
    renderWithApi(<InterviewSessionPage interviewId={interviewId} />);
    await screen.findByText('Connected');
    const roomA = createCollaborationRoomId({
      interviewId,
      interviewQuestionId: `${interviewId}-attachment-question-a`,
    });
    await user.click(
      within(screen.getByRole('navigation', { name: 'Questions' })).getByRole('button', {
        name: /Question B/,
      }),
    );
    expect(await screen.findByRole('textbox', { name: 'Code editor' })).toHaveValue(secondCode);
    await screen.findByText('Connected');
    await waitFor(() => expect(collaborationTestMetrics(roomA)?.destroyed).toBe(1));

    const roomB = createCollaborationRoomId({
      interviewId,
      interviewQuestionId: `${interviewId}-attachment-question-b`,
    });
    const editor = screen.getByRole('textbox', { name: 'Code editor' });
    await user.clear(editor);
    await user.type(editor, 'const changedB = 2;');
    await user.click(screen.getByRole('button', { name: 'Reset code' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reset code?' });
    await user.click(within(dialog).getByRole('button', { name: 'Confirm reset' }));
    await waitFor(() => expect(editor).toHaveValue(secondCode));
    expect(screen.getByText('Unmodified')).toBeInTheDocument();
    expect(roomIds).toContain(roomB);
  });

  test('shows reconnect states, tears down on unmount, and FINISHED sessions never connect', async () => {
    mockSession();
    const mounted = renderWithApi(<InterviewSessionPage interviewId={interviewId} />);
    await screen.findByText('Connected');
    const roomId = createCollaborationRoomId({
      interviewId,
      interviewQuestionId: `${interviewId}-attachment-question-a`,
    });
    act(() => setProviderStatus(roomId, 'disconnected'));
    expect(screen.getByText('Reconnecting…')).toBeInTheDocument();
    mounted.unmount();
    await waitFor(() => expect(collaborationTestMetrics(roomId)?.destroyed).toBeGreaterThan(0));

    roomIds.splice(0);
    mockSession(session('FINISHED'));
    renderWithApi(<InterviewSessionPage interviewId={interviewId} />);
    expect(await screen.findByText('Interview is finished')).toBeInTheDocument();
    expect(roomIds).toEqual([]);
  });
});
