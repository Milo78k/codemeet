'use client';

import { useEffect, useRef } from 'react';

import type { SessionEventAuthMessage } from '@codemeet/shared';

import { readBrowserCredential } from '../../../shared/api/participant-session';
import { connectInterviewSessionEvents, createSessionEventsUrl } from './session-event-client';

type InterviewSessionEventsOptions = {
  interviewId: string;
  enabled: boolean;
  refetch(): Promise<unknown>;
};

export function useInterviewSessionEvents({
  interviewId,
  enabled,
  refetch,
}: InterviewSessionEventsOptions): void {
  const refetchRef = useRef(refetch);
  useEffect(() => {
    refetchRef.current = refetch;
  }, [refetch]);

  useEffect(() => {
    const realtimeUrl = process.env.NEXT_PUBLIC_REALTIME_URL;
    if (!enabled || !realtimeUrl) return;

    const credential = readBrowserCredential();
    let authentication: SessionEventAuthMessage;
    if (credential.role === 'candidate') {
      if (!credential.token) return;
      authentication = { type: 'authenticate', role: 'candidate', token: credential.token };
    } else {
      authentication = { type: 'authenticate', role: 'interviewer', token: null };
    }

    let stopped = false;
    let scheduled = false;
    let inFlight = false;
    let requestedAgain = false;
    let syncTimer: ReturnType<typeof setTimeout> | undefined;

    const synchronizeCanonicalState = () => {
      if (stopped) return;
      if (inFlight) {
        requestedAgain = true;
        return;
      }
      if (scheduled) return;
      scheduled = true;
      syncTimer = setTimeout(() => {
        syncTimer = undefined;
        scheduled = false;
        inFlight = true;
        void refetchRef
          .current()
          .catch(() => {})
          .finally(() => {
            inFlight = false;
            if (requestedAgain && !stopped) {
              requestedAgain = false;
              synchronizeCanonicalState();
            }
          });
      }, 25);
    };

    let disconnect: (() => void) | undefined;
    try {
      disconnect = connectInterviewSessionEvents({
        url: createSessionEventsUrl(realtimeUrl, interviewId),
        interviewId,
        authentication,
        onConnected: synchronizeCanonicalState,
        onEvent: synchronizeCanonicalState,
      });
    } catch {
      // Missing or invalid local endpoint configuration does not affect the
      // GraphQL-backed session view; a valid reconnect performs a fresh read.
    }

    return () => {
      stopped = true;
      if (syncTimer) clearTimeout(syncTimer);
      disconnect?.();
    };
  }, [enabled, interviewId]);
}
