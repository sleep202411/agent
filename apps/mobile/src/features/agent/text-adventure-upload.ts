import type { UploadKind } from "@repo/shared/media-upload";
import * as DocumentPicker from "expo-document-picker";
import { z } from "zod";
import { getAuthGeneration } from "@/auth/auth-store";
import { uploadMobileMediaFile, type MediaConfirmation } from "@/lib/media-upload";
const docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const images = ["image/jpeg", "image/png", "image/webp"];
const music = ["audio/mpeg", "audio/wav", "audio/x-wav"];
const types = ["document", "poster", "still", "music"] as const;
export type TextAdventureUploadTarget = (typeof types)[number];
const policies = {
  document: { kind: "agent_attachment_document", maxBytes: 10 * 1024 * 1024, mime: [docx] },
  poster: { kind: "episode_cover", maxBytes: 20 * 1024 * 1024, mime: images },
  still: { kind: "ai_reference_image", maxBytes: 30 * 1024 * 1024, mime: images },
  music: { kind: "story_music_audio", maxBytes: 50 * 1024 * 1024, mime: music },
} satisfies Record<
  TextAdventureUploadTarget,
  { kind: UploadKind; maxBytes: number; mime: string[] }
>;
export function textAdventureUploadFile(
  target: TextAdventureUploadTarget,
  asset: DocumentPicker.DocumentPickerAsset
) {
  z.enum(types).parse(target);
  const policy = policies[target];
  const name = asset.name.trim();
  if (!name || !asset.uri) throw new Error("The selected file is unavailable.");
  let type = (asset.file?.type || asset.mimeType || "").toLowerCase();
  if (target === "document") {
    if (!name.toLowerCase().endsWith(".docx")) throw new Error("Select a DOCX worldview document.");
    if (
      !type ||
      ["application/octet-stream", "application/zip", "application/x-zip-compressed"].includes(type)
    )
      type = docx;
  }
  if (target === "music" && (!type || type === "application/octet-stream")) {
    if (/\.mp3$/i.test(name)) type = "audio/mpeg";
    if (/\.wav$/i.test(name)) type = "audio/wav";
  }
  if (!policy.mime.includes(type))
    throw new Error("The selected file type is not supported for this field.");
  const size = asset.file?.size ?? asset.size;
  if (size !== undefined && (!Number.isSafeInteger(size) || size <= 0 || size > policy.maxBytes))
    throw new Error(`Select a non-empty file no larger than ${policy.maxBytes / 1024 / 1024} MiB.`);
  return { file: { uri: asset.uri, name, type, size }, policy };
}
export async function pickAndUploadTextAdventureMedia(
  target: TextAdventureUploadTarget,
  generation: number,
  signal: AbortSignal,
  beforeConfirm?: (confirmation: MediaConfirmation) => void
) {
  const current = () => {
    signal.throwIfAborted();
    if (generation !== getAuthGeneration())
      throw new Error("Text adventure upload account changed.");
  };
  current();
  z.enum(types).parse(target);
  const selected = await DocumentPicker.getDocumentAsync({
    type: policies[target].mime,
    multiple: false,
    copyToCacheDirectory: true,
    base64: false,
  });
  current();
  if (selected.canceled) return null;
  if (selected.assets.length !== 1) throw new Error("Select one file at a time.");
  const { file, policy } = textAdventureUploadFile(target, selected.assets[0]!);
  const result = await uploadMobileMediaFile(file, {
    kind: policy.kind,
    maxBytes: policy.maxBytes,
    signal,
    beforeConfirm,
  });
  current();
  const receipt = z
    .object({
      mediaAssetId: z.string().uuid(),
      url: z
        .string()
        .url()
        .refine((value) => {
          const url = new URL(value);
          return url.protocol === "https:" && !url.username && !url.password;
        }),
    })
    .parse(result);
  return { ...receipt, name: file.name };
}
