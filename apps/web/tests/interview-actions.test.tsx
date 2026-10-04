import { describe, expect, jest, test } from '@jest/globals';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse } from 'msw';

import { InterviewDetailsPage } from '@/features/interviews/InterviewDetailsPage';
import { formatDateTime } from '@/shared/lib/format';

import { apiError, interview } from './support/fixtures';
import { renderWithApi } from './support/render';
import { api, server } from './support/server';

describe('interview status actions', () => {
  test.each([
    { status: 'READY' as const, actionName: 'Start interview', actionRole: 'button' as const },
    { status: 'IN_PROGRESS' as const, actionName: 'Open session', actionRole: 'link' as const },
    { status: 'FINISHED' as const, actionName: 'View results', actionRole: 'link' as const },
  ])('keeps the $status summary and primary action in one overview header', async (scenario) => {
    server.use(
      api.query('GetInterview', () =>
        HttpResponse.json({
          data: {
            interview: interview('interview-ready', 'Frontend interview', scenario.status),
          },
        }),
      ),
    );
    renderWithApi(<InterviewDetailsPage interviewId="interview-ready" />);

    const title = await screen.findByRole('heading', { name: 'Frontend interview' });
    const header = title.closest('header');
    expect(header).not.toBeNull();
    const overview = within(header!);
    expect(overview.getByText(scenario.status)).toBeInTheDocument();
    expect(
      overview.getByText('Your selected questions and the current interview status.'),
    ).toBeInTheDocument();
    expect(
      overview.getByRole(scenario.actionRole, { name: new RegExp(scenario.actionName) }),
    ).toBeInTheDocument();
  });

  test('guest invite expiry uses the shared human-readable date-time formatter', async () => {
    const expiresAt = '2026-10-04T12:29:29.000Z';
    server.use(
      api.query('GetInterview', () => HttpResponse.json({ data: { interview: interview() } })),
      api.mutation('CreateGuestInvite', () =>
        HttpResponse.json({
          data: {
            createGuestInvite: {
              __typename: 'GuestInvitePayload',
              token: 'demo-invite-token',
              interviewId: 'interview-ready',
              expiresAt,
            },
          },
        }),
      ),
    );
    const user = userEvent.setup();
    renderWithApi(<InterviewDetailsPage interviewId="interview-ready" />);
    await user.click(await screen.findByRole('button', { name: 'Create guest invite' }));

    expect(await screen.findByText(formatDateTime(expiresAt))).toBeInTheDocument();
  });

  test('creates a compact invite card that copies the correct URL and opens in a separate tab', async () => {
    const writeText = jest.fn(async (_text: string) => {});
    const user = userEvent.setup({ writeToClipboard: false });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    server.use(
      api.query('GetInterview', () => HttpResponse.json({ data: { interview: interview() } })),
      api.mutation('CreateGuestInvite', () =>
        HttpResponse.json({
          data: {
            createGuestInvite: {
              __typename: 'GuestInvitePayload',
              token: 'one-time-demo-token',
              interviewId: 'interview-ready',
              expiresAt: '2026-10-04T12:29:29.000Z',
            },
          },
        }),
      ),
    );
    renderWithApi(<InterviewDetailsPage interviewId="interview-ready" />);
    await user.click(await screen.findByRole('button', { name: 'Create guest invite' }));

    const inviteUrl = `${window.location.origin}/join/one-time-demo-token`;
    expect(await screen.findByRole('heading', { name: 'Guest invite' })).toBeInTheDocument();
    expect(screen.queryByText(inviteUrl)).not.toBeInTheDocument();
    expect(screen.getByText(formatDateTime('2026-10-04T12:29:29.000Z'))).toBeInTheDocument();
    const openLink = screen.getByRole('link', { name: 'Open in new tab' });
    expect(openLink).toHaveAttribute('href', inviteUrl);
    expect(openLink).toHaveAttribute('target', '_blank');
    expect(openLink).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.queryByRole('button', { name: 'Create guest invite' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Copy invite link' }));
    expect(writeText).toHaveBeenCalledWith(inviteUrl);
    expect(await screen.findByRole('status')).toHaveTextContent('Copied');
    expect(screen.getByRole('heading', { name: 'Frontend interview' })).toBeInTheDocument();
  });

  test('shows an accessible manual-copy fallback when clipboard access fails', async () => {
    const user = userEvent.setup({ writeToClipboard: false });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: jest.fn(async () => Promise.reject(new Error('denied'))) },
    });
    server.use(
      api.query('GetInterview', () => HttpResponse.json({ data: { interview: interview() } })),
      api.mutation('CreateGuestInvite', () =>
        HttpResponse.json({
          data: {
            createGuestInvite: {
              __typename: 'GuestInvitePayload',
              token: 'copy-fallback-token',
              interviewId: 'interview-ready',
              expiresAt: '2026-10-04T12:29:29.000Z',
            },
          },
        }),
      ),
    );
    renderWithApi(<InterviewDetailsPage interviewId="interview-ready" />);
    await user.click(await screen.findByRole('button', { name: 'Create guest invite' }));
    await user.click(await screen.findByRole('button', { name: 'Copy invite link' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not copy the invite link. Select and copy it below.',
    );
    expect(screen.getByRole('textbox', { name: 'Invite link' })).toHaveValue(
      `${window.location.origin}/join/copy-fallback-token`,
    );
  });

  test('starting READY interview renders the returned IN_PROGRESS state', async () => {
    let sentInterviewId: unknown;
    server.use(
      api.query('GetInterview', () => HttpResponse.json({ data: { interview: interview() } })),
      api.mutation('StartInterview', ({ variables }) => {
        sentInterviewId = variables.interviewId;
        return HttpResponse.json({
          data: {
            startInterview: interview('interview-ready', 'Frontend interview', 'IN_PROGRESS'),
          },
        });
      }),
    );
    const user = userEvent.setup();
    renderWithApi(<InterviewDetailsPage interviewId="interview-ready" />);
    await user.click(await screen.findByRole('button', { name: 'Start interview' }));
    expect(await screen.findByText('IN_PROGRESS')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Finish interview' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start interview' })).not.toBeInTheDocument();
    expect(sentInterviewId).toBe('interview-ready');
  });

  test('invalid transition displays the controlled error and preserves the server state', async () => {
    server.use(
      api.query('GetInterview', () => HttpResponse.json({ data: { interview: interview() } })),
      api.mutation('StartInterview', () =>
        HttpResponse.json(apiError('This interview has already started.', 'INVALID_STATE')),
      ),
    );
    const user = userEvent.setup();
    renderWithApi(<InterviewDetailsPage interviewId="interview-ready" />);
    await user.click(await screen.findByRole('button', { name: 'Start interview' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This interview has already started.',
    );
    expect(screen.getByText('READY')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start interview' })).toBeEnabled();
  });

  test('finishing an IN_PROGRESS interview renders FINISHED and removes mutation actions', async () => {
    server.use(
      api.query('GetInterview', () =>
        HttpResponse.json({
          data: {
            interview: interview('interview-ready', 'Frontend interview', 'IN_PROGRESS'),
          },
        }),
      ),
      api.mutation('FinishInterview', () =>
        HttpResponse.json({
          data: {
            finishInterview: interview('interview-ready', 'Frontend interview', 'FINISHED'),
          },
        }),
      ),
    );
    const user = userEvent.setup();
    renderWithApi(<InterviewDetailsPage interviewId="interview-ready" />);
    await user.click(await screen.findByRole('button', { name: 'Finish interview' }));
    expect(await screen.findByText('FINISHED')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Finish interview' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start interview' })).not.toBeInTheDocument();
  });
});
