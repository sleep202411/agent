import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { AI_QUEUE_IMAGE, AI_QUEUE_VIDEO } from '../../queue';
import type { AiJobType } from '../../types';
import type { FalModelRuntimeConfig } from './fal.types';
import { createFalModelConfig } from './fal-schema.mapper';

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

const falModelConfigSchema = z.object({
  endpointId: z.string().min(1),
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
          'bubble',
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

type FalModelConfigInput = z.infer<typeof falModelConfigSchema>;

export interface FalProviderConfig {
  enabled: boolean;
  apiKey: string | null;
  queueBaseUrl: string;
  apiBaseUrl: string;
  requestTimeoutMs: number;
  pollDelayMs: number;
  catalogRefreshMs: number;
  allowlist: Set<string> | null;
  models: FalModelRuntimeConfig[];
}

const DEFAULT_MODELS: FalModelConfigInput[] = [
  {
    endpointId: 'fal-ai/flux/schnell',
    type: 'image',
    name: 'FLUX Schnell',
    description: 'Fast text-to-image generation through fal.ai.',
    generationModes: ['text_to_image'],
    billing: {
      mode: 'charge',
      unit: 'bubble',
      displayCurrency: 'BUBBLES',
      preflightCost: 1,
      finalCostSource: 'fixed_table',
      refundPolicy: 'refund_on_final_failure',
    },
  },
  {
    endpointId: 'fal-ai/wan/v2.2-a14b/text-to-video',
    type: 'video',
    name: 'WAN Text to Video',
    description: 'Text-to-video generation through fal.ai.',
    generationModes: ['text_to_video'],
    billing: {
      mode: 'charge',
      unit: 'bubble',
      displayCurrency: 'BUBBLES',
      preflightCost: 20,
      finalCostSource: 'fixed_table',
      refundPolicy: 'refund_on_final_failure',
    },
  },
];

@Injectable()
export class FalConfigService {
  private readonly logger = new Logger(FalConfigService.name);
  private readonly value: FalProviderConfig;

  constructor() {
    this.value = this.load();
  }

  get config(): FalProviderConfig {
    return this.value;
  }

  private load(): FalProviderConfig {
    const enabled = boolEnv(process.env.FAL_ENABLED, false);
    const apiKey =
      process.env.FAL_API_KEY?.trim() || process.env.FAL_KEY?.trim() || null;
    const allowlist = this.parseAllowlist(process.env.FAL_MODEL_ALLOWLIST);
    const models = this.parseModels(process.env.FAL_MODEL_CONFIGS, enabled);

    return {
      enabled,
      apiKey,
      queueBaseUrl:
        process.env.FAL_QUEUE_BASE_URL?.replace(/\/+$/, '') ||
        'https://queue.fal.run',
      apiBaseUrl:
        process.env.FAL_API_BASE_URL?.replace(/\/+$/, '') ||
        'https://api.fal.ai/v1',
      requestTimeoutMs: numberEnv(
        process.env.FAL_REQUEST_TIMEOUT_MS,
        300_000,
        1_000,
      ),
      pollDelayMs: numberEnv(process.env.FAL_POLL_DELAY_MS, 5_000, 1_000),
      catalogRefreshMs: numberEnv(
        process.env.FAL_CATALOG_REFRESH_MS,
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
  ): FalModelRuntimeConfig[] {
    const source = raw?.trim() ? this.parseJson(raw) : DEFAULT_MODELS;
    return source.map((item) => {
      const parsed = falModelConfigSchema.parse(item);
      return createFalModelConfig({
        endpointId: parsed.endpointId,
        type: parsed.type as AiJobType,
        name: parsed.name,
        description: parsed.description,
        generationModes: parsed.generationModes,
        requiredPlan: parsed.requiredPlan ?? null,
        enabled: providerEnabled && parsed.enabled !== false,
        disabledReason: providerEnabled
          ? undefined
          : 'fal.ai provider is not enabled for this environment.',
        queueName: parsed.type === 'video' ? AI_QUEUE_VIDEO : AI_QUEUE_IMAGE,
        globalConcurrency:
          parsed.queue?.globalConcurrency ??
          numberEnv(
            parsed.type === 'video'
              ? process.env.FAL_VIDEO_GLOBAL_CONCURRENCY
              : process.env.FAL_IMAGE_GLOBAL_CONCURRENCY,
            parsed.type === 'video' ? 4 : 12,
            1,
          ),
        perUserRunning:
          parsed.queue?.perUserRunning ??
          numberEnv(
            parsed.type === 'video'
              ? process.env.FAL_PER_USER_VIDEO_RUNNING
              : process.env.FAL_PER_USER_IMAGE_RUNNING,
            parsed.type === 'video' ? 1 : 2,
            1,
          ),
        perUserQueued:
          parsed.queue?.perUserQueued ??
          numberEnv(process.env.FAL_PER_USER_QUEUED_TOTAL, 10, 1),
        pollDelayMs: numberEnv(process.env.FAL_POLL_DELAY_MS, 5_000, 1_000),
        billing: parsed.billing,
      });
    });
  }

  private parseJson(raw: string): unknown[] {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        throw new Error('FAL_MODEL_CONFIGS must be a JSON array.');
      }
      return parsed;
    } catch (err) {
      this.logger.error(
        `Invalid FAL_MODEL_CONFIGS: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw err;
    }
  }
}
