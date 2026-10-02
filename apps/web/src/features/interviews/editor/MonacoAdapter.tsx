'use client';

import Editor from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { ProgrammingLanguage } from '../../../shared/api/generated/graphql';
import { getMonacoLanguage } from './language';
import type { InterviewModelManager } from './model-manager';
import { loadMonaco, subscribeMonacoErrors } from './monaco-runtime';

import styles from './editor.module.css';

const editorOptions = {
  automaticLayout: true,
  minimap: { enabled: false },
  fontSize: 14,
  tabSize: 2,
  scrollBeyondLastLine: false,
  wordWrap: 'on',
  bracketPairColorization: { enabled: true },
  accessibilitySupport: 'auto',
  ariaLabel: 'Code editor',
} satisfies Monaco.editor.IStandaloneEditorConstructionOptions;

export type EditorReadyContext = {
  editor: Monaco.editor.IStandaloneCodeEditor;
  monaco: typeof Monaco;
  model: Monaco.editor.ITextModel;
};
export type EditorReadyCallback = (context: EditorReadyContext) => void | (() => void);

export type MonacoAdapterProps = {
  uri: string;
  language: ProgrammingLanguage;
  initialValue: string;
  models: InterviewModelManager;
  onChange: (value: string) => void;
  onEditorReady: EditorReadyCallback;
  onLoadError: (error: unknown) => void;
};

export function MonacoAdapter({
  uri,
  language,
  initialValue,
  models,
  onChange,
  onEditorReady,
  onLoadError,
}: MonacoAdapterProps) {
  const [monaco, setMonaco] = useState<typeof Monaco | null>(null);
  const cleanupBinding = useRef<(() => void) | null>(null);
  const [initialDraft] = useState(initialValue);
  const mounted = useCallback(
    (editor: Monaco.editor.IStandaloneCodeEditor, instance: typeof Monaco) => {
      cleanupBinding.current?.();
      const model = editor.getModel();
      if (!model) {
        onLoadError(new Error('The editor model is unavailable.'));
        return;
      }
      cleanupBinding.current = onEditorReady({ editor, monaco: instance, model }) ?? null;
    },
    [onEditorReady, onLoadError],
  );
  const changed = useCallback(
    (value: string | undefined) => {
      if (value !== undefined) onChange(value);
    },
    [onChange],
  );

  useEffect(() => {
    let cancelled = false;
    const unsubscribe = subscribeMonacoErrors((error) => {
      if (!cancelled) onLoadError(error);
    });
    void loadMonaco()
      .then((instance) => {
        if (cancelled) return;
        models.getOrCreateModel(instance, uri, getMonacoLanguage(language), initialDraft);
        setMonaco(instance);
      })
      .catch((error: unknown) => {
        if (!cancelled) onLoadError(error);
      });
    return () => {
      cancelled = true;
      unsubscribe();
      cleanupBinding.current?.();
      cleanupBinding.current = null;
    };
  }, [onLoadError, models, uri, language, initialDraft]);

  if (!monaco)
    return (
      <div className={styles.loading} role="status">
        <span>Loading code editor…</span>
        <div className={styles.skeleton} aria-hidden="true" />
      </div>
    );
  return (
    <Editor
      height="100%"
      theme="vs"
      path={uri}
      defaultLanguage={getMonacoLanguage(language)}
      defaultValue={initialDraft}
      keepCurrentModel
      saveViewState={false}
      onMount={mounted}
      onChange={changed}
      loading={
        <div className={styles.loading} role="status">
          Loading code editor…
        </div>
      }
      options={editorOptions}
    />
  );
}
