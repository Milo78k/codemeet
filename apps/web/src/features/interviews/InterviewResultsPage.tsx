'use client';

import { useQuery } from '@apollo/client/react';
import Link from 'next/link';
import { useState } from 'react';

import { getErrorMessage } from '../../shared/api/errors';
import {
  GetCodeRunsDocument,
  GetInterviewResultsDocument,
  type GetInterviewResultsQuery,
} from '../../shared/api/generated/graphql';
import { formatDateTime, formatDuration, languageLabels } from '../../shared/lib/format';
import { StatusBadge } from '../../shared/ui/Badge';
import { EmptyState, ErrorNotice, LoadingState } from '../../shared/ui/Feedback';
import { Icon } from '../../shared/ui/Icon';
import styles from '../../shared/ui/workspace.module.css';
import { CodeRunHistory } from '../code-runner/ui/CodeRunHistory';
import { RunOutput } from '../code-runner/ui/RunOutput';
import resultsStyles from './results.module.css';

type InterviewResults = GetInterviewResultsQuery['interviewResults'];
type QuestionResult = InterviewResults['questions'][number];
type TimelineEvent = InterviewResults['timeline'][number];

export function InterviewResultsPage({ interviewId }: { interviewId: string }) {
  const { data, loading, error, refetch } = useQuery(GetInterviewResultsDocument, {
    variables: { id: interviewId },
    fetchPolicy: 'network-only',
    ssr: false,
  });
  const results = data?.interviewResults;

  if (loading && !data) return <LoadingState label="Loading interview results…" />;
  if (error || !results) {
    return (
      <>
        <Link href="/dashboard" className={styles.backLink}>
          <Icon name="arrow" />
          Back to overview
        </Link>
        <ErrorNotice onRetry={() => void refetch().catch(() => {})}>
          {getErrorMessage(error)}
        </ErrorNotice>
      </>
    );
  }

  return (
    <>
      <Link href={`/interviews/${results.id}`} className={styles.backLink}>
        <Icon name="arrow" />
        Back to interview
      </Link>
      <div className={styles.pageHeader}>
        <div>
          <div className={styles.eyebrow}>Interview results</div>
          <h1 className={styles.title}>{results.title}</h1>
          <p className={styles.subtitle}>
            A record of the session and browser-reported code runs. These results are descriptive,
            not an automated candidate score.
          </p>
        </div>
        <StatusBadge status={results.status} />
      </div>

      {!results.available ? (
        <EmptyState title="Results are not available yet">
          Interview results are available after the interview is finished.
        </EmptyState>
      ) : (
        <>
          <section className={resultsStyles.summary} aria-label="Interview summary">
            <dl>
              <div>
                <dt>Candidate</dt>
                <dd>{results.candidateName ?? 'Candidate name unavailable'}</dd>
              </div>
              <div>
                <dt>Interviewer</dt>
                <dd>{results.interviewerName}</dd>
              </div>
              <div>
                <dt>Started</dt>
                <dd>{formatDateTime(results.startedAt)}</dd>
              </div>
              <div>
                <dt>Finished</dt>
                <dd>{formatDateTime(results.finishedAt)}</dd>
              </div>
              <div>
                <dt>Duration</dt>
                <dd>{formatDuration(results.durationMs)}</dd>
              </div>
            </dl>
          </section>

          <section className={resultsStyles.stats} aria-label="Interview totals">
            <article>
              <span>Questions</span>
              <strong>{results.totalQuestions}</strong>
            </article>
            <article>
              <span>Code runs</span>
              <strong>{results.totalRuns}</strong>
            </article>
          </section>

          <section className={resultsStyles.section} aria-labelledby="results-questions-title">
            <div className={styles.sectionHeader}>
              <h2 id="results-questions-title" className={styles.sectionTitle}>
                Questions
              </h2>
              <span className={styles.count}>{results.totalQuestions} total</span>
            </div>
            {results.questions.length ? (
              <ol className={resultsStyles.questionList} aria-label="Questions">
                {results.questions.map((question) => (
                  <QuestionCard
                    key={question.interviewQuestionId}
                    question={question}
                    interviewId={results.id}
                  />
                ))}
              </ol>
            ) : (
              <EmptyState title="No questions recorded">
                This interview has no question snapshots.
              </EmptyState>
            )}
          </section>

          <section className={resultsStyles.section} aria-labelledby="results-timeline-title">
            <div className={styles.sectionHeader}>
              <h2 id="results-timeline-title" className={styles.sectionTitle}>
                Interview timeline
              </h2>
            </div>
            {results.timeline.length ? (
              <ol className={resultsStyles.timeline} aria-label="Interview timeline">
                {results.timeline.map((event) => (
                  <TimelineItem key={event.id} event={event} />
                ))}
              </ol>
            ) : (
              <p className={resultsStyles.muted}>No timeline events were recorded.</p>
            )}
            {results.hasMoreTimelineEvents && (
              <p className={resultsStyles.muted}>Showing the 100 most recent key events.</p>
            )}
          </section>
        </>
      )}
    </>
  );
}

function QuestionCard({
  question,
  interviewId,
}: {
  question: QuestionResult;
  interviewId: string;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const title = question.snapshotTitle ?? `Question ${question.order + 1}`;
  const language = question.snapshotLanguage
    ? languageLabels[question.snapshotLanguage]
    : 'Language unavailable';

  return (
    <li className={resultsStyles.questionCard}>
      <div className={resultsStyles.questionHeading}>
        <div>
          <span className={resultsStyles.questionOrder}>Question {question.order + 1}</span>
          <h3>{title}</h3>
          <p>{language}</p>
        </div>
        <span className={resultsStyles.runCount}>
          {question.runCount} {question.runCount === 1 ? 'run' : 'runs'}
        </span>
      </div>
      <div className={resultsStyles.lastRun}>
        {question.lastRun ? (
          <>
            <span>Last run: {question.lastRun.status}</span>
            <span>{formatDuration(question.lastRun.durationMs)}</span>
            <time dateTime={question.lastRun.createdAt}>
              {formatDateTime(question.lastRun.createdAt, 'compact')}
            </time>
          </>
        ) : (
          <span>No runs for this question.</span>
        )}
      </div>
      {question.lastRun ? (
        <details className={resultsStyles.snapshot}>
          <summary>Latest source snapshot · read-only</summary>
          <pre aria-label="Latest source snapshot" tabIndex={0}>
            {question.lastRun.sourceSnapshot}
          </pre>
          <RunOutput stdout={question.lastRun.stdout} stderr={question.lastRun.stderr} />
        </details>
      ) : (
        <p className={resultsStyles.muted}>No source snapshot is available.</p>
      )}
      <button
        type="button"
        className={styles.secondaryButton}
        aria-expanded={historyOpen}
        onClick={() => setHistoryOpen((open) => !open)}
      >
        {historyOpen ? 'Hide run history' : 'View run history'}
      </button>
      {historyOpen && (
        <QuestionRunHistory
          interviewId={interviewId}
          interviewQuestionId={question.interviewQuestionId}
        />
      )}
    </li>
  );
}

function QuestionRunHistory({
  interviewId,
  interviewQuestionId,
}: {
  interviewId: string;
  interviewQuestionId: string;
}) {
  const [offset, setOffset] = useState(0);
  const { data, loading, error, refetch } = useQuery(GetCodeRunsDocument, {
    variables: { interviewId, interviewQuestionId, limit: 20, offset },
    fetchPolicy: 'network-only',
    ssr: false,
  });
  const page = data?.codeRuns;

  return (
    <CodeRunHistory
      page={page}
      loading={loading}
      failed={Boolean(error)}
      onRetry={() => void refetch().catch(() => {})}
      onPrevious={() => setOffset((current) => Math.max(0, current - 20))}
      onNext={() => {
        if (page?.pageInfo.hasNextPage) setOffset((current) => current + 20);
      }}
    />
  );
}

function TimelineItem({ event }: { event: TimelineEvent }) {
  let label = 'Interview event';
  switch (event.type) {
    case 'INTERVIEW_STARTED':
      label = `Interview started${event.questionTitle ? ` · ${event.questionTitle}` : ''}`;
      break;
    case 'QUESTION_CHANGED':
      label = event.questionTitle
        ? `Question changed${event.previousQuestionTitle ? ` · ${event.previousQuestionTitle} →` : ' →'} ${event.questionTitle}`
        : 'Question changed';
      break;
    case 'CANDIDATE_JOINED':
      label = `${event.participantName ?? 'Candidate'} joined`;
      break;
    case 'INTERVIEW_FINISHED':
      label = 'Interview finished';
      break;
  }

  return (
    <li>
      <time dateTime={event.createdAt} aria-label={formatDateTime(event.createdAt)}>
        {formatDateTime(event.createdAt, 'compact')}
      </time>
      <span>{label}</span>
    </li>
  );
}
