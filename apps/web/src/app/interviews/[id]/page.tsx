import { Suspense } from 'react';
import { InterviewDetailsPage } from '../../../features/interviews/InterviewDetailsPage';
export default async function InterviewDetailsRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Suspense fallback={<p>Loading interview…</p>}>
      <InterviewDetailsPage interviewId={id} />
    </Suspense>
  );
}
