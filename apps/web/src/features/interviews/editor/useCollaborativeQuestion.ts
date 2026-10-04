'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { createCollaborationRoomId } from '@codemeet/shared';

import type { EditorReadyContext } from './MonacoAdapter';
import {
  connectCollaborativeQuestion,
  releaseCollaborativeQuestion,
  retainCollaborativeQuestion,
} from './collaboration-runtime';
import {
  collectPresenceParticipants,
  type ParticipantIdentity,
  type PresenceParticipant,
} from './presence';

type CollaborativeQuestionOptions = {
  interviewId: string;
  interviewQuestionId: string;
  starterCode: string;
  identity: ParticipantIdentity | null;
  onChange: (value: string) => void;
};

const OFFLINE_AFTER_RECONNECT_MS = 20_000;

export function useCollaborativeQuestion({
  interviewId,
  interviewQuestionId,
  starterCode,
  identity,
  onChange,
}: CollaborativeQuestionOptions) {
  const roomId = useMemo(
    () => createCollaborationRoomId({ interviewId, interviewQuestionId }),
    [interviewId, interviewQuestionId],
  );
  const [error, setError] = useState<string | null>(null);
  const [room, setRoom] = useState<Awaited<ReturnType<typeof connectCollaborativeQuestion>> | null>(
    null,
  );
  const [status, setStatus] = useState<
    'connecting' | 'connected' | 'reconnecting' | 'disconnected'
  >('connecting');
  const [participants, setParticipants] = useState<PresenceParticipant[]>([]);

  useEffect(() => {
    retainCollaborativeQuestion(roomId);
    return () => releaseCollaborativeQuestion(roomId);
  }, [roomId]);

  const bind = useCallback(
    async (context: EditorReadyContext) => {
      setError(null);
      setStatus('connecting');
      let cleanupBinding: (() => void) | undefined;
      let active = true;
      try {
        const collaboration = await connectCollaborativeQuestion(roomId, starterCode);
        if (!active) return undefined;
        if (identity) {
          const awareness = collaboration.provider.awareness;
          if (awareness.getLocalState()) awareness.setLocalStateField('user', identity);
          else awareness.setLocalState({ user: identity });
        }
        cleanupBinding = await collaboration.bindModel(context);
        if (!active) {
          cleanupBinding();
          return undefined;
        }
        setRoom(collaboration);
        const updateParticipants = () => {
          const awareness = collaboration.provider.awareness;
          const remoteStates = [...awareness.getStates()]
            .filter(([clientId]) => clientId !== awareness.clientID)
            .map(([, state]) => state);
          setParticipants(
            collectPresenceParticipants(identity, remoteStates, collaboration.provider.wsconnected),
          );
        };
        let offlineTimer: number | undefined;
        let reconnectTimedOut = false;
        const clearOfflineTimer = () => {
          if (offlineTimer === undefined) return;
          window.clearTimeout(offlineTimer);
          offlineTimer = undefined;
        };
        const updateStatus = ({ status: nextStatus }: { status: string }) => {
          if (nextStatus === 'connected') {
            reconnectTimedOut = false;
            clearOfflineTimer();
            setStatus('connected');
          } else {
            if (!reconnectTimedOut) setStatus('reconnecting');
            if (!reconnectTimedOut && offlineTimer === undefined) {
              offlineTimer = window.setTimeout(() => {
                offlineTimer = undefined;
                if (active) {
                  reconnectTimedOut = true;
                  setStatus('disconnected');
                }
              }, OFFLINE_AFTER_RECONNECT_MS);
            }
          }
          updateParticipants();
        };
        const markDisconnected = () => {
          reconnectTimedOut = true;
          clearOfflineTimer();
          setStatus('disconnected');
          setParticipants([]);
        };
        collaboration.provider.on('status', updateStatus);
        collaboration.provider.on('closed', markDisconnected);
        collaboration.provider.awareness.on('change', updateParticipants);
        updateStatus({ status: collaboration.provider.wsconnected ? 'connected' : 'connecting' });
        const onTextChange = () => onChange(collaboration.text.toString());
        collaboration.text.observe(onTextChange);
        onTextChange();
        return () => {
          active = false;
          collaboration.provider.off('status', updateStatus);
          collaboration.provider.off('closed', markDisconnected);
          collaboration.provider.awareness.off('change', updateParticipants);
          collaboration.text.unobserve(onTextChange);
          clearOfflineTimer();
          cleanupBinding?.();
          setParticipants([]);
        };
      } catch (failure) {
        if (active) {
          setStatus('disconnected');
          setParticipants([]);
          setError(
            failure instanceof Error ? failure.message : 'Live collaboration is unavailable.',
          );
        }
        return undefined;
      }
    },
    [identity, onChange, roomId, starterCode],
  );

  const reset = useCallback(() => {
    if (!room) return false;
    return room.reset();
  }, [room]);

  return { bind, reset, error, status, participants };
}
