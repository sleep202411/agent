import { z } from "zod";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord, type DurableRecord } from "@/lib/durable-record";
const draftSchema = z
  .object({
    key: z.string().min(1),
    phase: z.enum(["creating", "updating", "uploading"]),
    workId: z.string().min(1).optional(),
    title: z.string().trim().min(1).max(80),
    description: z.string().trim().max(500),
    tagIds: z.array(z.number().int().positive()).max(5),
  })
  .refine((value) => value.phase === "creating" || !!value.workId, "Existing work ID required");
export type WorkDraft = z.infer<typeof draftSchema>;
const schema = z.object({ version: z.literal(1), draft: draftSchema.nullable() });
export function workDraft(
  userId: string,
  generation: number,
  entryId?: string,
  store: DurableRecord = durableRecord("personal-work-draft", userId, entryId ?? "new")
) {
  const check = () => {
    if (generation !== getAuthGeneration()) throw new Error("Publishing session expired.");
  };
  const read = () => {
    check();
    const raw = store.read();
    const draft = raw === null ? null : schema.parse(JSON.parse(raw)).draft;
    if (draft && entryId && draft.workId !== entryId)
      throw new Error("Publishing work does not match this entry.");
    return draft;
  };
  return {
    read,
    start(value: WorkDraft) {
      check();
      const next = draftSchema.parse(value),
        previous = read();
      if (entryId && next.workId !== entryId)
        throw new Error("Publishing work does not match this entry.");
      if (previous) throw new Error("Another publishing request is pending.");
      store.write(JSON.stringify({ version: 1, draft: next }));
      return next;
    },
    confirm(key: string, workId: string) {
      const previous = read();
      if (!previous || previous.key !== key || (previous.workId && previous.workId !== workId))
        throw new Error("Publishing request changed.");
      const next = draftSchema.parse({ ...previous, phase: "uploading", workId });
      store.write(JSON.stringify({ version: 1, draft: next }));
      return next;
    },
    clear(key: string) {
      const previous = read();
      if (previous && previous.key !== key) throw new Error("Publishing request changed.");
      store.write(JSON.stringify({ version: 1, draft: null }));
    },
  };
}
