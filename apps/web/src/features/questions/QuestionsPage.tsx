'use client';

import { NetworkStatus } from '@apollo/client';
import { useQuery } from '@apollo/client/react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { getErrorMessage } from '../../shared/api/errors';
import {
  GetQuestionsDocument,
  type ProgrammingLanguage,
  type QuestionDifficulty,
} from '../../shared/api/generated/graphql';
import { formatDate, languageLabels } from '../../shared/lib/format';
import { DifficultyBadge } from '../../shared/ui/Badge';
import { EmptyState, ErrorNotice, LoadingState, SuccessNotice } from '../../shared/ui/Feedback';
import { Icon } from '../../shared/ui/Icon';
import styles from '../../shared/ui/workspace.module.css';

export function QuestionsPage() {
  const searchParams = useSearchParams();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [language, setLanguage] = useState<ProgrammingLanguage | ''>('');
  const [difficulty, setDifficulty] = useState<QuestionDifficulty | ''>('');
  const [pageError, setPageError] = useState<string | null>(null);
  const { data, loading, error, fetchMore, refetch, networkStatus } = useQuery(
    GetQuestionsDocument,
    {
      ssr: false,
      variables: {
        search: search || undefined,
        language: language || undefined,
        difficulty: difficulty || undefined,
        limit: 12,
        offset: 0,
      },
    },
  );
  const page = data?.questions;
  const loadingMore = networkStatus === NetworkStatus.fetchMore;

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPageError(null);
    setSearch(searchInput.trim());
  }

  async function loadMore() {
    if (!page || loading) return;
    setPageError(null);
    try {
      await fetchMore({ variables: { offset: page.pageInfo.offset + page.pageInfo.limit } });
    } catch (failure) {
      setPageError(getErrorMessage(failure));
    }
  }

  return (
    <>
      <div className={styles.pageHeader}>
        <div>
          <div className={styles.eyebrow}>Question library</div>
          <h1 className={styles.title}>Good questions. Better interviews.</h1>
          <p className={styles.subtitle}>
            Keep your go-to challenges in one place, ready for your next conversation.
          </p>
        </div>
        <div className={styles.headerActions}>
          <Link href="/questions/new" className={styles.primaryButton}>
            <Icon name="plus" />
            New question
          </Link>
        </div>
      </div>
      {searchParams.get('created') === '1' && (
        <SuccessNotice>Question created. It is ready to use in an interview.</SuccessNotice>
      )}
      <form className={styles.filterBar} onSubmit={submitSearch} aria-label="Question filters">
        <div className={styles.searchField}>
          <label htmlFor="question-search" className={styles.label}>
            Search questions
          </label>
          <input
            id="question-search"
            className={styles.input}
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search by title or description"
            maxLength={200}
          />
        </div>
        <div className={styles.filterField}>
          <label htmlFor="question-language" className={styles.label}>
            Language
          </label>
          <select
            id="question-language"
            className={styles.select}
            value={language}
            onChange={(event) => {
              setLanguage(event.target.value as ProgrammingLanguage | '');
              setPageError(null);
            }}
          >
            <option value="">All languages</option>
            <option value="JAVASCRIPT">JavaScript</option>
            <option value="TYPESCRIPT">TypeScript</option>
            <option value="REACT_TSX">React / TSX</option>
          </select>
        </div>
        <div className={styles.filterField}>
          <label htmlFor="question-difficulty" className={styles.label}>
            Difficulty
          </label>
          <select
            id="question-difficulty"
            className={styles.select}
            value={difficulty}
            onChange={(event) => {
              setDifficulty(event.target.value as QuestionDifficulty | '');
              setPageError(null);
            }}
          >
            <option value="">All difficulties</option>
            <option value="EASY">Easy</option>
            <option value="MEDIUM">Medium</option>
            <option value="HARD">Hard</option>
          </select>
        </div>
        <button type="submit" className={styles.secondaryButton}>
          Search
        </button>
      </form>
      {(error || pageError) && (
        <ErrorNotice
          onRetry={() => {
            setPageError(null);
            void refetch().catch(() => {});
          }}
        >
          {pageError ?? getErrorMessage(error)}
        </ErrorNotice>
      )}
      {loading && !page ? (
        <LoadingState label="Loading questions…" />
      ) : (
        page && (
          <>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Your questions</h2>
              <span className={styles.count}>
                {page.pageInfo.totalCount}{' '}
                {page.pageInfo.totalCount === 1 ? 'question' : 'questions'}
              </span>
            </div>
            {page.items.length === 0 ? (
              <EmptyState title="No questions found">
                Try different filters or{' '}
                <Link href="/questions/new">create your first question</Link>.
              </EmptyState>
            ) : (
              <div className={styles.cardGrid}>
                {page.items.map((question) => (
                  <article key={question.id} className={styles.questionCard}>
                    <div className={styles.cardTop}>
                      <span className={styles.questionIcon}>
                        <Icon name="code" />
                      </span>
                      <DifficultyBadge difficulty={question.difficulty} />
                    </div>
                    <h3 className={styles.questionTitle}>{question.title}</h3>
                    <p className={`${styles.description} ${styles.clamp}`}>
                      {question.description}
                    </p>
                    <div className={styles.cardFooter}>
                      <span className={styles.language}>{languageLabels[question.language]}</span>
                      <time className={styles.date} dateTime={question.createdAt}>
                        {formatDate(question.createdAt)}
                      </time>
                    </div>
                  </article>
                ))}
              </div>
            )}
            {page.pageInfo.hasNextPage && (
              <div className={styles.loadMore}>
                <span className={styles.count}>
                  Showing {page.items.length} of {page.pageInfo.totalCount}
                </span>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => void loadMore()}
                  disabled={loading}
                  aria-label="Load more questions"
                >
                  {loadingMore ? 'Loading more…' : 'Load more questions'}
                </button>
              </div>
            )}
          </>
        )
      )}
    </>
  );
}
