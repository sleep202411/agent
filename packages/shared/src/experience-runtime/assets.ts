import { z } from "zod";
import {
  ExperienceLocaleSchema,
  ExperienceOrientationSchema,
  ExperienceRuntimeUriSchema,
  ExperienceSha256Schema,
  ExperienceStableIdSchema,
} from "./common.js";

const PositiveIntegerSchema = z.number().int().positive();
const MediaTypeSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i, "mediaType must be a valid MIME type");

const SourceIdentityShape = {
  variantId: ExperienceStableIdSchema,
  sourceAssetId: ExperienceStableIdSchema,
  sha256: ExperienceSha256Schema,
  uri: ExperienceRuntimeUriSchema,
  mediaType: MediaTypeSchema,
};

const VisualVariantSchema = z
  .object({
    ...SourceIdentityShape,
    orientation: ExperienceOrientationSchema,
    width: PositiveIntegerSchema,
    height: PositiveIntegerSchema,
  })
  .strict();

const VideoVariantSchema = z
  .object({
    ...SourceIdentityShape,
    sha256: ExperienceSha256Schema.optional(),
    orientation: ExperienceOrientationSchema,
    width: PositiveIntegerSchema.optional(),
    height: PositiveIntegerSchema.optional(),
    durationMs: PositiveIntegerSchema.optional(),
    framesPerSecond: z
      .object({ numerator: PositiveIntegerSchema, denominator: PositiveIntegerSchema })
      .strict()
      .optional(),
    codec: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

const AudioVariantSchema = z
  .object({
    ...SourceIdentityShape,
    locale: ExperienceLocaleSchema.optional(),
    durationMs: PositiveIntegerSchema,
    channels: PositiveIntegerSchema.max(32).optional(),
    sampleRate: PositiveIntegerSchema.optional(),
    codec: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

const OrientationPolicySchema = z.enum(["paired-required", "single-master", "responsive"]);

function validateVariantIds(
  variants: readonly { variantId: string }[],
  context: z.RefinementCtx
): void {
  const ids = new Set<string>();
  variants.forEach((variant, index) => {
    if (ids.has(variant.variantId)) {
      context.addIssue({
        code: "custom",
        path: ["variants", index, "variantId"],
        message: `Duplicate asset variant ${variant.variantId}`,
      });
    }
    ids.add(variant.variantId);
  });
}

function validateOrientationPolicy(
  asset: {
    orientationPolicy: z.infer<typeof OrientationPolicySchema>;
    variants: readonly {
      variantId: string;
      orientation: z.infer<typeof ExperienceOrientationSchema>;
    }[];
  },
  context: z.RefinementCtx
): void {
  validateVariantIds(asset.variants, context);
  const orientations = new Set(asset.variants.map((variant) => variant.orientation));
  if (orientations.size !== asset.variants.length) {
    context.addIssue({
      code: "custom",
      path: ["variants"],
      message: "Visual asset variants must use distinct orientations",
    });
  }
  if (
    asset.orientationPolicy === "paired-required" &&
    (!orientations.has("landscape") || !orientations.has("portrait"))
  ) {
    context.addIssue({
      code: "custom",
      path: ["variants"],
      message: "paired-required assets need independent landscape and portrait variants",
    });
  }
  if (asset.orientationPolicy === "single-master" && asset.variants.length !== 1) {
    context.addIssue({
      code: "custom",
      path: ["variants"],
      message: "single-master assets must provide exactly one variant",
    });
  }
}

export const ExperienceVideoAssetSchema = z
  .object({
    assetId: ExperienceStableIdSchema,
    kind: z.literal("video"),
    orientationPolicy: OrientationPolicySchema,
    variants: z.array(VideoVariantSchema).min(1),
    /**
     * RETIRED — accepted for backward compatibility, never read, never emitted.
     *
     * Nothing inspects a clip for sound any more: what the creator uploaded is
     * what plays, and the player decides mute purely from the browser's
     * autoplay verdict. The key survives ONLY because this object is `.strict()`
     * and every manifest already published to the CDN carries it. Those
     * artifacts are immutable, so deleting the key here would make every
     * existing film fail to parse and stop playing. Do not "clean this up".
     */
    audioMode: z.enum(["none", "embedded"]).optional(),
  })
  .strict()
  .superRefine(validateOrientationPolicy);

export const ExperienceImageAssetSchema = z
  .object({
    assetId: ExperienceStableIdSchema,
    kind: z.literal("image"),
    orientationPolicy: OrientationPolicySchema,
    variants: z.array(VisualVariantSchema).min(1),
  })
  .strict()
  .superRefine(validateOrientationPolicy);

export const ExperienceAudioAssetSchema = z
  .object({
    assetId: ExperienceStableIdSchema,
    kind: z.literal("audio"),
    variants: z.array(AudioVariantSchema).min(1),
  })
  .strict()
  .superRefine((asset, context) => validateVariantIds(asset.variants, context));

const SingleSourceAssetShape = {
  assetId: ExperienceStableIdSchema,
  sourceAssetId: ExperienceStableIdSchema,
  sha256: ExperienceSha256Schema,
  uri: ExperienceRuntimeUriSchema,
  mediaType: MediaTypeSchema,
};

export const ExperienceDataAssetSchema = z
  .object({
    ...SingleSourceAssetShape,
    kind: z.literal("data"),
    format: z.enum(["json", "vtt", "svg", "lottie", "tracking"]),
  })
  .strict();

export const ExperienceFontAssetSchema = z
  .object({
    ...SingleSourceAssetShape,
    kind: z.literal("font"),
    family: z.string().trim().min(1).max(120),
    weight: z.number().int().min(100).max(900),
    style: z.enum(["normal", "italic"]),
  })
  .strict();

export const ExperienceModelAssetSchema = z
  .object({
    ...SingleSourceAssetShape,
    kind: z.literal("model"),
    format: z.enum(["gltf", "glb"]),
  })
  .strict();

export const ExperienceBinaryAssetSchema = z
  .object({
    ...SingleSourceAssetShape,
    kind: z.literal("binary"),
    format: ExperienceStableIdSchema,
  })
  .strict();

export const ExperienceRuntimeAssetSchema = z.discriminatedUnion("kind", [
  ExperienceVideoAssetSchema,
  ExperienceImageAssetSchema,
  ExperienceAudioAssetSchema,
  ExperienceDataAssetSchema,
  ExperienceFontAssetSchema,
  ExperienceModelAssetSchema,
  ExperienceBinaryAssetSchema,
]);

export type ExperienceRuntimeAsset = z.infer<typeof ExperienceRuntimeAssetSchema>;
export type ExperienceVideoAsset = z.infer<typeof ExperienceVideoAssetSchema>;
export type ExperienceImageAsset = z.infer<typeof ExperienceImageAssetSchema>;
export type ExperienceAudioAsset = z.infer<typeof ExperienceAudioAssetSchema>;
