import { describe, expect, test } from '@jest/globals';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse } from 'msw';

import { JoinInterviewPage } from '@/features/interviews/join/JoinInterviewPage';

import { api, server } from './support/server';
import { router } from './support/navigation';
import { renderWithApi } from './support/render';

const rawInvite = 'a'.repeat(43);
const sessionToken = 'b'.repeat(43);
const interviewId = 'candidate-interview';

function validInvite() {
  return api.query('GetGuestInvite', ({ variables }) => {
    expect(variables.inviteToken).toBe(rawInvite);
    return HttpResponse.json({
      data: {
        guestInvite: {
          __typename: 'GuestInvitePreview',
          state: 'VALID',
          interviewTitle: 'Frontend Interview',
          expiresAt: '2026-10-04T10:00:00.000Z',
        },
      },
    });
  });
}

describe('guest invite join', () => {
  test('shows a loading state while invite status is being checked', async () => {
    server.use(
      api.query('GetGuestInvite', async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));
        return HttpResponse.json({
          data: {
            guestInvite: {
              __typename: 'GuestInvitePreview',
              state: 'INVALID',
              interviewTitle: null,
              expiresAt: null,
            },
          },
        });
      }),
    );
    renderWithApi(<JoinInterviewPage inviteToken={rawInvite} />);
    expect(screen.getByRole('status')).toHaveTextContent('Checking invite');
    expect(await screen.findByRole('alert')).toHaveTextContent('This invite link is invalid.');
  });

  test.each([
    ['INVALID', 'This invite link is invalid.'],
    ['EXPIRED', 'This invite has expired.'],
    ['USED', 'This invite has already been used.'],
    ['INTERVIEW_FINISHED', 'This interview has finished.'],
  ])('explains the %s invite state', async (state, message) => {
    server.use(
      api.query('GetGuestInvite', () =>
        HttpResponse.json({
          data: {
            guestInvite: {
              __typename: 'GuestInvitePreview',
              state,
              interviewTitle: state === 'INVALID' ? null : 'Frontend Interview',
              expiresAt: state === 'INVALID' ? null : '2026-10-04T10:00:00.000Z',
            },
          },
        }),
      ),
    );
    renderWithApi(<JoinInterviewPage inviteToken={rawInvite} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.queryByRole('button', { name: 'Join interview' })).not.toBeInTheDocument();
  });

  test('validates the display name and joins with a tab-scoped candidate session', async () => {
    let submittedName: string | undefined;
    server.use(
      validInvite(),
      api.mutation('JoinInterview', ({ variables }) => {
        submittedName = variables.displayName as string;
        return HttpResponse.json({
          data: {
            joinInterview: {
              __typename: 'JoinInterviewPayload',
              interviewId,
              participantSessionToken: sessionToken,
              participantSessionExpiresAt: '2026-10-09T10:00:00.000Z',
              participant: {
                __typename: 'InterviewParticipant',
                id: 'candidate-1',
                interviewId,
                displayName: 'Anton',
                role: 'CANDIDATE',
                joinedAt: '2026-10-02T10:00:00.000Z',
              },
            },
          },
        });
      }),
    );
    const user = userEvent.setup();
    renderWithApi(<JoinInterviewPage inviteToken={rawInvite} />);
    await screen.findByText('Frontend Interview');
    await user.click(screen.getByRole('button', { name: 'Join interview' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter your name.');
    await user.type(screen.getByLabelText('Your name'), '  Anton  ');
    await user.click(screen.getByRole('button', { name: 'Join interview' }));
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith(`/interviews/${interviewId}/session`),
    );
    expect(submittedName).toBe('Anton');
    expect(sessionStorage.getItem('codemeet.participant-session.v1')).toContain(sessionToken);
    expect(localStorage.getItem('codemeet.participant-session.v1')).toBeNull();
  });

  test('shows join errors without navigating', async () => {
    server.use(
      validInvite(),
      api.mutation('JoinInterview', () =>
        HttpResponse.json({
          errors: [
            { message: 'This invite has already been used.', extensions: { code: 'CONFLICT' } },
          ],
        }),
      ),
    );
    const user = userEvent.setup();
    renderWithApi(<JoinInterviewPage inviteToken={rawInvite} />);
    await screen.findByText('Frontend Interview');
    await user.type(screen.getByLabelText('Your name'), 'Anton');
    await user.click(screen.getByRole('button', { name: 'Join interview' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('conflicts with existing data');
    expect(router.replace).not.toHaveBeenCalled();
  });
});
