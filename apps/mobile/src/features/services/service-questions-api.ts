import { z } from "zod";
import { api } from "@/lib/api-client";

const question = z.object({
  id: z.string().trim().min(1).max(64).optional(),
  prompt: z.string().trim().min(1).max(240),
  helpText: z.string().trim().max(240),
  required: z.boolean(),
});
export const questionsSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  requirementQuestions: z
    .array(question)
    .max(20)
    .refine((items) => {
      const ids = items.flatMap((item) => (item.id ? [item.id] : []));
      return new Set(ids).size === ids.length;
    }, "Question IDs must be unique"),
});
export type EditableQuestion = z.infer<typeof question>;
export async function saveServiceQuestions(id: string, input: z.input<typeof questionsSchema>) {
  const parsed = questionsSchema.parse(input);
  await api.patch(`/creator-services/${encodeURIComponent(id)}`, {
    service: "aurora",
    data: {
      expectedVersion: parsed.expectedVersion,
      requirementQuestions: parsed.requirementQuestions.map((item, displayOrder) => ({
        ...item,
        displayOrder,
      })),
    },
  });
}
