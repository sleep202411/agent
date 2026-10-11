import { z } from "zod";
import * as DocumentPicker from "expo-document-picker";
import { api } from "@/lib/api-client";
import { selectedMedia } from "./selected-media";
import { logoCheckpoint, templateSession, type LogoCheckpoint } from "./templates-api";
const secureUrl = z
  .string()
  .url()
  .refine((value) => {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password;
  });
export async function pickTemplateLogo(
  templateId: string,
  generation: number,
  signal: AbortSignal,
  checkpoint: (value: LogoCheckpoint) => void
) {
  z.string().uuid().parse(templateId);
  templateSession(generation, signal);
  const picked = await DocumentPicker.getDocumentAsync({
    type: ["image/jpeg", "image/png", "image/webp"],
    multiple: false,
    copyToCacheDirectory: true,
    base64: false,
  });
  templateSession(generation, signal);
  if (picked.canceled) return null;
  const file = picked.assets[0];
  if (picked.assets.length !== 1 || !file?.uri || !file.name.trim())
    throw new Error("Select one logo image.");
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
  templateSession(generation, signal);
  if (!Number.isSafeInteger(selected.size) || selected.size <= 0 || selected.size > 20 * 1024 ** 2)
    throw new Error("Select a non-empty JPEG, PNG or WebP image up to 20 MiB.");
  // Template save accepts owned media IDs. ip_banner is the official IP-image upload kind;
  // the Web editor's ip_logo_asset string is not accepted by UploadKindSchema.
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
        data: { kind: "ip_banner", contentType, fileName: file.name, sizeBytes: selected.size },
      })
    );
  templateSession(generation, signal);
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
  templateSession(generation, signal);
  if (!response.ok) throw new Error(`Logo upload failed: HTTP ${response.status}`);
  const value = logoCheckpoint.parse({
    templateId,
    fileName: file.name,
    storageKey: signed.storageKey,
    kind: "ip_banner",
    contentType,
  });
  checkpoint(value);
  return value;
}
export async function confirmTemplateLogo(
  input: LogoCheckpoint,
  generation: number,
  signal: AbortSignal
) {
  templateSession(generation, signal);
  const value = logoCheckpoint.parse(input);
  const receipt = z.object({ mediaAssetId: z.string().uuid(), storageKey: z.string() }).parse(
    await api.post("/media/confirm", {
      service: "aurora",
      signal,
      retry: false,
      data: { storageKey: value.storageKey, kind: value.kind, contentType: value.contentType },
    })
  );
  templateSession(generation, signal);
  if (receipt.storageKey !== value.storageKey)
    throw new Error("Logo confirmation identity mismatch.");
  return receipt.mediaAssetId;
}
