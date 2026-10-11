import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import type { CandidateScope } from "./story-candidates-api";
const id = z.string().uuid();
const contextSchema = z.object({
  crew: z.object({ id: z.string().min(1), name: z.string() }).nullable(),
});
const nodeSchema = z.object({
  id,
  name: z.string(),
  kind: z.enum(["file", "folder"]),
  media: z
    .object({
      id,
      kind: z.enum(["image", "video", "audio", "document", "other"]),
      contentType: z.string(),
      previewUrl: z.string(),
    })
    .nullable(),
});
const pageSchema = z.object({
  items: z.array(nodeSchema),
  source: z.literal("recent"),
  parentId: z.null(),
  nextCursor: id.nullable(),
});
/** Keep the Story-scoped endpoint and its restricted-folder ACL filtering. */
export async function loadStoryCrewCandidates(scope: CandidateScope, signal: AbortSignal) {
  const current = () => {
    signal.throwIfAborted();
    id.parse(scope.projectId);
    if (getAuthGeneration() !== scope.generation) throw Error("Story session expired.");
  };
  const options = { service: "aurora" as const, signal, retry: false };
  const path = `/story-projects/${scope.projectId}/crew-assets`;
  current();
  const { crew } = contextSchema.parse(await api.get(`${path}/context`, options));
  current();
  const items: z.infer<typeof nodeSchema>[] = [];
  if (!crew) return { crew, items };
  const nodes = new Set<string>(),
    media = new Set<string>(),
    cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    current();
    const page = pageSchema.parse(
      await api.get(path, {
        ...options,
        params: { source: "recent", sort: "modified", limit: 200, cursor },
      })
    );
    current();
    for (const item of page.items) {
      if (nodes.has(item.id)) continue;
      nodes.add(item.id);
      if (
        item.kind !== "file" ||
        !item.media ||
        !["image", "video", "audio"].includes(item.media.kind) ||
        media.has(item.media.id)
      )
        continue;
      media.add(item.media.id);
      items.push(item);
    }
    // ACL filtering can leave a page empty even when later pages contain media.
    cursor = page.nextCursor ?? undefined;
    if (cursor && cursors.has(cursor)) throw Error("Crew asset pagination repeated a cursor.");
    if (cursor) cursors.add(cursor);
  } while (cursor);
  const latest = contextSchema.parse(await api.get(`${path}/context`, options));
  current();
  if (latest.crew?.id !== crew.id) throw Error("The linked Crew changed. Refresh to try again.");
  return { crew: latest.crew, items };
}
