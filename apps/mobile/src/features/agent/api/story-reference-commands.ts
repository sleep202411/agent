import { z } from "zod";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord, type DurableRecord } from "@/lib/durable-record";
import {
  referenceSpecSchema,
  referenceReviewInputSchema,
  referenceVersionInputSchema,
  storyReferences,
  type ReferenceScope,
} from "./story-references-api";
const id = z.string().uuid(),
  revision = z.number().int().nonnegative();
export const referenceCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), clientKey: id, slot: referenceSpecSchema }),
  z.object({
    action: z.literal("update"),
    clientKey: id,
    slotId: id,
    version: revision,
    slot: referenceSpecSchema,
  }),
  z.object({
    action: z.literal("import"),
    clientKey: id,
    slotId: id,
    input: referenceVersionInputSchema,
  }),
  z.object({
    action: z.literal("review"),
    clientKey: id,
    slotId: id,
    slotVersion: revision,
    versionId: id,
    input: referenceReviewInputSchema,
  }),
  z.object({
    action: z.literal("approve"),
    clientKey: id,
    slotId: id,
    slotVersion: revision,
    versionId: id,
    reviewId: id,
  }),
]);
export type ReferenceCommand = z.infer<typeof referenceCommandSchema>;
/** Retain exact writes across navigation; review approval is checkpointed as a separate step. */
export function referenceCommands(
  scope: ReferenceScope,
  userId: string,
  storage: DurableRecord = durableRecord("story-reference-command", userId, scope.projectId)
) {
  const api = storyReferences(scope);
  const record = z.object({
    projectId: z.literal(scope.projectId),
    command: referenceCommandSchema.nullable(),
  });
  let busy = false;
  const current = (signal?: AbortSignal) => {
    signal?.throwIfAborted();
    if (getAuthGeneration() !== scope.generation) throw Error("Reference session expired.");
  };
  const read = () => {
    current();
    const value = storage.read();
    return value ? record.parse(JSON.parse(value)).command : null;
  };
  const write = (command: ReferenceCommand | null) => {
    current();
    storage.write(JSON.stringify({ projectId: scope.projectId, command }));
  };
  const save = (raw: ReferenceCommand) => {
    const command = referenceCommandSchema.parse(raw),
      previous = read();
    if (previous && JSON.stringify(previous) !== JSON.stringify(command))
      throw Error("Finish the pending reference change first.");
    write(command);
    return command;
  };
  return {
    read,
    clear: () => {
      if (busy) throw Error("Wait for the reference change to finish.");
      write(null);
    },
    async submit(
      raw: ReferenceCommand,
      signal: AbortSignal,
      permissions: { edit: boolean; review: boolean }
    ) {
      current(signal);
      if (busy) throw Error("A reference change is already running.");
      let command = referenceCommandSchema.parse(raw);
      if (
        command.action === "review" || command.action === "approve"
          ? !permissions.review
          : !permissions.edit
      )
        throw Error("Reference permission denied.");
      command = save(command);
      busy = true;
      try {
        if (command.action === "create")
          await api.create([command.slot], command.clientKey, signal);
        else if (command.action === "update")
          await api.update(command.slotId, command.version, command.slot, signal);
        else if (command.action === "import")
          await api.addVersion(command.slotId, command.input, command.clientKey, signal);
        else {
          if (command.action === "review") {
            const result = await api.review(
              command.slotId,
              command.versionId,
              command.input,
              signal
            );
            current(signal);
            if (command.input.decision === "approve") {
              command = {
                action: "approve",
                clientKey: command.clientKey,
                slotId: command.slotId,
                slotVersion: command.slotVersion,
                versionId: command.versionId,
                reviewId: result.review.id,
              };
              write(command);
            }
          }
          if (command.action === "approve")
            await api.approve(
              command.slotId,
              command.slotVersion,
              command.versionId,
              command.reviewId,
              signal
            );
        }
        current(signal);
        write(null);
      } finally {
        busy = false;
      }
    },
  };
}
