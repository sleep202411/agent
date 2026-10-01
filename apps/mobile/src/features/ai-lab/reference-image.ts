import { z } from "zod";
import * as DocumentPicker from "expo-document-picker";
import { api } from "@/lib/api-client";
import { selectedMedia } from "@/features/ip-author/selected-media";
import { generationSession } from "./jobs-api";
export const referenceCheckpoint = z.object({
  field: z.string().min(1),
  multiple: z.boolean(),
  fileName: z.string().min(1),
  storageKey: z.string().min(1),
  kind: z.literal("ai_reference_image"),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
});
export type ReferenceCheckpoint = z.infer<typeof referenceCheckpoint>;
const secureUrl = z
  .string()
  .url()
  .refine((value) => {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password;
  });
export async function pickReferenceImage(
  field: string,
  multiple: boolean,
  generation: number,
  signal: AbortSignal,
  checkpoint: (value: ReferenceCheckpoint) => void
) {
  z.string().min(1).parse(field);
  generationSession(generation, signal);
  const picked = await DocumentPicker.getDocumentAsync({
    type: ["image/jpeg", "image/png", "image/webp"],
    multiple: false,
    copyToCacheDirectory: true,
    base64: false,
  });
  generationSession(generation, signal);
  if (picked.canceled) return null;
  const file = picked.assets[0];
  if (picked.assets.length !== 1 || !file?.uri || !file.name.trim())
    throw new Error("Select one reference image.");
  const reported = file.file?.type || file.mimeType;
  const extensions: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
  };
  const contentType = z
    .enum(["image/jpeg", "image/png", "image/webp"])
    .parse(
      reported && reported !== "application/octet-stream"
        ? reported
        : extensions[file.name.split(".").pop()?.toLowerCase() ?? ""]
    );
  const selected = await selectedMedia(file.uri, signal);
  generationSession(generation, signal);
  if (!Number.isSafeInteger(selected.size) || selected.size <= 0 || selected.size > 30 * 1024 ** 2)
    throw new Error("Select a non-empty JPEG, PNG or WebP image up to 30 MiB.");
  const signed = z
    .object({
      uploadUrl: secureUrl,
      method: z.literal("PUT"),
      headers: z.record(z.string(), z.string()),
      storageKey: z.string().min(1),
    })
    .parse(
      await api.post("/media/upload-url", {
        service: "aurora",
        signal,
        retry: false,
        data: {
          kind: "ai_reference_image",
          contentType,
          fileName: file.name,
          sizeBytes: selected.size,
        },
      })
    );
  generationSession(generation, signal);
  if (
    Object.keys(signed.headers).some((key) =>
      /^(authorization|cookie|proxy-authorization)$/i.test(key)
    )
  )
    throw new Error("Storage upload must not include login credentials.");
  const response = await selected.put(
    signed.uploadUrl,
    { "Content-Type": contentType, ...signed.headers },
    signal
  );
  generationSession(generation, signal);
  if (!response.ok) throw new Error(`Reference image upload failed: HTTP ${response.status}`);
  const value = referenceCheckpoint.parse({
    field,
    multiple,
    fileName: file.name,
    storageKey: signed.storageKey,
    kind: "ai_reference_image",
    contentType,
  });
  checkpoint(value);
  return value;
}
export async function confirmReferenceImage(
  input: ReferenceCheckpoint,
  generation: number,
  signal: AbortSignal
) {
  generationSession(generation, signal);
  const value = referenceCheckpoint.parse(input);
  const receipt = z
    .object({ mediaAssetId: z.string().uuid(), storageKey: z.string().min(1), url: secureUrl })
    .parse(
      await api.post("/media/confirm", {
        service: "aurora",
        signal,
        retry: false,
        data: { storageKey: value.storageKey, kind: value.kind, contentType: value.contentType },
      })
    );
  generationSession(generation, signal);
  // Reference-image confirmation promotes staging to the verified final key.
  // The returned key is deliberately different; confirmation remains idempotent.
  return receipt;
}

export function acceptsReferenceImage(field: import("./schema").AiFieldDescriptor) {
  const scalar =
    field.field.type === "string" ||
    (field.field.type === "array" && field.field.items.type === "string");
  return (
    scalar &&
    (field.ui.control === "image_upload" ||
      field.ui.accept?.split(",").some((type) => type.trim().startsWith("image/")) === true)
  );
}
