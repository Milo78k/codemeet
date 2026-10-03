export const SESSION_EVENTS_PATH = '/session-events/';

export type ActiveQuestionChangedEvent = {
  type: 'ACTIVE_QUESTION_CHANGED';
  interviewId: string;
  occurredAt: string;
};

export type InterviewFinishedEvent = {
  type: 'INTERVIEW_FINISHED';
  interviewId: string;
  occurredAt: string;
};

export type SessionEvent = ActiveQuestionChangedEvent | InterviewFinishedEvent;

export type SessionEventServerMessage =
  { type: 'authenticated' } | { type: 'session-event'; event: SessionEvent };

export type SessionEventAuthMessage =
  | { type: 'authenticate'; role: 'interviewer'; token: null }
  | { type: 'authenticate'; role: 'candidate'; token: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInterviewId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128;
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

export function parseSessionEvent(value: unknown): SessionEvent | null {
  if (!isRecord(value) || !isInterviewId(value.interviewId) || !isTimestamp(value.occurredAt)) {
    return null;
  }

  if (value.type === 'ACTIVE_QUESTION_CHANGED') {
    return {
      type: value.type,
      interviewId: value.interviewId,
      occurredAt: value.occurredAt,
    };
  }
  if (value.type === 'INTERVIEW_FINISHED') {
    return {
      type: value.type,
      interviewId: value.interviewId,
      occurredAt: value.occurredAt,
    };
  }
  return null;
}

export function parseSessionEventServerMessage(value: unknown): SessionEventServerMessage | null {
  if (!isRecord(value)) return null;
  if (value.type === 'authenticated') return { type: 'authenticated' };
  if (value.type !== 'session-event') return null;
  const event = parseSessionEvent(value.event);
  return event ? { type: 'session-event', event } : null;
}

export function parseSessionEventAuthMessage(value: unknown): SessionEventAuthMessage | null {
  if (!isRecord(value) || value.type !== 'authenticate') return null;
  if (value.role === 'interviewer' && value.token === null) {
    return { type: 'authenticate', role: 'interviewer', token: null };
  }
  if (
    value.role === 'candidate' &&
    typeof value.token === 'string' &&
    /^[A-Za-z0-9_-]{43}$/.test(value.token)
  ) {
    return { type: 'authenticate', role: 'candidate', token: value.token };
  }
  return null;
}
