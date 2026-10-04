import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord, type DurableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";
const id = z.string().uuid(),
  version = z.number().int().nonnegative();
export const storyLibraryProjectSchema = z.object({
  id,
  title: z.string(),
  summary: z.string().nullable(),
  status: z.enum(["active", "archived"]),
  projectVersion: version,
  capabilities: z.array(z.string()),
});
const fields = z.object({
  title: z.string().trim().min(1).max(160),
  summary: z.string().trim().max(2000).nullable(),
});
const commandSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("edit"), clientKey: id, expectedProjectVersion: version, fields })
    .strict(),
  z.object({ kind: z.literal("archive"), clientKey: id, expectedProjectVersion: version }).strict(),
]);
export type StoryLibraryCommand = z.infer<typeof commandSchema>;
export type StoryLibraryProject = z.infer<typeof storyLibraryProjectSchema>;
export type StoryLibraryScope = { projectId: string; generation: number };
export function storyLibraryActions(
  scope: StoryLibraryScope,
  userId: string,
  storage: DurableRecord = durableRecord("story-library-action", userId, scope.projectId)
) {
  if (!userId) throw Error("An account is required.");
  const pending = pendingRequest(commandSchema, scope.generation, storage);
  let saving = false;
  const current = (signal: AbortSignal) => {
    signal.throwIfAborted();
    id.parse(scope.projectId);
    if (scope.generation !== getAuthGeneration()) throw Error("Story project session expired.");
  };
  const receipt = (raw: unknown) => {
    const p = storyLibraryProjectSchema.parse(raw);
    if (p.id !== scope.projectId) throw Error("Story project identity mismatch.");
    return p;
  };
  const load = async (signal: AbortSignal) => {
    current(signal);
    const p = receipt(
      await api.get(`/story-projects/${scope.projectId}`, {
        service: "aurora",
        signal,
        retry: false,
      })
    );
    current(signal);
    if (!p.capabilities.includes("story.read"))
      throw Error("Story reading permission is required.");
    return p;
  };
  const matches = (p: StoryLibraryProject, c: StoryLibraryCommand) =>
    c.kind === "archive"
      ? p.status === "archived"
      : p.status === "active" && p.title === c.fields.title && p.summary === c.fields.summary;
  return {
    read: pending.read,
    discard: (key: string) => {
      if (saving) throw Error("A project update is in progress.");
      pending.clear(key);
    },
    async load(signal: AbortSignal) {
      const project = await load(signal),
        command = pending.read();
      const applied =
        !!command &&
        project.projectVersion > command.expectedProjectVersion &&
        matches(project, command);
      if (applied) pending.clear(command!.clientKey);
      return { project, pending: applied ? null : command, applied };
    },
    async save(raw: StoryLibraryCommand, signal: AbortSignal) {
      if (saving) throw Error("A project update is in progress.");
      saving = true;
      try {
        current(signal);
        const c = commandSchema.parse(raw);
        pending.save(c);
        const p = await load(signal);
        if (p.projectVersion > c.expectedProjectVersion && matches(p, c)) {
          pending.clear(c.clientKey);
          return p;
        }
        if (
          p.status !== "active" ||
          !p.capabilities.includes(c.kind === "archive" ? "story.admin" : "story.edit")
        )
          throw Error("This project action is not permitted.");
        if (p.projectVersion !== c.expectedProjectVersion)
          throw Error("The project changed. Reload and review your edits before saving.");
        const options = {
          service: "aurora" as const,
          signal,
          retry: false as const,
          data: {
            expectedProjectVersion: c.expectedProjectVersion,
            ...(c.kind === "edit" ? c.fields : {}),
          },
        };
        const updated = receipt(
          c.kind === "edit"
            ? await api.patch(`/story-projects/${scope.projectId}`, options)
            : await api.post(`/story-projects/${scope.projectId}/archive`, options)
        );
        current(signal);
        if (updated.projectVersion !== c.expectedProjectVersion + 1 || !matches(updated, c))
          throw Error("The project update could not be verified. Reload before retrying.");
        pending.clear(c.clientKey);
        return updated;
      } finally {
        saving = false;
      }
    },
  };
}
