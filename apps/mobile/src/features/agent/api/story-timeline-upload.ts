import * as DocumentPicker from "expo-document-picker";
import { z } from "zod";
import { getAuthGeneration } from "@/auth/auth-store";
import { api } from "@/lib/api-client";
import { durableRecord, type DurableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";
import { confirmMobileMediaUpload, uploadMobileMediaFile } from "@/lib/media-upload";
import { candidateSchema } from "./story-timeline-media";
import type { TimelineScope } from "./story-timeline-api";

const mime = ["image/jpeg", "image/png", "image/webp"] as const;
const maxBytes = 30 * 1024 * 1024;
const checkpointSchema = z
  .object({
    clientKey: z.string().min(1),
    name: z.string().min(1),
    confirmation: z
      .object({
        storageKey: z.string().min(1),
        kind: z.literal("ai_reference_image"),
        contentType: z.enum(mime),
        scope: z.object({ storyProjectId: z.string().uuid() }).strict(),
      })
      .strict(),
  })
  .strict()
  .refine((v) => v.clientKey === v.confirmation.storageKey);
export type TimelineUploadCheckpoint = z.infer<typeof checkpointSchema>;

/** Recover confirmation and candidate registration, never repeat the byte upload. */
export function timelineUpload(
  scope: TimelineScope,
  userId: string,
  storage: DurableRecord = durableRecord("story-timeline-upload", userId, scope.projectId)
) {
  const schema = checkpointSchema.refine(
    (v) => v.confirmation.scope.storyProjectId === scope.projectId
  );
  const pending = pendingRequest(schema, scope.generation, storage);
  const current = (signal?: AbortSignal) => {
    signal?.throwIfAborted();
    z.string().uuid().parse(scope.projectId);
    if (getAuthGeneration() !== scope.generation) throw Error("Timeline upload session expired.");
  };
  const register = async (
    checkpoint: TimelineUploadCheckpoint,
    raw: unknown,
    signal: AbortSignal
  ) => {
    current(signal);
    schema.parse(checkpoint);
    const receipt = z.object({ mediaAssetId: z.string().uuid() }).parse(raw);
    const candidate = candidateSchema.parse(
      await api.put(`/story-projects/${scope.projectId}/candidate-assets/${receipt.mediaAssetId}`, {
        service: "aurora",
        retry: false,
        signal,
      })
    );
    current(signal);
    if (
      candidate.asset.id !== receipt.mediaAssetId ||
      candidate.asset.kind !== "image" ||
      candidate.asset.contentType !== checkpoint.confirmation.contentType ||
      candidate.asset.status !== "ready" ||
      candidate.asset.moderationStatus === "blocked"
    )
      throw Error("Uploaded image could not be verified. Retry the saved upload.");
    pending.clear(checkpoint.clientKey);
    return candidate;
  };
  return {
    read: pending.read,
    clear: pending.clear,
    resume: async (signal: AbortSignal) => {
      current(signal);
      const saved = pending.read();
      if (!saved) throw Error("No upload is pending.");
      return register(saved, await confirmMobileMediaUpload(saved.confirmation, signal), signal);
    },
    pick: async (signal: AbortSignal) => {
      current(signal);
      if (pending.read()) throw Error("Finish the pending upload before selecting another file.");
      const picked = await DocumentPicker.getDocumentAsync({
        type: [...mime],
        multiple: false,
        copyToCacheDirectory: true,
        base64: false,
      });
      current(signal);
      if (picked.canceled) return null;
      if (picked.assets.length !== 1) throw Error("Select one image at a time.");
      const asset = picked.assets[0]!;
      const type = z.enum(mime).parse((asset.file?.type || asset.mimeType || "").toLowerCase());
      const name = asset.name.trim(),
        size = asset.file?.size ?? asset.size;
      if (!name || !asset.uri) throw Error("Selected image is unavailable.");
      if (size !== undefined && (!Number.isSafeInteger(size) || size <= 0 || size > maxBytes))
        throw Error("Select a non-empty image no larger than 30 MiB.");
      let saved: TimelineUploadCheckpoint | undefined;
      const receipt = await uploadMobileMediaFile(
        { uri: asset.uri, name, type, size },
        {
          kind: "ai_reference_image",
          maxBytes,
          signal,
          scope: { storyProjectId: scope.projectId },
          beforeConfirm: (confirmation) => {
            current(signal);
            saved = schema.parse({ clientKey: confirmation.storageKey, name, confirmation });
            pending.save(saved);
          },
        }
      );
      if (!saved) throw Error("Upload recovery was not saved.");
      return register(saved, receipt, signal);
    },
  };
}
