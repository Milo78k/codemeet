import { describe, expect, test } from '@jest/globals';
import { act, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import userEvent from '@testing-library/user-event';
import { HttpResponse } from 'msw';

import { InterviewSessionPage } from '@/features/interviews/InterviewSessionPage';
import { createCollaborationRoomId } from '@codemeet/shared';

import { interview, question } from './support/fixtures';
import {
  awarenessState,
  collaborationTestMetrics,
  roomIds,
  setProviderStatus,
  setAwarenessState,
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
    expect(
      within(screen.getByLabelText('Participants')).getByText('Demo Interviewer'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByLabelText('Participants')).getByText('Interviewer'),
    ).toBeInTheDocument();

    act(() =>
      setAwarenessState(roomId, 901, {
        user: { participantId: 'candidate-anton', displayName: 'Anton', role: 'CANDIDATE' },
      }),
    );
    expect(within(screen.getByLabelText('Participants')).getByText('Anton')).toBeInTheDocument();
    expect(
      within(screen.getByLabelText('Participants')).getByText('Candidate'),
    ).toBeInTheDocument();
    expect(screen.getByText('Unmodified')).toBeInTheDocument();
    expect(editor).toHaveValue(firstCode);

    act(() => setAwarenessState(roomId, 901, null));
    await waitFor(() => expect(screen.queryByText('Anton')).not.toBeInTheDocument());

    act(() => updateRemoteText(roomId, 'const remoteEdit = true;'));
    await waitFor(() => expect(editor).toHaveValue('const remoteEdit = true;'));
    expect(screen.getByText('Modified')).toBeInTheDocument();
    expect(collaborationTestMetrics(roomId)?.providers).toBe(1);
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
    expect(awarenessState(roomA)?.user).toEqual({
      participantId: `interviewer-${interviewId}`,
      displayName: 'Demo Interviewer',
      role: 'INTERVIEWER',
    });
    await user.click(
      within(screen.getByRole('navigation', { name: 'Questions' })).getByRole('button', {
        name: /Question B/,
      }),
    );
    expect(await screen.findByRole('textbox', { name: 'Code editor' })).toHaveValue(secondCode);
    await screen.findByText('Connected');
    await waitFor(() => expect(collaborationTestMetrics(roomA)?.destroyed).toBe(1));
    expect(awarenessState(roomA)).toBeUndefined();

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

    await user.click(
      within(screen.getByRole('navigation', { name: 'Questions' })).getByRole('button', {
        name: /Question A/,
      }),
    );
    await screen.findByRole('textbox', { name: 'Code editor' });
    await screen.findByText('Connected');
    expect(
      within(screen.getByLabelText('Participants')).getByText('Demo Interviewer'),
    ).toBeInTheDocument();
    expect(collaborationTestMetrics(roomA)?.providers).toBe(2);
    expect(awarenessState(roomA)?.user).toEqual({
      participantId: `interviewer-${interviewId}`,
      displayName: 'Demo Interviewer',
      role: 'INTERVIEWER',
    });
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
    await waitFor(() => {
      expect(collaborationTestMetrics(roomId)?.destroyed).toBeGreaterThan(0);
      expect(awarenessState(roomId)).toBeUndefined();
    });

    roomIds.splice(0);
    mockSession(session('FINISHED'));
    renderWithApi(<InterviewSessionPage interviewId={interviewId} />);
    expect(await screen.findByText('Interview is finished')).toBeInTheDocument();
    expect(roomIds).toEqual([]);
    expect(screen.queryByLabelText('Participants')).not.toBeInTheDocument();
  });

  test('shows a remote interviewer to the candidate and deduplicates tabs by participantId', async () => {
    mockSession();
    server.use(
      api.query('GetCurrentParticipant', () =>
        HttpResponse.json({
          data: {
            currentParticipant: {
              __typename: 'InterviewParticipant',
              id: 'candidate-anton',
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
    await screen.findByText('Connected');
    const roomId = createCollaborationRoomId({
      interviewId,
      interviewQuestionId: `${interviewId}-attachment-question-a`,
    });
    const interviewerState = {
      user: {
        participantId: `interviewer-${interviewId}`,
        displayName: 'Demo Interviewer',
        role: 'INTERVIEWER',
      },
    };
    act(() => {
      setAwarenessState(roomId, 902, interviewerState);
      setAwarenessState(roomId, 903, interviewerState);
    });
    const participants = screen.getByLabelText('Participants');
    expect(within(participants).getByText('Anton')).toBeInTheDocument();
    expect(within(participants).getByText('Candidate')).toBeInTheDocument();
    expect(within(participants).getByText('Demo Interviewer')).toBeInTheDocument();
    expect(within(participants).getByText('Interviewer')).toBeInTheDocument();
    expect(within(participants).getAllByText('Demo Interviewer')).toHaveLength(1);
    act(() => setAwarenessState(roomId, 902, null));
    expect(within(participants).getByText('Demo Interviewer')).toBeInTheDocument();
    act(() => setAwarenessState(roomId, 903, null));
    await waitFor(() =>
      expect(within(participants).queryByText('Demo Interviewer')).not.toBeInTheDocument(),
    );
  });

  test('StrictMode reuses one provider and removes local presence after final unmount', async () => {
    mockSession();
    const mounted = renderWithApi(
      <StrictMode>
        <InterviewSessionPage interviewId={interviewId} />
      </StrictMode>,
    );
    await screen.findByText('Connected');
    const roomId = createCollaborationRoomId({
      interviewId,
      interviewQuestionId: `${interviewId}-attachment-question-a`,
    });
    expect(collaborationTestMetrics(roomId)?.providers).toBe(1);
    expect(
      within(screen.getByLabelText('Participants')).getByText('Demo Interviewer'),
    ).toBeInTheDocument();
    mounted.unmount();
    await waitFor(() => {
      expect(collaborationTestMetrics(roomId)?.awarenessStates).toBe(0);
      expect(awarenessState(roomId)).toBeUndefined();
    });
  });
});
