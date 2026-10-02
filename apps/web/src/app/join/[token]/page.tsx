import { JoinInterviewPage } from '../../../features/interviews/join/JoinInterviewPage';

export const metadata = {
  referrer: 'no-referrer',
};

export default async function JoinInterviewRoute({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <JoinInterviewPage inviteToken={token} />;
}
