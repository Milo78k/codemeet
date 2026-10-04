'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { ProgrammingLanguage } from '../../shared/api/generated/graphql';
import { getModelUri } from '../interviews/editor/language';
import { createInterviewModelManager } from '../interviews/editor/model-manager';
import type { EditorReadyContext } from '../interviews/editor/MonacoAdapter';

import styles from '../../shared/ui/workspace.module.css';

const Adapter = dynamic(
  () => import('../interviews/editor/MonacoAdapter').then((module) => module.MonacoAdapter),
  {
    ssr: false,
    loading: () => (
      <div className={styles.starterCodeLoading} role="status">
        Loading code editor…
      </div>
    ),
  },
);

type StarterCodeEditorProps = {
  value: string;
  language: ProgrammingLanguage;
  disabled?: boolean;
  onChange: (value: string) => void;
};

export function StarterCodeEditor({
  value,
  language,
  disabled = false,
  onChange,
}: StarterCodeEditorProps) {
  return (
    <StarterCodeEditorInstance
      key={language}
      value={value}
      language={language}
      disabled={disabled}
      onChange={onChange}
    />
  );
}

function StarterCodeEditorInstance({
  value,
  language,
  disabled = false,
  onChange,
}: StarterCodeEditorProps) {
  const models = useMemo(() => createInterviewModelManager(), []);
  const uri = getModelUri('question-form', 'starter-code', language);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => () => models.dispose(), [models]);

  const onEditorReady = useCallback((_context: EditorReadyContext) => undefined, []);
  const onLoadError = useCallback(() => setLoadError(true), []);

  return (
    <div className={styles.starterCodeEditor} data-language={language}>
      {loadError ? (
        <p className={styles.starterCodeError} role="alert">
          The code editor could not be loaded. Reload the page to try again.
        </p>
      ) : (
        <Adapter
          uri={uri}
          language={language}
          initialValue={value}
          models={models}
          onChange={onChange}
          onEditorReady={onEditorReady}
          onLoadError={onLoadError}
          ariaLabel="Starter code"
          readOnly={disabled}
        />
      )}
    </div>
  );
}
