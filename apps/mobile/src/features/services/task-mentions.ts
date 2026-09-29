import { z } from "zod";
import { api } from "@/lib/api-client";
export const taskMention = z.object({
  userId: z.string().trim().min(1).max(64),
  label: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine((value) => !/[@\r\n]/.test(value)),
});
export type TaskMention = z.infer<typeof taskMention>;
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const member = z.object({
  id: identifier,
  crewId: identifier,
  userId: z.string().min(1).max(64),
  status: z.literal("active"),
});
export type MentionMember = z.infer<typeof member>;
export async function fetchMentionMembers(
  crewId: string,
  cursor: string | null,
  signal: AbortSignal
) {
  identifier.parse(crewId);
  const result = z.object({ items: z.array(member), nextCursor: identifier.nullable() }).parse(
    await api.get(`/crews/${encodeURIComponent(crewId)}/members`, {
      service: "aurora",
      signal,
      params: { limit: 50, ...(cursor ? { cursor: identifier.parse(cursor) } : {}) },
    })
  );
  if (result.items.some((item) => item.crewId !== crewId))
    throw new Error("Crew member scope mismatch");
  return result;
}
