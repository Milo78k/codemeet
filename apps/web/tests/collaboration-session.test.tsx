import { describe, expect, jest, test } from '@jest/globals';
import { act, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import userEvent from '@testing-library/user-event';
import { HttpResponse } from 'msw';

import { InterviewSessionPage } from '@/features/interviews/InterviewSessionPage';
import { createCollaborationRoomId } from '@codemeet/shared';

import { interview, question } from './support/fixtures';
import { FakeSessionEventWebSocket } from './support/session-events';
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
import { storeParticipantSession } from '@/shared/api/participant-session';

const interviewId = 'collaboration-session';
const firstCode = 'const starterA = 1;';
const secondCode = 'const starterB = 2;';

function session(status: 'READY' | 'IN_PROGRESS' | 'FINISHED' = 'IN_PROGRESS') {
  return interview(interviewId, 'Collaborative interview', status, [
    question('question-a', 'Question A', { starterCode: firstCode }),
    question('question-b', 'Question B', { starterCode: secondCode, language: 'TYPESCRIPT' }),
  ]);
}

function mockSession(current = session()) {
  let queryCount = 0;
  server.use(
    api.query('GetInterview', () => {
      queryCount += 1;
      return HttpResponse.json({ data: { interview: current } });
    }),
    api.mutation('SetActiveQuestion', ({ variables }) => {
      const next = current.questions.find((entry) => entry.question.id === variables.questionId);
      if (next) current = { ...current, activeQuestion: next.question };
      return HttpResponse.json({ data: { setActiveQuestion: current } });
    }),
  );
  return {
    setCurrent(next: ReturnType<typeof session>) {
      current = next;
    },
    getQueryCount: () => queryCount,
  };
}

function sessionEventMessage(
  type: 'ACTIVE_QUESTION_CHANGED' | 'INTERVIEW_STARTED' | 'INTERVIEW_FINISHED',
  eventInterviewId = interviewId,
) {
  return JSON.stringify({
    type: 'session-event',
    event: { type, interviewId: eventInterviewId, occurredAt: '2026-10-03T12:00:00.000Z' },
  });
}

async function waitForSessionEventSocket() {
  let socket: FakeSessionEventWebSocket | undefined;
  await waitFor(() => {
    socket = [...FakeSessionEventWebSocket.instances]
      .reverse()
      .find(
        (entry) =>
          entry.readyState !== FakeSessionEventWebSocket.CLOSED &&
          entry.url.includes(`/session-events/${interviewId}`),
      );
    expect(socket).toBeDefined();
  });
  return socket!;
}

function mockCandidateSession(token = 'p'.repeat(43)) {
  storeParticipantSession({
    role: 'candidate',
    token,
    interviewId,
    expiresAt: '2026-10-10T12:00:00.000Z',
  });
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
}

function authenticateSessionEventSocket(
  socket: FakeSessionEventWebSocket,
  role: 'interviewer' | 'candidate',
) {
  act(() => {
    socket.open();
    socket.receive(JSON.stringify({ type: 'authenticated' }));
  });
  expect(JSON.parse(socket.sent[0]!)).toMatchObject({ type: 'authenticate', role });
}

describe('collaborative interview editor integration', () => {
  test('a joined guest waiting before start enters the session from an interview-started event', async () => {
    const controller = mockSession(session('READY'));
    mockCandidateSession('w'.repeat(43));

    renderWithApi(
      <StrictMode>
        <InterviewSessionPage interviewId={interviewId} />
      </StrictMode>,
    );
    expect(await screen.findByText('Interview has not started yet')).toBeInTheDocument();

    const events = await waitForSessionEventSocket();
    authenticateSessionEventSocket(events, 'candidate');
    await waitFor(() => expect(controller.getQueryCount()).toBeGreaterThan(1));
    expect(
      FakeSessionEventWebSocket.instances.filter(
        (socket) => socket.readyState !== FakeSessionEventWebSocket.CLOSED,
      ),
    ).toHaveLength(1);

    const queryCount = controller.getQueryCount();
    act(() => events.receive(sessionEventMessage('INTERVIEW_STARTED', 'another-interview')));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(controller.getQueryCount()).toBe(queryCount);
    expect(screen.getByText('Interview has not started yet')).toBeInTheDocument();

    controller.setCurrent(session('IN_PROGRESS'));
    act(() => {
      events.receive(sessionEventMessage('INTERVIEW_STARTED'));
      events.receive(sessionEventMessage('INTERVIEW_STARTED'));
    });

    expect(await screen.findByRole('heading', { name: 'Question A' })).toBeInTheDocument();
    expect(screen.queryByText('Interview has not started yet')).not.toBeInTheDocument();
    await screen.findByText('Connected');
    const roomId = createCollaborationRoomId({
      interviewId,
      interviewQuestionId: `${interviewId}-attachment-question-a`,
    });
    expect(collaborationTestMetrics(roomId)?.providers).toBe(1);
  });

  test('a waiting guest recovers canonical IN_PROGRESS state after missing start while offline', async () => {
    const controller = mockSession(session('READY'));
    mockCandidateSession('o'.repeat(43));
    renderWithApi(<InterviewSessionPage interviewId={interviewId} />);
    expect(await screen.findByText('Interview has not started yet')).toBeInTheDocument();

    const firstEvents = await waitForSessionEventSocket();
    authenticateSessionEventSocket(firstEvents, 'candidate');
    await waitFor(() => expect(controller.getQueryCount()).toBeGreaterThan(1));

    controller.setCurrent(session('IN_PROGRESS'));
    act(() => firstEvents.disconnect());
    await waitFor(() => expect(FakeSessionEventWebSocket.instances.length).toBeGreaterThan(1));
    const reconnected = FakeSessionEventWebSocket.instances.at(-1)!;
    act(() => {
      reconnected.open();
      reconnected.receive(JSON.stringify({ type: 'authenticated' }));
    });

    expect(await screen.findByRole('heading', { name: 'Question A' })).toBeInTheDocument();
    expect(screen.queryByText('Interview has not started yet')).not.toBeInTheDocument();
  });

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
    act(() => setProviderStatus(roomId, 'connected'));
    expect(screen.getByText('Connected')).toBeInTheDocument();
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

  test('changes a stalled reconnect from Reconnecting to Offline and back to Connected on recovery', async () => {
    mockSession();
    const mounted = renderWithApi(<InterviewSessionPage interviewId={interviewId} />);
    await screen.findByText('Connected');
    const roomId = createCollaborationRoomId({
      interviewId,
      interviewQuestionId: `${interviewId}-attachment-question-a`,
    });
    jest.useFakeTimers();
    try {
      act(() => setProviderStatus(roomId, 'disconnected'));
      expect(screen.getByText('Reconnecting…')).toBeInTheDocument();
      act(() => jest.advanceTimersByTime(20_000));
      expect(screen.getByText('Offline')).toBeInTheDocument();
      act(() => setProviderStatus(roomId, 'connected'));
      expect(screen.getByText('Connected')).toBeInTheDocument();
    } finally {
      mounted.unmount();
      jest.runOnlyPendingTimers();
      jest.useRealTimers();
    }
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

  test('candidate refetches canonical state, switches rooms, and returns to preserved room code', async () => {
    const controller = mockSession();
    const activeRoomA = createCollaborationRoomId({
      interviewId,
      interviewQuestionId: `${interviewId}-attachment-question-a`,
    });
    const activeRoomB = createCollaborationRoomId({
      interviewId,
      interviewQuestionId: `${interviewId}-attachment-question-b`,
    });
    storeParticipantSession({
      role: 'candidate',
      token: 'p'.repeat(43),
      interviewId,
      expiresAt: '2026-10-10T12:00:00.000Z',
    });
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
    await screen.findByRole('heading', { name: 'Question A' });
    await screen.findByText('Connected');
    const events = await waitForSessionEventSocket();
    authenticateSessionEventSocket(events, 'candidate');
    await waitFor(() => expect(controller.getQueryCount()).toBeGreaterThan(1));

    act(() => updateRemoteText(activeRoomA, 'const preservedAcrossRooms = true;'));
    controller.setCurrent({
      ...session(),
      activeQuestion: session().questions[1]!.question,
    });
    act(() => events.receive(sessionEventMessage('ACTIVE_QUESTION_CHANGED')));

    await screen.findByRole('heading', { name: 'Question B' });
    await waitFor(() => expect(collaborationTestMetrics(activeRoomA)?.destroyed).toBe(1));
    expect(roomIds).toContain(activeRoomB);
    expect(collaborationTestMetrics(activeRoomB)?.providers).toBe(1);

    controller.setCurrent({
      ...session(),
      activeQuestion: session().questions[0]!.question,
    });
    act(() => events.receive(sessionEventMessage('ACTIVE_QUESTION_CHANGED')));
    await screen.findByRole('heading', { name: 'Question A' });
    const editor = screen.getByRole('textbox', { name: 'Code editor' });
    await waitFor(() => expect(editor).toHaveValue('const preservedAcrossRooms = true;'));
    expect(collaborationTestMetrics(activeRoomB)?.destroyed).toBe(1);
  });

  test('duplicate events are idempotent and events for another Interview are ignored', async () => {
    const controller = mockSession();
    renderWithApi(<InterviewSessionPage interviewId={interviewId} />);
    await screen.findByRole('heading', { name: 'Question A' });
    await screen.findByText('Connected');
    const events = await waitForSessionEventSocket();
    authenticateSessionEventSocket(events, 'interviewer');
    await waitFor(() => expect(controller.getQueryCount()).toBeGreaterThan(1));
    const roomA = createCollaborationRoomId({
      interviewId,
      interviewQuestionId: `${interviewId}-attachment-question-a`,
    });
    const queryCount = controller.getQueryCount();

    act(() => {
      events.receive(
        JSON.stringify({
          type: 'session-event',
          event: {
            type: 'ACTIVE_QUESTION_CHANGED',
            interviewId: 'another-interview',
            occurredAt: '2026-10-03T12:00:00.000Z',
          },
        }),
      );
      events.receive(sessionEventMessage('ACTIVE_QUESTION_CHANGED'));
      events.receive(sessionEventMessage('ACTIVE_QUESTION_CHANGED'));
      events.receive('{malformed');
    });

    await waitFor(() => expect(controller.getQueryCount()).toBeGreaterThan(queryCount));
    await waitFor(() => expect(collaborationTestMetrics(roomA)?.providers).toBe(1));
    expect(screen.getByRole('heading', { name: 'Question A' })).toBeInTheDocument();
  });

  test('reconnect refetch repairs a missed event and finish unmounts collaboration', async () => {
    const controller = mockSession();
    storeParticipantSession({
      role: 'candidate',
      token: 'r'.repeat(43),
      interviewId,
      expiresAt: '2026-10-10T12:00:00.000Z',
    });
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
    await screen.findByRole('heading', { name: 'Question A' });
    await screen.findByText('Connected');
    const firstEvents = await waitForSessionEventSocket();
    authenticateSessionEventSocket(firstEvents, 'candidate');
    await waitFor(() => expect(controller.getQueryCount()).toBeGreaterThan(1));

    controller.setCurrent({
      ...session(),
      activeQuestion: session().questions[1]!.question,
    });
    act(() => firstEvents.disconnect());
    await waitFor(() => expect(FakeSessionEventWebSocket.instances.length).toBeGreaterThan(1));
    const reconnected = FakeSessionEventWebSocket.instances.at(-1)!;
    reconnected.open();
    reconnected.receive(JSON.stringify({ type: 'authenticated' }));
    await screen.findByRole('heading', { name: 'Question B' });

    const roomB = createCollaborationRoomId({
      interviewId,
      interviewQuestionId: `${interviewId}-attachment-question-b`,
    });
    controller.setCurrent(session('FINISHED'));
    act(() => reconnected.receive(sessionEventMessage('INTERVIEW_FINISHED')));
    expect(await screen.findByText('Interview is finished')).toBeInTheDocument();
    await waitFor(() => expect(collaborationTestMetrics(roomB)?.destroyed).toBe(1));
    expect(reconnected.readyState).toBe(FakeSessionEventWebSocket.CLOSED);
  });

  test('unmount closes the event socket and removes its reconnect listener', async () => {
    mockSession();
    const mounted = renderWithApi(<InterviewSessionPage interviewId={interviewId} />);
    await screen.findByRole('heading', { name: 'Question A' });
    const events = await waitForSessionEventSocket();
    mounted.unmount();
    expect(events.readyState).toBe(FakeSessionEventWebSocket.CLOSED);
    expect(events.onmessage).toBeNull();
    expect(events.onclose).toBeNull();
  });
});
