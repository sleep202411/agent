import * as DocumentPicker from "expo-document-picker";
import { z } from "zod";
import { getAuthGeneration } from "@/auth/auth-store";
import { api } from "@/lib/api-client";
import { selectedMedia } from "@/features/ip-author/selected-media";
import {
  canEditPlatformProject,
  readPlatformProject,
  type PlatformProject,
} from "./platform-projects-api";
const uuid = z.string().uuid();
const secureUrl = z
  .string()
  .url()
  .refine((s) => {
    const u = new URL(s);
    return u.protocol === "https:" && !u.username && !u.password;
  });
export async function uploadPlatformProjectCover(
  project: PlatformProject,
  generation: number,
  signal: AbortSignal
) {
  const current = () => {
    signal.throwIfAborted();
    if (generation !== getAuthGeneration()) throw Error("Project upload account changed.");
  };
  current();
  const picked = await DocumentPicker.getDocumentAsync({
    type: ["image/jpeg", "image/png", "image/webp"],
    multiple: false,
    copyToCacheDirectory: true,
  });
  current();
  if (picked.canceled) return null;
  const file = picked.assets[0];
  const contentType = file?.file?.type || file?.mimeType;
  if (
    picked.assets.length !== 1 ||
    !file?.uri ||
    !file.name ||
    !["image/jpeg", "image/png", "image/webp"].includes(contentType ?? "")
  )
    throw Error("Select a JPEG, PNG or WebP image.");
  const media = await selectedMedia(file.uri, signal);
  current();
  if (!Number.isSafeInteger(media.size) || media.size <= 0 || media.size > 30 * 1024 ** 2)
    throw Error("Choose a non-empty image up to 30 MiB.");
  const fresh = await readPlatformProject(project.id, project.workspaceId, generation, signal);
  if (!canEditPlatformProject(fresh)) throw Error("Project editor permission is required.");
  if (fresh.version !== project.version) throw Error("Project changed. Refresh before uploading.");
  const config = {
    service: "aurora" as const,
    signal,
    retry: false,
    headers: { "x-fizz-workspace-id": uuid.parse(project.workspaceId) },
  };
  const signed = z
    .object({
      uploadUrl: secureUrl,
      method: z.literal("PUT"),
      headers: z.record(z.string(), z.string()),
      storageKey: z.string().min(1),
    })
    .parse(
      await api.post("/media/upload-url", {
        ...config,
        data: {
          kind: "ai_reference_image",
          contentType,
          fileName: file.name,
          sizeBytes: media.size,
        },
      })
    );
  current();
  if (
    Object.keys(signed.headers).some((key) =>
      /^(authorization|cookie|proxy-authorization)$/i.test(key)
    )
  )
    throw Error("Storage upload must not include login credentials.");
  const result = await media.put(
    signed.uploadUrl,
    { "Content-Type": contentType!, ...signed.headers },
    signal
  );
  current();
  if (!result.ok) throw Error(`Cover upload failed: HTTP ${result.status}`);
  const confirmed = z.object({ mediaAssetId: uuid }).parse(
    await api.post("/media/confirm", {
      ...config,
      data: { storageKey: signed.storageKey, kind: "ai_reference_image", contentType },
    })
  );
  current();
  return confirmed.mediaAssetId;
}
