import { z } from "zod";
import { getAuthGeneration } from "@/auth/auth-store";
import { api } from "@/lib/api-client";
import { confirmMobileMediaUpload, type MobileUploadFile } from "@/lib/media-upload";
import { selectedMedia } from "@/features/ip-author/selected-media";
import { canvasUploadedAssetSchema } from "../../../../canvas-editor/upload-schema";
import type { CanvasWriteScope } from "./story-canvas-update";
import { readStoryCanvasDocument } from "./story-canvas-document";
import {
  canvasUploadPolicies as policies,
  canvasUploadCheckpointSchema,
  type CanvasUploadCheckpoint,
} from "../../../../canvas-editor/upload-schema";
function current(scope: CanvasWriteScope, signal: AbortSignal) {
  signal.throwIfAborted();
  if (getAuthGeneration() !== scope.generation) throw Error("Canvas upload session expired.");
}
export async function confirmCanvasUpload(
  scope: CanvasWriteScope,
  raw: CanvasUploadCheckpoint,
  signal: AbortSignal
) {
  current(scope, signal);
  const saved = canvasUploadCheckpointSchema.parse(raw);
  if (saved.confirmation.scope.storyProjectId !== scope.projectId)
    throw Error("Canvas upload project mismatch.");
  await readStoryCanvasDocument(scope, scope.documentId, signal);
  current(scope, signal);
  const receipt = await confirmMobileMediaUpload(saved.confirmation, signal);
  current(scope, signal);
  return canvasUploadedAssetSchema.parse({
    mediaAssetId: receipt.mediaAssetId,
    url: receipt.url,
    name: saved.name,
    createdAt: saved.createdAt,
    kind: policies[saved.confirmation.contentType as keyof typeof policies][0],
  });
}
/** File-backed on native. Persist the confirmation before sending it; retries never repeat PUT. */
export async function uploadCanvasFile(
  scope: CanvasWriteScope,
  file: MobileUploadFile,
  signal: AbortSignal,
  checkpoint: (saved: CanvasUploadCheckpoint) => void
) {
  current(scope, signal);
  const suppliedType = file.type.toLowerCase();
  const extensionTypes: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    mp4: "video/mp4",
    mov: "video/quicktime",
    mp3: "audio/mpeg",
    wav: "audio/wav",
  };
  const type = Object.hasOwn(policies, suppliedType)
    ? suppliedType
    : (extensionTypes[file.name.split(".").pop()?.toLowerCase() ?? ""] ?? "");
  const policy = Object.hasOwn(policies, type)
    ? policies[type as keyof typeof policies]
    : undefined;
  if (!policy || !file.name.trim()) throw Error("Select a supported image, video or audio file.");
  const source = await selectedMedia(file.uri, signal);
  current(scope, signal);
  if (
    !Number.isSafeInteger(source.size) ||
    source.size <= 0 ||
    source.size > policy[1] * 1024 * 1024
  )
    throw Error(`Select a non-empty file no larger than ${policy[1]} MiB.`);
  await readStoryCanvasDocument(scope, scope.documentId, signal);
  current(scope, signal);
  const kind = `ai_reference_${policy[0]}` as const;
  const signed = z
    .object({
      uploadUrl: z
        .string()
        .url()
        .refine((value) => {
          const url = new URL(value);
          return url.protocol === "https:" && !url.username && !url.password;
        }),
      method: z.literal("PUT"),
      storageKey: z.string().min(1),
      headers: z.record(z.string()),
    })
    .parse(
      await api.post("/media/upload-url", {
        service: "aurora",
        signal,
        retry: false,
        data: {
          kind,
          contentType: type,
          fileName: file.name.trim(),
          sizeBytes: source.size,
          scope: { storyProjectId: scope.projectId },
        },
      })
    );
  current(scope, signal);
  if (Object.keys(signed.headers).some((key) => /^(authorization|cookie)$/i.test(key)))
    throw Error("Invalid storage upload headers.");
  const response = await source.put(
    signed.uploadUrl,
    { "Content-Type": type, ...signed.headers },
    signal
  );
  current(scope, signal);
  if (!response.ok) throw Error(`Media upload failed with HTTP ${response.status}`);
  const saved = canvasUploadCheckpointSchema.parse({
    name: file.name.trim(),
    createdAt: Date.now(),
    confirmation: {
      storageKey: signed.storageKey,
      kind,
      contentType: type,
      scope: { storyProjectId: scope.projectId },
    },
  });
  checkpoint(saved);
  current(scope, signal);
  return confirmCanvasUpload(scope, saved, signal);
}
