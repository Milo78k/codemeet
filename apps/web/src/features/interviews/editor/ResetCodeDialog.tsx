'use client';

import { useEffect, useRef } from 'react';

import styles from './editor.module.css';

export function ResetCodeDialog({
  open,
  onCancel,
  onConfirm,
  onClosed,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  onClosed: () => void;
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
      onClosed();
    }
  }, [open, onClosed]);

  return (
    <dialog
      ref={dialog}
      className={styles.resetDialog}
      aria-labelledby="reset-code-heading"
      aria-describedby="reset-code-description"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <div className={styles.eyebrow}>Restore starter code</div>
      <h2 id="reset-code-heading">Reset code?</h2>
      <p id="reset-code-description">
        Your edits to this question will be replaced with its original starter code. Drafts for
        other questions stay unchanged.
      </p>
      <div className={styles.dialogActions}>
        <button
          ref={cancelButton}
          type="button"
          className={styles.secondaryButton}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button type="button" className={styles.primaryButton} onClick={onConfirm}>
          Confirm reset
        </button>
      </div>
    </dialog>
  );
}
