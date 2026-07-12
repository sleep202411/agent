import { z } from "zod";

export const JINLING_ASSET_MANIFEST_SCHEMA_VERSION = 1 as const;

export const AssetStatusSchema = z.enum([
  "DRAFT",
  "REVIEWED",
  "LOCKED",
  "GENERATING",
  "REVIEW",
  "APPROVED",
  "REJECTED",
]);
export type AssetStatus = z.infer<typeof AssetStatusSchema>;

export const AssetKindSchema = z.enum([
  "IMAGE",
  "VIDEO",
  "AUDIO",
  "MODEL",
  "TEXTURE",
  "DATA",
  "SUBTITLE",
  "POSTER",
]);
export type AssetKind = z.infer<typeof AssetKindSchema>;

export const SubmissionStateSchema = z.enum(["BLOCKED", "REFERENCE_TRIAL", "FORMAL_READY"]);
export type SubmissionState = z.infer<typeof SubmissionStateSchema>;

const stableId = z
  .string()
  .trim()
  .regex(/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/, "Asset identifiers must be stable uppercase kebab ids");
const nonEmptyString = z.string().trim().min(1);
const positiveInteger = z.number().int().positive();

const uniqueStableIds = z
  .array(stableId)
  .refine((ids) => new Set(ids).size === ids.length, "Identifiers must be unique");

const AspectRatioSchema = z.enum(["1:1", "4:3", "3:4", "16:9", "9:16"]);

const DimensionsSchema = z
  .object({
    width: positiveInteger,
    height: positiveInteger,
  })
  .strict();

const PromptSchema = z
  .object({
    positive: nonEmptyString,
    negative: z.array(nonEmptyString).min(1),
    script: nonEmptyString.optional(),
    referenceAssetIds: uniqueStableIds.default([]),
  })
  .strict();

const SeedreamSourceSchema = z
  .object({
    strategy: z.literal("seedream"),
    provider: z.literal("byteplus-modelark"),
    model: z.enum(["seedream-5-pro", "seedream-5-lite"]),
    providerModelId: z.enum(["seedream-5-0-pro-260628", "seedream-5-0-lite-260128"]),
    endpointId: nonEmptyString,
    mode: z.enum(["text-to-image", "reference-edit"]),
    enabledEnv: z.literal("BYTEPLUS_MODELARK_ENABLED"),
    credentialEnv: z.literal("BYTEPLUS_MODELARK_API_KEY"),
    baseUrlEnv: z.literal("BYTEPLUS_MODELARK_API_BASE_URL"),
    orchestration: z
      .object({
        route: z.literal("fizzdragon-cloud-job"),
        publicBaseUrl: z.literal("https://studio.fizzdragon.com"),
        authEnv: z.literal("FIZZDRAGON_SATOKEN"),
        workspaceEnv: z.literal("FIZZDRAGON_WORKSPACE_ID"),
        catalogModelId: z.literal("seedream-5-pro"),
        schemaVersion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        imageSize: AspectRatioSchema,
        resolution: z.enum(["1K", "2K"]),
        sourceSurface: z.literal("jinling-production"),
      })
      .strict(),
    generationParams: z
      .object({
        requestSizeMode: z.literal("exact-pixels"),
        width: positiveInteger,
        height: positiveInteger,
        size: z.string().regex(/^\d+x\d+$/, "Exact Seedream size must use WIDTHxHEIGHT"),
        resolutionTier: z.enum(["1K", "2K"]),
        outputFormat: z.enum(["png", "jpeg"]),
        watermark: z.literal(false),
        outputRole: z.enum(["reference-trial", "formal-master"]),
        derivation: z
          .object({
            purpose: z.literal("review-only"),
            method: z.literal("lanczos3"),
            sourceDimensions: DimensionsSchema,
            targetDimensions: DimensionsSchema,
          })
          .strict()
          .optional(),
      })
      .strict(),
  })
  .strict();

const SeedanceSourceSchema = z
  .object({
    strategy: z.literal("seedance"),
    provider: z.literal("byteplus-modelark"),
    model: z.literal("seedance-2.0"),
    endpointId: nonEmptyString,
    mode: z.enum([
      "text-to-video",
      "image-to-video",
      "first-last-frame-to-video",
      "multimodal-to-video",
    ]),
    enabledEnv: z.literal("BYTEPLUS_MODELARK_ENABLED"),
    credentialEnv: z.literal("BYTEPLUS_MODELARK_API_KEY"),
    baseUrlEnv: z.literal("BYTEPLUS_MODELARK_API_BASE_URL"),
    generationParams: z
      .object({
        resolution: z.enum(["720p", "1080p"]),
        ratio: AspectRatioSchema,
        durationSeconds: z.number().int().min(4).max(15),
        generateAudio: z.boolean(),
        watermark: z.boolean(),
        outputRole: z.enum(["reference-trial", "formal-master"]),
      })
      .strict(),
  })
  .strict();

const SeedAudioSourceSchema = z
  .object({
    strategy: z.literal("seedaudio"),
    model: nonEmptyString,
    task: z.enum(["voice", "sound-effect", "ambience", "music"]),
    credentialEnv: z.literal("SEED_AUDIO_API_KEY"),
    baseUrlEnv: z.literal("SEED_AUDIO_BASE_URL"),
    voiceProfileId: nonEmptyString.optional(),
  })
  .strict();

const DccSourceSchema = z
  .object({
    strategy: z.literal("dcc"),
    tool: z.enum(["blender", "maya", "houdini", "substance"]),
    sourceFile: nonEmptyString,
  })
  .strict();

const CodeSourceSchema = z
  .object({
    strategy: z.literal("code"),
    generator: nonEmptyString,
  })
  .strict();

export const AssetSourceSchema = z
  .discriminatedUnion("strategy", [
    SeedreamSourceSchema,
    SeedanceSourceSchema,
    SeedAudioSourceSchema,
    DccSourceSchema,
    CodeSourceSchema,
  ])
  .superRefine((source, context) => {
    if (source.strategy !== "seedream") return;
    const expectedEndpoint =
      source.model === "seedream-5-pro"
        ? "dola-seedream-5-0-pro-260628"
        : "seedream-5-0-lite-260128";
    const expectedProviderModelId =
      source.model === "seedream-5-pro" ? "seedream-5-0-pro-260628" : "seedream-5-0-lite-260128";
    if (source.endpointId !== expectedEndpoint) {
      context.addIssue({
        code: "custom",
        path: ["endpointId"],
        message: `${source.model} must use reviewed endpoint ${expectedEndpoint}`,
      });
    }
    if (source.providerModelId !== expectedProviderModelId) {
      context.addIssue({
        code: "custom",
        path: ["providerModelId"],
        message: `${source.model} must use official model-list id ${expectedProviderModelId}`,
      });
    }
  });
export type AssetSource = z.infer<typeof AssetSourceSchema>;

const DurationRangeSchema = z
  .object({
    min: z.number().positive(),
    max: z.number().positive(),
  })
  .strict()
  .refine((duration) => duration.max >= duration.min, {
    message: "Maximum duration must be greater than or equal to minimum duration",
    path: ["max"],
  });

const ImageDeliverySchema = z
  .object({
    type: z.literal("image"),
    width: positiveInteger,
    height: positiveInteger,
    aspectRatio: AspectRatioSchema,
    format: z.enum(["png", "webp", "jpg"]),
    colorSpace: z.literal("srgb"),
    alpha: z.boolean(),
  })
  .strict();

const VideoDeliverySchema = z
  .object({
    type: z.literal("video"),
    width: positiveInteger,
    height: positiveInteger,
    aspectRatio: AspectRatioSchema,
    framesPerSecond: z
      .object({
        numerator: positiveInteger,
        denominator: positiveInteger,
      })
      .strict(),
    frameCount: positiveInteger,
    durationSeconds: DurationRangeSchema,
    container: z.literal("mp4"),
    videoCodec: z.enum(["h264", "h265"]),
    audio: z.boolean(),
  })
  .strict();

const AudioDeliverySchema = z
  .object({
    type: z.literal("audio"),
    sampleRateHz: z.literal(48000),
    bitDepth: z.literal(24),
    channels: z.union([z.literal(1), z.literal(2)]),
    format: z.literal("wav"),
    durationSeconds: DurationRangeSchema,
    loop: z.boolean(),
  })
  .strict();

const ModelDeliverySchema = z
  .object({
    type: z.literal("model"),
    format: z.literal("glb"),
    unit: z.literal("meter"),
    requiredNodes: z.array(nonEmptyString).min(1),
    requiredAnimations: z.array(nonEmptyString).min(1),
  })
  .strict();

const DataDeliverySchema = z
  .object({
    type: z.literal("data"),
    format: z.enum(["json", "svg", "vtt"]),
  })
  .strict();

export const AssetDeliverySchema = z
  .discriminatedUnion("type", [
    ImageDeliverySchema,
    VideoDeliverySchema,
    AudioDeliverySchema,
    ModelDeliverySchema,
    DataDeliverySchema,
  ])
  .superRefine((delivery, context) => {
    if (delivery.type === "image" || delivery.type === "video") {
      const [ratioWidth, ratioHeight] = delivery.aspectRatio.split(":").map(Number);
      const declaredRatio = ratioWidth / ratioHeight;
      const deliveredRatio = delivery.width / delivery.height;
      if (Math.abs(declaredRatio - deliveredRatio) > 0.001) {
        context.addIssue({
          code: "custom",
          path: ["aspectRatio"],
          message: `${delivery.width}x${delivery.height} does not match ${delivery.aspectRatio}`,
        });
      }
    }

    if (delivery.type === "video") {
      const framesPerSecond =
        delivery.framesPerSecond.numerator / delivery.framesPerSecond.denominator;
      const minimumFrames = Math.ceil(delivery.durationSeconds.min * framesPerSecond);
      const maximumFrames = Math.floor(delivery.durationSeconds.max * framesPerSecond);
      if (delivery.frameCount < minimumFrames || delivery.frameCount > maximumFrames) {
        context.addIssue({
          code: "custom",
          path: ["frameCount"],
          message: `Frame count ${delivery.frameCount} falls outside the declared duration range`,
        });
      }
    }
  });
export type AssetDelivery = z.infer<typeof AssetDeliverySchema>;

const AssetReferenceSchema = z
  .object({
    assetId: stableId,
    path: nonEmptyString,
    role: nonEmptyString,
  })
  .strict();

const SubmissionSchema = z
  .object({
    state: SubmissionStateSchema,
    blockers: z.array(nonEmptyString).default([]),
  })
  .strict()
  .superRefine((submission, context) => {
    if (submission.state === "BLOCKED" && submission.blockers.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["blockers"],
        message: "Blocked assets must record at least one blocker",
      });
    }
    if (submission.state === "FORMAL_READY" && submission.blockers.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["blockers"],
        message: "Formally submittable assets cannot retain blockers",
      });
    }
  });

export const ManifestAssetSchema = z
  .object({
    assetId: stableId,
    taskId: stableId,
    sceneId: stableId,
    shotId: stableId.optional(),
    kind: AssetKindSchema,
    status: AssetStatusSchema,
    purpose: nonEmptyString,
    source: AssetSourceSchema,
    prompt: PromptSchema.optional(),
    dependsOn: uniqueStableIds.default([]),
    references: z.array(AssetReferenceSchema).default([]),
    submission: SubmissionSchema,
    delivery: AssetDeliverySchema,
    output: z
      .object({
        publicPath: z.string().startsWith("/jinling-rumeng/production/"),
        recordPath: z.string().startsWith("production/records/"),
      })
      .strict(),
    acceptance: z.array(nonEmptyString).min(1),
    rejection: z.array(nonEmptyString).min(1),
  })
  .strict()
  .superRefine((asset, context) => {
    const deliveryByKind: Record<AssetKind, ReadonlyArray<AssetDelivery["type"]>> = {
      IMAGE: ["image"],
      VIDEO: ["video"],
      AUDIO: ["audio"],
      MODEL: ["model"],
      TEXTURE: ["image", "data"],
      DATA: ["data"],
      SUBTITLE: ["data"],
      POSTER: ["image"],
    };

    if (!deliveryByKind[asset.kind].includes(asset.delivery.type)) {
      context.addIssue({
        code: "custom",
        path: ["delivery", "type"],
        message: `${asset.kind} assets cannot use ${asset.delivery.type} delivery`,
      });
    }
    if (
      asset.kind === "TEXTURE" &&
      asset.delivery.type === "data" &&
      asset.delivery.format !== "svg"
    ) {
      context.addIssue({
        code: "custom",
        path: ["delivery", "format"],
        message: "Texture data delivery is reserved for controlled SVG sources",
      });
    }
    if (
      asset.kind === "SUBTITLE" &&
      asset.delivery.type === "data" &&
      asset.delivery.format !== "vtt"
    ) {
      context.addIssue({
        code: "custom",
        path: ["delivery", "format"],
        message: "Subtitle delivery must use VTT",
      });
    }

    const providerGenerated = ["seedream", "seedance", "seedaudio"].includes(asset.source.strategy);
    if (providerGenerated && !asset.prompt) {
      context.addIssue({
        code: "custom",
        path: ["prompt"],
        message: `${asset.source.strategy} assets require a versioned prompt`,
      });
    }

    const referenceIds = new Set(asset.references.map((reference) => reference.assetId));
    asset.prompt?.referenceAssetIds.forEach((referenceId) => {
      if (!referenceIds.has(referenceId)) {
        context.addIssue({
          code: "custom",
          path: ["references"],
          message: `Prompt reference ${referenceId} requires an explicit reference path record`,
        });
      }
    });

    if (asset.status === "DRAFT" && asset.submission.state !== "BLOCKED") {
      context.addIssue({
        code: "custom",
        path: ["submission", "state"],
        message: "Draft assets must remain blocked from submission",
      });
    }
    if (asset.submission.state === "REFERENCE_TRIAL") {
      if (asset.status !== "REVIEW") {
        context.addIssue({
          code: "custom",
          path: ["status"],
          message: "Reference trials must be in REVIEW",
        });
      }
      const supportedTrial =
        (asset.kind === "IMAGE" && asset.source.strategy === "seedream") ||
        (asset.kind === "VIDEO" && asset.source.strategy === "seedance");
      if (!supportedTrial) {
        context.addIssue({
          code: "custom",
          path: ["submission", "state"],
          message: "Reference trials are limited to Seedream images and Seedance videos",
        });
      }
      if (
        (asset.source.strategy === "seedream" || asset.source.strategy === "seedance") &&
        asset.source.generationParams.outputRole !== "reference-trial"
      ) {
        context.addIssue({
          code: "custom",
          path: ["source", "generationParams", "outputRole"],
          message: "Reference-trial assets must declare reference-trial provider output",
        });
      }
    }
    if (asset.submission.state === "FORMAL_READY" && asset.status !== "LOCKED") {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "Formal submission requires a LOCKED asset",
      });
    }
    if (asset.source.strategy === "seedream" && asset.delivery.type === "image") {
      const params = asset.source.generationParams;
      if (params.size !== `${params.width}x${params.height}`) {
        context.addIssue({
          code: "custom",
          path: ["source", "generationParams", "size"],
          message: "Seedream exact-pixel size must match its request dimensions",
        });
      }

      const requestRatio = params.width / params.height;
      const deliveryRatio = asset.delivery.width / asset.delivery.height;
      if (Math.abs(requestRatio - deliveryRatio) > 0.001) {
        context.addIssue({
          code: "custom",
          path: ["source", "generationParams"],
          message: "Seedream request and formal delivery must keep the same aspect ratio",
        });
      }

      const requestMatchesDelivery =
        params.width === asset.delivery.width && params.height === asset.delivery.height;
      const derivation = params.derivation;
      if (!requestMatchesDelivery && !derivation) {
        context.addIssue({
          code: "custom",
          path: ["source", "generationParams", "derivation"],
          message: "A differing formal delivery requires an explicit derivation",
        });
      }
      if (derivation) {
        const sourceMatchesRequest =
          derivation.sourceDimensions.width === params.width &&
          derivation.sourceDimensions.height === params.height;
        const targetMatchesDelivery =
          derivation.targetDimensions.width === asset.delivery.width &&
          derivation.targetDimensions.height === asset.delivery.height;
        if (!sourceMatchesRequest || !targetMatchesDelivery) {
          context.addIssue({
            code: "custom",
            path: ["source", "generationParams", "derivation"],
            message: "Derivation dimensions must connect the provider request to formal delivery",
          });
        }
        if (
          derivation.targetDimensions.width < derivation.sourceDimensions.width ||
          derivation.targetDimensions.height < derivation.sourceDimensions.height
        ) {
          context.addIssue({
            code: "custom",
            path: ["source", "generationParams", "derivation"],
            message: "The reviewed Lanczos3 derivation cannot downscale an asset",
          });
        }
        if (asset.submission.state === "FORMAL_READY" || params.outputRole === "formal-master") {
          context.addIssue({
            code: "custom",
            path: ["source", "generationParams", "derivation", "purpose"],
            message: "A review-only derivation cannot be treated as FORMAL_READY",
          });
        }
      }

      if (asset.source.model === "seedream-5-pro") {
        const requestPixels = params.width * params.height;
        if (requestPixels < 921_600 || requestPixels > 4_624_220) {
          context.addIssue({
            code: "custom",
            path: ["source", "generationParams"],
            message: "Seedream 5 Pro exact request must contain 921,600–4,624,220 pixels",
          });
        }
        if (params.width % 16 !== 0 || params.height % 16 !== 0) {
          context.addIssue({
            code: "custom",
            path: ["source", "generationParams"],
            message: "Seedream 5 Pro exact dimensions must be multiples of 16",
          });
        }
      }

      const deliveryOutputFormat = asset.delivery.format === "jpg" ? "jpeg" : asset.delivery.format;
      if (params.outputFormat !== deliveryOutputFormat) {
        context.addIssue({
          code: "custom",
          path: ["source", "generationParams", "outputFormat"],
          message: "Seedream output format must match the declared image delivery",
        });
      }
    }
    if (asset.source.strategy === "seedance" && asset.delivery.type === "video") {
      const params = asset.source.generationParams;
      if (asset.sceneId === "S01-P00" && (params.generateAudio || asset.delivery.audio)) {
        context.addIssue({
          code: "custom",
          path: ["source", "generationParams", "generateAudio"],
          message: "P00 Seedance assets must keep final audio in independent tracks",
        });
      }
      if (params.ratio !== asset.delivery.aspectRatio) {
        context.addIssue({
          code: "custom",
          path: ["source", "generationParams", "ratio"],
          message: "Seedance request ratio must match the declared video delivery",
        });
      }
      if (
        params.durationSeconds < asset.delivery.durationSeconds.min ||
        params.durationSeconds > asset.delivery.durationSeconds.max
      ) {
        context.addIssue({
          code: "custom",
          path: ["source", "generationParams", "durationSeconds"],
          message: "Seedance request duration must fit the declared delivery range",
        });
      }
      if (params.generateAudio !== asset.delivery.audio) {
        context.addIssue({
          code: "custom",
          path: ["source", "generationParams", "generateAudio"],
          message: "Seedance generated-audio request must match the delivery audio contract",
        });
      }
      const longEdge = Math.max(asset.delivery.width, asset.delivery.height);
      const expectedLongEdge = params.resolution === "1080p" ? 1920 : 1280;
      if (longEdge !== expectedLongEdge) {
        context.addIssue({
          code: "custom",
          path: ["delivery"],
          message: `${params.resolution} Seedance delivery requires a ${expectedLongEdge}px long edge`,
        });
      }
      const referenceCount = asset.prompt?.referenceAssetIds.length ?? 0;
      if (asset.source.mode === "text-to-video" && referenceCount > 0) {
        context.addIssue({
          code: "custom",
          path: ["prompt", "referenceAssetIds"],
          message: "Seedance text-to-video cannot declare media references",
        });
      }
      if (asset.source.mode !== "text-to-video" && referenceCount === 0) {
        context.addIssue({
          code: "custom",
          path: ["prompt", "referenceAssetIds"],
          message: `${asset.source.mode} requires at least one controlled media reference`,
        });
      }
      if (asset.source.mode === "image-to-video" && referenceCount !== 1) {
        context.addIssue({
          code: "custom",
          path: ["prompt", "referenceAssetIds"],
          message: "Seedance image-to-video requires exactly one first-frame reference",
        });
      }
      if (asset.source.mode === "first-last-frame-to-video" && referenceCount !== 2) {
        context.addIssue({
          code: "custom",
          path: ["prompt", "referenceAssetIds"],
          message: "Seedance first-last-frame-to-video requires exactly two ordered references",
        });
      }
    }
  });
export type ManifestAsset = z.infer<typeof ManifestAssetSchema>;

export const JinlingAssetManifestSchema = z
  .object({
    schemaVersion: z.literal(JINLING_ASSET_MANIFEST_SCHEMA_VERSION),
    manifestId: stableId,
    gameId: z.literal("jinling-rumeng"),
    releaseId: nonEmptyString,
    contentVersion: nonEmptyString,
    sceneId: stableId,
    productionCardId: stableId,
    status: AssetStatusSchema,
    promptVersion: nonEmptyString,
    authoredAt: z.string().datetime({ offset: true }),
    taskIds: uniqueStableIds.min(1),
    assets: z.array(ManifestAssetSchema).min(1),
  })
  .strict()
  .superRefine((manifest, context) => {
    const taskIds = new Set(manifest.taskIds);
    const assetIds = new Set<string>();
    const publicPaths = new Set<string>();
    const recordPaths = new Set<string>();

    manifest.assets.forEach((asset, index) => {
      if (asset.sceneId !== manifest.sceneId) {
        context.addIssue({
          code: "custom",
          path: ["assets", index, "sceneId"],
          message: `Asset scene ${asset.sceneId} does not match manifest scene ${manifest.sceneId}`,
        });
      }
      if (!taskIds.has(asset.taskId)) {
        context.addIssue({
          code: "custom",
          path: ["assets", index, "taskId"],
          message: `Unknown production task ${asset.taskId}`,
        });
      }
      if (assetIds.has(asset.assetId)) {
        context.addIssue({
          code: "custom",
          path: ["assets", index, "assetId"],
          message: `Duplicate asset id ${asset.assetId}`,
        });
      }
      assetIds.add(asset.assetId);
      if (publicPaths.has(asset.output.publicPath)) {
        context.addIssue({
          code: "custom",
          path: ["assets", index, "output", "publicPath"],
          message: `Duplicate public output ${asset.output.publicPath}`,
        });
      }
      publicPaths.add(asset.output.publicPath);
      if (recordPaths.has(asset.output.recordPath)) {
        context.addIssue({
          code: "custom",
          path: ["assets", index, "output", "recordPath"],
          message: `Duplicate production record ${asset.output.recordPath}`,
        });
      }
      recordPaths.add(asset.output.recordPath);
      if (manifest.status === "DRAFT" && asset.submission.state === "FORMAL_READY") {
        context.addIssue({
          code: "custom",
          path: ["assets", index, "submission", "state"],
          message: "A draft manifest cannot contain formally submittable assets",
        });
      }
    });

    const assetMap = new Map(manifest.assets.map((asset) => [asset.assetId, asset]));
    manifest.assets.forEach((asset, index) => {
      asset.dependsOn.forEach((dependency) => {
        if (!assetMap.has(dependency)) {
          context.addIssue({
            code: "custom",
            path: ["assets", index, "dependsOn"],
            message: `Unknown dependency ${dependency}`,
          });
        }
        if (dependency === asset.assetId) {
          context.addIssue({
            code: "custom",
            path: ["assets", index, "dependsOn"],
            message: "An asset cannot depend on itself",
          });
        }
      });
      asset.prompt?.referenceAssetIds.forEach((referenceId) => {
        if (assetMap.has(referenceId) && !asset.dependsOn.includes(referenceId)) {
          context.addIssue({
            code: "custom",
            path: ["assets", index, "dependsOn"],
            message: `Manifest reference ${referenceId} must also be a dependency`,
          });
        }
      });
    });

    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (assetId: string): boolean => {
      if (visiting.has(assetId)) return true;
      if (visited.has(assetId)) return false;
      visiting.add(assetId);
      const asset = assetMap.get(assetId);
      const cyclic = asset?.dependsOn.some((dependency) => visit(dependency)) ?? false;
      visiting.delete(assetId);
      visited.add(assetId);
      return cyclic;
    };
    for (const asset of manifest.assets) {
      if (visit(asset.assetId)) {
        context.addIssue({
          code: "custom",
          path: ["assets"],
          message: `Asset dependency graph contains a cycle at ${asset.assetId}`,
        });
        break;
      }
    }
  });

export type JinlingAssetManifest = z.infer<typeof JinlingAssetManifestSchema>;

export function parseJinlingAssetManifest(input: unknown): JinlingAssetManifest {
  return JinlingAssetManifestSchema.parse(input);
}
