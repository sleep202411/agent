import { z } from "zod";
import { INTERACTIVE_FILM_SESSION_SCHEMA_VERSION } from "./session";

const stableId = z.string().trim().min(1);
const timestamp = z.string().datetime({ offset: true });
const sessionVariable = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);

export const playbackSettingsSchema = z
  .object({
    muted: z.boolean(),
    captionsEnabled: z.boolean(),
    dialogueBoost: z.boolean(),
    subtitleScale: z.number().finite().min(0.75).max(2),
    subtitleBackground: z.enum(["none", "soft", "solid"]),
    quality: z.enum(["high", "reduced"]),
    qteAssistMode: z.enum(["normal", "extended", "untimed"]),
    reduceMotion: z.boolean(),
    reduceCameraShake: z.boolean(),
    panoramaInertia: z.boolean(),
  })
  .strict();

const historyEntrySchema = z
  .object({
    nodeId: stableId,
    choiceId: stableId.optional(),
    transactionId: stableId.optional(),
    enteredAt: timestamp,
  })
  .strict();

const stableCheckpointSchema = z
  .object({
    nodeId: stableId,
    historyIndex: z.number().int().nonnegative(),
    savedAt: timestamp,
  })
  .strict();

const pendingChoiceSchema = z
  .object({
    transactionId: stableId,
    nodeId: stableId,
    choiceId: stableId,
    actionId: stableId.optional(),
    nextNodeId: stableId,
    committedAt: timestamp,
  })
  .strict();

function hasDuplicates(values: string[]): boolean {
  return new Set(values).size !== values.length;
}

export function createGameSessionSchema<TProfileSchema extends z.ZodType>(
  profileSchema: TProfileSchema
) {
  return z
    .object({
      schemaVersion: z.literal(INTERACTIVE_FILM_SESSION_SCHEMA_VERSION),
      sessionId: stableId,
      gameId: stableId,
      releaseId: stableId,
      contentVersion: stableId,
      profile: profileSchema,
      currentNodeId: stableId,
      variables: z.record(z.string(), sessionVariable),
      flags: z.record(z.string(), z.boolean()),
      relationships: z.record(z.string(), z.number().finite()),
      history: z.array(historyEntrySchema).min(1),
      watchedAssets: z.array(stableId),
      unlockedEndings: z.array(stableId),
      settings: playbackSettingsSchema,
      stableCheckpoint: stableCheckpointSchema,
      pendingChoice: pendingChoiceSchema.nullable(),
      appliedTransactionIds: z.array(stableId),
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .strict()
    .superRefine((session, context) => {
      const checkpointEntry = session.history[session.stableCheckpoint.historyIndex];
      if (!checkpointEntry) {
        context.addIssue({
          code: "custom",
          path: ["stableCheckpoint", "historyIndex"],
          message: "Checkpoint historyIndex is outside session history",
        });
      } else if (checkpointEntry.nodeId !== session.stableCheckpoint.nodeId) {
        context.addIssue({
          code: "custom",
          path: ["stableCheckpoint", "nodeId"],
          message: "Checkpoint nodeId does not match its history entry",
        });
      }

      if (hasDuplicates(session.appliedTransactionIds)) {
        context.addIssue({
          code: "custom",
          path: ["appliedTransactionIds"],
          message: "Applied transaction ids must be unique",
        });
      }

      if (hasDuplicates(session.watchedAssets)) {
        context.addIssue({
          code: "custom",
          path: ["watchedAssets"],
          message: "Watched asset ids must be unique",
        });
      }

      if (hasDuplicates(session.unlockedEndings)) {
        context.addIssue({
          code: "custom",
          path: ["unlockedEndings"],
          message: "Unlocked ending ids must be unique",
        });
      }

      if (
        session.pendingChoice &&
        session.appliedTransactionIds.includes(session.pendingChoice.transactionId)
      ) {
        context.addIssue({
          code: "custom",
          path: ["pendingChoice", "transactionId"],
          message: "A pending transaction cannot already be applied",
        });
      }
    });
}
