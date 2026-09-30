import { SERVICE_CATEGORIES } from "@repo/shared/creator-service";
import { z } from "zod";
import { api } from "@/lib/api-client";

export const serviceDetailsSchema = z.object({
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(1000),
  category: z.enum(SERVICE_CATEGORIES),
  tags: z.array(z.string().trim().min(1).max(48)).max(10),
  expectedVersion: z.number().int().nonnegative(),
});
export type ServiceDetailsInput = z.input<typeof serviceDetailsSchema>;
export async function saveServiceDetails(id: string, input: ServiceDetailsInput) {
  // Deliberately omit replace-all collections and coverPath: metadata edits
  // must not erase packages, questionnaire IDs or the stored cover reference.
  const data = serviceDetailsSchema.parse(input);
  await api.patch(`/creator-services/${encodeURIComponent(id)}`, { service: "aurora", data });
}
