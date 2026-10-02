'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { createCollaborationRoomId } from '@codemeet/shared';

import type { EditorReadyContext } from './MonacoAdapter';
import {
  connectCollaborativeQuestion,
  releaseCollaborativeQuestion,
  retainCollaborativeQuestion,
} from './collaboration-runtime';

type CollaborativeQuestionOptions = {
  interviewId: string;
  interviewQuestionId: string;
  starterCode: string;
  onChange: (value: string) => void;
};

export function useCollaborativeQuestion({
  interviewId,
  interviewQuestionId,
  starterCode,
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
        cleanupBinding = await collaboration.bindModel(context.model);
        if (!active) {
          cleanupBinding();
          return undefined;
        }
        setRoom(collaboration);
        const updateStatus = ({ status: nextStatus }: { status: string }) => {
          setStatus(nextStatus === 'connected' ? 'connected' : 'reconnecting');
        };
        const markDisconnected = () => setStatus('disconnected');
        collaboration.provider.on('status', updateStatus);
        collaboration.provider.on('closed', markDisconnected);
        updateStatus({ status: collaboration.provider.wsconnected ? 'connected' : 'connecting' });
        const onTextChange = () => onChange(collaboration.text.toString());
        collaboration.text.observe(onTextChange);
        onTextChange();
        return () => {
          active = false;
          collaboration.provider.off('status', updateStatus);
          collaboration.provider.off('closed', markDisconnected);
          collaboration.text.unobserve(onTextChange);
          cleanupBinding?.();
        };
      } catch (failure) {
        if (active) {
          setStatus('disconnected');
          setError(
            failure instanceof Error ? failure.message : 'Live collaboration is unavailable.',
          );
        }
        return undefined;
      }
    },
    [onChange, roomId, starterCode],
  );

  const reset = useCallback(() => {
    if (!room) return false;
    return room.reset();
  }, [room]);

  return { bind, reset, error, status };
}
