'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import type { ProgrammingLanguage } from '../../../shared/api/generated/graphql';
import { languageLabels } from '../../../shared/lib/format';
import { CodeOutput } from '../../code-runner/ui/CodeOutput';
import { isCodeRunnerLanguageSupported } from '../../code-runner/model/execution';
import { useCodeRunner } from '../../code-runner/useCodeRunner';
import type { InterviewDraftStore } from './draft-store';
import { EditorErrorBoundary } from './EditorErrorBoundary';
import { getModelUri } from './language';
import type { EditorReadyCallback, EditorReadyContext } from './MonacoAdapter';
import { ParticipantPresence } from './ParticipantPresence';
import type { ParticipantIdentity } from './presence';
import { ResetCodeDialog } from './ResetCodeDialog';
import { useCollaborativeQuestion } from './useCollaborativeQuestion';

import styles from './editor.module.css';

function EditorLoading() {
  return (
    <div className={styles.loading} role="status">
      <span>Loading code editor…</span>
      <div className={styles.skeleton} aria-hidden="true" />
    </div>
  );
}

function createBrowserAdapter() {
  return dynamic(() => import('./MonacoAdapter').then((module) => module.MonacoAdapter), {
    ssr: false,
    loading: EditorLoading,
  });
}
const InitialMonacoAdapter = createBrowserAdapter();
const EDITOR_LOAD_TIMEOUT_MS = 20_000;

type InterviewCodeEditorProps = {
  interviewId: string;
  interviewQuestionId: string;
  language: ProgrammingLanguage;
  starterCode: string;
  drafts: InterviewDraftStore;
  identity?: ParticipantIdentity | null;
  canRun?: boolean;
  onEditorReady?: EditorReadyCallback;
};

export function InterviewCodeEditor(props: InterviewCodeEditorProps) {
  const uri = getModelUri(props.interviewId, props.interviewQuestionId, props.language);
  return <QuestionCodeEditor key={uri} {...props} uri={uri} />;
}

function QuestionCodeEditor({
  interviewId,
  interviewQuestionId,
  language,
  starterCode,
  drafts,
  identity,
  canRun = false,
  onEditorReady,
  uri,
}: InterviewCodeEditorProps & { uri: string }) {
  useSyncExternalStore(drafts.subscribe, drafts.getVersion, drafts.getVersion);
  const draft = drafts.getDraft(interviewQuestionId, starterCode);
  const change = useCallback(
    (value: string) => {
      drafts.setValue(interviewQuestionId, starterCode, value);
    },
    [drafts, interviewQuestionId, starterCode],
  );
  const collaboration = useCollaborativeQuestion({
    interviewId,
    interviewQuestionId,
    starterCode,
    identity: identity ?? null,
    onChange: change,
  });
  const bindCollaboration = collaboration.bind;
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retryVersion, setRetryVersion] = useState(0);
  const [MonacoAdapter, setBrowserAdapter] = useState(() => InitialMonacoAdapter);
  const [confirmReset, setConfirmReset] = useState(false);
  const model = useRef<EditorReadyContext['model'] | null>(null);
  const editor = useRef<EditorReadyContext['editor'] | null>(null);
  const cleanupExternal = useRef<(() => void) | void>(undefined);
  const resetButton = useRef<HTMLButtonElement>(null);
  const codeRunner = useCodeRunner({
    interviewQuestionId,
    language,
    enabled: canRun && ready,
  });

  const editorReady = useCallback(
    (context: EditorReadyContext) => {
      model.current = context.model;
      editor.current = context.editor;
      context.editor.updateOptions({ readOnly: true });
      let active = true;
      let cleanupBinding: (() => void) | undefined;
      void bindCollaboration(context).then((cleanup) => {
        if (!active || !cleanup) return;
        cleanupBinding = cleanup;
        context.editor.updateOptions({ readOnly: false });
        setReady(true);
        cleanupExternal.current = onEditorReady?.(context);
      });
      return () => {
        active = false;
        cleanupExternal.current?.();
        cleanupExternal.current = undefined;
        cleanupBinding?.();
        context.editor.updateOptions({ readOnly: true });
        model.current = null;
        editor.current = null;
      };
    },
    [bindCollaboration, onEditorReady],
  );
  const loadError = useCallback((_error: unknown) => {
    setFailed(true);
    setReady(false);
  }, []);

  useEffect(() => {
    if (ready || failed || collaboration.error) return;
    const timeout = window.setTimeout(() => {
      setFailed(true);
      setReady(false);
    }, EDITOR_LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timeout);
  }, [ready, failed, retryVersion, collaboration.error]);

  function retry() {
    // The failed branch has unmounted the old editor and its binding. Dropping
    // owned models lets Monaco stop its cached core worker; draft strings stay
    // in this workspace and initialize fresh models. Recovery can reset undo.
    drafts.models.dispose();
    setFailed(false);
    setReady(false);
    setRetryVersion((version) => version + 1);
    // React.lazy caches rejected chunk promises. A new loadable instance
    // retries the actual import as well as the Monaco runtime initialization.
    setBrowserAdapter(() => createBrowserAdapter());
  }
  function closeReset() {
    setConfirmReset(false);
  }
  const restoreFocus = useCallback(() => {
    if (resetButton.current && !resetButton.current.disabled) resetButton.current.focus();
    else editor.current?.focus();
  }, []);
  function reset() {
    if (!model.current || !collaboration.reset()) return;
    closeReset();
  }
  function runSnapshot() {
    if (!canRun || !ready || !isCodeRunnerLanguageSupported(language) || !model.current) return;
    // Monaco is bound to this question's Y.Text. Capture now; later remote or local edits
    // cannot mutate the primitive string already sent to the execution worker.
    const immutableSourceSnapshot = String(model.current.getValue());
    codeRunner.run(immutableSourceSnapshot);
  }
  const editorFailed = failed || Boolean(collaboration.error);
  const failure = (
    <div className={styles.failure} role="alert">
      <h3>Code editor could not be loaded.</h3>
      <p>
        {collaboration.error
          ? 'The collaboration server could not be reached. Retry to reconnect.'
          : 'Your local draft is kept. Retry loading the editor to continue.'}
      </p>
      <button type="button" className={styles.secondaryButton} onClick={retry}>
        Retry editor
      </button>
    </div>
  );

  return (
    <section className={styles.editorSection} aria-label="Question code">
      <ParticipantPresence participants={collaboration.participants} />
      <div className={styles.toolbar}>
        <div className={styles.toolbarInfo}>
          <span className={styles.language}>{languageLabels[language]}</span>
          <span role="status" aria-live="polite">
            {collaboration.status === 'connected'
              ? 'Connected'
              : collaboration.status === 'reconnecting'
                ? 'Reconnecting…'
                : collaboration.status === 'disconnected'
                  ? 'Disconnected'
                  : 'Connecting…'}
          </span>
          <span
            className={`${styles.dirtyState} ${draft.isDirty ? styles.modified : ''}`}
            aria-live="polite"
          >
            {draft.isDirty ? 'Modified' : 'Unmodified'}
          </span>
        </div>
        <button
          ref={resetButton}
          type="button"
          className={styles.resetButton}
          disabled={!ready || !draft.isDirty}
          onClick={() => setConfirmReset(true)}
        >
          Reset code
        </button>
        <button
          type="button"
          className={styles.runButton}
          disabled={
            !canRun ||
            !ready ||
            !isCodeRunnerLanguageSupported(language) ||
            codeRunner.state.status === 'running'
          }
          onClick={runSnapshot}
        >
          {codeRunner.state.status === 'running' ? 'Running…' : 'Run'}
        </button>
      </div>
      <div className={styles.editorContainer}>
        {editorFailed ? (
          failure
        ) : (
          <EditorErrorBoundary key={retryVersion} fallback={failure} onError={loadError}>
            <MonacoAdapter
              uri={uri}
              language={language}
              initialValue={draft.value}
              models={drafts.models}
              onChange={change}
              onEditorReady={editorReady}
              onLoadError={loadError}
            />
          </EditorErrorBoundary>
        )}
      </div>
      <CodeOutput language={language} state={codeRunner.state} />
      <p className={styles.localNotice}>
        Edits sync live to other people in this interview session. They stay in this session only.
      </p>
      {collaboration.error && (
        <p className={styles.failure} role="alert">
          {collaboration.error}
        </p>
      )}
      <ResetCodeDialog
        open={confirmReset}
        onCancel={closeReset}
        onConfirm={reset}
        onClosed={restoreFocus}
      />
    </section>
  );
}
