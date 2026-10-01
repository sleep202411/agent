import { z } from "zod";
import * as DocumentPicker from "expo-document-picker";
import type { AiObjectSchema, MediaRefSnapshot } from "@repo/shared";
import { api } from "@/lib/api-client";
import { selectedMedia } from "@/features/ip-author/selected-media";
import { generationSession } from "./jobs-api";
import { referenceCheckpoint, type ReferenceCheckpoint } from "./reference-image";
import { probeReferenceVideo } from "./reference-video-metadata";
import { referenceValues, validateReferenceMedia } from "./reference-validation";
import { fieldDescriptors, type AiFieldDescriptor } from "./schema";
export function acceptsReferenceVideo(field: AiFieldDescriptor) {
  const supported =
    field.field.type === "string" ||
    (field.field.type === "array" &&
      (field.field.items.type === "string" ||
        (field.field.items.type === "object" &&
          field.field.items.properties.url?.type === "string")));
  return (
    supported &&
    (field.ui.control === "video_upload" ||
      field.ui.accept?.split(",").some((type) => type.trim().startsWith("video/")) === true)
  );
}
export async function pickReferenceVideo(
  schema: AiObjectSchema,
  values: Record<string, unknown>,
  field: string,
  generation: number,
  signal: AbortSignal,
  checkpoint: (value: ReferenceCheckpoint) => void,
  media?: MediaRefSnapshot[]
) {
  generationSession(generation, signal);
  const descriptor = fieldDescriptors(schema, values).find((d) => d.name === field);
  if (!descriptor || !descriptor.enabled || !acceptsReferenceVideo(descriptor))
    throw new Error("This video input is not available.");
  const picked = await DocumentPicker.getDocumentAsync({
    type: ["video/mp4", "video/quicktime"],
    multiple: false,
    copyToCacheDirectory: true,
    base64: false,
  });
  generationSession(generation, signal);
  if (picked.canceled) return null;
  const file = picked.assets[0];
  if (picked.assets.length !== 1 || !file?.uri || !file.name.trim())
    throw new Error("Select one reference video.");
  const reported = file.file?.type || file.mimeType;
  const contentType = z
    .enum(["video/mp4", "video/quicktime"])
    .parse(
      reported && reported !== "application/octet-stream"
        ? reported
        : ({ mp4: "video/mp4", mov: "video/quicktime" } as Record<string, string>)[
            file.name.split(".").pop()?.toLowerCase() ?? ""
          ]
    );
  const ui = descriptor.ui as unknown as Record<string, unknown>;
  const accepted = typeof ui.accept === "string" ? ui.accept.split(",").map((v) => v.trim()) : [];
  if (
    accepted.length &&
    !accepted.includes(contentType) &&
    !accepted.includes("video/*") &&
    !accepted.includes("*/*")
  )
    throw new Error("This video format is not supported by the selected model.");
  if (
    Array.isArray(ui.acceptFormats) &&
    ui.acceptFormats.length &&
    !ui.acceptFormats.includes(contentType === "video/mp4" ? "mp4" : "mov")
  )
    throw new Error("This video format is not supported by the selected model.");
  const selected = await selectedMedia(file.uri, signal);
  generationSession(generation, signal);
  if (!Number.isSafeInteger(selected.size) || selected.size <= 0 || selected.size > 2 * 1024 ** 3)
    throw new Error("Select a non-empty MP4 or MOV video up to 2 GiB.");
  const facts = await probeReferenceVideo(file, signal);
  generationSession(generation, signal);
  if (ui.resolutionBand) {
    if (ui.resolutionBand !== "480p-720p")
      throw new Error("The selected model declares an unsupported video resolution constraint.");
    const pixels = facts.width * facts.height;
    if (pixels < 300_000 || pixels > 1_000_000)
      throw new Error("Reference video must be within the model's 480p–720p resolution band.");
  }
  const input = referenceValues(schema, values),
    candidate = { url: "https://pending.invalid/video", ...facts, bytes: selected.size };
  const multiple = descriptor.field.type === "array";
  input[field] = multiple
    ? [...(Array.isArray(input[field]) ? (input[field] as unknown[]) : []), candidate]
    : candidate;
  validateReferenceMedia(schema, input, media, field);
  const signed = z
    .object({
      uploadUrl: z
        .string()
        .url()
        .refine((v) => {
          const u = new URL(v);
          return u.protocol === "https:" && !u.username && !u.password;
        }),
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
          kind: "ai_reference_video",
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
  if (!response.ok) throw new Error(`Reference video upload failed: HTTP ${response.status}`);
  const value = referenceCheckpoint.parse({
    field,
    multiple,
    objectItems: descriptor.field.type === "array" && descriptor.field.items.type === "object",
    fileName: file.name,
    storageKey: signed.storageKey,
    kind: "ai_reference_video",
    contentType,
    ...facts,
    bytes: selected.size,
  });
  checkpoint(value);
  return value;
}
