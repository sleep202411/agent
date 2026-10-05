import { z } from "zod";
export const canvasUploadedAssetSchema = z
  .object({
    mediaAssetId: z.string().uuid(),
    kind: z.enum(["image", "video", "audio"]),
    url: z
      .string()
      .url()
      .refine((value) => {
        const url = new URL(value);
        return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
      }),
    name: z.string().min(1),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();
export type CanvasUploadedAsset = z.infer<typeof canvasUploadedAssetSchema>;

export const canvasUploadPolicies = {
  "image/jpeg": ["image", 30],
  "image/png": ["image", 30],
  "image/webp": ["image", 30],
  "video/mp4": ["video", 2048],
  "video/quicktime": ["video", 2048],
  "audio/mpeg": ["audio", 15],
  "audio/mp3": ["audio", 15],
  "audio/wav": ["audio", 15],
  "audio/x-wav": ["audio", 15],
  "audio/wave": ["audio", 15],
} as const;
export const canvasUploadTypes = Object.keys(canvasUploadPolicies);
export const canvasUploadCheckpointSchema = z
  .object({
    name: z.string().min(1),
    createdAt: z.number().int().nonnegative(),
    confirmation: z
      .object({
        storageKey: z.string().min(1),
        kind: z.enum(["ai_reference_image", "ai_reference_video", "ai_reference_audio"]),
        contentType: z.string().refine((value) => Object.hasOwn(canvasUploadPolicies, value)),
        scope: z.object({ storyProjectId: z.string().uuid() }).strict(),
      })
      .strict(),
  })
  .strict()
  .refine(
    (value) =>
      value.confirmation.kind ===
      `ai_reference_${canvasUploadPolicies[value.confirmation.contentType as keyof typeof canvasUploadPolicies]?.[0]}`
  );
export type CanvasUploadCheckpoint = z.infer<typeof canvasUploadCheckpointSchema>;
