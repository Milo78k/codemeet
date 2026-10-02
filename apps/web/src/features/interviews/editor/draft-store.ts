'use client';

import { useEffect, useMemo } from 'react';

import { destroyCollaborationDocuments } from './collaboration-runtime';
import { createInterviewModelManager } from './model-manager';

type QuestionDraft = Readonly<{ value: string; starterCode: string; isDirty: boolean }>;

export function createInterviewDraftStore(interviewId: string) {
  const drafts = new Map<string, QuestionDraft>();
  const listeners = new Set<() => void>();
  const models = createInterviewModelManager();
  let version = 0;
  let owners = 0;
  let releaseGeneration = 0;

  function getDraft(interviewQuestionId: string, starterCode: string) {
    const existing = drafts.get(interviewQuestionId);
    if (existing) return existing;
    const initial: QuestionDraft = { value: starterCode, starterCode, isDirty: false };
    drafts.set(interviewQuestionId, initial);
    return initial;
  }

  return {
    interviewId,
    models,
    getDraft,
    setValue(interviewQuestionId: string, starterCode: string, value: string) {
      const current = getDraft(interviewQuestionId, starterCode);
      if (current.value === value) return;
      drafts.set(interviewQuestionId, {
        value,
        starterCode: current.starterCode,
        isDirty: value !== current.starterCode,
      });
      version += 1;
      for (const listener of listeners) listener();
    },
    getVersion: () => version,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    retain() {
      owners += 1;
      releaseGeneration += 1;
    },
    release() {
      owners = Math.max(0, owners - 1);
      const generation = ++releaseGeneration;
      // React's development cleanup/setup cycle is synchronous. A remount
      // retains this same workspace before disposal and preserves its drafts.
      queueMicrotask(() => {
        if (owners === 0 && generation === releaseGeneration) {
          models.dispose();
          destroyCollaborationDocuments(interviewId);
        }
      });
    },
  };
}

export type InterviewDraftStore = ReturnType<typeof createInterviewDraftStore>;

export function useInterviewDraftStore(interviewId: string): InterviewDraftStore {
  const drafts = useMemo(() => createInterviewDraftStore(interviewId), [interviewId]);
  useEffect(() => {
    drafts.retain();
    return () => drafts.release();
  }, [drafts]);
  return drafts;
}
