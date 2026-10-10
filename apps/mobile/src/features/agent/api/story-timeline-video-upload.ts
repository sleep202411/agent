import { z } from "zod";
import { getAuthGeneration } from "@/auth/auth-store";
import { api } from "@/lib/api-client";
import {
  confirmMobileMediaUpload,
  type MediaConfirmation,
  type MobileUploadFile,
} from "@/lib/media-upload";
import { selectedMedia } from "@/features/ip-author/selected-media";
import type { TimelineScope } from "./story-timeline-api";
const maxBytes = 2 * 1024 * 1024 * 1024;
/** Native sends a file reference; never materialize a multi-gigabyte video in JS. */
export async function uploadTimelineVideo(
  file: MobileUploadFile,
  scope: TimelineScope,
  signal: AbortSignal,
  beforeConfirm: (value: MediaConfirmation) => void
) {
  const current = () => {
    signal.throwIfAborted();
    if (getAuthGeneration() !== scope.generation) throw Error("Timeline upload session expired.");
  };
  current();
  z.string().uuid().parse(scope.projectId);
  const contentType = z.enum(["video/mp4", "video/quicktime"]).parse(file.type);
  const source = await selectedMedia(file.uri, signal);
  current();
  if (!Number.isSafeInteger(source.size) || source.size <= 0 || source.size > maxBytes)
    throw Error("Select a non-empty video no larger than 2 GiB.");
  const signed = z
    .object({
      uploadUrl: z
        .string()
        .url()
        .refine((s) => {
          const url = new URL(s);
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
          kind: "ai_reference_video",
          contentType,
          fileName: file.name,
          sizeBytes: source.size,
          scope: { storyProjectId: scope.projectId },
        },
      })
    );
  current();
  // Storage receives only signing headers, never session credentials.
  if (Object.keys(signed.headers).some((key) => /^(authorization|cookie)$/i.test(key)))
    throw Error("Invalid storage upload headers.");
  const response = await source.put(
    signed.uploadUrl,
    { "Content-Type": contentType, ...signed.headers },
    signal
  );
  current();
  if (!response.ok) throw Error(`Video upload failed with HTTP ${response.status}`);
  const confirmation: MediaConfirmation = {
    storageKey: signed.storageKey,
    kind: "ai_reference_video",
    contentType,
    scope: { storyProjectId: scope.projectId },
  };
  beforeConfirm(confirmation);
  current();
  return confirmMobileMediaUpload(confirmation, signal);
}
