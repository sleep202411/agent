import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord, type DurableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";
const id = z.string().uuid(),
  version = z.number().int().nonnegative();
export const storyLibraryProjectSchema = z.object({
  id,
  workspaceId: id.optional(),
  canMove: z.boolean().optional(),
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
export function canMoveToWorkspace(
  workspace: { id: string; role?: string; accessScope?: string; status?: string },
  source?: string
) {
  return (
    workspace.id !== source &&
    workspace.accessScope === "workspace" &&
    ["owner", "admin"].includes(workspace.role ?? "") &&
    (workspace.status === undefined || workspace.status === "active")
  );
}
const commandSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("edit"), clientKey: id, expectedProjectVersion: version, fields })
    .strict(),
  z.object({ kind: z.literal("archive"), clientKey: id, expectedProjectVersion: version }).strict(),
  z
    .object({
      kind: z.literal("move"),
      clientKey: id,
      expectedProjectVersion: version,
      expectedWorkspaceId: id,
      targetWorkspaceId: id,
    })
    .strict(),
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
    c.kind === "move"
      ? p.workspaceId === c.targetWorkspaceId
      : c.kind === "archive"
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
      return {
        project,
        pending: applied ? null : command,
        applied,
        movedWorkspaceId: applied && command?.kind === "move" ? project.workspaceId : undefined,
      };
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
          !p.capabilities.includes(c.kind === "edit" ? "story.edit" : "story.admin")
        )
          throw Error("This project action is not permitted.");
        if (p.projectVersion !== c.expectedProjectVersion)
          throw Error("The project changed. Reload and review your edits before saving.");
        if (c.kind === "move") {
          if (!p.canMove) throw Error("Only the project owner can move this project.");
          if (
            p.workspaceId !== c.expectedWorkspaceId ||
            c.targetWorkspaceId === c.expectedWorkspaceId
          )
            throw Error("The project workspace changed. Reload before moving.");
          const { workspace: destination } = z
            .object({
              workspace: z.object({
                id,
                role: z.string().optional(),
                accessScope: z.string().optional(),
                status: z.string().optional(),
              }),
            })
            .parse(
              await api.get(`/workspaces/${c.targetWorkspaceId}`, {
                service: "aurora",
                signal,
                retry: false,
              })
            );
          current(signal);
          if (
            destination.id !== c.targetWorkspaceId ||
            !canMoveToWorkspace(destination, p.workspaceId)
          )
            throw Error("You must be an owner or admin of the destination workspace.");
          const moved = z.object({ projectId: id, workspaceId: id, projectVersion: version }).parse(
            await api.post(`/story-projects/${scope.projectId}/move`, {
              service: "aurora",
              signal,
              retry: false,
              data: {
                expectedWorkspaceId: c.expectedWorkspaceId,
                targetWorkspaceId: c.targetWorkspaceId,
                expectedProjectVersion: c.expectedProjectVersion,
              },
            })
          );
          current(signal);
          if (
            moved.projectId !== scope.projectId ||
            moved.workspaceId !== c.targetWorkspaceId ||
            moved.projectVersion !== c.expectedProjectVersion + 1
          )
            throw Error("The project move could not be verified. Reload before retrying.");
          const updated = await load(signal);
          if (updated.projectVersion < moved.projectVersion || !matches(updated, c))
            throw Error("The project moved again. Reload before continuing.");
          pending.clear(c.clientKey);
          return updated;
        }
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
