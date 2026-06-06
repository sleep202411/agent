import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { AI_QUEUE_IMAGE, AI_QUEUE_VIDEO } from '../../queue';
import type { AiJobType } from '../../types';
import type {
  BailianModelRuntimeConfig,
  BailianModelService,
} from './bailian.types';
import { createBailianModelConfig } from './bailian-schema.mapper';

const boolEnv = (value: string | undefined, fallback = false): boolean => {
  if (value == null || value.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
};

const numberEnv = (
  value: string | undefined,
  fallback: number,
  min = 0,
): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return Math.floor(parsed);
};

const bailianModelConfigSchema = z.object({
  endpointId: z.string().min(1),
  service: z.enum([
    'image-generation',
    'text2image',
    'multimodal-generation',
    'video-synthesis',
  ]),
  type: z.enum(['image', 'video']),
  name: z.string().optional(),
  description: z.string().optional(),
  generationModes: z.array(z.string()).optional(),
  requiredPlan: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
  queue: z
    .object({
      globalConcurrency: z.number().int().positive().optional(),
      perUserRunning: z.number().int().positive().optional(),
      perUserQueued: z.number().int().positive().optional(),
    })
    .optional(),
  billing: z
    .object({
      mode: z.enum(['charge', 'free', 'estimate_then_finalize']).optional(),
      unit: z
        .enum([
          'compute_point',
          'request',
          'output',
          'second',
          'token',
          'provider_usage',
        ])
        .optional(),
      displayCurrency: z.string().optional(),
      preflightCost: z.number().nonnegative().optional(),
      finalCostSource: z
        .enum([
          'fixed_table',
          'provider_usage',
          'internal_metering',
          'campaign',
          'unknown',
        ])
        .optional(),
      refundPolicy: z
        .enum(['refund_on_final_failure', 'no_refund', 'manual_review'])
        .optional(),
    })
    .optional(),
});

type BailianModelConfigInput = z.infer<typeof bailianModelConfigSchema>;

export interface BailianProviderConfig {
  enabled: boolean;
  apiKey: string | null;
  region: string;
  workspaceId: string | null;
  apiBaseUrl: string;
  requestTimeoutMs: number;
  pollDelayMs: number;
  catalogRefreshMs: number;
  allowlist: Set<string> | null;
  models: BailianModelRuntimeConfig[];
}

export const BAILIAN_DEFAULT_MODELS: BailianModelConfigInput[] = [
  {
    endpointId: 'qwen-image-plus',
    service: 'text2image',
    type: 'image',
    name: 'Qwen Image Plus',
    description:
      'Alibaba Model Studio Qwen image generation model optimized for high quality Chinese and English typography.',
    generationModes: ['text_to_image'],
    billing: {
      mode: 'charge',
      unit: 'compute_point',
      displayCurrency: 'COMPUTE_POINTS',
      preflightCost: 2,
      finalCostSource: 'fixed_table',
      refundPolicy: 'refund_on_final_failure',
    },
  },
  {
    endpointId: 'qwen-image',
    service: 'text2image',
    type: 'image',
    name: 'Qwen Image',
    description:
      'Alibaba Model Studio Qwen image generation model for balanced quality and latency.',
    generationModes: ['text_to_image'],
    billing: {
      mode: 'charge',
      unit: 'compute_point',
      displayCurrency: 'COMPUTE_POINTS',
      preflightCost: 1,
      finalCostSource: 'fixed_table',
      refundPolicy: 'refund_on_final_failure',
    },
  },
  {
    endpointId: 'wan2.7-image-pro',
    service: 'image-generation',
    type: 'image',
    name: 'Wan 2.7 Image Pro',
    description:
      'Alibaba Wan 2.7 image generation and editing model with reference-aware workflows.',
    generationModes: ['text_to_image', 'image_to_image', 'multimodal_to_image'],
    billing: {
      mode: 'charge',
      unit: 'compute_point',
      displayCurrency: 'COMPUTE_POINTS',
      preflightCost: 3,
      finalCostSource: 'fixed_table',
      refundPolicy: 'refund_on_final_failure',
    },
  },
  {
    endpointId: 'wan2.7-image',
    service: 'image-generation',
    type: 'image',
    name: 'Wan 2.7 Image',
    description:
      'Alibaba Wan 2.7 image generation and editing model for faster 2K workflows.',
    generationModes: ['text_to_image', 'image_to_image', 'multimodal_to_image'],
    billing: {
      mode: 'charge',
      unit: 'compute_point',
      displayCurrency: 'COMPUTE_POINTS',
      preflightCost: 2,
      finalCostSource: 'fixed_table',
      refundPolicy: 'refund_on_final_failure',
    },
  },
  {
    endpointId: 'wanx2.1-imageedit',
    service: 'image-generation',
    type: 'image',
    name: 'Wan 2.1 Image Edit',
    description:
      'Alibaba Wan image editing model for prompt guided image modifications.',
    generationModes: ['image_to_image', 'multimodal_to_image'],
    billing: {
      mode: 'charge',
      unit: 'compute_point',
      displayCurrency: 'COMPUTE_POINTS',
      preflightCost: 2,
      finalCostSource: 'fixed_table',
      refundPolicy: 'refund_on_final_failure',
    },
  },
  {
    endpointId: 'wan2.7-r2v',
    service: 'video-synthesis',
    type: 'video',
    name: 'Wan 2.7 Reference to Video',
    description:
      'Alibaba Wan 2.7 reference-to-video model with image, video and voice reference inputs.',
    generationModes: [
      'multimodal_to_video',
      'image_to_video',
      'video_to_video',
    ],
    billing: {
      mode: 'charge',
      unit: 'compute_point',
      displayCurrency: 'COMPUTE_POINTS',
      preflightCost: 30,
      finalCostSource: 'fixed_table',
      refundPolicy: 'refund_on_final_failure',
    },
  },
  {
    endpointId: 'wan2.7-t2v',
    service: 'video-synthesis',
    type: 'video',
    name: 'Wan 2.7 Text to Video',
    description: 'Alibaba Wan 2.7 text-to-video model.',
    generationModes: ['text_to_video'],
    billing: {
      mode: 'charge',
      unit: 'compute_point',
      displayCurrency: 'COMPUTE_POINTS',
      preflightCost: 24,
      finalCostSource: 'fixed_table',
      refundPolicy: 'refund_on_final_failure',
    },
  },
  {
    endpointId: 'wan2.7-i2v',
    service: 'video-synthesis',
    type: 'video',
    name: 'Wan 2.7 Image to Video',
    description: 'Alibaba Wan 2.7 image-to-video model.',
    generationModes: ['image_to_video'],
    billing: {
      mode: 'charge',
      unit: 'compute_point',
      displayCurrency: 'COMPUTE_POINTS',
      preflightCost: 24,
      finalCostSource: 'fixed_table',
      refundPolicy: 'refund_on_final_failure',
    },
  },
];

@Injectable()
export class BailianConfigService {
  private readonly logger = new Logger(BailianConfigService.name);
  private readonly value: BailianProviderConfig;

  constructor() {
    this.value = this.load();
  }

  get config(): BailianProviderConfig {
    return this.value;
  }

  private load(): BailianProviderConfig {
    const enabled = boolEnv(process.env.BAILIAN_ENABLED, false);
    const apiKey =
      process.env.DASHSCOPE_API_KEY?.trim() ||
      process.env.BAILIAN_API_KEY?.trim() ||
      null;
    const region =
      process.env.BAILIAN_REGION?.trim() ||
      process.env.DASHSCOPE_REGION?.trim() ||
      'ap-southeast-1';
    const workspaceId =
      process.env.BAILIAN_WORKSPACE_ID?.trim() ||
      process.env.DASHSCOPE_WORKSPACE_ID?.trim() ||
      null;
    const apiBaseUrl =
      process.env.BAILIAN_API_BASE_URL?.replace(/\/+$/, '') ||
      process.env.DASHSCOPE_API_BASE_URL?.replace(/\/+$/, '') ||
      defaultApiBaseUrl(region, workspaceId);
    const allowlist = this.parseAllowlist(process.env.BAILIAN_MODEL_ALLOWLIST);
    const models = this.parseModels(process.env.BAILIAN_MODEL_CONFIGS, enabled);

    return {
      enabled,
      apiKey,
      region,
      workspaceId,
      apiBaseUrl,
      requestTimeoutMs: numberEnv(
        process.env.BAILIAN_REQUEST_TIMEOUT_MS,
        300_000,
        1_000,
      ),
      pollDelayMs: numberEnv(process.env.BAILIAN_POLL_DELAY_MS, 6_000, 1_000),
      catalogRefreshMs: numberEnv(
        process.env.BAILIAN_CATALOG_REFRESH_MS,
        15 * 60_000,
        30_000,
      ),
      allowlist,
      models: allowlist
        ? models.filter((model) => allowlist.has(model.endpointId))
        : models,
    };
  }

  private parseAllowlist(raw: string | undefined): Set<string> | null {
    const values = (raw ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    return values.length > 0 ? new Set(values) : null;
  }

  private parseModels(
    raw: string | undefined,
    providerEnabled: boolean,
  ): BailianModelRuntimeConfig[] {
    const source = raw?.trim() ? this.parseJson(raw) : BAILIAN_DEFAULT_MODELS;
    return source.map((item) => {
      const parsed = bailianModelConfigSchema.parse(item);
      return createBailianModelConfig({
        endpointId: parsed.endpointId,
        service: parsed.service as BailianModelService,
        type: parsed.type as AiJobType,
        name: parsed.name,
        description: parsed.description,
        generationModes: parsed.generationModes,
        requiredPlan: parsed.requiredPlan ?? null,
        enabled: providerEnabled && parsed.enabled !== false,
        disabledReason: providerEnabled
          ? undefined
          : 'Alibaba Model Studio provider is not enabled for this environment.',
        queueName: parsed.type === 'video' ? AI_QUEUE_VIDEO : AI_QUEUE_IMAGE,
        globalConcurrency:
          parsed.queue?.globalConcurrency ??
          numberEnv(
            parsed.type === 'video'
              ? process.env.BAILIAN_VIDEO_GLOBAL_CONCURRENCY
              : process.env.BAILIAN_IMAGE_GLOBAL_CONCURRENCY,
            parsed.type === 'video' ? 4 : 12,
            1,
          ),
        perUserRunning:
          parsed.queue?.perUserRunning ??
          numberEnv(
            parsed.type === 'video'
              ? process.env.BAILIAN_PER_USER_VIDEO_RUNNING
              : process.env.BAILIAN_PER_USER_IMAGE_RUNNING,
            parsed.type === 'video' ? 1 : 2,
            1,
          ),
        perUserQueued:
          parsed.queue?.perUserQueued ??
          numberEnv(process.env.BAILIAN_PER_USER_QUEUED_TOTAL, 10, 1),
        pollDelayMs: numberEnv(process.env.BAILIAN_POLL_DELAY_MS, 6_000, 1_000),
        billing: parsed.billing,
      });
    });
  }

  private parseJson(raw: string): unknown[] {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        throw new Error('BAILIAN_MODEL_CONFIGS must be a JSON array.');
      }
      return parsed;
    } catch (err) {
      this.logger.error(
        `Invalid BAILIAN_MODEL_CONFIGS: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw err;
    }
  }
}

function defaultApiBaseUrl(region: string, workspaceId: string | null): string {
  if (region === 'ap-southeast-1' && workspaceId) {
    return `https://${workspaceId}.ap-southeast-1.maas.aliyuncs.com/api/v1`;
  }
  if (region === 'cn-beijing' || region.startsWith('cn-')) {
    return 'https://dashscope.aliyuncs.com/api/v1';
  }
  return 'https://dashscope-intl.aliyuncs.com/api/v1';
}
