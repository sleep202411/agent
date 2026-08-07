import { AI_MODEL_PROTOCOL_DIALECT } from '../../types';
import type {
  AiBillingPolicy,
  AiGenerationMode,
  AiInputSchema,
  AiJsonValue,
  AiModelDefinition,
  AiOutputSchema,
  AiQueueName,
  AiQueuePolicy,
  AiRequiredPlan,
  AiCatalogSource,
} from '../../types';

export const MINIMAX_SCHEMA_VERSION = '2026-08-07-h3';
export const MINIMAX_PROVIDER = 'minimax';
export const MINIMAX_H3_ENDPOINT = 'MiniMax-H3';
export const MINIMAX_H3_MODEL_ID = 'minimax-h3';

export interface MiniMaxRuntimeConfig {
  provider: typeof MINIMAX_PROVIDER;
  endpointId: string;
  name: string;
  description: string;
  enabled: boolean;
  disabledReason?: string;
  requiredPlan: AiRequiredPlan | null;
  generationModes: AiGenerationMode[];
  queue: {
    queueName: AiQueueName;
    globalConcurrency: number;
    perUserRunning: number;
    perUserQueued: number;
  };
  queuePolicy: AiQueuePolicy;
  billingPolicy: AiBillingPolicy;
  parameterPolicy?: AiJsonValue;
  outputPolicy?: AiJsonValue;
  inputSchema: AiInputSchema;
  outputSchema: AiOutputSchema;
}

export interface CreateMiniMaxRuntimeArgs {
  endpointId: string;
  name: string;
  description: string;
  generationModes: AiGenerationMode[];
  enabled: boolean;
  disabledReason?: string;
  requiredPlan: AiRequiredPlan | null;
  queueName: AiQueueName;
  globalConcurrency: number;
  perUserRunning: number;
  perUserQueued: number;
  billingPolicy: AiBillingPolicy;
  parameterPolicy?: AiJsonValue;
  outputPolicy?: AiJsonValue;
}

export function createMiniMaxRuntimeConfig(
  args: CreateMiniMaxRuntimeArgs,
): MiniMaxRuntimeConfig {
  const queuePolicy: AiQueuePolicy = {
    queueName: args.queueName,
    globalConcurrency: args.globalConcurrency,
    perUserRunning: args.perUserRunning,
    perUserQueued: args.perUserQueued,
    priority: 0,
    maxProviderRuntimeSeconds: 30 * 60,
    maxQueueWaitSeconds: 30 * 60,
    retryPolicy: {
      maxAttempts: 3,
      retryableCodes: ['PROVIDER_429', 'PROVIDER_5XX', 'PROVIDER_TIMEOUT'],
      backoffMs: [2_000, 10_000, 30_000],
    },
  };

  return {
    provider: MINIMAX_PROVIDER,
    endpointId: args.endpointId,
    name: args.name,
    description: args.description,
    enabled: args.enabled,
    disabledReason: args.disabledReason,
    requiredPlan: args.requiredPlan,
    generationModes: args.generationModes,
    queue: {
      queueName: args.queueName,
      globalConcurrency: args.globalConcurrency,
      perUserRunning: args.perUserRunning,
      perUserQueued: args.perUserQueued,
    },
    queuePolicy,
    billingPolicy: args.billingPolicy,
    parameterPolicy: args.parameterPolicy,
    outputPolicy: args.outputPolicy,
    inputSchema: videoInputSchemaFor(
      args.generationModes,
      args.parameterPolicy,
    ),
    outputSchema: videoOutputSchemaFor(),
  };
}

export function toMiniMaxModelDefinition(args: {
  config: MiniMaxRuntimeConfig;
  modelId: string;
  source: AiCatalogSource;
  ops?: AiModelDefinition['ops'];
}): AiModelDefinition {
  const { config } = args;
  return {
    id: args.modelId,
    provider: config.provider,
    providerModelId: config.endpointId,
    deployment: config.endpointId,
    modelName: config.endpointId,
    source: args.source,
    family: 'video',
    generationModes: config.generationModes,
    capability: 'video_generation',
    type: 'video',
    name: config.name,
    description: config.description,
    enabled: config.enabled,
    disabledReason: config.disabledReason,
    schemaDialect: AI_MODEL_PROTOCOL_DIALECT,
    schemaVersion: MINIMAX_SCHEMA_VERSION,
    documentation: [
      {
        title: 'MiniMax H3 Video Generation',
        url: 'https://platform.minimax.io/docs/guides/video-generation',
        source: 'official',
        scope: 'guide',
        provider: config.provider,
      },
      {
        title: 'Create Video Generation Task (V2)',
        url: 'https://platform.minimax.io/docs/api-reference/video-generation-v2-create',
        source: 'official',
        scope: 'api_reference',
        provider: config.provider,
      },
    ],
    capability_matrix: {
      modalities: { video: true },
      modes: Object.fromEntries(
        config.generationModes.map((mode) => [mode, true]),
      ),
    } as never,
    availability: {
      currentRegion: process.env.NEXT_PUBLIC_SITE_REGION ?? 'global',
      regions: [
        {
          region: process.env.NEXT_PUBLIC_SITE_REGION ?? 'global',
          status: config.enabled ? 'available' : 'requires_configuration',
          reason: config.disabledReason,
          endpointEnvVars: ['MINIMAX_ENABLED', 'MINIMAX_API_KEY'],
        },
      ],
    },
    cost_estimate: {
      billingMode: 'duration',
      currency: config.billingPolicy.displayCurrency,
      meters: [{ meter: 'video_seconds', unit: 'second' }],
      supportsPreflightEstimate: config.billingPolicy.preflightCost != null,
      finalCostSource: config.billingPolicy.finalCostSource,
    },
    observability: {
      requestId: { jobField: 'providerJobId' },
      logging: {
        events: ['minimax.v2.video_generation'],
        redactInputFields: [],
        redactProviderFields: ['Authorization'],
      },
      metrics: [
        {
          name: 'minimax.provider_run_ms',
          unit: 'ms',
          description: 'MiniMax provider runtime.',
        },
      ],
    },
    capabilities: {
      textToVideo: config.generationModes.includes('text_to_video'),
      imageToVideo: config.generationModes.includes('image_to_video'),
      supportsSeed: false,
      supportsCancel: false,
      maxOutputs: 1,
    },
    queue: config.queue,
    queue_policy: config.queuePolicy,
    entitlement: { requiredPlan: config.requiredPlan },
    entitlement_policy: { requiredPlan: config.requiredPlan },
    billing_policy: config.billingPolicy,
    parameter_policy: config.parameterPolicy,
    ui_policy: {
      defaultMode: 'simple',
      advancedVisible: true,
      showProviderName: true,
      showCostEstimate: true,
      showQueueEstimate: true,
    },
    input_schema: config.inputSchema,
    output_schema: config.outputSchema,
    provider_output_schema: config.outputSchema,
    provider_binding: {
      provider: config.provider,
      endpoint: config.endpointId,
      requestContentType: 'application/json',
    },
    ops: args.ops,
  };
}

function videoInputSchemaFor(
  generationModes: AiGenerationMode[],
  parameterPolicy?: AiJsonValue,
): AiInputSchema {
  const imageToVideo = generationModes.includes('image_to_video');
  const firstLastFrame = generationModes.includes('first_last_frame_to_video');
  const multimodal = generationModes.includes('multimodal_to_video');
  const resolutionOptions = stringArrayFromPolicy(
    parameterPolicy,
    'resolutionOptions',
  );
  const durationOptions = stringArrayFromPolicy(
    parameterPolicy,
    'durationOptions',
  );
  const aspectOptions = stringArrayFromPolicy(
    parameterPolicy,
    'supportedAspectRatios',
  );

  const properties: AiInputSchema['properties'] = {
    prompt: {
      type: 'string',
      title: 'Prompt',
      minLength: 1,
      maxLength: 7000,
      'x-ui': {
        control: 'textarea',
        group: 'prompt',
        order: 10,
        rows: 4,
        importance: 'primary',
      },
    },
  };

  if (imageToVideo || firstLastFrame) {
    properties.startFrame = {
      type: 'string',
      title: 'Start frame',
      'x-ui': { control: 'image_upload', group: 'reference', order: 20 },
    };
  }
  if (firstLastFrame) {
    properties.endFrame = {
      type: 'string',
      title: 'End frame',
      'x-ui': { control: 'image_upload', group: 'reference', order: 21 },
    };
  }

  const referenceInputs = referenceInputsFor(parameterPolicy);
  if (multimodal && referenceInputs) {
    if (referenceInputs.images.max > 0) {
      properties.referenceImages = {
        type: 'array',
        title: 'Reference images',
        minItems: referenceInputs.images.min,
        maxItems: referenceInputs.images.max,
        items: { type: 'string' },
        'x-ui': { control: 'image_upload', group: 'reference', order: 22 },
      };
    }
    if (referenceInputs.videos.max > 0) {
      properties.referenceVideos = {
        type: 'array',
        title: 'Reference videos',
        minItems: referenceInputs.videos.min,
        maxItems: referenceInputs.videos.max,
        items: { type: 'string' },
        'x-ui': { control: 'video_upload', group: 'reference', order: 23 },
      };
    }
    if (referenceInputs.audios.max > 0) {
      properties.referenceAudios = {
        type: 'array',
        title: 'Reference audio',
        minItems: referenceInputs.audios.min,
        maxItems: referenceInputs.audios.max,
        items: { type: 'string' },
        'x-ui': { control: 'audio_upload', group: 'reference', order: 24 },
      };
    }
  }

  const resolutionEnum =
    resolutionOptions.length > 0 ? resolutionOptions : ['768P', '2K'];
  const aspectEnum =
    aspectOptions.length > 0
      ? aspectOptions
      : ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'];

  properties.resolution = {
    type: 'string',
    title: 'Resolution',
    default: stringFromPolicy(parameterPolicy, 'defaultResolution') ?? '2K',
    // Official MiniMax-H3 wire enum (768P | 2K).
    enum: resolutionEnum,
    'x-ui': {
      control: 'segmented',
      group: 'settings',
      order: 30,
      // Explicit label/value — studio prefers options over bare enum.
      options: resolutionEnum.map((value) => ({
        value,
        label: value,
      })),
    },
  };
  properties.aspectRatio = {
    type: 'string',
    title: 'Aspect ratio',
    default: stringFromPolicy(parameterPolicy, 'defaultAspectRatio') ?? '16:9',
    // Official wire enum uses `adaptive` (OpenAPI). Product UI shows "Auto".
    enum: aspectEnum,
    'x-ui': {
      control: 'segmented',
      group: 'settings',
      order: 40,
      options: aspectEnum.map((value) =>
        value === 'adaptive' || value === 'auto'
          ? { value, label: 'Auto', labelKey: 'sizePresets.auto' }
          : { value, label: value },
      ),
    },
  };
  if (durationOptions.length > 0) {
    properties.duration = {
      type: 'string',
      title: 'Duration',
      default:
        stringFromPolicy(parameterPolicy, 'defaultDurationSeconds') ??
        durationOptions[0],
      enum: durationOptions,
      'x-ui': { control: 'select', group: 'settings', order: 50 },
    };
  } else {
    properties.duration = {
      type: 'integer',
      title: 'Duration (s)',
      enum: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      default: 5,
      'x-ui': { control: 'select', group: 'settings', order: 50 },
    };
  }

  return {
    type: 'object',
    required: ['prompt', 'duration', 'resolution'],
    properties,
  } as unknown as AiInputSchema;
}

function videoOutputSchemaFor(): AiOutputSchema {
  return {
    type: 'object',
    required: ['video'],
    properties: {
      video: {
        type: 'object',
        required: ['url'],
        properties: {
          url: { type: 'string' },
          content_type: { type: 'string' },
        },
      },
    },
  } as unknown as AiOutputSchema;
}

function referenceInputsFor(parameterPolicy?: AiJsonValue): {
  images: { min: number; max: number };
  videos: { min: number; max: number };
  audios: { min: number; max: number };
  maxTotalFiles: number;
} | null {
  const record = recordValue(parameterPolicy);
  const ref = recordValue(record?.referenceInputs);
  if (!ref || ref.enabled === false) return null;
  return {
    images: rangeFromPolicy(ref.images, 0, 9),
    videos: rangeFromPolicy(ref.videos, 0, 3),
    audios: rangeFromPolicy(ref.audios, 0, 3),
    maxTotalFiles:
      typeof ref.maxTotalFiles === 'number' &&
      Number.isFinite(ref.maxTotalFiles)
        ? ref.maxTotalFiles
        : 12,
  };
}

function rangeFromPolicy(
  value: unknown,
  fallbackMin: number,
  fallbackMax: number,
): { min: number; max: number } {
  const record = recordValue(value);
  return {
    min:
      typeof record?.min === 'number' && Number.isFinite(record.min)
        ? record.min
        : fallbackMin,
    max:
      typeof record?.max === 'number' && Number.isFinite(record.max)
        ? record.max
        : fallbackMax,
  };
}

function stringArrayFromPolicy(
  parameterPolicy: AiJsonValue | undefined,
  key: string,
): string[] {
  const raw = recordValue(parameterPolicy)?.[key];
  return Array.isArray(raw)
    ? raw.filter((item): item is string => typeof item === 'string')
    : [];
}

function stringFromPolicy(
  parameterPolicy: AiJsonValue | undefined,
  key: string,
): string | undefined {
  const raw = recordValue(parameterPolicy)?.[key];
  return typeof raw === 'string' ? raw : undefined;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
