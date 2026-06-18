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

export const AGNES_SCHEMA_VERSION = '2026-06-18';

export interface AgnesRuntimeConfig {
  provider: 'agnes-ai';
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

export interface CreateAgnesRuntimeArgs {
  provider: AgnesRuntimeConfig['provider'];
  endpointId: string;
  type: AiJobType;
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

export function createAgnesRuntimeConfig(
  args: CreateAgnesRuntimeArgs,
): AgnesRuntimeConfig {
  const isVideo = args.type === 'video';
  const queuePolicy: AiQueuePolicy = {
    queueName: args.queueName,
    globalConcurrency: args.globalConcurrency,
    perUserRunning: args.perUserRunning,
    perUserQueued: args.perUserQueued,
    priority: 0,
    maxProviderRuntimeSeconds: isVideo ? 30 * 60 : 10 * 60,
    maxQueueWaitSeconds: isVideo ? 30 * 60 : 10 * 60,
    retryPolicy: {
      maxAttempts: 3,
      retryableCodes: ['PROVIDER_429', 'PROVIDER_5XX', 'PROVIDER_TIMEOUT'],
      backoffMs: [2_000, 10_000, 30_000],
    },
  };

  return {
    provider: args.provider,
    endpointId: args.endpointId,
    type: args.type,
    family: args.type,
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
    inputSchema: isVideo
      ? videoInputSchemaFor(args.parameterPolicy)
      : imageInputSchemaFor(args.parameterPolicy),
    outputSchema: isVideo ? videoOutputSchemaFor() : imageOutputSchemaFor(),
    documentation: documentationFor(args.endpointId),
  };
}

export function toAgnesModelDefinition(args: {
  config: AgnesRuntimeConfig;
  modelId: string;
  source: FoundryCatalogSource;
  ops: AiModelDefinition['ops'];
}): AiModelDefinition {
  const { config } = args;
  const isVideo = config.type === 'video';
  const capabilityMatrix = capabilityMatrixFor(
    config.type,
    config.generationModes,
    config.inputSchema,
  );
  const endpointEnvVars = ['AGNES_API_KEY'];

  return {
    id: args.modelId,
    provider: config.provider,
    providerModelId: config.endpointId,
    deployment: config.endpointId,
    modelName: config.endpointId,
    source: args.source,
    family: config.family,
    generationModes: config.generationModes,
    capability: isVideo ? 'video_generation' : 'image_generation',
    type: config.type,
    name: config.name,
    description: config.description,
    enabled: config.enabled,
    disabledReason: config.disabledReason,
    schemaDialect: AI_MODEL_PROTOCOL_DIALECT,
    schemaVersion: AGNES_SCHEMA_VERSION,
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
        events: [isVideo ? 'agnes.videos.status' : 'agnes.images.generations'],
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
    capabilities: isVideo
      ? {
          textToVideo: config.generationModes.includes('text_to_video'),
          imageToVideo: false,
          supportsSeed: false,
          supportsCancel: false,
          maxOutputs: 1,
        }
      : {
          textToImage: config.generationModes.includes('text_to_image'),
          imageToImage: false,
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

function imageInputSchemaFor(parameterPolicy?: AiJsonValue): AiInputSchema {
  const aspectOptions = stringArrayFromPolicy(
    parameterPolicy,
    'supportedAspectRatios',
  );
  return {
    type: 'object',
    properties: {
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
        default:
          stringFromPolicy(parameterPolicy, 'defaultAspectRatio') ?? '1:1',
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
    },
    required: ['prompt'],
    additionalProperties: false,
    'x-ui': {
      groups: [
        { id: 'prompt', title: 'Prompt', order: 10 },
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

function videoInputSchemaFor(parameterPolicy?: AiJsonValue): AiInputSchema {
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

  return {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        title: 'Prompt',
        minLength: 1,
        maxLength: 4000,
        'x-ui': {
          control: 'textarea',
          group: 'prompt',
          order: 10,
          rows: 4,
          importance: 'primary',
        },
      },
      resolution: {
        type: 'string',
        title: 'Resolution',
        default:
          stringFromPolicy(parameterPolicy, 'defaultResolution') ?? '480p',
        enum:
          resolutionOptions.length > 0 ? resolutionOptions : ['480p', '720p'],
        'x-ui': {
          control: 'segmented',
          group: 'settings',
          order: 30,
          importance: 'secondary',
        },
      },
      aspectRatio: {
        type: 'string',
        title: 'Aspect ratio',
        default:
          stringFromPolicy(parameterPolicy, 'defaultAspectRatio') ?? '16:9',
        enum:
          aspectOptions.length > 0
            ? aspectOptions
            : ['16:9', '9:16', '1:1', '4:3', '3:4'],
        'x-ui': {
          control: 'segmented',
          group: 'settings',
          order: 40,
          importance: 'secondary',
        },
      },
      duration: {
        type: 'string',
        title: 'Duration',
        default:
          stringFromPolicy(parameterPolicy, 'defaultDurationSeconds') ?? '5',
        enum:
          durationOptions.length > 0
            ? durationOptions
            : ['4', '5', '6', '8', '10', '12', '15'],
        'x-ui': {
          control: 'select',
          group: 'settings',
          order: 50,
          importance: 'secondary',
          unit: 's',
        },
      },
    },
    required: ['prompt'],
    additionalProperties: false,
    'x-ui': {
      groups: [
        { id: 'prompt', title: 'Prompt', order: 10 },
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

function imageOutputSchemaFor(): AiOutputSchema {
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
        'x-output': { control: 'image_gallery', order: 10 },
      },
    },
    required: ['outputs'],
    additionalProperties: true,
  };
}

function videoOutputSchemaFor(): AiOutputSchema {
  return {
    type: 'object',
    properties: {
      outputs: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            url: { type: 'string', format: 'uri', title: 'URL' },
            mimeType: { type: 'string', title: 'MIME type' },
            durationSeconds: { type: 'number', title: 'Duration (s)' },
          },
          required: ['url'],
          additionalProperties: true,
        },
        'x-output': { control: 'video_player', order: 10 },
      },
    },
    required: ['outputs'],
    additionalProperties: true,
  };
}

function capabilityMatrixFor(
  type: AiJobType,
  generationModes: AiGenerationMode[],
  inputSchema: AiInputSchema,
): AiCapabilityMatrix {
  const isVideo = type === 'video';
  return {
    source: 'internal',
    inputModalities: ['text'],
    outputModalities: isVideo ? ['video'] : ['image'],
    generationModes,
    supportedParameters: Object.keys(inputSchema.properties),
    unsupportedParameters: [],
    features: {
      cancel: false,
      providerQueue: isVideo,
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
      title: `Agnes AI ${endpointId}`,
      url: 'https://apihub.agnes-ai.com',
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
