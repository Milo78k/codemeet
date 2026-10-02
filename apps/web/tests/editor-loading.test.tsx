import { expect, test } from '@jest/globals';
import { screen } from '@testing-library/react';
import { HttpResponse } from 'msw';

import { InterviewSessionPage } from '@/features/interviews/InterviewSessionPage';

import { interview, question } from './support/fixtures';
import { setEditorAdapterMode } from './support/monaco';
import { renderWithApi } from './support/render';
import { api, server } from './support/server';

test('editor chunk loading shows the real application placeholder until its browser module is ready', async () => {
  setEditorAdapterMode('loading');
  const starterCode = 'const loaded = true;';
  server.use(
    api.query('GetInterview', () =>
      HttpResponse.json({
        data: {
          interview: interview('loading-interview', 'Loading interview', 'IN_PROGRESS', [
            question('loading-question', 'Loading question', { starterCode }),
          ]),
        },
      }),
    ),
  );
  renderWithApi(<InterviewSessionPage interviewId="loading-interview" />);
  await screen.findByRole('heading', { name: 'Loading question' });
  expect(await screen.findByText('Loading code editor…')).toBeInTheDocument();
  expect(screen.queryByRole('textbox', { name: 'Code editor' })).not.toBeInTheDocument();
  setEditorAdapterMode('ready');
  expect(await screen.findByRole('textbox', { name: 'Code editor' })).toHaveValue(starterCode);
});
