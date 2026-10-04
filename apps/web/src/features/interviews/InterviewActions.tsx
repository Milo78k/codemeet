'use client';

import { useMutation } from '@apollo/client/react';
import type { ReactNode } from 'react';
import { useState } from 'react';

import { invalidateInterviewLists } from '../../shared/api/cache';
import { getErrorMessage } from '../../shared/api/errors';
import {
  CreateGuestInviteDocument,
  FinishInterviewDocument,
  StartInterviewDocument,
  type InterviewFieldsFragment,
} from '../../shared/api/generated/graphql';
import { formatDateTime } from '../../shared/lib/format';
import styles from '../../shared/ui/workspace.module.css';

type InviteCardProps = {
  inviteUrl: string;
  expiresAt: string | null;
  copied: boolean;
  copyError: string | null;
  compact: boolean;
  onCopy: () => void;
};

function GuestInviteCard({
  inviteUrl,
  expiresAt,
  copied,
  copyError,
  compact,
  onCopy,
}: InviteCardProps) {
  return (
    <section
      className={compact ? styles.guestInviteCompact : styles.guestInviteCard}
      aria-labelledby={compact ? undefined : 'guest-invite-title'}
      aria-label={compact ? 'Guest invite' : undefined}
    >
      {!compact && (
        <h2 id="guest-invite-title" className={styles.guestInviteTitle}>
          Guest invite
        </h2>
      )}
      <p className={styles.guestInviteExpiry}>
        <span>Expires</span>
        <time dateTime={expiresAt ?? undefined}>{expiresAt ? formatDateTime(expiresAt) : '—'}</time>
      </p>
      <div className={styles.guestInviteActions}>
        <button type="button" className={styles.secondaryButton} onClick={onCopy}>
          Copy invite link
        </button>
        <a href={inviteUrl} target="_blank" rel="noopener noreferrer" className={styles.textButton}>
          Open in new tab
        </a>
      </div>
      {copied && (
        <p className={styles.guestInviteFeedback} role="status" aria-live="polite">
          Copied
        </p>
      )}
      {copyError && (
        <div className={styles.guestInviteCopyError}>
          <p role="alert">{copyError}</p>
          <label className={styles.guestInviteManualLabel}>
            Copy the invite link manually
            <input aria-label="Invite link" readOnly value={inviteUrl} />
          </label>
        </div>
      )}
    </section>
  );
}

export function InterviewActions({
  interview,
  onStatusChange,
  primaryAction = null,
  variant = 'compact',
}: {
  interview: InterviewFieldsFragment;
  onStatusChange?: () => Promise<unknown>;
  primaryAction?: ReactNode;
  variant?: 'compact' | 'overview';
}) {
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteExpiresAt, setInviteExpiresAt] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<'copied' | 'error' | null>(null);
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
    setCopyStatus(null);
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

  async function copyInvite() {
    if (!inviteUrl) return;
    setCopyStatus(null);
    try {
      const clipboard = navigator.clipboard;
      if (!clipboard?.writeText) throw new Error('Clipboard access is unavailable.');
      await clipboard.writeText(inviteUrl);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('error');
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

  const actionButtons = (
    <div className={variant === 'overview' ? styles.overviewActions : styles.actionGroupButtons}>
      {primaryAction}
      {(interview.status === 'READY' || interview.status === 'IN_PROGRESS' || pending) && (
        <button
          type="button"
          className={
            interview.status === 'IN_PROGRESS' ? styles.destructiveButton : styles.secondaryButton
          }
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
      {(interview.status === 'READY' || interview.status === 'IN_PROGRESS') && !inviteUrl && (
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={() => void generateInvite()}
          disabled={creatingInvite.loading}
        >
          {creatingInvite.loading ? 'Creating invite…' : 'Create guest invite'}
        </button>
      )}
    </div>
  );

  const inviteCard = inviteUrl ? (
    <GuestInviteCard
      inviteUrl={inviteUrl}
      expiresAt={inviteExpiresAt}
      copied={copyStatus === 'copied'}
      copyError={
        copyStatus === 'error' ? 'Could not copy the invite link. Select and copy it below.' : null
      }
      compact={variant === 'compact'}
      onCopy={() => void copyInvite()}
    />
  ) : null;

  if (variant === 'overview') {
    return (
      <>
        {actionButtons}
        {inviteCard}
        {error && (
          <p className={styles.overviewActionError} role="alert">
            {error}
          </p>
        )}
      </>
    );
  }

  return (
    <div className={styles.actionGroup}>
      {actionButtons}
      {inviteCard}
      {error && (
        <p className={styles.overviewActionError} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
