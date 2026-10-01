import { z } from "zod";
import * as DocumentPicker from "expo-document-picker";
import type { AiObjectSchema, MediaRefSnapshot } from "@repo/shared";
import { api } from "@/lib/api-client";
import { selectedMedia } from "@/features/ip-author/selected-media";
import { generationSession } from "./jobs-api";
import { referenceCheckpoint, type ReferenceCheckpoint } from "./reference-image";
import { probeReferenceAudio } from "./reference-audio-metadata";
import { referenceValues, validateReferenceMedia } from "./reference-validation";
import { fieldDescriptors, type AiFieldDescriptor } from "./schema";
export function acceptsReferenceAudio(field: AiFieldDescriptor) {
  const supported =
    field.field.type === "string" ||
    (field.field.type === "array" &&
      (field.field.items.type === "string" ||
        (field.field.items.type === "object" &&
          field.field.items.properties.url?.type === "string")));
  return (
    supported &&
    (field.ui.control === "audio_upload" ||
      field.ui.accept?.split(",").some((type) => type.trim().startsWith("audio/")) === true)
  );
}
export async function pickReferenceAudio(
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
  if (!descriptor || !descriptor.enabled || !acceptsReferenceAudio(descriptor))
    throw new Error("This audio input is not available.");
  const picked = await DocumentPicker.getDocumentAsync({
    type: ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave"],
    multiple: false,
    copyToCacheDirectory: true,
    base64: false,
  });
  generationSession(generation, signal);
  if (picked.canceled) return null;
  const file = picked.assets[0];
  if (picked.assets.length !== 1 || !file?.uri || !file.name.trim())
    throw new Error("Select one reference audio file.");
  const rawType = (file.file?.type || file.mimeType)?.toLowerCase();
  const reported = rawType
    ? ((
        {
          "audio/mp3": "audio/mpeg",
          "audio/x-wav": "audio/wav",
          "audio/wave": "audio/wav",
        } as Record<string, string>
      )[rawType] ?? rawType)
    : undefined;
  const contentType = z
    .enum(["audio/mpeg", "audio/wav", "audio/x-wav"])
    .parse(
      reported && reported !== "application/octet-stream"
        ? reported
        : ({ mp3: "audio/mpeg", wav: "audio/wav" } as Record<string, string>)[
            file.name.split(".").pop()?.toLowerCase() ?? ""
          ]
    );
  const ui = descriptor.ui as unknown as Record<string, unknown>;
  const accepted = typeof ui.accept === "string" ? ui.accept.split(",").map((v) => v.trim()) : [];
  if (
    accepted.length &&
    !accepted.includes(contentType) &&
    !accepted.includes("audio/*") &&
    !accepted.includes("*/*")
  )
    throw new Error("This audio format is not supported by the selected model.");
  if (
    Array.isArray(ui.acceptFormats) &&
    ui.acceptFormats.length &&
    !ui.acceptFormats.includes(contentType === "audio/mpeg" ? "mp3" : "wav")
  )
    throw new Error("This audio format is not supported by the selected model.");
  const selected = await selectedMedia(file.uri, signal);
  generationSession(generation, signal);
  if (!Number.isSafeInteger(selected.size) || selected.size <= 0 || selected.size > 15 * 1024 ** 2)
    throw new Error("Select a non-empty MP3 or WAV audio up to 15 MiB.");
  const facts = await probeReferenceAudio(file, signal);
  generationSession(generation, signal);
  const input = referenceValues(schema, values),
    candidate = { url: "https://pending.invalid/audio", ...facts, bytes: selected.size };
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
          kind: "ai_reference_audio",
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
  if (!response.ok) throw new Error(`Reference audio upload failed: HTTP ${response.status}`);
  const value = referenceCheckpoint.parse({
    field,
    multiple,
    objectItems: descriptor.field.type === "array" && descriptor.field.items.type === "object",
    fileName: file.name,
    storageKey: signed.storageKey,
    kind: "ai_reference_audio",
    contentType,
    ...facts,
    bytes: selected.size,
  });
  checkpoint(value);
  return value;
}
