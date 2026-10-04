import styles from '../../interviews/editor/editor.module.css';

export function RunOutput({ stdout, stderr }: { stdout: string; stderr: string }) {
  const hasOutput = stdout.length > 0;
  const hasErrors = stderr.length > 0;

  if (!hasOutput && !hasErrors) {
    return <p className={styles.outputNotice}>No output.</p>;
  }

  return (
    <div className={styles.runOutputContent}>
      {hasOutput && (
        <section className={styles.runOutputSection} aria-label="Output">
          <h4 className={styles.runOutputHeading}>Output</h4>
          <pre className={styles.runOutputText} aria-label="Output content" tabIndex={0}>
            {stdout}
          </pre>
        </section>
      )}
      {hasErrors && (
        <section className={styles.runOutputSection} aria-label="Errors">
          <h4 className={styles.runOutputHeading}>Errors</h4>
          <pre className={styles.runOutputText} aria-label="Error output" tabIndex={0}>
            {stderr}
          </pre>
        </section>
      )}
    </div>
  );
}
