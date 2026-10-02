import { difficultyLabels } from '../lib/format';
import type { InterviewStatus, QuestionDifficulty } from '../api/generated/graphql';
import styles from './workspace.module.css';
export function DifficultyBadge({ difficulty }: { difficulty: QuestionDifficulty }) {
  return (
    <span className={`${styles.badge} ${styles[difficulty.toLowerCase()] ?? ''}`}>
      {difficultyLabels[difficulty]}
    </span>
  );
}
export function StatusBadge({ status }: { status: InterviewStatus }) {
  return (
    <span className={`${styles.badge} ${styles[status.toLowerCase()] ?? ''}`}>
      <span className={styles.statusDot} />
      {status}
    </span>
  );
}
