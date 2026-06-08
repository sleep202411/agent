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

export const BYTEPLUS_IMAGE_SCHEMA_VERSION = '2026-06-08';

export interface BytePlusImageRuntimeConfig {
  provider: 'byteplus-modelark';
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

export interface CreateBytePlusImageRuntimeArgs {
  provider: BytePlusImageRuntimeConfig['provider'];
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

export function createBytePlusImageRuntimeConfig(
  args: CreateBytePlusImageRuntimeArgs,
): BytePlusImageRuntimeConfig {
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
    inputSchema: inputSchemaFor(args.generationModes, args.parameterPolicy),
    outputSchema: outputSchemaFor(),
    documentation: documentationFor(args.endpointId),
  };
}

export function toBytePlusImageModelDefinition(args: {
  config: BytePlusImageRuntimeConfig;
  modelId: string;
  source: FoundryCatalogSource;
  ops: AiModelDefinition['ops'];
}): AiModelDefinition {
  const { config } = args;
  const capabilityMatrix = capabilityMatrixFor(
    config.generationModes,
    config.inputSchema,
  );
  const endpointEnvVars = [
    'BYTEPLUS_MODELARK_ENABLED',
    'BYTEPLUS_MODELARK_API_KEY',
  ];

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
    schemaVersion: BYTEPLUS_IMAGE_SCHEMA_VERSION,
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
        events: ['byteplus.images.generations'],
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
  generationModes: AiGenerationMode[],
  parameterPolicy?: AiJsonValue,
): AiInputSchema {
  const imageToImage = generationModes.includes('image_to_image');
  const reference = referencePolicy(parameterPolicy);
  const aspectOptions = stringArrayFromPolicy(
    parameterPolicy,
    'supportedAspectRatios',
  );
  const resolutionOptions = stringArrayFromPolicy(
    parameterPolicy,
    'resolutionOptions',
  );

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
    imageSize: {
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
      cancel: false,
      providerQueue: false,
      providerUrlOutput: true,
    },
    limits: {
      maxOutputs: 1,
      maxPromptCharacters: 4000,
    },
  };
}

function documentationFor(
  endpointId: string,
): Array<{ title: string; url: string; scope: string }> {
  return [
    {
      title: `BytePlus ModelArk ${endpointId}`,
      url: 'https://docs.byteplus.com/en/docs/ModelArk/1541523',
      scope: 'api_reference',
    },
  ];
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

function referencePolicy(policy: AiJsonValue | undefined): {
  enabled: boolean;
  min: number;
  max: number;
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
        : 14,
  };
}
