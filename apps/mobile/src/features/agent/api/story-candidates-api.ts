import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord, type DurableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";
import { candidateSchema } from "./story-timeline-media";

const id = z.string().uuid();
const commandSchema = z.object({ clientKey: id, mediaAssetId: id }).strict();
export type CandidateRemoval = z.infer<typeof commandSchema>;
export type CandidateScope = { projectId: string; generation: number };

/** Removes only the project's saved candidate relation, never the media itself. */
export function storyCandidates(
  scope: CandidateScope,
  userId: string,
  storage: DurableRecord = durableRecord("story-candidate-removal", userId, scope.projectId)
) {
  if (!userId) throw Error("An account is required.");
  const pending = pendingRequest(commandSchema, scope.generation, storage);
  let busy = false;
  const current = (signal: AbortSignal) => {
    signal.throwIfAborted();
    id.parse(scope.projectId);
    if (getAuthGeneration() !== scope.generation) throw Error("Story session expired.");
  };
  const read = async (signal: AbortSignal) => {
    current(signal);
    const options = { service: "aurora" as const, signal, retry: false };
    const project = z
      .object({ id, capabilities: z.array(z.string()) })
      .parse(await api.get(`/story-projects/${scope.projectId}`, options));
    current(signal);
    if (project.id !== scope.projectId) throw Error("Candidate project identity mismatch.");
    if (!project.capabilities.includes("story.read"))
      throw Error("Story reading permission is required.");
    const items = z
      .array(candidateSchema)
      .parse(await api.get(`/story-projects/${scope.projectId}/candidate-assets`, options));
    current(signal);
    if (new Set(items.map((item) => item.asset.id)).size !== items.length)
      throw Error("Duplicate project media returned.");
    return { items, canEdit: project.capabilities.includes("story.edit") };
  };
  const load = async (signal: AbortSignal) => {
    const state = await read(signal);
    const command = pending.read();
    const applied =
      !!command && !state.items.some((item) => item.asset.id === command.mediaAssetId);
    if (applied) pending.clear(command!.clientKey);
    return { ...state, pending: applied ? null : command };
  };
  return {
    load,
    pending: pending.read,
    async remove(raw: CandidateRemoval, signal: AbortSignal) {
      if (busy) throw Error("A candidate update is in progress.");
      busy = true;
      try {
        current(signal);
        const command = commandSchema.parse(raw);
        const state = await load(signal);
        if (state.pending && JSON.stringify(state.pending) !== JSON.stringify(command))
          throw Error("Finish the pending candidate removal first.");
        if (!state.items.some((item) => item.asset.id === command.mediaAssetId)) return state;
        if (!state.canEdit) throw Error("Story editing permission is required.");
        pending.save(command);
        const receipt = z.object({ mediaAssetId: id }).parse(
          await api.delete(
            `/story-projects/${scope.projectId}/candidate-assets/${command.mediaAssetId}`,
            {
              service: "aurora",
              signal,
              retry: false,
            }
          )
        );
        current(signal);
        if (receipt.mediaAssetId !== command.mediaAssetId)
          throw Error("Candidate removal could not be verified. Refresh to check its status.");
        const next = await load(signal);
        if (next.pending)
          throw Error("Candidate removal has not been confirmed. Refresh to check its status.");
        return next;
      } finally {
        busy = false;
      }
    },
  };
}
export type CandidateState = Awaited<ReturnType<ReturnType<typeof storyCandidates>["load"]>>;
