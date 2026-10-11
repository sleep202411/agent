import { z } from 'zod';

export const PdfTaskSchema = z
  .object({
    episode: z
      .object({
        number: z.number().int().positive().max(10000),
        title: z.string().min(1).max(180),
        label: z.string().min(1).max(40),
      })
      .strict()
      .optional(),
    title: z.string().trim().min(1).max(180),
    description: z.string().trim().min(1).max(4000),
    category: z.enum([
      'scripts',
      'characters',
      'scenes',
      'props',
      'art',
      'music',
      'production',
      'finalEditing',
    ]),
    evidence: z.string().trim().min(8).max(1000),
  })
  .strict();
export const PdfTasksSchema = z
  .object({ tasks: z.array(PdfTaskSchema).min(1).max(100) })
  .strict();
export const ApplyPdfTasksSchema = z
  .object({
    indices: z.array(z.number().int().min(0).max(99)).min(1).max(100),
  })
  .strict()
  .refine(
    (value) => new Set(value.indices).size === value.indices.length,
    'Select each task only once.',
  );
export function groundedPdfTasks(value: unknown, source: string) {
  const parsed = PdfTasksSchema.parse(value);
  const normalize = (text: string) =>
    text.normalize('NFKC').replace(/\s+/g, ' ').trim();
  const text = normalize(source);
  const seen = new Set<string>();
  for (const task of parsed.tasks) {
    if (!text.includes(normalize(task.evidence)))
      throw new Error(
        'AI returned a task without a matching source excerpt. Analyze the document again.',
      );
    const key = `${task.category}:${normalize(task.title).toLowerCase()}`;
    if (seen.has(key))
      throw new Error(
        'AI returned duplicate tasks. Analyze the document again.',
      );
    seen.add(key);
  }
  return parsed;
}
