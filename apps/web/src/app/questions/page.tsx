import { Suspense } from 'react';
import { QuestionsPage } from '../../features/questions/QuestionsPage';
export default function QuestionsRoute() {
  return (
    <Suspense fallback={<p>Loading questions…</p>}>
      <QuestionsPage />
    </Suspense>
  );
}
