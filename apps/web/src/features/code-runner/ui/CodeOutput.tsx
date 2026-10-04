import { isCodeRunnerLanguageSupported, type CodeExecutionResult } from '../model/execution';
import type { CodeRunnerViewState } from '../useCodeRunner';
import { formatDuration } from '../../../shared/lib/format';
import { RunOutput } from './RunOutput';

import styles from '../../interviews/editor/editor.module.css';

export function CodeOutput({
  language,
  state,
  historySaveStatus = null,
}: {
  language: Parameters<typeof isCodeRunnerLanguageSupported>[0];
  state: CodeRunnerViewState;
  historySaveStatus?: 'saving' | 'saved' | 'failed' | null;
}) {
  if (!isCodeRunnerLanguageSupported(language)) {
    return (
      <section className={styles.outputPanel} aria-label="Code output">
        <h3 className={styles.outputTitle}>Output</h3>
        <p role="status" className={styles.outputNotice}>
          Execution for React TSX is not supported yet.
        </p>
      </section>
    );
  }

  if (state.status === 'idle') {
    return (
      <section className={styles.outputPanel} aria-label="Code output">
        <h3 className={styles.outputTitle}>Output</h3>
        <p className={styles.outputNotice}>Run the current code to see its output.</p>
      </section>
    );
  }

  if (state.status === 'running') {
    return (
      <section className={styles.outputPanel} aria-label="Code output" aria-busy="true">
        <h3 className={styles.outputTitle}>Output</h3>
        <p role="status" className={styles.outputStatus}>
          Running…
        </p>
      </section>
    );
  }

  return <ExecutionOutput result={state.result} historySaveStatus={historySaveStatus} />;
}

function ExecutionOutput({
  result,
  historySaveStatus,
}: {
  result: CodeExecutionResult;
  historySaveStatus: 'saving' | 'saved' | 'failed' | null;
}) {
  const statusText = {
    success: 'Completed',
    runtime_error: 'Runtime error',
    timeout: 'Execution timed out',
    unsupported: 'Execution unsupported',
    cancelled: 'Execution cancelled',
  }[result.status];

  return (
    <section className={`${styles.outputPanel} ${styles.outputCompact}`} aria-label="Code output">
      <h3 className={styles.outputTitle}>Run result</h3>
      <div className={styles.outputSummary}>
        <p
          role={result.status === 'runtime_error' ? 'alert' : 'status'}
          className={
            result.status === 'success'
              ? styles.outputSuccess
              : result.status === 'timeout' || result.status === 'runtime_error'
                ? styles.outputFailure
                : styles.outputStatus
          }
        >
          {result.status === 'success' ? '✓ ' : result.status === 'timeout' ? '⏱ ' : ''}
          {statusText}
        </p>
        <span className={styles.outputDuration}>{formatDuration(result.durationMs)}</span>
      </div>
      <RunOutput stdout={result.stdout.join('\n')} stderr={result.stderr.join('\n')} />
      {historySaveStatus && (
        <p
          role={historySaveStatus === 'failed' ? 'alert' : 'status'}
          className={historySaveStatus === 'failed' ? styles.outputFailure : styles.outputNotice}
        >
          {historySaveStatus === 'saving' && 'Saving this run to history…'}
          {historySaveStatus === 'saved' && 'Saved to run history.'}
          {historySaveStatus === 'failed' &&
            'Run history could not be saved. The execution output is still available.'}
        </p>
      )}
    </section>
  );
}
