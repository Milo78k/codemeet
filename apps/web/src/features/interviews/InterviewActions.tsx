'use client';

import { useMutation } from '@apollo/client/react';
import { useState } from 'react';

import { invalidateInterviewLists } from '../../shared/api/cache';
import { getErrorMessage } from '../../shared/api/errors';
import {
  CreateGuestInviteDocument,
  FinishInterviewDocument,
  StartInterviewDocument,
  type InterviewFieldsFragment,
} from '../../shared/api/generated/graphql';
import { ErrorNotice } from '../../shared/ui/Feedback';
import styles from '../../shared/ui/workspace.module.css';

export function InterviewActions({
  interview,
  onStatusChange,
}: {
  interview: InterviewFieldsFragment;
  onStatusChange?: () => Promise<unknown>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteExpiresAt, setInviteExpiresAt] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [start] = useMutation(StartInterviewDocument, {
    update: (cache) => invalidateInterviewLists(cache),
  });
  const [finish] = useMutation(FinishInterviewDocument, {
    update: (cache) => invalidateInterviewLists(cache),
  });
  const [createInvite, creatingInvite] = useMutation(CreateGuestInviteDocument, {
    fetchPolicy: 'no-cache',
  });

  async function generateInvite() {
    setError(null);
    setInviteUrl(null);
    try {
      const result = await createInvite({ variables: { interviewId: interview.id } });
      const invite = result.data?.createGuestInvite;
      if (!invite) throw new Error('Could not create an invite. Please try again.');
      setInviteUrl(`${window.location.origin}/join/${encodeURIComponent(invite.token)}`);
      setInviteExpiresAt(invite.expiresAt);
    } catch (failure) {
      setError(getErrorMessage(failure));
    }
  }

  async function changeStatus() {
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      if (interview.status === 'READY') await start({ variables: { interviewId: interview.id } });
      else if (interview.status === 'IN_PROGRESS')
        await finish({ variables: { interviewId: interview.id } });
      if (onStatusChange) await onStatusChange();
    } catch (failure) {
      setError(getErrorMessage(failure));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.actionGroup}>
      {(interview.status === 'READY' || interview.status === 'IN_PROGRESS' || pending) && (
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={() => void changeStatus()}
          disabled={pending}
        >
          {pending
            ? 'Updating…'
            : interview.status === 'READY'
              ? 'Start interview'
              : 'Finish interview'}
        </button>
      )}
      {(interview.status === 'READY' || interview.status === 'IN_PROGRESS') && (
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={() => void generateInvite()}
          disabled={creatingInvite.loading}
        >
          {creatingInvite.loading ? 'Creating invite…' : 'Create guest invite'}
        </button>
      )}
      {inviteUrl && (
        <p role="status" className={styles.description} style={{ overflowWrap: 'anywhere' }}>
          Share this one-time link (expires{' '}
          {inviteExpiresAt ? new Date(inviteExpiresAt).toLocaleString() : 'soon'}):{' '}
          <a href={inviteUrl}>{inviteUrl}</a>
        </p>
      )}
      {error && <ErrorNotice>{error}</ErrorNotice>}
    </div>
  );
}
