import { Suspense } from 'react';

import { InterviewResultsPage } from '../../../../features/interviews/InterviewResultsPage';

export default async function InterviewResultsRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Suspense fallback={<p>Loading interview results…</p>}>
      <InterviewResultsPage interviewId={id} />
    </Suspense>
  );
}
