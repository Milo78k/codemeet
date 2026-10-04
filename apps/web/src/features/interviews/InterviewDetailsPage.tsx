'use client';

import { useQuery } from '@apollo/client/react';
import Link from 'next/link';

import { getErrorMessage } from '../../shared/api/errors';
import { GetInterviewDocument } from '../../shared/api/generated/graphql';
import { formatDate, languageLabels } from '../../shared/lib/format';
import { DifficultyBadge, StatusBadge } from '../../shared/ui/Badge';
import { EmptyState, ErrorNotice, LoadingState } from '../../shared/ui/Feedback';
import { Icon } from '../../shared/ui/Icon';
import styles from '../../shared/ui/workspace.module.css';
import { InterviewActions } from './InterviewActions';
import { getQuestionSnapshot } from './question-snapshot';

export function InterviewDetailsPage({ interviewId }: { interviewId: string }) {
  const { data, loading, error, refetch } = useQuery(GetInterviewDocument, {
    variables: { id: interviewId },
    ssr: false,
  });
  const interview = data?.interview;
  const historical = interview?.status === 'IN_PROGRESS' || interview?.status === 'FINISHED';

  return (
    <>
      <Link href="/dashboard" className={styles.backLink}>
        <Icon name="arrow" />
        Back to overview
      </Link>
      {error && (
        <ErrorNotice
          onRetry={() => {
            void refetch().catch(() => {});
          }}
        >
          {getErrorMessage(error)}
        </ErrorNotice>
      )}
      {loading && !data ? (
        <LoadingState label="Loading interview…" />
      ) : interview ? (
        <>
          <div className={styles.pageHeader}>
            <div>
              <div className={styles.eyebrow}>Interview overview</div>
              <h1 className={styles.title}>{interview.title}</h1>
              <p className={styles.subtitle}>
                Your selected questions and the current interview status.
              </p>
            </div>
            <div className={styles.headerActions}>
              <StatusBadge status={interview.status} />
              {interview.status === 'IN_PROGRESS' && (
                <Link href={`/interviews/${interview.id}/session`} className={styles.primaryButton}>
                  Open session
                  <Icon name="arrow" />
                </Link>
              )}
              {interview.status === 'FINISHED' && interview.createdBy && (
                <Link href={`/interviews/${interview.id}/results`} className={styles.primaryButton}>
                  View results
                  <Icon name="arrow" />
                </Link>
              )}
              {interview.createdBy && <InterviewActions interview={interview} />}
            </div>
          </div>
          <div className={styles.summaryGrid}>
            <section>
              <div className={styles.sectionHeader}>
                <h2 className={styles.sectionTitle}>Selected questions</h2>
                <span className={styles.count}>
                  {interview.questions.length}{' '}
                  {interview.questions.length === 1 ? 'question' : 'questions'}
                </span>
              </div>
              {interview.questions.length ? (
                <ol className={styles.questionList}>
                  {interview.questions.map((entry) => {
                    const { id, order, question } = entry;
                    const content = historical ? getQuestionSnapshot(entry) : question;
                    return (
                      <li key={id} className={styles.detailQuestion}>
                        <p className={styles.questionNumber}>
                          QUESTION {String(order + 1).padStart(2, '0')}
                        </p>
                        <div className={styles.detailTop}>
                          <h3 className={styles.questionTitle}>
                            {content?.title ?? `Question ${order + 1} · snapshot unavailable`}
                          </h3>
                          {interview.activeQuestion?.id === question.id && (
                            <span className={styles.activeLabel}>Active question</span>
                          )}
                        </div>
                        {content ? (
                          <>
                            <p className={styles.description}>{content.description}</p>
                            <div className={styles.detailMeta}>
                              <DifficultyBadge difficulty={content.difficulty} />
                              <span className={styles.language}>
                                {languageLabels[content.language]}
                              </span>
                            </div>
                            {historical && (
                              <section
                                className={styles.summaryStarterCode}
                                aria-labelledby={`starter-${id}`}
                              >
                                <h4 id={`starter-${id}`} className={styles.label}>
                                  Starter code · read-only
                                </h4>
                                {content.starterCode === '' ? (
                                  <p className={styles.description}>
                                    No starter code was supplied.
                                  </p>
                                ) : (
                                  <pre
                                    className={styles.starterCode}
                                    tabIndex={0}
                                    aria-label={`Starter code for ${content.title}`}
                                  >
                                    <code>{content.starterCode}</code>
                                  </pre>
                                )}
                              </section>
                            )}
                          </>
                        ) : (
                          <ErrorNotice>
                            Original question snapshot is unavailable.{' '}
                            <span className={styles.diagnostic}>
                              Interview {interview.id} · attachment {id} · SNAPSHOT_MISSING
                            </span>
                          </ErrorNotice>
                        )}
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <EmptyState title="No questions attached">
                  No questions are attached to this interview.
                </EmptyState>
              )}
            </section>
            <aside className={styles.detailsAside}>
              <section className={styles.detailCard}>
                <h2 className={styles.sectionTitle}>Interview details</h2>
                <dl className={styles.infoList}>
                  <div>
                    <dt>Created</dt>
                    <dd>
                      <time dateTime={interview.createdAt}>{formatDate(interview.createdAt)}</time>
                    </dd>
                  </div>
                  <div>
                    <dt>Created by</dt>
                    <dd>{interview.createdBy?.name ?? 'Interviewer'}</dd>
                  </div>
                  {interview.startedAt && (
                    <div>
                      <dt>Started</dt>
                      <dd>
                        <time dateTime={interview.startedAt}>
                          {formatDate(interview.startedAt)}
                        </time>
                      </dd>
                    </div>
                  )}
                  {interview.finishedAt && (
                    <div>
                      <dt>Finished</dt>
                      <dd>
                        <time dateTime={interview.finishedAt}>
                          {formatDate(interview.finishedAt)}
                        </time>
                      </dd>
                    </div>
                  )}
                </dl>
              </section>
              <section className={styles.detailCard}>
                <h2 className={styles.sectionTitle}>Participants</h2>
                {interview.participants.length ? (
                  <ul className={styles.participantList}>
                    {interview.participants.map((participant) => (
                      <li key={participant.id} className={styles.participant}>
                        <span className={styles.avatar}>
                          {participant.displayName.slice(0, 2).toUpperCase()}
                        </span>
                        <div>
                          <strong>{participant.displayName}</strong>
                          <span>
                            {participant.role === 'INTERVIEWER' ? 'Interviewer' : 'Candidate'}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={styles.description}>No participants yet.</p>
                )}
              </section>
            </aside>
          </div>
        </>
      ) : (
        !error &&
        !loading && (
          <EmptyState title="Interview not found">
            It may have been removed or belong to another workspace.{' '}
            <Link href="/dashboard">Return to your overview</Link>.
          </EmptyState>
        )
      )}
    </>
  );
}
