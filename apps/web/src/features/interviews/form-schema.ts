import { z } from 'zod';
export const interviewFormSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Enter an interview title.')
    .max(200, 'Use 200 characters or fewer.'),
  questionIds: z.array(z.string().min(1)).min(1, 'Select at least one question.'),
});
export type InterviewFormValues = z.infer<typeof interviewFormSchema>;
