import { z } from "zod/v4";
import {
  ExperienceAppearanceSchema,
  ExperienceJsonObjectSchema,
  ExperienceRuntimeManifestSchema,
} from "@repo/shared/experience-runtime";

const channel = z.string().min(1).max(128);
const revision = z.number().int().positive();
export const PreviewPlayerConfigSchema = z
  .object({
    runtime: ExperienceRuntimeManifestSchema,
    locale: z.enum(["en-US", "zh-CN", "zh-HK"]),
    frameProfile: z.enum(["landscape_16_9", "portrait_9_16"]).optional(),
    coverUrl: z.string().nullable().optional(),
    startSceneId: z.string().nullable().optional(),
  })
  .strict();
export type PreviewPlayerConfig = z.infer<typeof PreviewPlayerConfigSchema>;

export const PreviewPlayerCommandSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("fizz.preview.initialize"),
      channel,
      revision,
      config: PreviewPlayerConfigSchema,
      appearance: ExperienceAppearanceSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("fizz.preview.appearance"),
      channel,
      revision,
      appearance: ExperienceAppearanceSchema,
    })
    .strict(),
]);
export const PreviewPlayerStateSchema = z
  .object({
    values: ExperienceJsonObjectSchema,
    completedEndingIds: z.array(z.string()),
  })
  .strict();
export type PreviewPlayerState = z.infer<typeof PreviewPlayerStateSchema>;
export const PreviewPlayerEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("fizz.preview.ready"), channel }).strict(),
  z.object({ type: z.literal("fizz.preview.initialized"), channel, revision }).strict(),
  z
    .object({
      type: z.literal("fizz.preview.state"),
      channel,
      revision,
      state: PreviewPlayerStateSchema,
    })
    .strict(),
]);

/** Both the origin and the exact window must match; another same-origin frame is not this peer. */
export function isPreviewPlayerPeer(event: MessageEvent, peer: Window | null, origin: string) {
  return peer !== null && event.source === peer && event.origin === origin;
}
