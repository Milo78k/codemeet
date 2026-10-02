import type { ReactNode } from 'react';
import { Icon } from './Icon';
import styles from './workspace.module.css';
export function ErrorNotice({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <div className={styles.errorNotice} role="alert">
      <span>{children}</span>
      {onRetry && (
        <button type="button" className={styles.textButton} onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
export function SuccessNotice({ children }: { children: ReactNode }) {
  return (
    <div className={styles.successNotice} role="status">
      <Icon name="check" />
      <span>{children}</span>
    </div>
  );
}
export function LoadingState({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div>
      <p className={styles.loadingLabel} role="status">
        {label}
      </p>
      <div className={styles.skeletonStack} aria-hidden="true">
        {Array.from({ length: rows }, (_, index) => (
          <div className={styles.skeleton} key={index} />
        ))}
      </div>
    </div>
  );
}
export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={styles.emptyState}>
      <div className={styles.emptyIcon}>
        <Icon name="questions" />
      </div>
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}
export function FieldError({ id, message }: { id: string; message: string | undefined }) {
  return message ? (
    <p id={id} className={styles.fieldError} role="alert">
      {message}
    </p>
  ) : null;
}
