import { z } from 'zod';
export const questionFormSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Enter a question title.')
    .max(200, 'Use 200 characters or fewer.'),
  description: z
    .string()
    .trim()
    .min(1, 'Describe the question.')
    .max(20_000, 'Use 20,000 characters or fewer.'),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']),
  language: z.enum(['JAVASCRIPT', 'TYPESCRIPT', 'REACT_TSX']),
  starterCode: z.string().max(100_000, 'Use 100,000 characters or fewer.'),
});
export type QuestionFormValues = z.infer<typeof questionFormSchema>;
