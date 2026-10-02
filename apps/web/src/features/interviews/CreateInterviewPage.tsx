'use client';

import { NetworkStatus } from '@apollo/client';
import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { useApolloClient, useMutation, useQuery } from '@apollo/client/react';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { invalidateInterviewLists } from '../../shared/api/cache';
import { getErrorMessage } from '../../shared/api/errors';
import {
  AddQuestionToInterviewDocument,
  CreateInterviewDocument,
  GetInterviewDocument,
  GetQuestionsDocument,
} from '../../shared/api/generated/graphql';
import { languageLabels } from '../../shared/lib/format';
import { DifficultyBadge } from '../../shared/ui/Badge';
import { EmptyState, ErrorNotice, FieldError, LoadingState } from '../../shared/ui/Feedback';
import { Icon } from '../../shared/ui/Icon';
import styles from '../../shared/ui/workspace.module.css';
import { interviewFormSchema, type InterviewFormValues } from './form-schema';

// Local workflow state preserves the one server-created interview across retries.
type SetupProgress = {
  interviewId: string;
  title: string;
  questionIds: string[];
  attachedIds: string[];
  failedQuestionId: string | null;
};

export function CreateInterviewPage() {
  const router = useRouter();
  const client = useApolloClient();
  const [progress, setProgress] = useState<SetupProgress | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [creationUncertain, setCreationUncertain] = useState(false);
  const [completed, setCompleted] = useState(false);
  const questions = useQuery(GetQuestionsDocument, {
    ssr: false,
    variables: { limit: 12, offset: 0 },
  });
  const [createInterview] = useMutation(CreateInterviewDocument, {
    update: (cache) => invalidateInterviewLists(cache),
  });
  const [attachQuestion] = useMutation(AddQuestionToInterviewDocument, {
    update: (cache) => invalidateInterviewLists(cache),
  });
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<InterviewFormValues>({
    resolver: zodResolver(interviewFormSchema),
    defaultValues: { title: '', questionIds: [] },
  });
  const page = questions.data?.questions;
  const busy = isSubmitting || retrying;
  const frozen = busy || progress !== null || completed || creationUncertain;

  async function reconcile(current: SetupProgress) {
    const result = await client.query({
      query: GetInterviewDocument,
      variables: { id: current.interviewId },
      fetchPolicy: 'network-only',
    });
    if (!result.data?.interview) throw new Error('Interview reconciliation failed');
    const next = {
      ...current,
      attachedIds: result.data.interview.questions.map(({ question }) => question.id),
      failedQuestionId: null,
    };
    setProgress(next);
    return next;
  }

  async function attachRemaining(current: SetupProgress) {
    let next = current;
    for (const questionId of current.questionIds) {
      if (next.attachedIds.includes(questionId)) continue;
      next = { ...next, failedQuestionId: questionId };
      setProgress(next);
      try {
        const result = await attachQuestion({
          variables: { interviewId: next.interviewId, questionId },
        });
        if (!result.data) throw new Error('Missing attachment response');
        next = {
          ...next,
          attachedIds: result.data.addQuestionToInterview.questions.map(
            ({ question }) => question.id,
          ),
          failedQuestionId: null,
        };
        setProgress(next);
      } catch (failure) {
        const message = getErrorMessage(failure);
        try {
          const reconciled = await reconcile(next);
          next = {
            ...reconciled,
            failedQuestionId: reconciled.attachedIds.includes(questionId) ? null : questionId,
          };
          setProgress(next);
        } catch {
          // Keep confirmed responses; retry must reconcile again before any write.
        }
        setSubmitError(message);
        return;
      }
    }
    setCompleted(true);
    router.push(`/interviews/${next.interviewId}`);
  }

  async function submit(values: InterviewFormValues) {
    if (progress || creationUncertain || completed) return;
    setSubmitError(null);
    try {
      const result = await createInterview({ variables: { input: { title: values.title } } });
      if (!result.data) throw new Error('Missing creation response');
      const current: SetupProgress = {
        interviewId: result.data.createInterview.id,
        title: values.title,
        questionIds: values.questionIds,
        attachedIds: [],
        failedQuestionId: null,
      };
      setProgress(current);
      await attachRemaining(current);
    } catch (failure) {
      setSubmitError(getErrorMessage(failure));
      if (!CombinedGraphQLErrors.is(failure)) setCreationUncertain(true);
    }
  }

  async function retryRemaining() {
    if (!progress || busy || completed) return;
    setRetrying(true);
    setSubmitError(null);
    try {
      await attachRemaining(await reconcile(progress));
    } catch (failure) {
      setSubmitError(getErrorMessage(failure));
    } finally {
      setRetrying(false);
    }
  }

  async function loadMore() {
    if (!page || questions.loading || frozen) return;
    setPageError(null);
    try {
      await questions.fetchMore({
        variables: { offset: page.pageInfo.offset + page.pageInfo.limit },
      });
    } catch (failure) {
      setPageError(getErrorMessage(failure));
    }
  }

  const attachedCount =
    progress?.questionIds.filter((id) => progress.attachedIds.includes(id)).length ?? 0;
  const failedQuestionTitle = page?.items.find(
    ({ id }) => id === progress?.failedQuestionId,
  )?.title;

  return (
    <>
      <Link href="/dashboard" className={styles.backLink}>
        <Icon name="arrow" />
        Back to overview
      </Link>
      <div className={styles.pageHeader}>
        <div>
          <div className={styles.eyebrow}>Interview preparation</div>
          <h1 className={styles.title}>Set up your next interview.</h1>
          <p className={styles.subtitle}>
            Give it a name and choose the questions you want to explore.
          </p>
        </div>
      </div>
      {submitError && (
        <ErrorNotice>
          {progress ? (
            <>
              Interview <strong>{progress.interviewId}</strong> was created. {attachedCount} of{' '}
              {progress.questionIds.length} questions attached.{' '}
              {failedQuestionTitle && <>Could not attach “{failedQuestionTitle}”. </>}
              {submitError} Resume with Retry remaining questions.
            </>
          ) : (
            <>
              {submitError}
              {creationUncertain && (
                <>
                  {' '}
                  The creation response was lost. Check your{' '}
                  <Link href="/dashboard">interview overview</Link> before starting another
                  interview.
                </>
              )}
            </>
          )}
        </ErrorNotice>
      )}
      {progress && (
        <div className={styles.progressCard} role="status">
          <h2>
            {completed
              ? 'Interview ready'
              : busy
                ? 'Preparing your interview…'
                : 'Interview setup saved'}
          </h2>
          <p>
            {progress.title} · {attachedCount} of {progress.questionIds.length} questions attached
          </p>
          <code>{progress.interviewId}</code>
          {!busy && !completed && (
            <Link href={`/interviews/${progress.interviewId}`}>Open the existing interview</Link>
          )}
        </div>
      )}
      <div className={styles.formLayout}>
        <form className={styles.formCard} onSubmit={handleSubmit(submit)} noValidate>
          <fieldset className={styles.fieldset} disabled={frozen}>
            <div>
              <label htmlFor="interview-title" className={styles.formLabel}>
                Interview title
              </label>
              <input
                id="interview-title"
                className={styles.input}
                placeholder="e.g. Frontend engineer · First round"
                {...register('title')}
                aria-invalid={Boolean(errors.title)}
                aria-describedby={errors.title ? 'interview-title-error' : undefined}
              />
              <FieldError id="interview-title-error" message={errors.title?.message} />
            </div>
            <fieldset
              className={styles.fieldset}
              aria-describedby={
                errors.questionIds ? 'interview-question-error' : 'interview-question-hint'
              }
            >
              <legend className={styles.formLabel}>Choose questions</legend>
              <p id="interview-question-hint" className={styles.hint}>
                Select at least one question. Questions are attached one at a time.
              </p>
              <FieldError id="interview-question-error" message={errors.questionIds?.message} />
              {(questions.error || pageError) && (
                <ErrorNotice
                  onRetry={() => {
                    setPageError(null);
                    void questions.refetch().catch(() => {});
                  }}
                >
                  {pageError ?? getErrorMessage(questions.error)}
                </ErrorNotice>
              )}
              {questions.loading && !page ? (
                <LoadingState label="Loading questions…" />
              ) : (
                page &&
                (page.items.length ? (
                  <div className={styles.selectionList}>
                    {page.items.map((question) => (
                      <label key={question.id} className={styles.selectionCard}>
                        <input
                          type="checkbox"
                          value={question.id}
                          {...register('questionIds')}
                          aria-label={question.title}
                          aria-invalid={Boolean(errors.questionIds)}
                          aria-describedby={
                            errors.questionIds ? 'interview-question-error' : undefined
                          }
                        />
                        <span className={styles.selectionBody}>
                          <span className={styles.selectionTitle}>{question.title}</span>
                          <span className={styles.selectionMeta}>
                            <DifficultyBadge difficulty={question.difficulty} />
                            <span className={styles.language}>
                              {languageLabels[question.language]}
                            </span>
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="No questions yet">
                    <Link href="/questions/new">Create a question</Link> before setting up an
                    interview.
                  </EmptyState>
                ))
              )}
              {page?.pageInfo.hasNextPage && (
                <div className={styles.loadMore}>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => void loadMore()}
                    disabled={questions.loading || frozen}
                  >
                    {questions.networkStatus === NetworkStatus.fetchMore
                      ? 'Loading more…'
                      : 'Load more questions'}
                  </button>
                </div>
              )}
            </fieldset>
          </fieldset>
          <div className={styles.formActions}>
            <Link href="/dashboard" className={styles.textButton}>
              Back to overview
            </Link>
            {progress ? (
              <button
                type="button"
                className={styles.primaryButton}
                disabled={busy || completed}
                onClick={() => void retryRemaining()}
              >
                {busy
                  ? 'Adding questions…'
                  : completed
                    ? 'Opening interview…'
                    : 'Retry remaining questions'}
              </button>
            ) : (
              <button
                type="submit"
                className={styles.primaryButton}
                disabled={
                  busy || creationUncertain || questions.loading || Boolean(questions.error)
                }
              >
                {busy ? 'Creating…' : 'Create interview'}
                <Icon name="arrow" />
              </button>
            )}
          </div>
        </form>
        <aside className={styles.formAside}>
          <div className={styles.asideIcon}>
            <Icon name="interview" />
          </div>
          <h2>A little preparation helps</h2>
          <p>
            Choose a few focused questions for your conversation. Your interview becomes ready when
            the first question is attached.
          </p>
          <p>After creation, you can review the questions and manage the interview status.</p>
        </aside>
      </div>
    </>
  );
}
