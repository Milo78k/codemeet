import { describe, expect, test } from '@jest/globals';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse } from 'msw';

import { QuestionsPage } from '@/features/questions/QuestionsPage';
import type { GetQuestionsQueryVariables } from '@/shared/api/generated/graphql';

import { apiError, deferred, question, questionsData } from './support/fixtures';
import { renderWithApi } from './support/render';
import { api, server } from './support/server';

describe('question library', () => {
  test('shows loading until the GraphQL response arrives', async () => {
    const response = deferred();
    server.use(
      api.query('GetQuestions', async () => {
        await response.promise;
        return HttpResponse.json({ data: questionsData([question()]) });
      }),
    );
    renderWithApi(<QuestionsPage />);
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);
    response.resolve();
    expect(await screen.findByText('Two Sum')).toBeInTheDocument();
  });

  test('renders API questions with difficulty and language', async () => {
    server.use(
      api.query('GetQuestions', () =>
        HttpResponse.json({
          data: questionsData([
            question(),
            question('question-2', 'Group By', {
              language: 'TYPESCRIPT',
              difficulty: 'MEDIUM',
            }),
          ]),
        }),
      ),
    );
    renderWithApi(<QuestionsPage />);
    expect(await screen.findByText('Two Sum')).toBeInTheDocument();
    expect(screen.getByText('Group By')).toBeInTheDocument();
    expect(screen.getAllByText(/JavaScript/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/EASY/i).length).toBeGreaterThan(0);
  });

  test('shows an empty state when no questions match', async () => {
    server.use(api.query('GetQuestions', () => HttpResponse.json({ data: questionsData([]) })));
    renderWithApi(<QuestionsPage />);
    expect(await screen.findByText(/no questions/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more questions' })).not.toBeInTheDocument();
  });

  test('shows a controlled API error', async () => {
    server.use(
      api.query('GetQuestions', () =>
        HttpResponse.json(apiError('Question library is unavailable.', 'INTERNAL_SERVER_ERROR')),
      ),
    );
    renderWithApi(<QuestionsPage />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('alert')).not.toHaveTextContent(/stack|PrismaClient/);
  });

  test('search submits the text and replaces results with matching questions', async () => {
    const user = userEvent.setup();
    let receivedSearch: unknown;
    server.use(
      api.query('GetQuestions', ({ variables }) => {
        receivedSearch = variables.search;
        return HttpResponse.json({
          data: questionsData([
            variables.search === 'needle'
              ? question('matching', 'Matching task')
              : question('baseline', 'Baseline task'),
          ]),
        });
      }),
    );
    renderWithApi(<QuestionsPage />);
    await screen.findByText('Baseline task');
    await user.type(screen.getByRole('textbox', { name: 'Search questions' }), 'needle');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('Matching task')).toBeInTheDocument();
    expect(receivedSearch).toBe('needle');
    expect(screen.queryByText('Baseline task')).not.toBeInTheDocument();
  });

  test('language and difficulty filters request and show matching results', async () => {
    const user = userEvent.setup();
    let receivedFilters: unknown;
    server.use(
      api.query('GetQuestions', ({ variables }) => {
        const filtered = variables.language === 'TYPESCRIPT' && variables.difficulty === 'MEDIUM';
        if (filtered)
          receivedFilters = { language: variables.language, difficulty: variables.difficulty };
        return HttpResponse.json({
          data: questionsData([
            filtered
              ? question('filtered', 'Filtered task', {
                  language: 'TYPESCRIPT',
                  difficulty: 'MEDIUM',
                })
              : question('baseline', 'Baseline task'),
          ]),
        });
      }),
    );
    renderWithApi(<QuestionsPage />);
    await screen.findByText('Baseline task');
    await user.selectOptions(screen.getByLabelText('Language'), 'TYPESCRIPT');
    await user.selectOptions(screen.getByLabelText('Difficulty'), 'MEDIUM');
    expect(await screen.findByText('Filtered task')).toBeInTheDocument();
    expect(receivedFilters).toEqual({ language: 'TYPESCRIPT', difficulty: 'MEDIUM' });
    expect(screen.queryByText('Baseline task')).not.toBeInTheDocument();
  });

  test('load more retains previous questions and removes duplicate items', async () => {
    const user = userEvent.setup();
    let expectedOffset = 0;
    let nextOffset: unknown;
    server.use(
      api.query('GetQuestions', ({ variables }) => {
        const limit = typeof variables.limit === 'number' ? variables.limit : 20;
        expectedOffset = limit;
        if (!variables.offset) {
          const items = Array.from({ length: limit }, (_, index) =>
            question(`first-${index}`, `Initial task ${index}`),
          );
          return HttpResponse.json({ data: questionsData(items, 0, limit + 1, limit) });
        }
        nextOffset = variables.offset;
        return HttpResponse.json({
          data: questionsData(
            [
              question(`first-${limit - 1}`, `Initial task ${limit - 1}`),
              question('last', 'Next page task'),
            ],
            limit,
            limit + 2,
            limit,
          ),
        });
      }),
    );
    renderWithApi(<QuestionsPage />);
    await screen.findByText('Initial task 0');
    await user.click(screen.getByRole('button', { name: 'Load more questions' }));
    expect(await screen.findByText('Next page task')).toBeInTheDocument();
    expect(screen.getByText('Initial task 0')).toBeInTheDocument();
    expect(screen.getAllByText(`Initial task ${expectedOffset - 1}`)).toHaveLength(1);
    expect(nextOffset).toBe(expectedOffset);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Load more questions' })).not.toBeInTheDocument(),
    );
  });

  test('resetting a filter restores its own question results', async () => {
    const user = userEvent.setup();
    server.use(
      api.query('GetQuestions', ({ variables }) =>
        HttpResponse.json({
          data: questionsData([
            variables.language === 'TYPESCRIPT'
              ? question('typescript', 'Typed task', { language: 'TYPESCRIPT' })
              : question('javascript', 'Original task'),
          ]),
        }),
      ),
    );
    renderWithApi(<QuestionsPage />);
    await screen.findByText('Original task');
    await user.selectOptions(screen.getByLabelText('Language'), 'TYPESCRIPT');
    await screen.findByText('Typed task');
    await user.selectOptions(screen.getByLabelText('Language'), '');
    expect(await screen.findByText('Original task')).toBeInTheDocument();
    expect(screen.queryByText('Typed task')).not.toBeInTheDocument();
  });

  test('omits inactive filters on initial load and requests after clearing filters', async () => {
    const requests: GetQuestionsQueryVariables[] = [];
    server.use(
      api.query('GetQuestions', ({ variables }) => {
        requests.push(variables);
        expect(variables.search).not.toBeNull();
        expect(variables.language).not.toBeNull();
        expect(variables.difficulty).not.toBeNull();
        const filtered = variables.search || variables.language || variables.difficulty;
        const offset = typeof variables.offset === 'number' ? variables.offset : 0;
        const limit = typeof variables.limit === 'number' ? variables.limit : 12;
        return HttpResponse.json({
          data: questionsData(
            [
              question(
                offset ? 'next' : filtered ? 'filtered' : 'all',
                offset ? 'Next unfiltered task' : filtered ? 'Filtered task' : 'All tasks',
              ),
            ],
            offset,
            limit + 1,
            limit,
          ),
        });
      }),
    );
    const user = userEvent.setup();
    renderWithApi(<QuestionsPage />);
    await screen.findByText('All tasks');
    expect(requests[0]).toEqual({ limit: 12, offset: 0 });
    await user.selectOptions(screen.getByLabelText('Language'), 'TYPESCRIPT');
    await screen.findByText('Filtered task');
    await user.selectOptions(screen.getByLabelText('Difficulty'), 'MEDIUM');
    await user.type(screen.getByRole('textbox', { name: 'Search questions' }), 'needle');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(requests.at(-1)?.search).toBe('needle'));
    await user.clear(screen.getByRole('textbox', { name: 'Search questions' }));
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.selectOptions(screen.getByLabelText('Language'), '');
    await user.selectOptions(screen.getByLabelText('Difficulty'), '');
    await screen.findByText('All tasks');
    await user.click(screen.getByRole('button', { name: 'Load more questions' }));
    expect(await screen.findByText('Next unfiltered task')).toBeInTheDocument();
    expect(requests.at(-1)).toEqual({ limit: 12, offset: 12 });
  });
});
