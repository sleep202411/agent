/**
 * Declarative catalog of canonical AI video models (mirror of image-models.ts).
 *
 * One clean entry per canonical ContainerModel; no policy boilerplate (that
 * lives in defaults.ts + seed-catalog.ts). Modes are the union the model
 * supports; the studio param panel filters per selected mode. Each `providers`
 * entry seeds an AiProviderEndpoint + a runtime-valid AiProviderModelBinding
 * (modality 'video').
 */
import type { AiGenerationMode } from '@repo/shared';

import {
  HAPPYHORSE_VIDEO_PARAMETER_POLICY,
  HAPPYHORSE_VIDEO_PRODUCT_PRICING,
  HAPPYHORSE_1_1_VIDEO_PARAMETER_POLICY,
  HAPPYHORSE_1_1_VIDEO_PRODUCT_PRICING,
  KLING_MOTION_PARAMETER_POLICY,
  KLING_MOTION_PRODUCT_PRICING,
  QUICK_VIDEO_PARAMETER_POLICY,
  QUICK_VIDEO_PRODUCT_PRICING,
  SEEDANCE_2_0_FAST_PRODUCT_PRICING,
  SEEDANCE_2_0_MINI_PRODUCT_PRICING,
  SEEDANCE_2_0_PARAMETER_POLICY,
  SEEDANCE_2_0_PRODUCT_PRICING,
  SEEDANCE_2_0_SD_PARAMETER_POLICY,
  WAN_2_7_VIDEO_PARAMETER_POLICY,
  WAN_2_7_VIDEO_PRODUCT_PRICING,
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

export const VIDEO_MODELS: VideoModelSeed[] = [
  {
    slug: 'quick-video-1-0',
    displayName: 'Agnes Video 2.0',
    family: 'quick-video',
    vendor: 'Agnes AI',
    description:
      'Agnes AI lightweight text-to-video and multi-image-to-video model for draft motion clips and local generation tests.',
    modes: [T2V, MM2V],
    tier: 'vip',
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
    tier: 'vip',
    // billingPolicy.preflightCost — display metadata only; the real wallet
    // hold is quoted per job from productPricing (4k tops out at 15s × 180
    // = 2700). Kept at the 15s × 720p default-lane ceiling.
    cost: 375,
    parameterPolicy: SEEDANCE_2_0_PARAMETER_POLICY,
    productPricing: SEEDANCE_2_0_PRODUCT_PRICING,
    group: 'video',
    sortOrder: 10,
    recommended: true,
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
    tier: 'vip',
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
    tier: 'vip',
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
    tier: 'vip',
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
    tier: 'vip',
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
    tier: 'vip',
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
    tier: 'vip',
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
];
