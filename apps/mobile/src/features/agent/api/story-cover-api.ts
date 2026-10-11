import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord, type DurableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";
import { candidateSchema } from "./story-timeline-media";
import type { StoryRepairScope } from "./story-draft-repair-api";
const id = z.string().uuid();
const projectSchema = z.object({
  id,
  projectVersion: z.number().int().nonnegative(),
  status: z.string(),
  capabilities: z.array(z.string()),
  cover: candidateSchema.shape.asset.nullable(),
});
const commandSchema = z
  .object({
    clientKey: id,
    expectedProjectVersion: z.number().int().nonnegative(),
    coverAssetId: id.nullable(),
  })
  .strict();
export type StoryCoverProject = z.infer<typeof projectSchema>;
export type StoryCoverCommand = z.infer<typeof commandSchema>;
export const usableStoryCover = (asset: StoryCoverProject["cover"]) =>
  !!asset &&
  asset.kind === "image" &&
  asset.status === "ready" &&
  asset.moderationStatus !== "blocked";
export function storyCover(
  scope: StoryRepairScope,
  userId: string,
  storage: DurableRecord = durableRecord("story-cover", userId, scope.projectId)
) {
  if (!userId) throw Error("An account is required.");
  const pending = pendingRequest(commandSchema, scope.generation, storage);
  let saving = false;
  const current = (signal: AbortSignal) => {
    signal.throwIfAborted();
    id.parse(scope.projectId);
    if (scope.generation !== getAuthGeneration()) throw Error("Story cover session expired.");
  };
  const receipt = (raw: unknown) => {
    const project = projectSchema.parse(raw);
    if (project.id !== scope.projectId) throw Error("Story cover project mismatch.");
    return project;
  };
  const load = async (signal: AbortSignal) => {
    current(signal);
    const project = receipt(
      await api.get(`/story-projects/${scope.projectId}`, {
        service: "aurora",
        signal,
        retry: false,
      })
    );
    current(signal);
    if (!project.capabilities.includes("story.read"))
      throw Error("Story reading permission is required.");
    return project;
  };
  const matches = (project: StoryCoverProject, command: StoryCoverCommand) =>
    (project.cover?.id ?? null) === command.coverAssetId;
  return {
    read: pending.read,
    discard: (key: string) => {
      if (saving) throw Error("A cover save is in progress.");
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
    async save(raw: StoryCoverCommand, signal: AbortSignal) {
      if (saving) throw Error("A cover save is in progress.");
      saving = true;
      try {
        current(signal);
        const command = commandSchema.parse(raw);
        pending.save(command);
        const project = await load(signal);
        if (!project.capabilities.includes("story.edit") || project.status !== "active")
          throw Error("Story editing permission is required.");
        if (project.projectVersion > command.expectedProjectVersion && matches(project, command)) {
          pending.clear(command.clientKey);
          return project;
        }
        if (project.projectVersion !== command.expectedProjectVersion)
          throw Error(
            "The project changed. Reload and review its cover before applying your change."
          );
        if (command.coverAssetId) {
          const candidates = z.array(candidateSchema).parse(
            await api.get(`/story-projects/${scope.projectId}/candidate-assets`, {
              service: "aurora",
              signal,
              retry: false,
            })
          );
          if (
            !candidates.some(
              (c) => c.asset.id === command.coverAssetId && usableStoryCover(c.asset)
            )
          )
            throw Error("Select a ready, unblocked image from this project's media.");
        }
        current(signal);
        const updated = receipt(
          await api.patch(`/story-projects/${scope.projectId}`, {
            service: "aurora",
            signal,
            retry: false,
            data: {
              expectedProjectVersion: command.expectedProjectVersion,
              coverAssetId: command.coverAssetId,
            },
          })
        );
        current(signal);
        if (
          updated.projectVersion !== command.expectedProjectVersion + 1 ||
          !matches(updated, command)
        )
          throw Error("The cover save could not be verified. Reload before retrying.");
        pending.clear(command.clientKey);
        return updated;
      } finally {
        saving = false;
      }
    },
  };
}
