'use client';

import { useMutation, useQuery } from '@apollo/client/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';

import { invalidateInterviewLists } from '../../shared/api/cache';
import { getErrorMessage } from '../../shared/api/errors';
import {
  FinishInterviewDocument,
  GetCurrentParticipantDocument,
  GetInterviewDocument,
  SetActiveQuestionDocument,
} from '../../shared/api/generated/graphql';
import { EmptyState, ErrorNotice, LoadingState } from '../../shared/ui/Feedback';
import styles from '../../shared/ui/workspace.module.css';
import { ActiveInterviewQuestion } from './ActiveInterviewQuestion';
import { useInterviewDraftStore } from './editor/draft-store';
import type { ParticipantIdentity } from './editor/presence';
import { useInterviewSessionEvents } from './session-events/useInterviewSessionEvents';
import { FinishInterviewDialog } from './FinishInterviewDialog';
import { InterviewQuestionList } from './InterviewQuestionList';
import { InterviewSessionHeader } from './InterviewSessionHeader';
import { getQuestionSnapshot } from './question-snapshot';

export function InterviewSessionPage({ interviewId }: { interviewId: string }) {
  const router = useRouter();
  const drafts = useInterviewDraftStore(interviewId);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const writePending = useRef(false);
  const { data, error, loading, refetch } = useQuery(GetInterviewDocument, {
    variables: { id: interviewId },
    ssr: false,
    fetchPolicy: 'network-only',
  });
  const interview = data?.interview;
  useInterviewSessionEvents({
    interviewId,
    enabled: interview?.status === 'IN_PROGRESS',
    refetch: () => refetch(),
  });
  const currentParticipant = useQuery(GetCurrentParticipantDocument, {
    fetchPolicy: 'network-only',
    ssr: false,
  });
  const [setActiveQuestion, switching] = useMutation(SetActiveQuestionDocument);
  const [finishInterview, finishing] = useMutation(FinishInterviewDocument, {
    update: (cache) => invalidateInterviewLists(cache),
  });
  const candidate = currentParticipant.data?.currentParticipant ?? null;
  const interviewer = interview?.participants.find(
    (participant) => participant.role === 'INTERVIEWER',
  );
  const activeParticipant = candidate ?? interviewer ?? null;
  const participantId = activeParticipant?.id;
  const participantName = activeParticipant?.displayName;
  const participantRole = activeParticipant?.role;
  const identity = useMemo<ParticipantIdentity | null>(
    () =>
      participantId && participantName && participantRole
        ? {
            participantId,
            displayName: participantName,
            role: participantRole,
          }
        : null,
    [participantId, participantName, participantRole],
  );
  const canManage = !candidate;
  const busy = switching.loading || finishing.loading;
  const activeEntry = interview?.questions.find(
    ({ question }) => question.id === interview.activeQuestion?.id,
  );
  const activeSnapshot = activeEntry ? getQuestionSnapshot(activeEntry) : null;

  async function switchQuestion(questionId: string) {
    if (
      !interview ||
      interview.status !== 'IN_PROGRESS' ||
      loading ||
      writePending.current ||
      confirmOpen ||
      questionId === interview.activeQuestion?.id
    )
      return;
    writePending.current = true;
    setSwitchError(null);
    try {
      await setActiveQuestion({ variables: { interviewId: interview.id, questionId } });
    } catch (failure) {
      setSwitchError(getErrorMessage(failure));
    } finally {
      writePending.current = false;
    }
  }

  async function finish() {
    if (!interview || interview.status !== 'IN_PROGRESS' || writePending.current || !confirmOpen)
      return;
    writePending.current = true;
    setFinishError(null);
    try {
      await finishInterview({ variables: { interviewId: interview.id } });
      router.push(`/interviews/${interview.id}`);
    } catch (failure) {
      setFinishError(getErrorMessage(failure));
    } finally {
      writePending.current = false;
    }
  }

  function retry() {
    setSwitchError(null);
    void refetch().catch(() => {});
    void currentParticipant.refetch().catch(() => {});
  }

  if ((loading && !data) || (currentParticipant.loading && !currentParticipant.data))
    return <LoadingState label="Loading interview session…" />;
  if (error || currentParticipant.error)
    return (
      <>
        <ErrorNotice onRetry={retry}>
          {getErrorMessage(error ?? currentParticipant.error)}
        </ErrorNotice>
      </>
    );
  if (!interview)
    return (
      <EmptyState title="Interview not found">
        This interview is unavailable in your workspace.{' '}
        <Link href="/dashboard">Back to overview</Link>.
      </EmptyState>
    );
  if (interview.status === 'DRAFT' || interview.status === 'READY')
    return (
      <EmptyState title="Interview has not started yet">
        Start this interview from its overview before opening the session.{' '}
        <Link href={`/interviews/${interview.id}`}>Back to interview</Link>.
      </EmptyState>
    );
  if (interview.status === 'FINISHED')
    return (
      <EmptyState title="Interview is finished">
        The session has ended. <Link href={`/interviews/${interview.id}`}>View result</Link>.
      </EmptyState>
    );

  let brokenState: string | null = null;
  let diagnostic: string | null = null;
  if (interview.questions.length === 0) {
    brokenState = 'This interview has no attached questions.';
    diagnostic = 'QUESTIONS_MISSING';
  } else if (!interview.activeQuestion) {
    brokenState = 'The active question is missing. Select an available question to continue.';
    diagnostic = 'ACTIVE_QUESTION_MISSING';
  } else if (!activeEntry) {
    brokenState =
      'The active question does not belong to this interview. Select an available question to continue.';
    diagnostic = 'ACTIVE_QUESTION_INVALID';
  } else if (!activeSnapshot) {
    brokenState =
      'The active question snapshot is unavailable. Its original interview content cannot be displayed.';
    diagnostic = 'SNAPSHOT_MISSING';
  }
  const missingOtherSnapshots = interview.questions.some(
    (entry) => entry.id !== activeEntry?.id && !getQuestionSnapshot(entry),
  );

  return (
    <>
      <InterviewSessionHeader
        interview={interview}
        participantName={candidate?.displayName ?? null}
        canFinish={canManage}
        finishDisabled={busy || confirmOpen || loading}
        onFinish={() => {
          setFinishError(null);
          setConfirmOpen(true);
        }}
      />
      {switchError && <ErrorNotice onRetry={retry}>{switchError}</ErrorNotice>}
      {switching.loading && (
        <p role="status" className={styles.loadingLabel}>
          Switching question…
        </p>
      )}
      {brokenState && (
        <ErrorNotice onRetry={retry}>
          {brokenState}{' '}
          <span className={styles.diagnostic}>
            Interview {interview.id} · {diagnostic}
          </span>
        </ErrorNotice>
      )}
      {missingOtherSnapshots && !brokenState && (
        <ErrorNotice>
          Some question snapshots are unavailable. Those questions cannot be opened.{' '}
          <span className={styles.diagnostic}>Interview {interview.id} · SNAPSHOT_MISSING</span>
        </ErrorNotice>
      )}
      <div className={styles.sessionLayout}>
        <InterviewQuestionList
          questions={interview.questions}
          activeQuestionId={interview.activeQuestion?.id ?? null}
          disabled={!canManage || busy || confirmOpen || loading}
          onSelect={(questionId) => void switchQuestion(questionId)}
        />
        {activeSnapshot && activeEntry ? (
          <ActiveInterviewQuestion
            key={activeEntry.id}
            snapshot={activeSnapshot}
            interviewId={interview.id}
            interviewQuestionId={activeEntry.id}
            canRun={interview.status === 'IN_PROGRESS'}
            drafts={drafts}
            identity={identity}
          />
        ) : (
          <div className={styles.sessionBrokenContent}>
            <h2 className={styles.sectionTitle}>Question content unavailable</h2>
            <p className={styles.description}>
              Choose another available question, retry the request, or finish the interview.
            </p>
          </div>
        )}
      </div>
      <FinishInterviewDialog
        open={confirmOpen}
        pending={finishing.loading}
        error={finishError}
        onCancel={() => {
          if (!finishing.loading) setConfirmOpen(false);
        }}
        onConfirm={() => void finish()}
      />
    </>
  );
}
