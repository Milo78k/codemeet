'use client';

import { NetworkStatus } from '@apollo/client';
import { useQuery } from '@apollo/client/react';
import Link from 'next/link';
import { useState } from 'react';

import { getErrorMessage } from '../../shared/api/errors';
import {
  GetInterviewsDocument,
  GetQuestionsDocument,
  type InterviewStatus,
} from '../../shared/api/generated/graphql';
import { formatDate } from '../../shared/lib/format';
import { StatusBadge } from '../../shared/ui/Badge';
import { EmptyState, ErrorNotice, LoadingState } from '../../shared/ui/Feedback';
import { Icon } from '../../shared/ui/Icon';
import styles from '../../shared/ui/workspace.module.css';
import { InterviewActions } from './InterviewActions';

export function DashboardPage() {
  const [status, setStatus] = useState<InterviewStatus | ''>('');
  const [pageError, setPageError] = useState<string | null>(null);
  const interviews = useQuery(GetInterviewsDocument, {
    ssr: false,
    variables: { status: status || undefined, limit: 6, offset: 0 },
  });
  const questions = useQuery(GetQuestionsDocument, {
    ssr: false,
    variables: { limit: 1, offset: 0 },
  });
  const page = interviews.data?.interviews;

  async function loadMore() {
    if (!page || interviews.loading) return;
    setPageError(null);
    try {
      await interviews.fetchMore({
        variables: { offset: page.pageInfo.offset + page.pageInfo.limit },
      });
    } catch (failure) {
      setPageError(getErrorMessage(failure));
    }
  }

  return (
    <>
      <div className={styles.pageHeader}>
        <div>
          <div className={styles.eyebrow}>Your workspace</div>
          <h1 className={styles.title}>A good interview starts here.</h1>
          <p className={styles.subtitle}>
            Organize your questions, prepare an interview, and keep the conversation moving.
          </p>
        </div>
        <div className={styles.headerActions}>
          <Link href="/interviews/new" className={styles.primaryButton}>
            <Icon name="plus" />
            Create interview
          </Link>
        </div>
      </div>
      <div className={styles.statsGrid}>
        <section className={styles.statCard}>
          <div className={styles.statLabel}>
            Questions count
            <Icon name="questions" />
          </div>
          <div className={styles.statValue}>
            {questions.loading && !questions.data
              ? '…'
              : (questions.data?.questions.pageInfo.totalCount ?? '—')}
          </div>
          <p className={styles.statNote}>Reusable challenges in your library</p>
        </section>
        <section className={styles.statCard}>
          <div className={styles.statLabel}>
            {status ? 'Matching interviews' : 'Your interviews'}
            <Icon name="interview" />
          </div>
          <div className={styles.statValue}>
            {interviews.loading && !page ? '…' : (page?.pageInfo.totalCount ?? '—')}
          </div>
          <p className={styles.statNote}>
            {status ? 'With the selected server status' : 'Prepared and past conversations'}
          </p>
        </section>
        <section className={`${styles.statCard} ${styles.guideCard}`}>
          <h2>Your next great question</h2>
          <p>A useful library makes preparing your next interview a little easier.</p>
          <Link href="/questions">
            Question library
            <Icon name="arrow" />
          </Link>
        </section>
      </div>
      {questions.error && (
        <ErrorNotice
          onRetry={() => {
            void questions.refetch().catch(() => {});
          }}
        >
          Question count: {getErrorMessage(questions.error)}
        </ErrorNotice>
      )}
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>Recent interviews</h2>
        <div className={styles.statusFilter}>
          <label htmlFor="interview-status-filter">Status</label>
          <select
            id="interview-status-filter"
            className={styles.select}
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as InterviewStatus | '');
              setPageError(null);
            }}
          >
            <option value="">All statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="READY">Ready</option>
            <option value="IN_PROGRESS">In progress</option>
            <option value="FINISHED">Finished</option>
          </select>
        </div>
      </div>
      {(interviews.error || pageError) && (
        <ErrorNotice
          onRetry={() => {
            setPageError(null);
            void interviews.refetch().catch(() => {});
          }}
        >
          {pageError ?? getErrorMessage(interviews.error)}
        </ErrorNotice>
      )}
      {interviews.loading && !page ? (
        <LoadingState label="Loading interviews…" />
      ) : (
        page && (
          <>
            {page.items.length === 0 ? (
              <EmptyState title="No interviews yet">
                {status ? (
                  'Try a different status filter.'
                ) : (
                  <>
                    <Link href="/interviews/new">Create an interview</Link> and choose a few
                    questions to get started.
                  </>
                )}
              </EmptyState>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">Interview</th>
                      <th scope="col">Status</th>
                      <th scope="col">Questions</th>
                      <th scope="col">Created</th>
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {page.items.map((interview) => (
                      <tr key={interview.id}>
                        <td>
                          <Link href={`/interviews/${interview.id}`} className={styles.tableTitle}>
                            {interview.title}
                          </Link>
                          <span className={styles.tableMeta}>
                            by {interview.createdBy?.name ?? 'Interviewer'}
                          </span>
                        </td>
                        <td>
                          <StatusBadge status={interview.status} />
                        </td>
                        <td>
                          {interview.questions.length}{' '}
                          {interview.questions.length === 1 ? 'question' : 'questions'}
                        </td>
                        <td>
                          <time dateTime={interview.createdAt}>
                            {formatDate(interview.createdAt)}
                          </time>
                        </td>
                        <td>
                          <div className={styles.rowActions}>
                            <Link
                              href={`/interviews/${interview.id}`}
                              className={styles.textButton}
                              aria-label={`Open ${interview.title}`}
                            >
                              Open
                              <Icon name="chevron" />
                            </Link>
                            <InterviewActions
                              interview={interview}
                              onStatusChange={() => interviews.refetch({ offset: 0 })}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {page.pageInfo.hasNextPage && (
              <div className={styles.loadMore}>
                <span className={styles.count}>
                  Showing {page.items.length} of {page.pageInfo.totalCount}
                </span>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => void loadMore()}
                  disabled={interviews.loading}
                  aria-label="Load more interviews"
                >
                  {interviews.networkStatus === NetworkStatus.fetchMore
                    ? 'Loading more…'
                    : 'Load more interviews'}
                </button>
              </div>
            )}
          </>
        )
      )}
    </>
  );
}
