import { describe, expect, test } from '@jest/globals';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse } from 'msw';

import { CreateQuestionPage } from '@/features/questions/CreateQuestionPage';
import type {
  CreateQuestionMutation,
  CreateQuestionMutationVariables,
} from '@/shared/api/generated/graphql';

import { apiError, deferred, question } from './support/fixtures';
import { router } from './support/navigation';
import { renderWithApi } from './support/render';
import { api, server } from './support/server';

async function fillQuestionForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Title'), 'Binary search');
  await user.type(screen.getByLabelText('Description'), 'Find the target in a sorted array.');
  await user.selectOptions(screen.getByLabelText('Difficulty'), 'MEDIUM');
  await user.selectOptions(screen.getByLabelText('Language'), 'TYPESCRIPT');
  await user.clear(screen.getByRole('textbox', { name: 'Starter code' }));
  await user.type(screen.getByRole('textbox', { name: 'Starter code' }), 'const target = 3;');
}

describe('create question', () => {
  test('validates fields accessibly before sending a mutation', async () => {
    let mutationCount = 0;
    server.use(
      api.mutation('CreateQuestion', () => {
        mutationCount += 1;
        return HttpResponse.json({ data: { createQuestion: question() } });
      }),
    );
    const user = userEvent.setup();
    renderWithApi(<CreateQuestionPage />);
    await user.click(screen.getByRole('button', { name: 'Create question' }));
    expect(await screen.findAllByRole('alert')).not.toHaveLength(0);
    expect(screen.getByLabelText('Title')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Title')).toHaveAttribute('aria-describedby');
    expect(mutationCount).toBe(0);
  });

  test('submits typed fields, disables the button while pending and redirects after success', async () => {
    const response = deferred();
    let input: CreateQuestionMutationVariables['input'] | undefined;
    server.use(
      api.mutation<CreateQuestionMutation, CreateQuestionMutationVariables>(
        'CreateQuestion',
        async ({ variables }) => {
          input = variables.input;
          await response.promise;
          return HttpResponse.json({
            data: { createQuestion: question('created-question', 'Binary search') },
          });
        },
      ),
    );
    const user = userEvent.setup();
    renderWithApi(<CreateQuestionPage />);
    await fillQuestionForm(user);
    await user.click(screen.getByRole('button', { name: 'Create question' }));
    await waitFor(() => expect(input).toBeDefined());
    expect(screen.getByRole('button', { name: /creating/i })).toBeDisabled();
    expect(input).toEqual({
      title: 'Binary search',
      description: 'Find the target in a sorted array.',
      difficulty: 'MEDIUM',
      language: 'TYPESCRIPT',
      starterCode: 'const target = 3;',
    });
    response.resolve();
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith(expect.stringMatching(/^\/questions(?:\?|$)/)),
    );
  });

  test('shows controlled GraphQL errors and retains the form for correction', async () => {
    server.use(
      api.mutation('CreateQuestion', () =>
        HttpResponse.json(apiError('The question title is not allowed.')),
      ),
    );
    const user = userEvent.setup();
    renderWithApi(<CreateQuestionPage />);
    await fillQuestionForm(user);
    await user.click(screen.getByRole('button', { name: 'Create question' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The question title is not allowed.',
    );
    expect(screen.getByLabelText('Title')).toHaveValue('Binary search');
    expect(screen.getByRole('button', { name: 'Create question' })).toBeEnabled();
    expect(router.push).not.toHaveBeenCalled();
  });

  test('uses compact language-aware Monaco starter editor and preserves edits on language switch', async () => {
    let submittedInput: CreateQuestionMutationVariables['input'] | undefined;
    server.use(
      api.mutation<CreateQuestionMutation, CreateQuestionMutationVariables>(
        'CreateQuestion',
        ({ variables }) => {
          submittedInput = variables.input;
          return HttpResponse.json({ data: { createQuestion: question('created-question') } });
        },
      ),
    );
    const user = userEvent.setup();
    renderWithApi(<CreateQuestionPage />);
    await user.type(screen.getByLabelText('Title'), 'Monaco starter');
    await user.type(screen.getByLabelText('Description'), 'Exercise starter code editing.');
    const starter = await screen.findByRole('textbox', { name: 'Starter code' });

    await user.type(starter, 'const answer = 42;');
    expect(starter).toHaveValue('const answer = 42;');
    expect(starter).toHaveAttribute('data-language', 'javascript');

    await user.selectOptions(screen.getByLabelText('Language'), 'TYPESCRIPT');
    const javascriptStarter = await screen.findByRole('textbox', { name: 'Starter code' });
    expect(javascriptStarter).toHaveValue('const answer = 42;');
    expect(javascriptStarter).toHaveAttribute('data-language', 'typescript');
    await user.clear(javascriptStarter);
    await user.type(javascriptStarter, 'const typedAnswer: number = 42;');

    await user.selectOptions(screen.getByLabelText('Language'), 'JAVASCRIPT');
    const finalStarter = await screen.findByRole('textbox', { name: 'Starter code' });
    expect(finalStarter).toHaveValue('const typedAnswer: number = 42;');
    expect(finalStarter).toHaveAttribute('data-language', 'javascript');
    await user.click(screen.getByRole('button', { name: 'Create question' }));
    await waitFor(() => expect(router.push).toHaveBeenCalled());
    expect(submittedInput).toMatchObject({
      language: 'JAVASCRIPT',
      starterCode: 'const typedAnswer: number = 42;',
    });
  });
});
