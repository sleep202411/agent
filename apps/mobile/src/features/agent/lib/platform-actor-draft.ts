import { z } from "zod";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord, type DurableRecord } from "@/lib/durable-record";
import { canvasActorReceiptSchema } from "../../../../canvas-editor/actor-schema";
import { canvasUpdateSchema } from "../../../../canvas-editor/protocol";
import type { PlatformCanvasScope } from "../api/platform-canvas-document";

export const platformActorDraftSchema = z
  .object({
    actorId: z.string().uuid(),
    clientKey: z.string().uuid(),
    receipt: canvasActorReceiptSchema.optional(),
    command: canvasUpdateSchema.optional(),
  })
  .strict()
  .refine(
    (draft) =>
      !draft.receipt ||
      (draft.receipt.actorId === draft.actorId && draft.receipt.nodeId === draft.clientKey),
    "Actor receipt identity mismatch."
  )
  .refine(
    (draft) => !draft.command || (!!draft.receipt && draft.command.clientKey === draft.clientKey),
    "Actor canvas save must match its receipt."
  );
export type PlatformActorDraft = z.infer<typeof platformActorDraftSchema>;

/** Commit intent, then use receipt, then exact canvas bytes. A failed durable write
 * stops the next side effect. Clearing requires the original request identity. */
export function platformActorDraftStore(
  scope: PlatformCanvasScope,
  userId: string,
  storage?: DurableRecord
) {
  const record =
    storage ??
    durableRecord(
      "platform-canvas-actor-draft",
      userId,
      `${scope.workspaceId}:${scope.projectId}:${scope.sectionId}:${scope.documentId}`
    );
  const current = () => {
    if (scope.generation !== getAuthGeneration()) throw Error("Actor session expired.");
  };
  const read = () => {
    current();
    const raw = record.read();
    return raw === null
      ? null
      : z
          .object({ version: z.literal(1), draft: platformActorDraftSchema.nullable() })
          .parse(JSON.parse(raw)).draft;
  };
  return {
    read,
    write: (raw: PlatformActorDraft) => {
      current();
      const next = platformActorDraftSchema.parse(raw),
        previous = read();
      if (previous && (previous.clientKey !== next.clientKey || previous.actorId !== next.actorId))
        throw Error("Finish the pending actor insertion before selecting another actor.");
      if (previous?.receipt && JSON.stringify(previous.receipt) !== JSON.stringify(next.receipt))
        throw Error("The saved actor receipt cannot be replaced.");
      if (previous?.command && JSON.stringify(previous.command) !== JSON.stringify(next.command))
        throw Error("Retry the exact saved canvas update.");
      record.write(JSON.stringify({ version: 1, draft: next }));
    },
    acknowledge: (clientKey: string) => {
      current();
      const previous = read();
      if (!previous || previous.clientKey !== clientKey || !previous.receipt)
        throw Error("Actor insertion acknowledgement mismatch.");
      record.write(JSON.stringify({ version: 1, draft: null }));
    },
    discardUnprepared: (clientKey: string) => {
      const previous = read();
      if (!previous || previous.clientKey !== clientKey || previous.command)
        throw Error("A prepared actor save must be confirmed before it can be cleared.");
      record.write(JSON.stringify({ version: 1, draft: null }));
    },
  };
}
