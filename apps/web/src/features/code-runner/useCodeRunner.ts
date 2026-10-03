'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ProgrammingLanguage } from '../../shared/api/generated/graphql';
import { CodeRunner, type CodeRunHandle } from './lib/CodeRunner';
import type { CodeExecutionResult } from './model/execution';

export type CodeRunnerViewState =
  | { status: 'idle' }
  | { status: 'running'; runId: string }
  | { status: 'complete'; result: CodeExecutionResult };

export function useCodeRunner({
  interviewQuestionId,
  language,
  enabled,
}: {
  interviewQuestionId: string;
  language: ProgrammingLanguage;
  enabled: boolean;
}) {
  const runner = useMemo(() => new CodeRunner(), []);
  const [viewState, setViewState] = useState<CodeRunnerViewState>({ status: 'idle' });
  const activeHandle = useRef<CodeRunHandle | null>(null);

  const cancel = useCallback(() => {
    const handle = activeHandle.current;
    activeHandle.current = null;
    handle?.cancel();
    setViewState({ status: 'idle' });
  }, []);

  useEffect(() => {
    if (!enabled) {
      const handle = activeHandle.current;
      activeHandle.current = null;
      handle?.cancel();
    }
    return () => {
      const handle = activeHandle.current;
      activeHandle.current = null;
      handle?.cancel();
      runner.dispose();
    };
  }, [enabled, interviewQuestionId, runner]);

  const run = useCallback(
    (source: string) => {
      if (!enabled) return;
      const handle = runner.start({ interviewQuestionId, language, source: String(source) });
      activeHandle.current = handle;
      setViewState({ status: 'running', runId: handle.runId });
      void handle.promise.then((result) => {
        if (activeHandle.current !== handle) return;
        activeHandle.current = null;
        if (result.status === 'cancelled') {
          setViewState({ status: 'idle' });
          return;
        }
        setViewState({ status: 'complete', result });
      });
    },
    [enabled, interviewQuestionId, language, runner],
  );

  let visibleState = viewState;
  if (
    (viewState.status === 'running' && !enabled) ||
    (viewState.status === 'complete' &&
      viewState.result.interviewQuestionId !== interviewQuestionId)
  ) {
    visibleState = { status: 'idle' };
  }

  return { run, cancel, state: visibleState };
}
