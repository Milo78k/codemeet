import { afterEach, describe, expect, jest, test } from '@jest/globals';

import { parseSessionEventServerMessage, type SessionEventAuthMessage } from '@codemeet/shared';
import {
  connectInterviewSessionEvents,
  createSessionEventsUrl,
} from '@/features/interviews/session-events/session-event-client';

import { FakeSessionEventWebSocket } from './support/session-events';

const occurredAt = '2026-10-03T12:00:00.000Z';

afterEach(() => {
  jest.useRealTimers();
  FakeSessionEventWebSocket.reset();
});

describe('session-event WebSocket client', () => {
  test('builds an interview-scoped endpoint from the existing realtime URL', () => {
    expect(
      createSessionEventsUrl('wss://api.example.test/collaboration?x=1', 'interview one'),
    ).toBe('wss://api.example.test/session-events/interview%20one');
    expect(() =>
      createSessionEventsUrl('https://api.example.test/collaboration', 'interview'),
    ).toThrow('must use ws or wss');
  });

  test('sends authentication separately and ignores malformed or foreign interview events', () => {
    const onConnected = jest.fn();
    const onEvent = jest.fn();
    const token = 'c'.repeat(43);
    const authentication: SessionEventAuthMessage = {
      type: 'authenticate',
      role: 'candidate',
      token,
    };
    const disconnect = connectInterviewSessionEvents({
      url: createSessionEventsUrl('ws://localhost:4000/collaboration', 'interview-a'),
      interviewId: 'interview-a',
      authentication,
      onConnected,
      onEvent,
      WebSocketConstructor: FakeSessionEventWebSocket,
    });
    const socket = FakeSessionEventWebSocket.instances[0]!;

    expect(socket.url).not.toContain(token);
    socket.open();
    expect(socket.sent).toEqual([JSON.stringify(authentication)]);
    socket.receive(JSON.stringify({ type: 'authenticated' }));
    socket.receive(
      JSON.stringify({
        type: 'session-event',
        event: { type: 'ACTIVE_QUESTION_CHANGED', interviewId: 'interview-b', occurredAt },
      }),
    );
    socket.receive(JSON.stringify({ type: 'session-event', event: { type: 'UNKNOWN' } }));
    socket.receive('{invalid');
    expect(onConnected).toHaveBeenCalledTimes(1);
    expect(onEvent).not.toHaveBeenCalled();

    socket.receive(
      JSON.stringify({
        type: 'session-event',
        event: { type: 'INTERVIEW_FINISHED', interviewId: 'interview-a', occurredAt },
      }),
    );
    expect(onEvent).toHaveBeenCalledWith({
      type: 'INTERVIEW_FINISHED',
      interviewId: 'interview-a',
      occurredAt,
    });
    disconnect();
  });

  test('validates server messages with a discriminated event protocol', () => {
    expect(
      parseSessionEventServerMessage({
        type: 'session-event',
        event: { type: 'ACTIVE_QUESTION_CHANGED', interviewId: 'interview-a', occurredAt },
      }),
    ).toEqual({
      type: 'session-event',
      event: { type: 'ACTIVE_QUESTION_CHANGED', interviewId: 'interview-a', occurredAt },
    });
    expect(
      parseSessionEventServerMessage({
        type: 'session-event',
        event: { type: 'INTERVIEW_STARTED', interviewId: 'interview-a', occurredAt },
      }),
    ).toEqual({
      type: 'session-event',
      event: { type: 'INTERVIEW_STARTED', interviewId: 'interview-a', occurredAt },
    });
    expect(
      parseSessionEventServerMessage({
        type: 'session-event',
        event: { type: 'INTERVIEW_FINISHED', interviewId: '', occurredAt },
      }),
    ).toBeNull();
    expect(
      parseSessionEventServerMessage({
        type: 'session-event',
        event: { type: 'INTERVIEW_FINISHED', interviewId: 'interview-a', occurredAt: 'later' },
      }),
    ).toBeNull();
  });

  test('reconnects with bounded backoff and stops reconnecting after cleanup', () => {
    jest.useFakeTimers();
    const onConnected = jest.fn();
    const disconnect = connectInterviewSessionEvents({
      url: 'ws://localhost:4000/session-events/interview-a',
      interviewId: 'interview-a',
      authentication: { type: 'authenticate', role: 'interviewer', token: null },
      onConnected,
      onEvent: jest.fn(),
      WebSocketConstructor: FakeSessionEventWebSocket,
    });
    const first = FakeSessionEventWebSocket.instances[0]!;
    first.open();
    first.receive(JSON.stringify({ type: 'authenticated' }));
    first.disconnect();

    jest.advanceTimersByTime(249);
    expect(FakeSessionEventWebSocket.instances).toHaveLength(1);
    jest.advanceTimersByTime(1);
    expect(FakeSessionEventWebSocket.instances).toHaveLength(2);
    const second = FakeSessionEventWebSocket.instances[1]!;
    second.open();
    expect(JSON.parse(second.sent[0]!)).toEqual({
      type: 'authenticate',
      role: 'interviewer',
      token: null,
    });
    second.receive(JSON.stringify({ type: 'authenticated' }));
    expect(onConnected).toHaveBeenCalledTimes(2);

    second.disconnect();
    disconnect();
    jest.runOnlyPendingTimers();
    expect(FakeSessionEventWebSocket.instances).toHaveLength(2);
  });

  test('does not retry authentication or authorization close codes', () => {
    jest.useFakeTimers();
    connectInterviewSessionEvents({
      url: 'ws://localhost:4000/session-events/interview-a',
      interviewId: 'interview-a',
      authentication: { type: 'authenticate', role: 'candidate', token: 'd'.repeat(43) },
      onConnected: jest.fn(),
      onEvent: jest.fn(),
      WebSocketConstructor: FakeSessionEventWebSocket,
    });
    FakeSessionEventWebSocket.instances[0]!.disconnect(4403);
    jest.runOnlyPendingTimers();
    expect(FakeSessionEventWebSocket.instances).toHaveLength(1);
  });
});
