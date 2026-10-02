import * as DocumentPicker from "expo-document-picker";
import { z } from "zod";
import { getAuthGeneration } from "@/auth/auth-store";
import { api } from "@/lib/api-client";
import { durableRecord, type DurableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";
import {
  confirmMobileMediaUpload,
  uploadMobileMediaFile,
  type MediaConfirmation,
  type MobileUploadFile,
} from "@/lib/media-upload";
import { uploadTimelineVideo } from "./story-timeline-video-upload";
import { candidateSchema } from "./story-timeline-media";
import type { TimelineScope } from "./story-timeline-api";

const mime = ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime"] as const;

const checkpointSchema = z
  .object({
    clientKey: z.string().min(1),
    name: z.string().min(1),
    confirmation: z
      .object({
        storageKey: z.string().min(1),
        kind: z.enum(["ai_reference_image", "ai_reference_video"]),
        contentType: z.enum(mime),
        scope: z.object({ storyProjectId: z.string().uuid() }).strict(),
      })
      .strict(),
  })
  .strict()
  .refine((v) => v.clientKey === v.confirmation.storageKey)
  .refine(
    (v) =>
      (v.confirmation.kind === "ai_reference_video") ===
      v.confirmation.contentType.startsWith("video/")
  );
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
      candidate.asset.kind !==
        (checkpoint.confirmation.kind === "ai_reference_video" ? "video" : "image") ||
      candidate.asset.contentType !== checkpoint.confirmation.contentType ||
      candidate.asset.status !== "ready" ||
      candidate.asset.moderationStatus === "blocked"
    )
      throw Error("Uploaded media could not be verified. Retry the saved upload.");
    pending.clear(checkpoint.clientKey);
    return candidate;
  };
  const upload = async (input: MobileUploadFile, signal: AbortSignal) => {
    current(signal);
    if (pending.read()) throw Error("Finish the pending upload before uploading another file.");
    const type = z.enum(mime).parse(input.type.toLowerCase());
    const name = input.name.trim(),
      size = input.size;
    if (!name || !input.uri) throw Error("Selected media is unavailable.");
    const file = { ...input, name, type };
    const video = type.startsWith("video/");
    const maxBytes = (video ? 2048 : 30) * 1024 * 1024;
    if (size !== undefined && (!Number.isSafeInteger(size) || size <= 0 || size > maxBytes))
      throw Error(
        `Select a non-empty ${video ? "video no larger than 2 GiB" : "image no larger than 30 MiB"}.`
      );
    let saved: TimelineUploadCheckpoint | undefined;
    const beforeConfirm = (confirmation: MediaConfirmation) => {
      current(signal);
      saved = schema.parse({ clientKey: confirmation.storageKey, name, confirmation });
      pending.save(saved);
    };
    const receipt = video
      ? await uploadTimelineVideo(file, scope, signal, beforeConfirm)
      : await uploadMobileMediaFile(file, {
          kind: "ai_reference_image",
          maxBytes,
          signal,
          scope: { storyProjectId: scope.projectId },
          beforeConfirm,
        });
    if (!saved) throw Error("Upload recovery was not saved.");
    return register(saved, receipt, signal);
  };
  return {
    /** Upload an encoder-owned file using the same durable confirmation recovery. */
    upload,
    read: pending.read,
    clear: pending.clear,
    resume: async (signal: AbortSignal) => {
      current(signal);
      const saved = pending.read();
      if (!saved) throw Error("No upload is pending.");
      return register(saved, await confirmMobileMediaUpload(saved.confirmation, signal), signal);
    },
    pick: async (signal: AbortSignal, imagesOnly = false) => {
      current(signal);
      if (pending.read()) throw Error("Finish the pending upload before selecting another file.");
      const picked = await DocumentPicker.getDocumentAsync({
        type: imagesOnly ? mime.filter((value) => value.startsWith("image/")) : [...mime],
        multiple: false,
        copyToCacheDirectory: true,
        base64: false,
      });
      current(signal);
      if (picked.canceled) return null;
      if (picked.assets.length !== 1) throw Error("Select one image or video at a time.");
      const asset = picked.assets[0]!;
      const type = z.enum(mime).parse((asset.file?.type || asset.mimeType || "").toLowerCase());
      if (imagesOnly && !type.startsWith("image/")) throw Error("Select an image.");
      const name = asset.name.trim(),
        size = asset.file?.size ?? asset.size;
      if (!name || !asset.uri) throw Error("Selected media is unavailable.");
      return upload({ uri: asset.uri, name, type, size }, signal);
    },
  };
}
