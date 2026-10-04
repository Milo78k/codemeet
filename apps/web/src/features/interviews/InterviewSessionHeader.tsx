import Link from 'next/link';

import type { InterviewFieldsFragment } from '../../shared/api/generated/graphql';
import { formatDateTime } from '../../shared/lib/format';
import { StatusBadge } from '../../shared/ui/Badge';
import { Icon } from '../../shared/ui/Icon';
import styles from '../../shared/ui/workspace.module.css';

export function InterviewSessionHeader({
  interview,
  participantName,
  canFinish,
  finishDisabled,
  onFinish,
}: {
  interview: InterviewFieldsFragment;
  participantName: string | null;
  canFinish: boolean;
  finishDisabled: boolean;
  onFinish: () => void;
}) {
  const startedLabel = formatDateTime(interview.startedAt);

  return (
    <header className={styles.sessionHeader}>
      <div className={styles.sessionHeaderInfo}>
        <Link href={`/interviews/${interview.id}`} className={styles.backLink}>
          <Icon name="arrow" />
          Back to interview
        </Link>
        <div className={styles.eyebrow}>Interview session</div>
        <h1 className={styles.title}>{interview.title}</h1>
        {participantName && <p className={styles.subtitle}>Joined as {participantName}</p>}
        {startedLabel !== '—' && (
          <p className={styles.subtitle}>
            Started <time dateTime={interview.startedAt ?? undefined}>{startedLabel}</time>
          </p>
        )}
      </div>
      <div className={styles.sessionHeaderActions}>
        <StatusBadge status={interview.status} />
        {canFinish && (
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={finishDisabled}
            onClick={onFinish}
          >
            Finish interview
          </button>
        )}
      </div>
    </header>
  );
}
