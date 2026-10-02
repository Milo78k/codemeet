'use client';

import { useApolloClient, useMutation, useQuery } from '@apollo/client/react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { getErrorMessage } from '../../../shared/api/errors';
import {
  GetGuestInviteDocument,
  JoinInterviewDocument,
  type GuestInviteState,
} from '../../../shared/api/generated/graphql';
import { storeParticipantSession } from '../../../shared/api/participant-session';
import { ErrorNotice, LoadingState } from '../../../shared/ui/Feedback';
import styles from '../../../shared/ui/workspace.module.css';

const joinSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, 'Enter your name.')
    .max(80, 'Use 80 characters or fewer.')
    .refine((value) => !containsControlCharacters(value), 'Remove control characters.'),
});
type JoinValues = z.infer<typeof joinSchema>;

function containsControlCharacters(value: string) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
  });
}

const inviteMessages: Record<GuestInviteState, string> = {
  VALID: '',
  INVALID: 'This invite link is invalid.',
  EXPIRED: 'This invite has expired. Ask the interviewer for a new link.',
  USED: 'This invite has already been used.',
  INTERVIEW_FINISHED: 'This interview has finished.',
};

export function JoinInterviewPage({ inviteToken }: { inviteToken: string }) {
  const router = useRouter();
  const client = useApolloClient();
  const [joinError, setJoinError] = useState<string | null>(null);
  const { data, loading, error, refetch } = useQuery(GetGuestInviteDocument, {
    variables: { inviteToken },
    fetchPolicy: 'no-cache',
    ssr: false,
  });
  const [joinInterview, joining] = useMutation(JoinInterviewDocument, {
    fetchPolicy: 'no-cache',
  });
  const form = useForm<JoinValues>({
    resolver: zodResolver(joinSchema),
    defaultValues: { displayName: '' },
  });
  const invite = data?.guestInvite;

  async function submit(values: JoinValues) {
    setJoinError(null);
    try {
      const result = await joinInterview({
        variables: { inviteToken, displayName: values.displayName },
      });
      const payload = result.data?.joinInterview;
      if (!payload) throw new Error('Could not join this interview. Please try again.');
      storeParticipantSession({
        role: 'candidate',
        token: payload.participantSessionToken,
        interviewId: payload.interviewId,
        expiresAt: payload.participantSessionExpiresAt,
      });
      await client.clearStore();
      router.replace(`/interviews/${encodeURIComponent(payload.interviewId)}/session`);
    } catch (failure) {
      setJoinError(getErrorMessage(failure));
      void refetch().catch(() => {});
    }
  }

  return (
    <section
      className={styles.formCard}
      style={{ maxWidth: 560, margin: '20px auto' }}
      aria-labelledby="join-title"
    >
      <div className={styles.eyebrow}>CodeMeet</div>
      <h1 id="join-title" className={styles.title}>
        You&apos;ve been invited to an interview
      </h1>
      {loading && !invite ? (
        <LoadingState label="Checking invite…" />
      ) : error ? (
        <ErrorNotice onRetry={() => void refetch().catch(() => {})}>
          Could not check this invite. Please try again.
        </ErrorNotice>
      ) : !invite || invite.state !== 'VALID' ? (
        <p role="alert" className={styles.description}>
          {invite ? inviteMessages[invite.state] : 'This invite link is invalid.'}
        </p>
      ) : (
        <>
          <p className={styles.description}>
            You&apos;ve been invited to: <strong>{invite.interviewTitle}</strong>
          </p>
          <form
            noValidate
            onSubmit={form.handleSubmit((values) => void submit(values))}
            className={styles.fieldset}
          >
            <div>
              <label htmlFor="candidate-display-name" className={styles.formLabel}>
                Your name
              </label>
              <input
                id="candidate-display-name"
                className={styles.input}
                autoComplete="name"
                maxLength={80}
                aria-invalid={Boolean(form.formState.errors.displayName)}
                aria-describedby={
                  form.formState.errors.displayName ? 'candidate-name-error' : undefined
                }
                {...form.register('displayName')}
              />
              {form.formState.errors.displayName && (
                <p id="candidate-name-error" className={styles.fieldError} role="alert">
                  {form.formState.errors.displayName.message}
                </p>
              )}
            </div>
            {joinError && <ErrorNotice>{joinError}</ErrorNotice>}
            <button type="submit" className={styles.primaryButton} disabled={joining.loading}>
              {joining.loading ? 'Joining…' : 'Join interview'}
            </button>
          </form>
        </>
      )}
    </section>
  );
}
