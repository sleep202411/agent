import { AI_MODEL_PROTOCOL_DIALECT } from '../../types';
import type {
  AiBillingPolicy,
  AiCapabilityMatrix,
  AiGenerationMode,
  AiInputSchema,
  AiJobType,
  AiJsonValue,
  AiModelDefinition,
  AiModelFamily,
  AiOutputSchema,
  AiQueueName,
  AiQueuePolicy,
  AiRequiredPlan,
  FoundryCatalogSource,
} from '../../types';

export const REPLICATE_IMAGE_SCHEMA_VERSION = '2026-06-08';

export interface ReplicateImageRuntimeConfig {
  provider: 'replicate';
  endpointId: string;
  type: AiJobType;
  family: AiModelFamily;
  generationModes: AiGenerationMode[];
  name: string;
  description: string;
  enabled: boolean;
  disabledReason?: string;
  requiredPlan: AiRequiredPlan | null;
  queue: {
    queueName: AiQueueName;
    globalConcurrency: number;
    perUserRunning: number;
    perUserQueued: number;
  };
  queuePolicy: AiQueuePolicy;
  billingPolicy: AiBillingPolicy;
  parameterPolicy?: AiJsonValue;
  inputSchema: AiInputSchema;
  outputSchema: AiOutputSchema;
  documentation: Array<{ title: string; url: string; scope: string }>;
}

export interface CreateReplicateImageRuntimeArgs {
  provider: ReplicateImageRuntimeConfig['provider'];
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
}

export function createReplicateImageRuntimeConfig(
  args: CreateReplicateImageRuntimeArgs,
): ReplicateImageRuntimeConfig {
  const queuePolicy: AiQueuePolicy = {
    queueName: args.queueName,
    globalConcurrency: args.globalConcurrency,
    perUserRunning: args.perUserRunning,
    perUserQueued: args.perUserQueued,
    priority: 0,
    maxProviderRuntimeSeconds: 10 * 60,
    maxQueueWaitSeconds: 10 * 60,
    retryPolicy: {
      maxAttempts: 3,
      retryableCodes: ['PROVIDER_429', 'PROVIDER_5XX', 'PROVIDER_TIMEOUT'],
      backoffMs: [2_000, 10_000, 30_000],
    },
  };

  return {
    provider: args.provider,
    endpointId: args.endpointId,
    type: 'image',
    family: 'image',
    generationModes: args.generationModes,
    name: args.name,
    description: args.description,
    enabled: args.enabled,
    disabledReason: args.disabledReason,
    requiredPlan: args.requiredPlan,
    queue: {
      queueName: args.queueName,
      globalConcurrency: args.globalConcurrency,
      perUserRunning: args.perUserRunning,
      perUserQueued: args.perUserQueued,
    },
    queuePolicy,
    billingPolicy: args.billingPolicy,
    parameterPolicy: args.parameterPolicy,
    inputSchema: inputSchemaFor(
      args.endpointId,
      args.generationModes,
      args.parameterPolicy,
    ),
    outputSchema: outputSchemaFor(),
    documentation: documentationFor(args.endpointId),
  };
}

export function toReplicateImageModelDefinition(args: {
  config: ReplicateImageRuntimeConfig;
  modelId: string;
  source: FoundryCatalogSource;
  ops: AiModelDefinition['ops'];
}): AiModelDefinition {
  const { config } = args;
  const capabilityMatrix = capabilityMatrixFor(
    config.generationModes,
    config.inputSchema,
  );
  const endpointEnvVars = ['REPLICATE_ENABLED', 'REPLICATE_API_TOKEN'];

  return {
    id: args.modelId,
    provider: config.provider,
    providerModelId: config.endpointId,
    deployment: config.endpointId,
    modelName: config.endpointId,
    source: args.source,
    family: config.family,
    generationModes: config.generationModes,
    capability: 'image_generation',
    type: config.type,
    name: config.name,
    description: config.description,
    enabled: config.enabled,
    disabledReason: config.disabledReason,
    schemaDialect: AI_MODEL_PROTOCOL_DIALECT,
    schemaVersion: REPLICATE_IMAGE_SCHEMA_VERSION,
    documentation: config.documentation.map((item) => ({
      title: item.title,
      url: item.url,
      source: 'official',
      scope: item.scope as never,
      provider: config.provider,
    })),
    capability_matrix: capabilityMatrix,
    availability: {
      currentRegion: process.env.NEXT_PUBLIC_SITE_REGION ?? 'global',
      regions: [
        {
          region: process.env.NEXT_PUBLIC_SITE_REGION ?? 'global',
          status: config.enabled ? 'available' : 'requires_configuration',
          reason: config.disabledReason,
          endpointEnvVars,
        },
      ],
    },
    cost_estimate: {
      billingMode:
        config.billingPolicy.unit === 'provider_usage' ? 'unknown' : 'credit',
      currency: config.billingPolicy.displayCurrency,
      meters: [{ meter: 'request', unit: 'request' }],
      supportsPreflightEstimate: config.billingPolicy.preflightCost != null,
      finalCostSource: config.billingPolicy.finalCostSource,
    },
    observability: {
      requestId: { jobField: 'providerJobId' },
      logging: {
        events: [
          'replicate.prediction.submit',
          'replicate.prediction.status',
          'replicate.prediction.cancel',
        ],
        redactInputFields: [],
        redactProviderFields: ['Authorization'],
      },
      metrics: [
        {
          name: `${config.provider}.provider_run_ms`,
          unit: 'ms',
          description: `${config.provider} provider runtime.`,
        },
      ],
    },
    capabilities: {
      textToImage: config.generationModes.includes('text_to_image'),
      imageToImage: config.generationModes.includes('image_to_image'),
      supportsSeed: false,
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
      provider: config.provider,
      endpoint: config.endpointId,
      requestContentType: 'application/json',
    },
    ops: args.ops,
  };
}

function inputSchemaFor(
  endpointId: string,
  generationModes: AiGenerationMode[],
  parameterPolicy?: AiJsonValue,
): AiInputSchema {
  const imageToImage = generationModes.includes('image_to_image');
  const inpainting = generationModes.includes('inpainting');
  const nanoBanana = isNanoBananaEndpoint(endpointId);
  const seedream = isSeedreamEndpoint(endpointId);
  const reference = referencePolicy(parameterPolicy);
  const properties: AiInputSchema['properties'] = {
    prompt: {
      type: 'string',
      title: 'Prompt',
      minLength: 1,
      maxLength: 4000,
      'x-ui': {
        control: 'textarea',
        group: 'prompt',
        order: 10,
        rows: 5,
        importance: 'primary',
      },
    },
    imageSize: imageSizeProperty(endpointId, parameterPolicy),
  };

  const resolutionOptions = resolutionOptionsFor(endpointId, parameterPolicy);
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
    };
  }

  const qualityOptions = stringArrayFromPolicy(
    parameterPolicy,
    'qualityOptions',
  );
  if (!nanoBanana && qualityOptions.length > 0) {
    properties.quality = {
      type: 'string',
      title: 'Quality',
      default: stringFromPolicy(parameterPolicy, 'defaultQuality') ?? 'medium',
      enum: qualityOptions,
      'x-ui': {
        control: 'segmented',
        group: 'settings',
        order: 26,
        importance: 'secondary',
      },
    };
  }

  const variationOptions = numberArrayFromPolicy(
    parameterPolicy,
    'variationOptions',
  );
  const maxVariations =
    variationOptions.length > 0 ? Math.max(...variationOptions) : 1;
  if (maxVariations > 1) {
    properties.numOutputs = {
      type: 'integer',
      title: 'Outputs',
      default: numberFromPolicy(parameterPolicy, 'defaultVariations') ?? 1,
      minimum: Math.min(...variationOptions),
      maximum: maxVariations,
      'x-ui': {
        control: 'stepper',
        group: 'settings',
        order: 30,
        importance: 'secondary',
      },
    };
  }

  const outputFormatOptions = stringArrayFromPolicy(
    parameterPolicy,
    'outputFormatOptions',
  );
  if (!seedream && outputFormatOptions.length > 0) {
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
    };
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
    };
  }

  if (inpainting && reference.maskSupported) {
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

function imageSizeProperty(
  endpointId: string,
  parameterPolicy?: AiJsonValue,
): AiInputSchema['properties'][string] {
  if (isNanoBananaEndpoint(endpointId)) {
    const aspectOptions = stringArrayFromPolicy(
      parameterPolicy,
      'supportedAspectRatios',
    );
    return {
      type: 'string',
      title: 'Image size',
      default: stringFromPolicy(parameterPolicy, 'defaultAspectRatio') ?? '1:1',
      enum:
        aspectOptions.length > 0
          ? aspectOptions
          : ['1:1', '4:3', '3:4', '16:9', '9:16'],
      'x-ui': {
        control: 'select',
        group: 'settings',
        order: 20,
        importance: 'secondary',
      },
    };
  }

  if (isSeedreamEndpoint(endpointId)) {
    const aspectOptions = stringArrayFromPolicy(
      parameterPolicy,
      'supportedAspectRatios',
    );
    return {
      type: 'string',
      title: 'Image size',
      default: stringFromPolicy(parameterPolicy, 'defaultAspectRatio') ?? '1:1',
      enum:
        aspectOptions.length > 0
          ? aspectOptions
          : ['1:1', '4:3', '3:4', '16:9', '9:16'],
      'x-ui': {
        control: 'select',
        group: 'settings',
        order: 20,
        importance: 'secondary',
      },
    };
  }

  return {
    type: 'string',
    title: 'Image size',
    default: 'landscape_4_3',
    enum: [
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
  };
}

function outputSchemaFor(): AiOutputSchema {
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
            mimeType: { type: 'string', title: 'MIME type' },
          },
          required: ['url'],
          additionalProperties: true,
        },
        'x-output': {
          control: 'image_gallery',
          order: 10,
        },
      },
    },
    required: ['outputs'],
    additionalProperties: true,
  };
}

function capabilityMatrixFor(
  generationModes: AiGenerationMode[],
  inputSchema: AiInputSchema,
): AiCapabilityMatrix {
  return {
    source: 'internal',
    inputModalities: generationModes.includes('image_to_image')
      ? ['text', 'image']
      : ['text'],
    outputModalities: ['image'],
    generationModes,
    supportedParameters: Object.keys(inputSchema.properties),
    unsupportedParameters: [],
    features: {
      cancel: true,
      providerQueue: true,
      providerUrlOutput: true,
    },
    limits: {
      maxOutputs: maxOutputsFromSchema(inputSchema),
      maxPromptCharacters: 4000,
    },
  };
}

function documentationFor(
  endpointId: string,
): Array<{ title: string; url: string; scope: string }> {
  return [
    {
      title: `Replicate ${endpointId}`,
      url: `https://replicate.com/${endpointId}/api`,
      scope: 'api_reference',
    },
  ];
}

function isNanoBananaEndpoint(endpointId: string): boolean {
  return /^google\/nano-banana(?:-2|-pro)?$/.test(endpointId);
}

function isSeedreamEndpoint(endpointId: string): boolean {
  return /^bytedance\/seedream-(?:4|4\.5|5-lite)$/.test(endpointId);
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

function stringFromPolicy(
  policy: AiJsonValue | undefined,
  key: string,
): string | undefined {
  const value = recordValue(policy)?.[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
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

function numberFromPolicy(
  policy: AiJsonValue | undefined,
  key: string,
): number | undefined {
  const value = recordValue(policy)?.[key];
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function resolutionOptionsFor(
  endpointId: string,
  parameterPolicy?: AiJsonValue,
): string[] {
  const options = stringArrayFromPolicy(parameterPolicy, 'resolutionOptions');
  if (endpointId === 'bytedance/seedream-5-lite') {
    return options.filter((item) => item === '2K' || item === '3K');
  }
  return options;
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

function maxOutputsFromSchema(schema: AiInputSchema): number {
  const value = recordValue(schema.properties.numOutputs)?.maximum;
  return typeof value === 'number' && Number.isFinite(value) ? value : 1;
}
