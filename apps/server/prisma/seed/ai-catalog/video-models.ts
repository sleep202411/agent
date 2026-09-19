/**
 * Declarative catalog of canonical AI video models (mirror of image-models.ts).
 *
 * One clean entry per canonical ContainerModel; no policy boilerplate (that
 * lives in defaults.ts + seed-catalog.ts). Modes are the union the model
 * supports; the studio param panel filters per selected mode. Each `providers`
 * entry seeds an AiProviderEndpoint + a runtime-valid AiProviderModelBinding
 * (modality 'video').
 */
import type { Prisma } from '@prisma/client';
import type { AiGenerationMode } from '@repo/shared';

import {
  HAPPYHORSE_VIDEO_PARAMETER_POLICY,
  HAPPYHORSE_VIDEO_PRODUCT_PRICING,
  HAPPYHORSE_1_1_VIDEO_PARAMETER_POLICY,
  HAPPYHORSE_1_1_VIDEO_PRODUCT_PRICING,
  KLING_MOTION_PARAMETER_POLICY,
  KLING_MOTION_PRODUCT_PRICING,
  MINIMAX_H3_PARAMETER_POLICY,
  MINIMAX_H3_PRODUCT_PRICING,
  QUICK_VIDEO_PARAMETER_POLICY,
  QUICK_VIDEO_PRODUCT_PRICING,
  SEEDANCE_2_0_FAST_PRODUCT_PRICING,
  SEEDANCE_2_0_MINI_PRODUCT_PRICING,
  SEEDANCE_2_0_PARAMETER_POLICY,
  SEEDANCE_2_0_PRODUCT_PRICING,
  SEEDANCE_2_0_SD_PARAMETER_POLICY,
  SEEDANCE_2_5_PARAMETER_POLICY,
  SEEDANCE_2_5_PRODUCT_PRICING,
  WAN_2_7_VIDEO_PARAMETER_POLICY,
  WAN_2_7_VIDEO_PRODUCT_PRICING,
  WAN_3_0_VIDEO_PARAMETER_POLICY,
  WAN_3_0_VIDEO_PRODUCT_PRICING,
  VEO_3_1_FAST_PRODUCT_PRICING,
  VEO_3_1_FAST_PARAMETER_POLICY,
  VEO_3_1_LITE_PARAMETER_POLICY,
  VEO_3_1_LITE_PRODUCT_PRICING,
  VEO_3_1_PARAMETER_POLICY,
  VEO_3_1_PRODUCT_PRICING,
  GEMINI_OMNI_FLASH_PARAMETER_POLICY,
  GEMINI_OMNI_FLASH_PRODUCT_PRICING,
} from './defaults';
import {
  bailianVideoCatalogSnapshot,
  type ImageModelSeed,
  type ProviderEntry,
} from './image-models';

/** Video ContainerModel seed — structurally identical to ImageModelSeed. */
export type VideoModelSeed = ImageModelSeed;

const T2V: AiGenerationMode = 'text_to_video';
const I2V: AiGenerationMode = 'image_to_video';
const FLF2V: AiGenerationMode = 'first_last_frame_to_video';
const MM2V: AiGenerationMode = 'multimodal_to_video'; // 全能参考 / omni reference
const V2V: AiGenerationMode = 'video_to_video';

const WAN_3_0_DOCS_URL =
  'https://modelstudio.console.alibabacloud.com/ap-southeast-1?tab=doc#/doc/?type=model&url=2840914_2&modelId=wan3.0-video&serviceSite=international';

const WAN_3_0_CATALOG_SNAPSHOT = {
  service: 'video-synthesis',
  callMode: 'async',
  lifecycle: {
    stage: 'preview',
    releasedAt: '2026-08-06',
    access: 'application_required',
  },
  pricing: {
    source: 'aliyun_model_studio_official_pricing',
    unit: 'second',
    markets: {
      cn: {
        currency: 'CNY',
        defaultResolution: '720P',
        unitPriceByResolution: { '480P': 0.3, '720P': 0.6, '1080P': 1.2 },
      },
      global: {
        currency: 'USD',
        defaultResolution: '720P',
        unitPriceByResolution: { '480P': 0.05, '720P': 0.1, '1080P': 0.2 },
      },
    },
    defaultMarket: 'global',
  },
  docs: [
    { title: 'Wan 3.0 API reference', url: WAN_3_0_DOCS_URL },
    {
      title: 'Wan 3.0 launch and pricing',
      url: 'https://www.alibabacloud.com/en/product/model-studio/wan3.0',
    },
  ],
  model: 'wan3.0-video',
} as const satisfies Prisma.InputJsonObject;

/** Fal video result: a single mp4 (audio muxed in) + echoed seed. */
const PROVIDER_VIDEO_OUTPUT_SCHEMA = {
  type: 'object',
  required: ['video'],
  properties: {
    video: {
      type: 'object',
      required: ['url'],
      properties: {
        url: { type: 'string' },
        content_type: { type: 'string' },
        file_name: { type: 'string' },
        file_size: { type: 'integer' },
      },
    },
    seed: { type: 'integer' },
  },
};

const GOOGLE_VEO_INPUT_SCHEMA = {
  type: 'object',
  required: ['model', 'config'],
  properties: {
    model: { type: 'string' },
    prompt: { type: 'string' },
    image: { type: 'object' },
    config: {
      type: 'object',
      properties: {
        numberOfVideos: { type: 'integer' },
        durationSeconds: { type: 'integer' },
        aspectRatio: { type: 'string' },
        resolution: { type: 'string' },
        generateAudio: { type: 'boolean' },
        negativePrompt: { type: 'string' },
        seed: { type: 'integer' },
        lastFrame: { type: 'object' },
        referenceImages: { type: 'array' },
      },
    },
  },
};

const GOOGLE_OMNI_INPUT_SCHEMA = {
  type: 'object',
  required: ['api_version', 'model', 'input', 'response_format'],
  properties: {
    api_version: { const: 'v1beta1' },
    model: { const: 'gemini-omni-flash-preview' },
    input: { type: 'array' },
    previous_interaction_id: { type: 'string' },
    store: { type: 'boolean' },
    background: { type: 'boolean' },
    response_format: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { const: 'video' },
          aspect_ratio: { type: 'string' },
          duration: { type: 'string' },
          delivery: { type: 'string' },
        },
      },
    },
    generation_config: {
      type: 'object',
      properties: { video_config: { type: 'object' } },
    },
  },
};

const GOOGLE_OMNI_OUTPUT_SCHEMA = {
  type: 'object',
  required: ['id', 'status'],
  properties: {
    id: { type: 'string' },
    status: { type: 'string' },
    output_video: { type: 'object' },
    errors: { type: 'array' },
    usage: { type: 'object' },
    steps: { type: 'array' },
  },
};

const GOOGLE_VEO_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    done: { type: 'boolean' },
    error: { type: 'object' },
    response: {
      type: 'object',
      properties: {
        generatedVideos: { type: 'array' },
        raiMediaFilteredCount: { type: 'integer' },
        raiMediaFilteredReasons: { type: 'array' },
      },
    },
  },
};

function googleVeoProvider(
  endpointId:
    | 'veo-3.1-generate-001'
    | 'veo-3.1-fast-generate-001'
    | 'veo-3.1-lite-generate-001',
  modes: AiGenerationMode[],
): ProviderEntry {
  return {
    provider: 'google-vertex',
    endpointId,
    modes,
    providerInputSchema: GOOGLE_VEO_INPUT_SCHEMA,
    providerOutputSchema: GOOGLE_VEO_OUTPUT_SCHEMA,
    requestTimeoutSeconds: 1800,
    failureThreshold: 3,
    priority: 10,
    catalogSnapshot: {
      service: 'Vertex AI generateVideos',
      model: endpointId,
      apiVersion: 'v1',
      authentication: 'Application Default Credentials',
      callMode: 'long_running_operation',
      cancellation: 'not_supported',
      lifecycle: endpointId.endsWith('lite-generate-001')
        ? { stage: 'preview' }
        : {
            stage: 'ga',
            releasedAt: '2025-11-17',
            retirementNotBefore: '2026-11-17',
          },
      docs: [
        {
          title: 'Veo 3.1 model card',
          url: 'https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/veo/3-1-generate',
        },
        {
          title: 'Veo video generation overview',
          url: 'https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/video/overview',
        },
      ],
      pricing: {
        source: 'provider_usage',
        unit: 'second',
        url: 'https://cloud.google.com/vertex-ai/generative-ai/pricing',
      },
    },
  };
}

const googleOmniProvider: ProviderEntry = {
  provider: 'google-vertex',
  endpointId: 'gemini-omni-flash-preview',
  modes: [T2V, I2V, MM2V, V2V],
  providerInputSchema: GOOGLE_OMNI_INPUT_SCHEMA,
  providerOutputSchema: GOOGLE_OMNI_OUTPUT_SCHEMA,
  requestTimeoutSeconds: 600,
  failureThreshold: 3,
  priority: 10,
  catalogSnapshot: {
    service: 'Vertex AI Interactions API',
    model: 'gemini-omni-flash-preview',
    apiVersion: 'v1beta1',
    authentication: 'Application Default Credentials',
    callMode: 'background_interaction_with_polling',
    statefulEditing: true,
    quota: {
      mode: 'fixed_quota_only',
      payAsYouGoSupported: false,
    },
    docs: [
      {
        title: 'Gemini 2.5 Omni model card',
        url: 'https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/omni-flash-preview',
      },
      {
        title: 'Generate videos from text with Gemini 2.5 Omni',
        url: 'https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/video/generate-videos-from-text',
      },
      {
        title: 'Interactions API reference',
        url: 'https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/models/interactions-api',
      },
    ],
    pricing: {
      source: 'provider_usage',
      unit: 'video_output_tokens',
      url: 'https://cloud.google.com/vertex-ai/generative-ai/pricing',
    },
    lifecycle: {
      stage: 'preview',
      releasedAt: '2026-06-30',
      retirementAt: '2027-06-30',
    },
  },
};

const SEEDANCE_MODES: AiGenerationMode[] = [T2V, I2V, FLF2V, MM2V];

/**
 * BytePlus ModelArk is the SOLE Seedance provider (fal retired 2026-07-02:
 * ~2× the official per-second price, no ACR/private-asset plane, no watermark
 * compliance field). One ModelArk endpoint id serves all four modes — content[]
 * roles select the scenario; reference videos/audios ride content[] as
 * reference_video / reference_audio parts. The current Standard endpoint is a
 * custom no-prefilter access point backed by dreamina-seedance-2-0-260128
 * (SEEDANCE-2.0.md).
 */
const bytePlusSeedanceProvider: ProviderEntry = {
  provider: 'byteplus-modelark',
  endpointId: 'ep-20260708234913-w8kjv',
  modes: SEEDANCE_MODES,
  requestTimeoutSeconds: 1800,
  priority: 50,
  catalogSnapshot: {
    // ModelArk's 4k lane is account-wide concurrency 1 / 15 RPM (non-4k:
    // 10 / 600). The tier gives 4k jobs their own capacity bucket so they
    // queue politely instead of exhausting the retry ladder, without
    // serializing the 480p-1080p lane. NOTE: the lane is shared with the
    // .cn cell (same ModelArk account).
    capacityTiers: {
      resolution: {
        '4k': { maxConcurrentRequests: 1, maxRequestsPerMinute: 15 },
      },
    },
  },
};

/** Dreamina Seedance 2.5 — official public ModelArk model id. */
const bytePlusSeedance25Provider: ProviderEntry = {
  provider: 'byteplus-modelark',
  endpointId: 'dreamina-seedance-2-5-260628',
  modes: SEEDANCE_MODES,
  requestTimeoutSeconds: 1800,
  // No maxConcurrentRequests / maxRequestsPerMinute on purpose, matching every
  // other BytePlus endpoint. Setting either one is what flips
  // `hasRuntimeCapacity` true, which routes the job through the Redis-backed
  // provider capacity gate — a path no endpoint in production currently takes,
  // and one that fails CLOSED: it requeues when Redis is slow or absent. The
  // canonical queuePolicy.globalConcurrency is the binding limit anyway
  // (min(8, 10) = 8), so the gate would buy nothing and would make the studio's
  // default video model the one model a Redis blip can stop.
  priority: 60,
  catalogSnapshot: {
    docs: [
      {
        title: 'Seedance 2.5 integration guide',
        url: 'https://docs.byteplus.com/en/docs/ModelArk/2607688',
      },
      {
        title: 'Create a video generation task',
        url: 'https://docs.byteplus.com/en/docs/ModelArk/1520757',
      },
      {
        title: 'Retrieve a video generation task',
        url: 'https://docs.byteplus.com/en/docs/ModelArk/1521309',
      },
      {
        title: 'Model pricing',
        url: 'https://docs.byteplus.com/en/docs/ModelArk/1544106',
      },
    ],
    model: 'dreamina-seedance-2-5-260628',
    api: {
      create: 'POST /api/v3/contents/generations/tasks',
      query: 'GET /api/v3/contents/generations/tasks/{task_id}',
    },
    pricing: { source: 'provider_usage', unit: 'completion_token' },
    limits: {
      maxConcurrentRequests: 10,
      maxRequestsPerMinute: 600,
    },
  },
};

/** Official fast variant (480p/720p only, no 1080p/4k tier). */
const bytePlusSeedanceFastProvider: ProviderEntry = {
  provider: 'byteplus-modelark',
  endpointId: 'dreamina-seedance-2-0-fast-260128',
  modes: SEEDANCE_MODES,
  requestTimeoutSeconds: 1800,
  priority: 50,
};

/** Official budget variant (~50% cheaper; 480p/720p only). */
const bytePlusSeedanceMiniProvider: ProviderEntry = {
  provider: 'byteplus-modelark',
  endpointId: 'dreamina-seedance-2-0-mini-260615',
  modes: SEEDANCE_MODES,
  requestTimeoutSeconds: 1800,
  priority: 50,
};

/** MiniMax-H3 — single V2 endpoint serves t2v / i2v / flf2v / r2v via content[]. */
const miniMaxH3Provider: ProviderEntry = {
  provider: 'minimax',
  endpointId: 'MiniMax-H3',
  modes: SEEDANCE_MODES,
  requestTimeoutSeconds: 1800,
  priority: 50,
  catalogSnapshot: {
    docs: [
      {
        title: 'MiniMax H3 Video Generation',
        url: 'https://platform.minimax.io/docs/guides/video-generation',
      },
      {
        title: 'Create Video Generation Task (V2)',
        url: 'https://platform.minimax.io/docs/api-reference/video-generation-v2-create',
      },
    ],
    model: 'MiniMax-H3',
    api: {
      create: 'POST /v2/video_generation',
      query: 'GET /v2/query/video_generation/{task_id}',
    },
    pricing: { source: 'provider_usage', unit: 'second' },
  },
};

/** fal H3 Max is a separate model from MiniMax's native H3 endpoint. */
const H3_MAX_POLICY = {
  parameterMode: 'provider_union',
  providerFamily: 'minimax-h3-max',
  promptMaxLength: 50000,
  defaultResolution: '768P',
  resolutionOptions: ['768P'],
  defaultDurationSeconds: '5',
  durationOptions: Array.from({ length: 11 }, (_, i) => String(i + 5)),
  defaultAspectRatio: '16:9',
  supportedAspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
  startFrame: { enabled: true },
  endFrame: { enabled: true },
  referenceInputs: {
    enabled: true,
    images: { min: 0, max: 9 },
    videos: { min: 0, max: 3 },
    audios: { min: 0, max: 3 },
    maxTotalFiles: 12,
  },
  seed: { enabled: true },
} satisfies Prisma.InputJsonObject;

export const VIDEO_MODELS: VideoModelSeed[] = [
  {
    slug: 'minimax-h3-max',
    displayName: 'MiniMax H3 Max',
    family: 'minimax',
    vendor: 'fal',
    description:
      'fal H3 Max: fast text-to-video and first/last-frame video generation.',
    modes: [T2V, I2V, FLF2V, MM2V],
    requiredPlan: null,
    cost: 180,
    parameterPolicy: H3_MAX_POLICY,
    productPricing: {
      mode: 'per_second_matrix',
      currency: 'COMPUTE_POINTS',
      defaultOutputCount: 1,
      minOutputCount: 1,
      maxOutputCount: 1,
      maxSeconds: 15,
      defaultSeconds: 5,
      autoQuoteSeconds: 15,
      minimumPoints: 1,
      roundTo: 1,
      // fal list rate (not the temporary launch discount): $0.08/s at 768P.
      // 2026-09-17 global −30% with a ≥1.10× cost floor: product rate $0.09/s
      // (floored — raw ×0.7 would sit exactly at cost); reference tokens are
      // still billed separately at cost.
      // https://fal.ai/models/minimax/h3-max/reference-to-video (2026-09-12)
      referenceTokenPricing: {
        includedTokens: 4096,
        pointsPerThousandTokens: 2,
        imagePixelsPerToken: 1024,
        videoTokensPerSecond: { '768P': 7460 },
        audioTokensPerSecond: 80,
      },
      version: 'minimax-h3-max-points-v2-2026-09-17',
      defaultResolution: '768P',
      pointsPerSecond: { '768P': 9 },
      minSeconds: 5,
    },
    group: 'video',
    sortOrder: 14,
    recommended: false,
    providers: [
      {
        provider: 'fal-ai',
        endpointId: 'minimax/h3-max/text-to-video',
        modes: [T2V],
        priority: 100,
        requestTimeoutSeconds: 600,
      },
      {
        provider: 'fal-ai',
        endpointId: 'minimax/h3-max/image-to-video',
        modes: [I2V, FLF2V],
        priority: 100,
        requestTimeoutSeconds: 600,
      },
      {
        provider: 'fal-ai',
        endpointId: 'minimax/h3-max/reference-to-video',
        modes: [MM2V],
        priority: 100,
        requestTimeoutSeconds: 600,
      },
    ],
    providerAliases: [
      'minimax/h3-max/text-to-video',
      'minimax/h3-max/image-to-video',
      'minimax/h3-max/reference-to-video',
    ],
  },
  {
    slug: 'wan-3-0',
    displayName: 'Wan 3.0',
    family: 'wan',
    vendor: 'Alibaba',
    description:
      'Alibaba Wan 3.0 all-in-one video generation with native audio, first/last-frame control, and mixed image, video, audio, file, and link references. 480P-1080P, 2-30s.',
    modes: [T2V, I2V, FLF2V, MM2V, V2V],
    requiredPlan: null,
    // Preflight hold = 30s × 720P points(20).
    cost: 600,
    parameterPolicy: WAN_3_0_VIDEO_PARAMETER_POLICY,
    productPricing: WAN_3_0_VIDEO_PRODUCT_PRICING,
    group: 'video',
    sortOrder: 5,
    recommended: true,
    providers: [
      {
        provider: 'aliyun-bailian',
        endpointId: 'wan3.0-video',
        modes: [T2V, I2V, FLF2V, MM2V, V2V],
        requestTimeoutSeconds: 1800,
        priority: 10,
        maxRequestsPerMinute: 50,
        failureThreshold: 3,
        catalogSnapshot: WAN_3_0_CATALOG_SNAPSHOT,
      },
    ],
    providerAliases: ['bailian/wan3.0-video', 'wan3.0-video'],
  },
  {
    slug: 'veo-3-1',
    displayName: 'Veo 3.1',
    family: 'veo',
    vendor: 'Google',
    description:
      'Google Veo 3.1 cinematic video generation with native audio, text-to-video, image-to-video and controlled first/last frames.',
    modes: [T2V, I2V, FLF2V, MM2V],
    requiredPlan: null,
    // Default 8s × 1080p points(60).
    cost: 480,
    parameterPolicy: VEO_3_1_PARAMETER_POLICY,
    productPricing: VEO_3_1_PRODUCT_PRICING,
    group: 'video',
    sortOrder: 1,
    recommended: true,
    providers: [
      googleVeoProvider('veo-3.1-generate-001', [T2V, I2V, FLF2V, MM2V]),
    ],
    providerAliases: [
      'google-vertex/veo-3.1-generate-001',
      'veo-3.1-generate-preview',
    ],
  },
  {
    slug: 'veo-3-1-fast',
    displayName: 'Veo 3.1 Fast',
    family: 'veo',
    vendor: 'Google',
    description:
      'Google Veo 3.1 Fast for rapid cinematic iteration with native audio and the same text, frame and portrait/landscape controls.',
    modes: [T2V, I2V, FLF2V, MM2V],
    requiredPlan: null,
    // Default 8s × 1080p points(20).
    cost: 160,
    parameterPolicy: VEO_3_1_FAST_PARAMETER_POLICY,
    productPricing: VEO_3_1_FAST_PRODUCT_PRICING,
    group: 'video',
    sortOrder: 2,
    recommended: false,
    providers: [
      googleVeoProvider('veo-3.1-fast-generate-001', [T2V, I2V, FLF2V, MM2V]),
    ],
    providerAliases: [
      'google-vertex/veo-3.1-fast-generate-001',
      'veo-3.1-fast-generate-preview',
    ],
  },
  {
    slug: 'veo-3-1-lite',
    displayName: 'Veo 3.1 Lite',
    family: 'veo',
    vendor: 'Google',
    description:
      'Google Veo 3.1 Lite preview for lower-cost native-audio generation with text, start-image, and controlled first/last frames.',
    modes: [T2V, I2V, FLF2V],
    requiredPlan: null,
    // Default 8s × 720p points(8).
    cost: 64,
    parameterPolicy: VEO_3_1_LITE_PARAMETER_POLICY,
    productPricing: VEO_3_1_LITE_PRODUCT_PRICING,
    group: 'video',
    sortOrder: 3,
    recommended: false,
    providers: [
      googleVeoProvider('veo-3.1-lite-generate-001', [T2V, I2V, FLF2V]),
    ],
    providerAliases: ['google-vertex/veo-3.1-lite-generate-001'],
  },
  {
    slug: 'gemini-omni-flash-preview',
    displayName: 'Gemini 2.5 Omni Flash',
    family: 'gemini-omni',
    vendor: 'Google',
    description:
      'Google native multimodal video model for text, start-image, multi-image reference, and stateful generated-video editing with synchronized audio.',
    modes: [T2V, I2V, MM2V, V2V],
    requiredPlan: null,
    // Default 8s × 720p points(16).
    cost: 128,
    parameterPolicy: GEMINI_OMNI_FLASH_PARAMETER_POLICY,
    productPricing: GEMINI_OMNI_FLASH_PRODUCT_PRICING,
    group: 'video',
    sortOrder: 4,
    recommended: true,
    providers: [googleOmniProvider],
    providerAliases: ['google-vertex/gemini-omni-flash-preview'],
  },
  {
    slug: 'seedance-2-5',
    displayName: 'Seedance 2.5',
    family: 'seedance',
    vendor: 'ByteDance',
    description:
      'ByteDance Seedance 2.5 — native 30-second cinematic video with synced audio, multimodal references, precise editing and extension.',
    modes: SEEDANCE_MODES,
    requiredPlan: null,
    // Auto-duration + maximum 30s of reference video: 60s × 23 points/s.
    cost: 1380,
    parameterPolicy: SEEDANCE_2_5_PARAMETER_POLICY,
    productPricing: SEEDANCE_2_5_PRODUCT_PRICING,
    group: 'video',
    sortOrder: 5,
    recommended: true,
    providers: [bytePlusSeedance25Provider],
    providerAliases: ['bytedance/seedance-2.5', 'dreamina-seedance-2-5-260628'],
  },
  {
    slug: 'quick-video-1-0',
    displayName: 'Agnes Video 2.0',
    family: 'quick-video',
    vendor: 'Agnes AI',
    description:
      'Agnes AI lightweight text-to-video and multi-image-to-video model for draft motion clips and local generation tests.',
    modes: [T2V, MM2V],
    requiredPlan: null,
    // Default 5s × 480p points(6).
    cost: 30,
    parameterPolicy: QUICK_VIDEO_PARAMETER_POLICY,
    productPricing: QUICK_VIDEO_PRODUCT_PRICING,
    group: 'video',
    sortOrder: 8,
    recommended: false,
    providers: [
      {
        provider: 'agnes-ai',
        endpointId: 'agnes-video-v2.0',
        modes: [T2V, MM2V],
        requestTimeoutSeconds: 1800,
        maxConcurrentRequests: 1,
        maxRequestsPerMinute: 20,
        cooldownSeconds: 60,
        failureThreshold: 3,
        priority: 100,
        catalogSnapshot: {
          docs: [
            {
              title: 'Agnes Video V2.0 API',
              url: 'https://agnes-ai.com/doc/agnes-video-v20',
            },
          ],
          model: 'agnes-video-v2.0',
          polling: { endpoint: '/agnesapi?video_id={video_id}' },
          pricing: { source: 'provider_account' },
        },
      },
    ],
    providerAliases: ['agnes/agnes-video-v2.0'],
  },
  {
    slug: 'seedance-2-0',
    displayName: 'Seedance 2.0',
    family: 'seedance',
    vendor: 'ByteDance',
    description:
      'ByteDance Seedance 2.0 video — text/image/first-last-frame and omni reference, with native synced audio.',
    modes: SEEDANCE_MODES,
    requiredPlan: null,
    // billingPolicy.preflightCost — display metadata only; the real wallet
    // hold is quoted per job from productPricing (4k tops out at 15s × 180
    // = 2700). Kept at the 15s × 720p default-lane ceiling.
    cost: 375,
    parameterPolicy: SEEDANCE_2_0_PARAMETER_POLICY,
    productPricing: SEEDANCE_2_0_PRODUCT_PRICING,
    group: 'video',
    sortOrder: 10,
    recommended: false,
    providers: [bytePlusSeedanceProvider],
    // 'bytedance/seedance-2.0' kept as a lookup alias for pre-cutover job
    // rows / presets that referenced the retired fal endpoint family.
    providerAliases: [
      'bytedance/seedance-2.0',
      'dreamina-seedance-2-0-260128',
      'ep-20260708234913-w8kjv',
    ],
  },
  {
    slug: 'seedance-2-0-fast',
    displayName: 'Seedance 2.0 Fast',
    family: 'seedance',
    vendor: 'ByteDance',
    description:
      'ByteDance Seedance 2.0 Fast — same modes at a lower cost / faster turnaround (720p).',
    modes: SEEDANCE_MODES,
    requiredPlan: null,
    // Preflight hold = 15s × 720p @ 20/s. v3 reprice.
    cost: 300,
    parameterPolicy: SEEDANCE_2_0_SD_PARAMETER_POLICY,
    productPricing: SEEDANCE_2_0_FAST_PRODUCT_PRICING,
    group: 'video',
    sortOrder: 20,
    recommended: false,
    providers: [bytePlusSeedanceFastProvider],
    providerAliases: [
      'bytedance/seedance-2.0/fast',
      'dreamina-seedance-2-0-fast-260128',
    ],
  },
  {
    slug: 'seedance-2-0-mini',
    displayName: 'Seedance 2.0 Mini',
    family: 'seedance',
    vendor: 'ByteDance',
    description:
      'ByteDance Seedance 2.0 Mini — cost-effective budget tier (~50% cheaper) for high-volume video generation; 480p/720p.',
    modes: SEEDANCE_MODES,
    requiredPlan: null,
    // Preflight hold = 15s × 720p @ 12/s.
    cost: 180,
    parameterPolicy: SEEDANCE_2_0_SD_PARAMETER_POLICY,
    productPricing: SEEDANCE_2_0_MINI_PRODUCT_PRICING,
    group: 'video',
    sortOrder: 30,
    recommended: false,
    providers: [bytePlusSeedanceMiniProvider],
    providerAliases: [
      'bytedance/seedance-2.0/mini',
      'dreamina-seedance-2-0-mini-260615',
    ],
  },
  {
    slug: 'wan-2-7',
    displayName: 'Wan 2.7',
    family: 'wan',
    vendor: 'Alibaba',
    description:
      'Alibaba Tongyi Wanxiang 2.7 video — text-to-video and image-to-video (with first/last-frame control), on Alibaba Model Studio. Native 720P/1080P, 2–15s.',
    // One canonical, three upstream model ids. wan2.7-t2v serves text_to_video;
    // wan2.7-i2v serves image_to_video AND first_last_frame_to_video (via its
    // input.media first_frame/last_frame roles); wan2.7-r2v serves the omni
    // reference (参考生视频) multimodal_to_video mode. The Bailian catalog merges
    // the bindings into one model with a per-mode endpoint map.
    modes: [T2V, I2V, FLF2V, MM2V],
    requiredPlan: null,
    // Display floor ≈ maxSeconds(15) × 720P points(20).
    cost: 300,
    parameterPolicy: WAN_2_7_VIDEO_PARAMETER_POLICY,
    productPricing: WAN_2_7_VIDEO_PRODUCT_PRICING,
    group: 'video',
    sortOrder: 30,
    recommended: false,
    providers: [
      {
        provider: 'aliyun-bailian',
        endpointId: 'wan2.7-i2v',
        modes: [I2V, FLF2V],
        requestTimeoutSeconds: 600,
        priority: 100,
        catalogSnapshot: bailianVideoCatalogSnapshot({
          model: 'wan2.7-i2v',
          // Provider-cost tracking only (per second). ESTIMATE (wan2.6 intl
          // proxy ~$0.10/720P–$0.15/1080P ≈ ¥0.7–1.07/s); user pricing is the
          // productPricing above. Pending finance sign-off.
          cnRmbPerSecond: 0.7,
          globalRmbPerSecond: 0.7,
          docsUrl:
            'https://www.alibabacloud.com/help/en/model-studio/image-to-video-general-api-reference',
        }),
      },
      {
        provider: 'aliyun-bailian',
        endpointId: 'wan2.7-t2v',
        modes: [T2V],
        requestTimeoutSeconds: 600,
        priority: 100,
        catalogSnapshot: bailianVideoCatalogSnapshot({
          model: 'wan2.7-t2v',
          cnRmbPerSecond: 0.7,
          globalRmbPerSecond: 0.7,
          docsUrl:
            'https://help.aliyun.com/zh/model-studio/text-to-video-api-reference',
        }),
      },
      {
        provider: 'aliyun-bailian',
        endpointId: 'wan2.7-r2v',
        modes: [MM2V],
        requestTimeoutSeconds: 600,
        priority: 100,
        catalogSnapshot: bailianVideoCatalogSnapshot({
          model: 'wan2.7-r2v',
          cnRmbPerSecond: 0.7,
          globalRmbPerSecond: 0.7,
          docsUrl:
            'https://help.aliyun.com/zh/model-studio/video-reference-api-reference',
        }),
      },
    ],
    providerAliases: ['wan2.7-i2v', 'wan2.7-t2v', 'wan2.7-r2v'],
  },
  {
    slug: 'happyhorse-1-0',
    displayName: 'HappyHorse 1.0',
    family: 'wan',
    vendor: 'Alibaba',
    description:
      'Alibaba HappyHorse 1.0 video — top-ranked text-to-video / image-to-video / omni-reference with native synced audio and multi-language lip-sync. 720P/1080P, 2–15s.',
    // One canonical, three upstream model ids: happyhorse-1.0-t2v (text),
    // happyhorse-1.0-i2v (first frame), happyhorse-1.0-r2v (reference images).
    // No first-last-frame (i2v is first-frame only) and no video edit on this
    // account. The Bailian catalog merges the bindings with a per-mode endpoint
    // map.
    modes: [T2V, I2V, MM2V],
    requiredPlan: null,
    // Display floor ≈ maxSeconds(15) × 720P points(20).
    cost: 300,
    parameterPolicy: HAPPYHORSE_VIDEO_PARAMETER_POLICY,
    productPricing: HAPPYHORSE_VIDEO_PRODUCT_PRICING,
    group: 'video',
    sortOrder: 25,
    recommended: false,
    providers: [
      {
        provider: 'aliyun-bailian',
        endpointId: 'happyhorse-1.0-t2v',
        modes: [T2V],
        requestTimeoutSeconds: 900,
        priority: 100,
        catalogSnapshot: bailianVideoCatalogSnapshot({
          model: 'happyhorse-1.0-t2v',
          // Provider-cost per-second ESTIMATE pending finance; user price is the
          // productPricing above.
          cnRmbPerSecond: 0.7,
          globalRmbPerSecond: 0.7,
          docsUrl:
            'https://www.alibabacloud.com/help/en/model-studio/happyhorse-text-to-video-api-reference',
        }),
      },
      {
        provider: 'aliyun-bailian',
        endpointId: 'happyhorse-1.0-i2v',
        modes: [I2V],
        requestTimeoutSeconds: 900,
        priority: 100,
        catalogSnapshot: bailianVideoCatalogSnapshot({
          model: 'happyhorse-1.0-i2v',
          cnRmbPerSecond: 0.7,
          globalRmbPerSecond: 0.7,
          docsUrl:
            'https://www.alibabacloud.com/help/en/model-studio/happyhorse-image-to-video-api-reference',
        }),
      },
      {
        provider: 'aliyun-bailian',
        endpointId: 'happyhorse-1.0-r2v',
        modes: [MM2V],
        requestTimeoutSeconds: 900,
        priority: 100,
        catalogSnapshot: bailianVideoCatalogSnapshot({
          model: 'happyhorse-1.0-r2v',
          cnRmbPerSecond: 0.7,
          globalRmbPerSecond: 0.7,
          docsUrl:
            'https://www.alibabacloud.com/help/en/model-studio/happyhorse-reference-to-video-api-reference',
        }),
      },
    ],
    providerAliases: [
      'happyhorse-1.0-t2v',
      'happyhorse-1.0-i2v',
      'happyhorse-1.0-r2v',
    ],
  },
  {
    slug: 'happyhorse-1-1',
    displayName: 'HappyHorse 1.1',
    family: 'wan',
    vendor: 'Alibaba',
    description:
      'Alibaba HappyHorse 1.1 video — upgrade of 1.0 with stronger motion, higher consistency and multi-image reference, native synced audio and multi-language lip-sync. 720P/1080P, 2–15s.',
    // Same shape as happyhorse-1-0: one canonical, three upstream ids
    // (happyhorse-1.1-t2v / -i2v / -r2v). ⚠️ confirm the exact 1.1 model ids +
    // param set against a live DashScope probe before deploying (see defaults.ts).
    modes: [T2V, I2V, MM2V],
    requiredPlan: null,
    // Display floor ≈ maxSeconds(15) × 720P points(20).
    cost: 300,
    parameterPolicy: HAPPYHORSE_1_1_VIDEO_PARAMETER_POLICY,
    productPricing: HAPPYHORSE_1_1_VIDEO_PRODUCT_PRICING,
    group: 'video',
    sortOrder: 24, // surface just above 1.0 (25)
    recommended: true, // feature 1.1 as the headline HappyHorse
    providers: [
      {
        provider: 'aliyun-bailian',
        endpointId: 'happyhorse-1.1-t2v',
        modes: [T2V],
        requestTimeoutSeconds: 900,
        priority: 100,
        catalogSnapshot: bailianVideoCatalogSnapshot({
          model: 'happyhorse-1.1-t2v',
          // Provider-cost per-second ESTIMATE pending finance; user price is the
          // productPricing above.
          cnRmbPerSecond: 0.7,
          globalRmbPerSecond: 0.7,
          docsUrl:
            'https://www.alibabacloud.com/help/en/model-studio/happyhorse-text-to-video-api-reference',
        }),
      },
      {
        provider: 'aliyun-bailian',
        endpointId: 'happyhorse-1.1-i2v',
        modes: [I2V],
        requestTimeoutSeconds: 900,
        priority: 100,
        catalogSnapshot: bailianVideoCatalogSnapshot({
          model: 'happyhorse-1.1-i2v',
          cnRmbPerSecond: 0.7,
          globalRmbPerSecond: 0.7,
          docsUrl:
            'https://www.alibabacloud.com/help/en/model-studio/happyhorse-image-to-video-api-reference',
        }),
      },
      {
        provider: 'aliyun-bailian',
        endpointId: 'happyhorse-1.1-r2v',
        modes: [MM2V],
        requestTimeoutSeconds: 900,
        priority: 100,
        catalogSnapshot: bailianVideoCatalogSnapshot({
          model: 'happyhorse-1.1-r2v',
          cnRmbPerSecond: 0.7,
          globalRmbPerSecond: 0.7,
          docsUrl:
            'https://www.alibabacloud.com/help/en/model-studio/happyhorse-reference-to-video-api-reference',
        }),
      },
    ],
    providerAliases: [
      'happyhorse-1.1-t2v',
      'happyhorse-1.1-i2v',
      'happyhorse-1.1-r2v',
    ],
  },
  {
    slug: 'kling-motion',
    displayName: 'Kling Motion',
    family: 'kling',
    vendor: 'Kuaishou',
    description:
      'Kling v1 image-to-video with the motion brush — paint a region and draw a path, and that region follows the trajectory. The only Kling tier with trajectory control. Reached via the studio Motion action.',
    modes: [I2V],
    requiredPlan: null,
    // Display floor ≈ maxSeconds(10) × 720p points(12).
    cost: 120,
    parameterPolicy: KLING_MOTION_PARAMETER_POLICY,
    productPricing: KLING_MOTION_PRODUCT_PRICING,
    group: 'video',
    sortOrder: 40,
    recommended: false,
    providers: [
      {
        provider: 'fal-ai',
        endpointId: 'fal-ai/kling-video/v1/standard/image-to-video',
        modes: [I2V],
        providerOutputSchema: PROVIDER_VIDEO_OUTPUT_SCHEMA,
        requestTimeoutSeconds: 1800,
        priority: 100,
      },
    ],
    providerAliases: ['fal/fal-ai/kling-video/v1/standard/image-to-video'],
  },
  {
    slug: 'minimax-h3',
    displayName: 'MiniMax H3',
    family: 'minimax',
    vendor: 'MiniMax',
    description:
      'MiniMax-H3 multimodal video — text / first-last frame / reference media. Async create + poll; 720p (768P) or 1080p (2K), 4–15s.',
    modes: SEEDANCE_MODES,
    requiredPlan: null,
    // Preflight hold = 15s × 1080p @ 25/s.
    cost: 375,
    parameterPolicy: MINIMAX_H3_PARAMETER_POLICY,
    productPricing: MINIMAX_H3_PRODUCT_PRICING,
    group: 'video',
    sortOrder: 15,
    recommended: true,
    providers: [miniMaxH3Provider],
    providerAliases: ['minimax/MiniMax-H3', 'MiniMax-H3', 'minimax-h3'],
  },
];
