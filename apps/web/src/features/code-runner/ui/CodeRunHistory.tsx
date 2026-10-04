import type { GetCodeRunsQuery } from '../../../shared/api/generated/graphql';
import { formatDateTime, formatDuration } from '../../../shared/lib/format';
import { RunOutput } from './RunOutput';

import styles from '../../interviews/editor/editor.module.css';

type CodeRunRow = GetCodeRunsQuery['codeRuns']['items'][number];
type CodeRunPage = GetCodeRunsQuery['codeRuns'];

export function CodeRunHistory({
  page,
  loading,
  failed,
  onRetry,
  onPrevious,
  onNext,
}: {
  page: CodeRunPage | undefined;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <section className={styles.historyPanel} aria-label="Run history">
      <div className={styles.historyHeader}>
        <h3 className={styles.historyTitle}>Run history</h3>
        {page && page.pageInfo.totalCount > 0 && (
          <span className={styles.historyCount}>{page.pageInfo.totalCount} runs</span>
        )}
      </div>

      {failed ? (
        <div className={styles.historyMessage}>
          <p role="alert">Run history could not be loaded.</p>
          <button type="button" className={styles.historyRetry} onClick={onRetry}>
            Retry history
          </button>
        </div>
      ) : loading && !page ? (
        <p role="status" className={styles.historyMessage}>
          Loading run history…
        </p>
      ) : page?.items.length ? (
        <>
          <ol className={styles.historyList}>
            {page.items.map((run) => (
              <HistoryItem key={run.id} run={run} />
            ))}
          </ol>
          {(page.pageInfo.offset > 0 || page.pageInfo.hasNextPage) && (
            <div className={styles.historyPagination}>
              <span className={styles.historyCount}>
                {page.pageInfo.offset + 1}–{page.pageInfo.offset + page.items.length} of{' '}
                {page.pageInfo.totalCount}
              </span>
              <div>
                <button
                  type="button"
                  className={styles.historyRetry}
                  disabled={page.pageInfo.offset === 0 || loading}
                  onClick={onPrevious}
                >
                  Newer
                </button>
                <button
                  type="button"
                  className={styles.historyRetry}
                  disabled={!page.pageInfo.hasNextPage || loading}
                  onClick={onNext}
                >
                  Older
                </button>
              </div>
            </div>
          )}
        </>
      ) : loading ? (
        <p role="status" className={styles.historyMessage}>
          Refreshing run history…
        </p>
      ) : (
        <p className={styles.historyMessage}>No runs for this question yet.</p>
      )}
    </section>
  );
}

function HistoryItem({ run }: { run: CodeRunRow }) {
  const status = {
    SUCCESS: { label: '✓ Success', className: styles.historySuccess },
    RUNTIME_ERROR: { label: '✕ Runtime error', className: styles.historyFailure },
    TIMEOUT: { label: '⏱ Timeout', className: styles.historyTimeout },
  }[run.status];
  const time = formatDateTime(run.createdAt, 'compact');

  return (
    <li className={styles.historyItem}>
      <div className={styles.historySummary}>
        <time className={styles.historyTime} dateTime={run.createdAt}>
          {time}
        </time>
        <span className={status.className}>{status.label}</span>
        <span className={styles.historyDuration}>{formatDuration(run.durationMs)}</span>
        {run.createdByParticipant && (
          <span className={styles.historyAuthor}>{run.createdByParticipant.displayName}</span>
        )}
      </div>
      <details className={styles.historyDetails}>
        <summary>View run details</summary>
        <div className={styles.historyDetailBody}>
          <h4>Source snapshot</h4>
          <pre aria-label="Source snapshot">{run.sourceSnapshot}</pre>
          <RunOutput stdout={run.stdout ?? ''} stderr={run.stderr ?? ''} />
        </div>
      </details>
    </li>
  );
}
