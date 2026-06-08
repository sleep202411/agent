import { AI_MODEL_PROTOCOL_DIALECT } from '../../types';
import type {
  AiBillingPolicy,
  AiCapabilityMatrix,
  AiGenerationMode,
  AiInputSchema,
  AiJsonValue,
  AiJobType,
  AiModelDefinition,
  AiModelFamily,
  AiOutputSchema,
  AiQueueName,
  AiQueuePolicy,
  AiRequiredPlan,
} from '../../types';
import type {
  FalModelRuntimeConfig,
  FalProviderFieldBinding,
} from './fal.types';

export const FAL_SCHEMA_VERSION = '2026-05-26';

interface CreateFalModelConfigArgs {
  endpointId: string;
  type: AiJobType;
  name?: string;
  description?: string;
  generationModes?: string[];
  requiredPlan: string | null;
  enabled: boolean;
  disabledReason?: string;
  queueName: AiQueueName;
  globalConcurrency: number;
  perUserRunning: number;
  perUserQueued: number;
  pollDelayMs: number;
  billing?: Partial<AiBillingPolicy>;
  parameterPolicy?: AiJsonValue;
}

function humanizeEndpoint(endpointId: string): string {
  return endpointId
    .split('/')
    .slice(1)
    .join(' ')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function defaultGenerationModes(type: AiJobType): AiGenerationMode[] {
  return type === 'video' ? ['text_to_video'] : ['text_to_image'];
}

function familyForType(type: AiJobType): AiModelFamily {
  return type === 'video' ? 'video' : 'image';
}

function coarseCapability(type: AiJobType) {
  return type === 'video' ? 'video_generation' : 'image_generation';
}

function isNanoBananaEndpoint(endpointId: string): boolean {
  return /^fal-ai\/nano-banana(?:-2|-pro)?(?:\/edit)?$/.test(endpointId);
}

function isSeedreamEndpoint(endpointId: string): boolean {
  return /^fal-ai\/bytedance\/seedream\/v(?:4(?:\.5)?|5\/lite)\/text-to-image(?:\/edit)?$/.test(
    endpointId,
  );
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringArrayFromPolicy(
  policy: AiJsonValue | undefined,
  key: string,
): string[] {
  const value = recordValue(policy)?.[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function numberArrayFromPolicy(
  policy: AiJsonValue | undefined,
  key: string,
): number[] {
  const value = recordValue(policy)?.[key];
  return Array.isArray(value)
    ? value.filter(
        (item): item is number =>
          typeof item === 'number' && Number.isFinite(item),
      )
    : [];
}

function stringFromPolicy(
  policy: AiJsonValue | undefined,
  key: string,
): string | undefined {
  const value = recordValue(policy)?.[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function referencePolicy(policy: AiJsonValue | undefined): {
  enabled: boolean;
  min: number;
  max: number;
  maskSupported: boolean;
} {
  const value = recordValue(recordValue(policy)?.referenceImages);
  return {
    enabled: value?.enabled !== false,
    min:
      typeof value?.min === 'number' && Number.isFinite(value.min)
        ? Math.max(0, value.min)
        : 0,
    max:
      typeof value?.max === 'number' && Number.isFinite(value.max)
        ? Math.max(0, value.max)
        : 4,
    maskSupported: value?.maskSupported !== false,
  };
}

function seedEnabled(policy: AiJsonValue | undefined): boolean {
  return recordValue(recordValue(policy)?.seed)?.enabled !== false;
}

function inputSchemaFor(
  endpointId: string,
  type: AiJobType,
  generationModes: AiGenerationMode[],
  parameterPolicy?: AiJsonValue,
): AiInputSchema {
  const imageMode = type === 'image';
  const firstLastFrame = generationModes.includes('first_last_frame_to_video');
  const imageToVideo = generationModes.includes('image_to_video');
  const imageToImage = generationModes.includes('image_to_image');
  const nanoBanana = isNanoBananaEndpoint(endpointId);
  const seedream = isSeedreamEndpoint(endpointId);
  const aspectRatioDriven = nanoBanana || seedream;
  const referenceBase = referencePolicy(parameterPolicy);
  const reference = seedream
    ? { ...referenceBase, max: Math.min(referenceBase.max, 10) }
    : referenceBase;

  const properties: AiInputSchema['properties'] = {
    prompt: {
      type: 'string',
      title: 'Prompt',
      minLength: 1,
      maxLength: imageMode ? 4000 : 2000,
      'x-ui': {
        control: 'textarea',
        group: 'prompt',
        order: 10,
        rows: 5,
        importance: 'primary',
      },
      'x-provider': { parameter: 'prompt' },
    },
  };

  if (imageMode || imageToImage) {
    const aspectOptions = stringArrayFromPolicy(
      parameterPolicy,
      'supportedAspectRatios',
    );
    const resolutionOptions = stringArrayFromPolicy(
      parameterPolicy,
      'resolutionOptions',
    );
    const qualityOptions = stringArrayFromPolicy(
      parameterPolicy,
      'qualityOptions',
    );
    const outputFormatOptions = stringArrayFromPolicy(
      parameterPolicy,
      'outputFormatOptions',
    );
    const variationOptions = numberArrayFromPolicy(
      parameterPolicy,
      'variationOptions',
    );
    const maxVariations =
      variationOptions.length > 0 ? Math.max(...variationOptions) : 4;

    properties.imageSize = {
      type: 'string',
      title: 'Image size',
      default: aspectRatioDriven
        ? (stringFromPolicy(parameterPolicy, 'defaultAspectRatio') ?? '1:1')
        : 'landscape_4_3',
      enum: aspectRatioDriven
        ? aspectOptions.length > 0
          ? aspectOptions
          : ['1:1', '4:3', '3:4', '16:9', '9:16']
        : [
            'square_hd',
            'square',
            'portrait_4_3',
            'portrait_16_9',
            'landscape_4_3',
            'landscape_16_9',
          ],
      'x-ui': {
        control: 'select',
        group: 'settings',
        order: 20,
        importance: 'secondary',
      },
      'x-provider': {
        parameter: nanoBanana ? 'aspect_ratio' : 'image_size',
      },
    };

    if (resolutionOptions.length > 0) {
      properties.resolution = {
        type: 'string',
        title: 'Resolution',
        default:
          stringFromPolicy(parameterPolicy, 'defaultResolution') ??
          resolutionOptions[0],
        enum: resolutionOptions,
        'x-ui': {
          control: 'segmented',
          group: 'settings',
          order: 24,
          importance: 'secondary',
        },
        ...(nanoBanana
          ? ({
              'x-provider': {
                parameter: 'resolution',
                omitIfDefault: true,
              },
            } as const)
          : {}),
      };
    } else if (!nanoBanana) {
      properties.resolution = {
        type: 'string',
        title: 'Resolution',
        default: '1K',
        enum: ['1K', '2K', '4K'],
        'x-ui': {
          control: 'segmented',
          group: 'settings',
          order: 24,
          importance: 'secondary',
        },
      };
    }

    if (!nanoBanana && qualityOptions.length > 0) {
      properties.quality = {
        type: 'string',
        title: 'Quality',
        default:
          stringFromPolicy(parameterPolicy, 'defaultQuality') ?? 'medium',
        enum:
          qualityOptions.length > 0
            ? qualityOptions
            : ['low', 'medium', 'high'],
        'x-ui': {
          control: 'segmented',
          group: 'settings',
          order: 26,
          importance: 'secondary',
        },
        'x-provider': { parameter: 'quality' },
      };
    }

    if (maxVariations > 1) {
      properties.numOutputs = {
        type: 'integer',
        title: 'Outputs',
        default:
          typeof recordValue(parameterPolicy)?.defaultVariations === 'number'
            ? (recordValue(parameterPolicy)?.defaultVariations as number)
            : 1,
        minimum: Math.min(...variationOptions),
        maximum: maxVariations,
        'x-ui': {
          control: 'stepper',
          group: 'settings',
          order: 30,
          importance: 'secondary',
        },
        'x-provider': { parameter: 'num_images', omitIfDefault: true },
      };
    }

    if (outputFormatOptions.length > 0) {
      properties.outputFormat = {
        type: 'string',
        title: 'Output format',
        default:
          stringFromPolicy(parameterPolicy, 'defaultOutputFormat') ?? 'png',
        enum: outputFormatOptions,
        'x-ui': {
          control: 'segmented',
          group: 'advanced',
          order: 84,
          importance: 'advanced',
        },
        'x-provider': { parameter: 'output_format', omitIfDefault: true },
      };
    }
  }

  if (imageToImage && reference.enabled) {
    properties.referenceImages = {
      type: 'array',
      title: 'Reference images',
      minItems: reference.min,
      maxItems: reference.max,
      items: {
        type: 'object',
        properties: {
          url: { type: 'string', format: 'uri', title: 'URL' },
        },
        required: ['url'],
        additionalProperties: true,
      },
      'x-ui': {
        control: 'image_upload',
        group: 'references',
        order: 40,
        importance: 'primary',
      },
      'x-provider': { parameter: 'image_urls', transform: 'mediaArrayToUrls' },
    };
  }

  if (imageToImage && reference.enabled && reference.maskSupported) {
    properties.maskImage = {
      type: 'object',
      title: 'Mask image',
      properties: {
        url: { type: 'string', format: 'uri', title: 'URL' },
      },
      required: ['url'],
      additionalProperties: true,
      'x-ui': {
        control: 'image_upload',
        group: 'references',
        order: 45,
        importance: 'advanced',
      },
      'x-provider': {
        parameter: 'mask_url',
        transform: 'mediaUrl',
        omitIfEmpty: true,
      },
    };
  }

  if (imageToVideo) {
    properties.startFrame = {
      type: 'object',
      title: 'Start frame',
      properties: {
        url: { type: 'string', format: 'uri', title: 'URL' },
      },
      required: ['url'],
      additionalProperties: true,
      'x-ui': {
        control: 'image_upload',
        group: 'references',
        order: 40,
        importance: 'primary',
      },
      'x-provider': { parameter: 'image_url', transform: 'mediaUrl' },
    };
  }

  if (firstLastFrame) {
    properties.startFrame = {
      type: 'object',
      title: 'Start frame',
      properties: {
        url: { type: 'string', format: 'uri', title: 'URL' },
      },
      required: ['url'],
      additionalProperties: true,
      'x-ui': {
        control: 'image_upload',
        group: 'references',
        order: 40,
        importance: 'primary',
      },
      'x-provider': { parameter: 'image_url', transform: 'mediaUrl' },
    };
    properties.endFrame = {
      type: 'object',
      title: 'End frame',
      properties: {
        url: { type: 'string', format: 'uri', title: 'URL' },
      },
      required: ['url'],
      additionalProperties: true,
      'x-ui': {
        control: 'image_upload',
        group: 'references',
        order: 50,
        importance: 'primary',
      },
      'x-provider': { parameter: 'end_image_url', transform: 'mediaUrl' },
    };
  }

  if (type === 'video') {
    properties.durationSeconds = {
      type: 'integer',
      title: 'Duration',
      default: 5,
      minimum: 3,
      maximum: 10,
      'x-ui': {
        control: 'slider',
        group: 'settings',
        order: 60,
        unit: 's',
        importance: 'secondary',
      },
      'x-provider': {
        parameter: 'duration',
        transform: 'secondsToInteger',
        omitIfDefault: true,
      },
    };
    properties.aspectRatio = {
      type: 'string',
      title: 'Aspect ratio',
      default: '16:9',
      enum: ['16:9', '9:16', '1:1'],
      'x-ui': {
        control: 'segmented',
        group: 'settings',
        order: 70,
        importance: 'secondary',
      },
      'x-provider': { parameter: 'aspect_ratio', omitIfDefault: true },
    };
  }

  if (seedEnabled(parameterPolicy)) {
    properties.seed = {
      type: 'integer',
      title: 'Seed',
      minimum: 0,
      'x-ui': {
        control: 'stepper',
        group: 'advanced',
        order: 200,
        importance: 'advanced',
      },
      'x-provider': { parameter: 'seed', omitIfEmpty: true },
    };
  }

  return {
    type: 'object',
    properties,
    required: ['prompt'],
    additionalProperties: false,
    'x-ui': {
      groups: [
        { id: 'prompt', title: 'Prompt', order: 10 },
        { id: 'references', title: 'References', order: 20 },
        { id: 'settings', title: 'Settings', order: 30 },
        {
          id: 'advanced',
          title: 'Advanced',
          order: 90,
          collapsible: true,
          defaultCollapsed: true,
        },
      ],
    },
  };
}

function outputSchemaFor(type: AiJobType): AiOutputSchema {
  return {
    type: 'object',
    properties: {
      outputs: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            url: { type: 'string', format: 'uri', title: 'URL' },
            width: { type: 'integer', title: 'Width' },
            height: { type: 'integer', title: 'Height' },
            durationSeconds: { type: 'number', title: 'Duration' },
            mimeType: { type: 'string', title: 'MIME type' },
          },
          required: ['url'],
          additionalProperties: true,
        },
        'x-output': {
          control: type === 'video' ? 'video_player' : 'image_gallery',
          order: 10,
        },
      },
    },
    required: ['outputs'],
    additionalProperties: true,
  };
}

function capabilityMatrixFor(
  type: AiJobType,
  generationModes: AiGenerationMode[],
): AiCapabilityMatrix {
  return {
    source: 'internal',
    inputModalities: generationModes.some((mode) => mode.includes('image_to'))
      ? ['text', 'image']
      : ['text'],
    outputModalities: [type],
    generationModes,
    supportedParameters: [
      'prompt',
      'image_size',
      'resolution',
      'quality',
      'num_images',
      'image_url',
      'image_urls',
      'mask_url',
      'end_image_url',
      'output_format',
      'duration',
      'aspect_ratio',
      'seed',
    ],
    unsupportedParameters: [],
    features: {
      cancel: true,
      providerQueue: true,
      providerUrlOutput: true,
    },
    limits: {
      maxOutputs: type === 'video' ? 1 : 4,
      maxPromptCharacters: type === 'video' ? 2000 : 4000,
    },
  };
}

function providerInputMap(
  schema: AiInputSchema,
): Record<string, FalProviderFieldBinding> {
  const map: Record<string, FalProviderFieldBinding> = {};
  for (const [field, property] of Object.entries(schema.properties)) {
    const binding = property['x-provider'];
    if (!binding?.parameter) continue;
    map[field] = {
      parameter: binding.parameter,
      transform: binding.transform as FalProviderFieldBinding['transform'],
      omitIfDefault: binding.omitIfDefault,
      omitIfEmpty: binding.omitIfEmpty,
    };
  }
  return map;
}

function maxOutputsFromSchema(schema: AiInputSchema): number {
  const value = recordValue(schema.properties.numOutputs)?.maximum;
  return typeof value === 'number' && Number.isFinite(value) ? value : 1;
}

export function createFalModelConfig(
  args: CreateFalModelConfigArgs,
): FalModelRuntimeConfig {
  const generationModes = (
    args.generationModes?.length
      ? args.generationModes
      : defaultGenerationModes(args.type)
  ) as AiGenerationMode[];
  const inputSchema = inputSchemaFor(
    args.endpointId,
    args.type,
    generationModes,
    args.parameterPolicy,
  );
  const outputSchema = outputSchemaFor(args.type);
  const queuePolicy: AiQueuePolicy = {
    queueName: args.queueName,
    globalConcurrency: args.globalConcurrency,
    perUserRunning: args.perUserRunning,
    perUserQueued: args.perUserQueued,
    priority: 0,
    maxProviderRuntimeSeconds: args.type === 'video' ? 45 * 60 : 10 * 60,
    maxQueueWaitSeconds: args.type === 'video' ? 30 * 60 : 10 * 60,
    retryPolicy: {
      maxAttempts: 3,
      retryableCodes: ['PROVIDER_429', 'PROVIDER_5XX', 'PROVIDER_TIMEOUT'],
      backoffMs: [2_000, 10_000, 30_000],
    },
  };
  const productPricing = args.billing?.productPricing;
  if (!productPricing) {
    throw new Error(
      `fal.ai endpoint "${args.endpointId}" is missing canonical product pricing.`,
    );
  }

  return {
    endpointId: args.endpointId,
    type: args.type,
    family: familyForType(args.type),
    generationModes,
    name: args.name ?? humanizeEndpoint(args.endpointId),
    description:
      args.description ?? `${humanizeEndpoint(args.endpointId)} via fal.ai.`,
    enabled: args.enabled,
    disabledReason: args.disabledReason,
    requiredPlan: (args.requiredPlan as AiRequiredPlan | null) ?? null,
    queue: {
      queueName: args.queueName,
      globalConcurrency: args.globalConcurrency,
      perUserRunning: args.perUserRunning,
      perUserQueued: args.perUserQueued,
    },
    queuePolicy,
    billingPolicy: {
      mode: args.billing?.mode ?? 'charge',
      unit: args.billing?.unit ?? 'compute_point',
      displayCurrency: args.billing?.displayCurrency ?? 'COMPUTE_POINTS',
      preflightCost: args.billing?.preflightCost,
      finalCostSource: args.billing?.finalCostSource ?? 'product_pricing',
      refundPolicy: args.billing?.refundPolicy ?? 'refund_on_final_failure',
      productPricing,
    },
    parameterPolicy: args.parameterPolicy,
    inputSchema,
    outputSchema,
    providerInputMap: providerInputMap(inputSchema),
    outputPaths:
      args.type === 'video'
        ? ['video', 'videos', 'output.video', 'data.video', 'url']
        : ['images', 'image', 'output.images', 'data.images', 'url'],
    documentation: [
      {
        title: 'fal.ai model',
        url: `https://fal.ai/models/${args.endpointId}`,
        scope: 'model',
      },
      {
        title: 'fal.ai queue API',
        url: 'https://fal.ai/docs/documentation/model-apis/inference/queue',
        scope: 'api_reference',
      },
    ],
  };
}

export function toAiModelDefinition(
  config: FalModelRuntimeConfig,
): AiModelDefinition {
  const capabilityMatrix = capabilityMatrixFor(
    config.type,
    config.generationModes,
  );
  return {
    id: `fal/${config.endpointId}`,
    provider: 'fal-ai',
    providerModelId: config.endpointId,
    deployment: config.endpointId,
    modelName: config.endpointId,
    source: 'fal-config',
    family: config.family,
    generationModes: config.generationModes,
    capability: coarseCapability(config.type),
    type: config.type,
    name: config.name,
    description: config.description,
    enabled: config.enabled,
    disabledReason: config.disabledReason,
    schemaDialect: AI_MODEL_PROTOCOL_DIALECT,
    schemaVersion: FAL_SCHEMA_VERSION,
    documentation:
      config.documentation?.map((item) => ({
        title: item.title,
        url: item.url,
        source: item.url.includes('fal.ai') ? 'official' : 'internal',
        scope: item.scope as never,
        provider: 'fal-ai',
      })) ?? [],
    capability_matrix: capabilityMatrix,
    availability: {
      currentRegion: process.env.NEXT_PUBLIC_SITE_REGION ?? 'global',
      regions: [
        {
          region: process.env.NEXT_PUBLIC_SITE_REGION ?? 'global',
          status: config.enabled ? 'available' : 'requires_configuration',
          reason: config.disabledReason,
          endpointEnvVars: ['FAL_ENABLED', 'FAL_API_KEY'],
        },
      ],
    },
    cost_estimate: {
      billingMode:
        config.billingPolicy.unit === 'second'
          ? 'duration'
          : config.billingPolicy.unit === 'provider_usage'
            ? 'unknown'
            : 'credit',
      currency: config.billingPolicy.displayCurrency,
      meters: [
        {
          meter: config.type === 'video' ? 'video_seconds' : 'request',
          unit: config.type === 'video' ? 'second' : 'request',
        },
      ],
      supportsPreflightEstimate: config.billingPolicy.preflightCost != null,
      finalCostSource: config.billingPolicy.finalCostSource,
    },
    observability: {
      requestId: {
        jobField: 'providerJobId',
      },
      logging: {
        events: [
          'fal.queue.submit',
          'fal.queue.status',
          'fal.queue.response',
          'fal.queue.cancel',
        ],
        redactInputFields: [],
        redactProviderFields: ['Authorization'],
      },
      metrics: [
        {
          name: 'fal.queue_wait_ms',
          unit: 'ms',
          description: 'Time spent in fal.ai queue.',
        },
        {
          name: 'fal.provider_run_ms',
          unit: 'ms',
          description: 'fal.ai provider runtime.',
        },
      ],
    },
    capabilities: {
      textToImage: config.generationModes.includes('text_to_image'),
      imageToImage: config.generationModes.includes('image_to_image'),
      textToVideo: config.generationModes.includes('text_to_video'),
      imageToVideo:
        config.generationModes.includes('image_to_video') ||
        config.generationModes.includes('first_last_frame_to_video'),
      supportsSeed: Boolean(config.inputSchema.properties.seed),
      supportsCancel: true,
      maxOutputs: maxOutputsFromSchema(config.inputSchema),
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
      showProviderName: false,
      showCostEstimate: true,
      showQueueEstimate: true,
    },
    input_schema: config.inputSchema,
    output_schema: config.outputSchema,
    provider_output_schema: config.outputSchema,
    provider_binding: {
      provider: 'fal-ai',
      endpoint: config.endpointId,
      requestContentType: 'application/json',
    },
  };
}
