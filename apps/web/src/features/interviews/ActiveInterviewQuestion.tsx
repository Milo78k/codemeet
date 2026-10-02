import { languageLabels } from '../../shared/lib/format';
import { DifficultyBadge } from '../../shared/ui/Badge';
import styles from '../../shared/ui/workspace.module.css';
import type { useInterviewDraftStore } from './editor/draft-store';
import { InterviewCodeEditor } from './editor/InterviewCodeEditor';
import type { getQuestionSnapshot } from './question-snapshot';

export function ActiveInterviewQuestion({
  snapshot,
  interviewId,
  interviewQuestionId,
  drafts,
}: {
  snapshot: NonNullable<ReturnType<typeof getQuestionSnapshot>>;
  interviewId: string;
  interviewQuestionId: string;
  drafts: ReturnType<typeof useInterviewDraftStore>;
}) {
  return (
    <article className={styles.sessionQuestion}>
      <section className={styles.sessionPrompt} aria-labelledby="active-question-title">
        <div className={styles.eyebrow}>Active question</div>
        <h2 id="active-question-title" className={styles.sessionQuestionTitle}>
          {snapshot.title}
        </h2>
        <div className={styles.detailMeta}>
          <DifficultyBadge difficulty={snapshot.difficulty} />
          <span className={styles.language}>{languageLabels[snapshot.language]}</span>
        </div>
        <p className={`${styles.description} ${styles.sessionDescription}`}>
          {snapshot.description}
        </p>
      </section>
      <InterviewCodeEditor
        interviewId={interviewId}
        interviewQuestionId={interviewQuestionId}
        language={snapshot.language}
        starterCode={snapshot.starterCode}
        drafts={drafts}
      />
    </article>
  );
}
