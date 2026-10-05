import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord, type DurableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";
import { candidateSchema } from "./story-timeline-media";
import type { StoryRepairScope } from "./story-draft-repair-api";
const id = z.string().uuid();
export const storyStoreListingSchema = z
  .object({
    description: z.string().trim().max(13000),
    tags: z
      .array(z.string().trim().min(1).max(40))
      .max(12)
      .refine(
        (values) => new Set(values).size === values.length,
        "Tags must not contain duplicates."
      ),
    developer: z.string().trim().max(60),
    trailerAssetId: id.nullable(),
    screenshotAssetIds: z
      .array(id)
      .max(8)
      .refine(
        (values) => new Set(values).size === values.length,
        "Screenshot assets must not contain duplicates."
      ),
  })
  .strict();
export type StoryStoreListing = z.infer<typeof storyStoreListingSchema>;
const projectSchema = z.object({
  id,
  projectVersion: z.number().int().nonnegative(),
  status: z.string(),
  capabilities: z.array(z.string()),
  storeListing: storyStoreListingSchema.nullable(),
});
const commandSchema = z
  .object({
    clientKey: id,
    expectedProjectVersion: z.number().int().nonnegative(),
    storeListing: storyStoreListingSchema.nullable(),
  })
  .strict();
export type StoryListingProject = z.infer<typeof projectSchema>;
export type StoryListingCommand = z.infer<typeof commandSchema>;
export function storyListing(
  scope: Pick<StoryRepairScope, "projectId" | "generation">,
  userId: string,
  storage: DurableRecord = durableRecord("story-listing", userId, scope.projectId)
) {
  if (!userId) throw Error("An account is required.");
  const pending = pendingRequest(commandSchema, scope.generation, storage);
  let saving = false;
  const current = (signal: AbortSignal) => {
    signal.throwIfAborted();
    id.parse(scope.projectId);
    if (scope.generation !== getAuthGeneration()) throw Error("Story listing session expired.");
  };
  const receipt = (raw: unknown) => {
    const project = projectSchema.parse(raw);
    if (project.id !== scope.projectId) throw Error("Story listing project mismatch.");
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
  const matches = (project: StoryListingProject, command: StoryListingCommand) =>
    JSON.stringify(project.storeListing) === JSON.stringify(command.storeListing);
  return {
    read: pending.read,
    discard: (key: string) => {
      if (saving) throw Error("A listing save is in progress.");
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
    async save(raw: StoryListingCommand, signal: AbortSignal) {
      if (saving) throw Error("A listing save is in progress.");
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
            "The project changed. Reload and review its listing before applying your change."
          );
        if (
          command.storeListing &&
          (command.storeListing.trailerAssetId || command.storeListing.screenshotAssetIds.length)
        ) {
          const candidates = z.array(candidateSchema).parse(
            await api.get(`/story-projects/${scope.projectId}/candidate-assets`, {
              service: "aurora",
              signal,
              retry: false,
            })
          );
          const usable = (assetId: string, kind: "image" | "video") =>
            candidates.some(
              (candidate) =>
                candidate.asset.id === assetId &&
                candidate.asset.kind === kind &&
                candidate.asset.status === "ready" &&
                candidate.asset.moderationStatus !== "blocked"
            );
          if (
            command.storeListing.trailerAssetId &&
            !usable(command.storeListing.trailerAssetId, "video")
          )
            throw Error("Select a ready, unblocked trailer from this project's videos.");
          if (command.storeListing.screenshotAssetIds.some((assetId) => !usable(assetId, "image")))
            throw Error("Select ready, unblocked screenshots from this project's images.");
        }
        current(signal);
        const updated = receipt(
          await api.patch(`/story-projects/${scope.projectId}`, {
            service: "aurora",
            signal,
            retry: false,
            data: {
              expectedProjectVersion: command.expectedProjectVersion,
              storeListing: command.storeListing,
            },
          })
        );
        current(signal);
        if (
          updated.projectVersion !== command.expectedProjectVersion + 1 ||
          !matches(updated, command)
        )
          throw Error("The listing save could not be verified. Reload before retrying.");
        pending.clear(command.clientKey);
        return updated;
      } finally {
        saving = false;
      }
    },
  };
}
