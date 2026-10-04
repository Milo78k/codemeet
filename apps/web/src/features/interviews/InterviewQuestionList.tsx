'use client';

import { languageLabels } from '../../shared/lib/format';
import { DifficultyBadge } from '../../shared/ui/Badge';
import styles from '../../shared/ui/workspace.module.css';
import { getQuestionSnapshot, type InterviewQuestionEntry } from './question-snapshot';

export function InterviewQuestionList({
  questions,
  activeQuestionId,
  disabled,
  onSelect,
}: {
  questions: InterviewQuestionEntry[];
  activeQuestionId: string | null;
  disabled: boolean;
  onSelect: (questionId: string) => void;
}) {
  const orderedQuestions = questions.slice().sort((left, right) => left.order - right.order);
  const activeBelongsToInterview = orderedQuestions.some(
    (entry) => entry.question.id === activeQuestionId,
  );
  return (
    <nav className={styles.sessionQuestionNavigation} aria-label="Questions">
      <div className={styles.sessionDesktopQuestions}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Questions</h2>
          <span className={styles.count}>{questions.length}</span>
        </div>
        <ol className={styles.sessionQuestionList}>
          {orderedQuestions.map((entry, index) => {
            const snapshot = getQuestionSnapshot(entry);
            const active = entry.question.id === activeQuestionId;
            return (
              <li key={entry.id}>
                {orderedQuestions.length === 1 ? (
                  <div
                    className={`${styles.sessionQuestionButton} ${styles.sessionQuestionCurrent}`}
                  >
                    <span className={styles.sessionQuestionIndex}>{index + 1}</span>
                    <span className={styles.sessionQuestionBody}>
                      <span className={styles.sessionQuestionName}>
                        {snapshot?.title ?? `Question ${index + 1} · snapshot unavailable`}
                      </span>
                      {snapshot && (
                        <span className={styles.selectionMeta}>
                          <DifficultyBadge difficulty={snapshot.difficulty} />
                          <span className={styles.language}>
                            {languageLabels[snapshot.language]}
                          </span>
                        </span>
                      )}
                      <span className={styles.activeQuestionCurrentLabel}>
                        {active ? 'Current question' : 'No active question'}
                      </span>
                    </span>
                  </div>
                ) : (
                  <button
                    type="button"
                    className={`${styles.sessionQuestionButton} ${active ? styles.sessionQuestionActive : ''}`}
                    aria-current={active ? 'true' : undefined}
                    disabled={disabled || !snapshot}
                    onClick={() => onSelect(entry.question.id)}
                    title={snapshot?.title}
                  >
                    <span className={styles.sessionQuestionIndex}>{index + 1}</span>
                    <span className={styles.sessionQuestionBody}>
                      <span className={styles.sessionQuestionName}>
                        {snapshot?.title ?? `Question ${index + 1} · snapshot unavailable`}
                      </span>
                      {snapshot && (
                        <span className={styles.selectionMeta}>
                          <DifficultyBadge difficulty={snapshot.difficulty} />
                          <span className={styles.language}>
                            {languageLabels[snapshot.language]}
                          </span>
                        </span>
                      )}
                    </span>
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      </div>
      <div className={styles.sessionMobileQuestions}>
        <span id="session-active-question-label" className={styles.formLabel}>
          Active question
        </span>
        {orderedQuestions.length < 2 ? (
          <div
            className={styles.activeQuestionReadonly}
            role="group"
            aria-labelledby="session-active-question-label"
            aria-disabled="true"
            title={activeEntryTitle(orderedQuestions, activeQuestionId)}
          >
            {activeEntryTitle(orderedQuestions, activeQuestionId)}
          </div>
        ) : (
          <select
            id="session-active-question"
            className={`${styles.select} ${styles.activeQuestionSelect}`}
            aria-labelledby="session-active-question-label"
            value={activeBelongsToInterview ? (activeQuestionId ?? '') : ''}
            disabled={disabled}
            onChange={(event) => onSelect(event.target.value)}
          >
            {!activeBelongsToInterview && (
              <option value="" disabled>
                Select a question
              </option>
            )}
            {orderedQuestions.map((entry, index) => (
              <option
                key={entry.id}
                value={entry.question.id}
                disabled={!getQuestionSnapshot(entry)}
              >
                {index + 1}. {getQuestionSnapshot(entry)?.title ?? 'Snapshot unavailable'}
              </option>
            ))}
          </select>
        )}
      </div>
    </nav>
  );
}

function activeEntryTitle(questions: InterviewQuestionEntry[], activeQuestionId: string | null) {
  if (questions.length === 0) return 'No questions attached';
  const current = questions.find((entry) => entry.question.id === activeQuestionId);
  return current
    ? (getQuestionSnapshot(current)?.title ?? 'Question unavailable')
    : 'No active question';
}
