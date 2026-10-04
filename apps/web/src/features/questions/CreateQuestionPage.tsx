'use client';

import { useMutation } from '@apollo/client/react';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';

import { invalidateQuestionLists } from '../../shared/api/cache';
import { getErrorMessage } from '../../shared/api/errors';
import { CreateQuestionDocument } from '../../shared/api/generated/graphql';
import { ErrorNotice, FieldError, SuccessNotice } from '../../shared/ui/Feedback';
import { Icon } from '../../shared/ui/Icon';
import styles from '../../shared/ui/workspace.module.css';
import { questionFormSchema, type QuestionFormValues } from './form-schema';
import { StarterCodeEditor } from './StarterCodeEditor';

export function CreateQuestionPage() {
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);
  const [createQuestion] = useMutation(CreateQuestionDocument, {
    update: (cache) => invalidateQuestionLists(cache),
  });
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<QuestionFormValues>({
    resolver: zodResolver(questionFormSchema),
    defaultValues: {
      title: '',
      description: '',
      difficulty: 'EASY',
      language: 'JAVASCRIPT',
      starterCode: '',
    },
  });
  const language = useWatch({ control, name: 'language' });

  async function submit(input: QuestionFormValues) {
    setSubmitError(null);
    try {
      await createQuestion({ variables: { input } });
      setCreated(true);
      router.push('/questions?created=1');
    } catch (failure) {
      setSubmitError(getErrorMessage(failure));
    }
  }

  return (
    <>
      <Link href="/questions" className={styles.backLink}>
        <Icon name="arrow" />
        Back to question library
      </Link>
      <div className={styles.pageHeader}>
        <div>
          <div className={styles.eyebrow}>Question library</div>
          <h1 className={styles.title}>Create a question</h1>
          <p className={styles.subtitle}>A clear prompt and a little starter code go a long way.</p>
        </div>
      </div>
      {submitError && <ErrorNotice>{submitError}</ErrorNotice>}
      {created && <SuccessNotice>Question created. Opening the question library…</SuccessNotice>}
      <div className={styles.formLayout}>
        <form className={styles.formCard} onSubmit={handleSubmit(submit)} noValidate>
          <fieldset className={styles.fieldset} disabled={isSubmitting || created}>
            <div>
              <label htmlFor="question-title" className={styles.formLabel}>
                Title
              </label>
              <input
                id="question-title"
                className={styles.input}
                placeholder="e.g. Two Sum"
                {...register('title')}
                aria-invalid={Boolean(errors.title)}
                aria-describedby={errors.title ? 'question-title-error' : undefined}
              />
              <FieldError id="question-title-error" message={errors.title?.message} />
            </div>
            <div>
              <label htmlFor="question-description" className={styles.formLabel}>
                Description
              </label>
              <textarea
                id="question-description"
                className={styles.textarea}
                placeholder="Describe the task, expected behavior, and any constraints."
                {...register('description')}
                aria-invalid={Boolean(errors.description)}
                aria-describedby={errors.description ? 'question-description-error' : undefined}
              />
              <FieldError id="question-description-error" message={errors.description?.message} />
            </div>
            <div className={styles.formRow}>
              <div>
                <label htmlFor="new-question-difficulty" className={styles.formLabel}>
                  Difficulty
                </label>
                <select
                  id="new-question-difficulty"
                  className={styles.select}
                  {...register('difficulty')}
                  aria-invalid={Boolean(errors.difficulty)}
                  aria-describedby={errors.difficulty ? 'new-question-difficulty-error' : undefined}
                >
                  <option value="EASY">Easy</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HARD">Hard</option>
                </select>
                <FieldError
                  id="new-question-difficulty-error"
                  message={errors.difficulty?.message}
                />
              </div>
              <div>
                <label htmlFor="new-question-language" className={styles.formLabel}>
                  Language
                </label>
                <select
                  id="new-question-language"
                  className={styles.select}
                  {...register('language')}
                  aria-invalid={Boolean(errors.language)}
                  aria-describedby={errors.language ? 'new-question-language-error' : undefined}
                >
                  <option value="JAVASCRIPT">JavaScript</option>
                  <option value="TYPESCRIPT">TypeScript</option>
                  <option value="REACT_TSX">React / TSX</option>
                </select>
                <FieldError id="new-question-language-error" message={errors.language?.message} />
              </div>
            </div>
            <div>
              <label id="question-starter-code-label" className={styles.formLabel}>
                Starter code
              </label>
              <Controller
                control={control}
                name="starterCode"
                render={({ field }) => (
                  <div
                    role="group"
                    aria-labelledby="question-starter-code-label"
                    aria-describedby={
                      errors.starterCode
                        ? 'question-starter-code-error'
                        : 'question-starter-code-hint'
                    }
                  >
                    <StarterCodeEditor
                      value={field.value}
                      language={language}
                      disabled={isSubmitting || created}
                      onChange={field.onChange}
                    />
                  </div>
                )}
              />
              <p id="question-starter-code-hint" className={styles.hint}>
                Optional. Whitespace and indentation are preserved.
              </p>
              <FieldError id="question-starter-code-error" message={errors.starterCode?.message} />
            </div>
          </fieldset>
          <div className={styles.formActions}>
            <Link href="/questions" className={styles.textButton}>
              Cancel
            </Link>
            <button
              type="submit"
              className={styles.primaryButton}
              disabled={isSubmitting || created}
            >
              {isSubmitting ? 'Creating…' : created ? 'Created' : 'Create question'}
              <Icon name="arrow" />
            </button>
          </div>
        </form>
        <aside className={styles.formAside}>
          <div className={styles.asideIcon}>
            <Icon name="questions" />
          </div>
          <h2>Build a useful library</h2>
          <p>
            Write a prompt that leaves room for conversation. Include examples and constraints when
            they help explain the challenge.
          </p>
          <p>You can reuse this question in your next interview.</p>
        </aside>
      </div>
    </>
  );
}
