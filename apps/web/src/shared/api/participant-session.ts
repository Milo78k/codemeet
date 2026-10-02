'use client';

const PARTICIPANT_SESSION_KEY = 'codemeet.participant-session.v1';
const PARTICIPANT_SESSION_EVENT = 'codemeet:participant-session-change';

export type CandidateSessionCredential = {
  role: 'candidate';
  token: string;
  interviewId: string;
  expiresAt: string;
};

export type BrowserCredential =
  CandidateSessionCredential | { role: 'candidate'; token: '' } | { role: 'interviewer' };

export function storeParticipantSession(session: CandidateSessionCredential): void {
  window.sessionStorage.setItem(PARTICIPANT_SESSION_KEY, JSON.stringify(session));
  window.dispatchEvent(new Event(PARTICIPANT_SESSION_EVENT));
}

export function subscribeToParticipantSession(onChange: () => void): () => void {
  window.addEventListener(PARTICIPANT_SESSION_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(PARTICIPANT_SESSION_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

export function hasCandidateSession(): boolean {
  return readBrowserCredential().role === 'candidate';
}

export function readBrowserCredential(): BrowserCredential {
  if (typeof window === 'undefined') return { role: 'interviewer' };
  const value = window.sessionStorage.getItem(PARTICIPANT_SESSION_KEY);
  if (value === null) return { role: 'interviewer' };
  try {
    const session = JSON.parse(value) as Partial<CandidateSessionCredential>;
    if (
      session.role === 'candidate' &&
      typeof session.token === 'string' &&
      typeof session.interviewId === 'string' &&
      typeof session.expiresAt === 'string'
    ) {
      return session as CandidateSessionCredential;
    }
  } catch {
    // A damaged candidate session must not silently fall back to TEMP DEMO AUTH.
  }
  return { role: 'candidate', token: '' };
}

export function readParticipantAuthorization(): string | undefined {
  const credential = readBrowserCredential();
  return credential.role === 'candidate' ? `Bearer ${credential.token}` : undefined;
}
