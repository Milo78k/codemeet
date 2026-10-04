import { describe, expect, jest, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { GetCodeRunsQuery } from '@/shared/api/generated/graphql';
import { CodeRunHistory } from '@/features/code-runner/ui/CodeRunHistory';
import { formatDateTime } from '@/shared/lib/format';

const page: GetCodeRunsQuery['codeRuns'] = {
  __typename: 'CodeRunPage',
  items: [
    {
      __typename: 'CodeRun',
      id: 'run-1',
      interviewId: 'interview-1',
      interviewQuestionId: 'attachment-1',
      language: 'TYPESCRIPT',
      sourceSnapshot: 'const answer: number = 42;',
      status: 'RUNTIME_ERROR',
      stdout: 'before error',
      stderr: 'Error: boom',
      durationMs: 19,
      createdAt: '2026-10-03T12:00:00.000Z',
      createdByParticipant: {
        __typename: 'InterviewParticipant',
        id: 'participant-1',
        displayName: 'Candidate',
        role: 'CANDIDATE',
      },
    },
  ],
  pageInfo: {
    __typename: 'PageInfo',
    limit: 20,
    offset: 0,
    totalCount: 1,
    hasNextPage: false,
  },
};

describe('code run history panel', () => {
  test('shows read-only source and output details without a restore or edit action', async () => {
    const user = userEvent.setup();
    render(
      <CodeRunHistory
        page={page}
        loading={false}
        failed={false}
        onRetry={() => {}}
        onPrevious={() => {}}
        onNext={() => {}}
      />,
    );

    expect(screen.getByText(/Runtime error/)).toBeInTheDocument();
    expect(screen.getByText('Candidate')).toBeInTheDocument();
    expect(screen.getByText('19 ms')).toBeInTheDocument();
    await user.click(screen.getByText('View run details'));
    expect(screen.getByLabelText('Source snapshot')).toHaveTextContent(
      'const answer: number = 42;',
    );
    expect(screen.getByRole('region', { name: 'Output' })).toHaveTextContent('before error');
    expect(screen.getByRole('region', { name: 'Errors' })).toHaveTextContent('Error: boom');
    expect(screen.queryByRole('button', { name: /restore|edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByText('1–1 of 1')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Newer' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Older' })).not.toBeInTheDocument();
  });

  test('shows each run timestamp to milliseconds so close runs remain distinguishable', () => {
    const closeRuns = {
      ...page,
      items: [
        page.items[0]!,
        {
          ...page.items[0]!,
          id: 'run-2',
          createdAt: '2026-10-03T12:00:04.318Z',
        },
      ],
      pageInfo: { ...page.pageInfo, totalCount: 2 },
    };
    render(
      <CodeRunHistory
        page={closeRuns}
        loading={false}
        failed={false}
        onRetry={() => {}}
        onPrevious={() => {}}
        onNext={() => {}}
      />,
    );
    const timestamps = screen.getAllByRole('time').map((element) => element.textContent);
    expect(timestamps).toHaveLength(2);
    expect(new Set(timestamps).size).toBe(2);
    expect(timestamps).toEqual([
      formatDateTime(page.items[0]!.createdAt, 'compact'),
      formatDateTime('2026-10-03T12:00:04.318Z', 'compact'),
    ]);
  });

  test('exposes history retry and pagination controls without making entries editable', async () => {
    const retry = jest.fn();
    const previous = jest.fn();
    const next = jest.fn();
    const user = userEvent.setup();
    const nextPage = {
      ...page,
      pageInfo: { ...page.pageInfo, offset: 20, totalCount: 30, hasNextPage: true },
    };
    render(
      <CodeRunHistory
        page={nextPage}
        loading={false}
        failed={false}
        onRetry={retry}
        onPrevious={previous}
        onNext={next}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Newer' }));
    await user.click(screen.getByRole('button', { name: 'Older' }));
    expect(previous).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
  });

  test('offers a retry action when history fails to load', async () => {
    const retry = jest.fn();
    const user = userEvent.setup();
    render(
      <CodeRunHistory
        page={undefined}
        loading={false}
        failed={true}
        onRetry={retry}
        onPrevious={() => {}}
        onNext={() => {}}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Retry history' }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toHaveTextContent('Run history could not be loaded.');
  });
});
