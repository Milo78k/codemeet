'use client';

import { useEffect, useRef } from 'react';

import { ErrorNotice } from '../../shared/ui/Feedback';
import styles from '../../shared/ui/workspace.module.css';

export function FinishInterviewDialog({
  open,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      cancelButton.current?.focus();
    } else if (!open && element.open) {
      element.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className={styles.finishDialog}
      aria-labelledby="finish-interview-heading"
      aria-describedby="finish-interview-description"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onCancel();
      }}
    >
      <div className={styles.eyebrow}>Complete interview</div>
      <h2 id="finish-interview-heading">Finish interview?</h2>
      <p id="finish-interview-description" className={styles.description}>
        This ends the session. You can review the selected questions in the interview summary
        afterward.
      </p>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <div className={styles.dialogActions}>
        <button
          ref={cancelButton}
          type="button"
          className={styles.secondaryButton}
          disabled={pending}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={pending}
          onClick={onConfirm}
        >
          {pending ? 'Finishing…' : 'Confirm finish'}
        </button>
      </div>
    </dialog>
  );
}
