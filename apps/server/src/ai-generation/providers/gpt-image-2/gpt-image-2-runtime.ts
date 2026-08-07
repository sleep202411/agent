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
  AiCatalogSource,
} from '../../types';

export const GPT_IMAGE_2_SCHEMA_VERSION = '2026-06-07';

export interface GptImage2RuntimeConfig {
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

export interface CreateGptImage2RuntimeArgs {
  provider: GptImage2RuntimeConfig['provider'];
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

export function createGptImage2RuntimeConfig(
  args: CreateGptImage2RuntimeArgs,
): GptImage2RuntimeConfig {
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
    inputSchema: inputSchemaFor(args.generationModes),
    outputSchema: outputSchemaFor(),
    documentation: documentationFor(args.provider),
  };
}

export function toGptImage2ModelDefinition(args: {
  config: GptImage2RuntimeConfig;
  modelId: string;
  source: AiCatalogSource;
  ops: AiModelDefinition['ops'];
}): AiModelDefinition {
  const { config } = args;
  const capabilityMatrix = capabilityMatrixFor(config.generationModes);
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
    schemaVersion: GPT_IMAGE_2_SCHEMA_VERSION,
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
      requestId: {
        jobField:
          config.provider === 'replicate' ? 'providerJobId' : 'requestId',
      },
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
      maxOutputs: Number(capabilityMatrix.limits.maxOutputs ?? 1),
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

function inputSchemaFor(generationModes: AiGenerationMode[]): AiInputSchema {
  const imageToImage = generationModes.includes('image_to_image');
  const inpainting = generationModes.includes('inpainting');
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
    },
    resolution: {
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
    },
    quality: {
      type: 'string',
      title: 'Quality',
      default: 'medium',
      enum: ['low', 'medium', 'high'],
      'x-ui': {
        control: 'segmented',
        group: 'settings',
        order: 26,
        importance: 'secondary',
      },
    },
    numOutputs: {
      type: 'integer',
      title: 'Outputs',
      default: 1,
      minimum: 1,
      maximum: 4,
      'x-ui': {
        control: 'stepper',
        group: 'settings',
        order: 30,
        importance: 'secondary',
      },
    },
    outputFormat: {
      type: 'string',
      title: 'Output format',
      default: 'png',
      enum: ['png', 'jpeg', 'webp'],
      'x-ui': {
        control: 'segmented',
        group: 'advanced',
        order: 84,
        importance: 'advanced',
      },
    },
  };

  if (imageToImage) {
    properties.referenceImages = {
      type: 'array',
      title: 'Reference images',
      minItems: 0,
      maxItems: 4,
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

  if (inpainting) {
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
): AiCapabilityMatrix {
  return {
    source: 'internal',
    inputModalities: generationModes.includes('image_to_image')
      ? ['text', 'image']
      : ['text'],
    outputModalities: ['image'],
    generationModes,
    supportedParameters: [
      'prompt',
      'image_size',
      'resolution',
      'quality',
      'num_images',
      ...(generationModes.includes('image_to_image') ? ['image_urls'] : []),
      ...(generationModes.includes('inpainting') ? ['mask_url'] : []),
      'output_format',
    ],
    unsupportedParameters: [],
    features: {
      cancel: generationModes.includes('image_to_image'),
      providerQueue: generationModes.includes('image_to_image'),
      providerUrlOutput: true,
    },
    limits: {
      maxOutputs: 4,
      maxPromptCharacters: 4000,
    },
  };
}

function documentationFor(
  provider: GptImage2RuntimeConfig['provider'],
): Array<{ title: string; url: string; scope: string }> {
  void provider;
  return [
    {
      title: 'Replicate GPT Image 2',
      url: 'https://replicate.com/openai/gpt-image-2/api',
      scope: 'api_reference',
    },
  ];
}
