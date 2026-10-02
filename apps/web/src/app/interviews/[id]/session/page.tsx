import { InterviewSessionPage } from '../../../../features/interviews/InterviewSessionPage';

export default async function InterviewSessionRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <InterviewSessionPage interviewId={id} />;
}
