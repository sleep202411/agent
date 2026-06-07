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
  BailianModelRuntimeConfig,
  BailianModelService,
  BailianProviderFieldBinding,
} from './bailian.types';

export const BAILIAN_SCHEMA_VERSION = '2026-06-05';

interface CreateBailianModelConfigArgs {
  endpointId: string;
  service: BailianModelService;
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

function providerProperty(
  property: Record<string, unknown>,
): AiInputSchema['properties'][string] {
  return property as unknown as AiInputSchema['properties'][string];
}

function humanizeEndpoint(endpointId: string): string {
  return endpointId
    .replace(/^wan/i, 'Wan ')
    .replace(/^qwen/i, 'Qwen ')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .replace(/\bR2v\b/i, 'R2V')
    .replace(/\bI2v\b/i, 'I2V')
    .replace(/\bT2v\b/i, 'T2V');
}

function defaultGenerationModes(
  type: AiJobType,
  service: BailianModelService,
): AiGenerationMode[] {
  if (service === 'video-synthesis') return ['text_to_video'];
  return type === 'image' ? ['text_to_image'] : ['text_to_video'];
}

function familyForType(type: AiJobType): AiModelFamily {
  return type === 'video' ? 'video' : 'image';
}

function coarseCapability(type: AiJobType) {
  return type === 'video' ? 'video_generation' : 'image_generation';
}

function inputSchemaFor(
  type: AiJobType,
  generationModes: AiGenerationMode[],
): AiInputSchema {
  const properties: AiInputSchema['properties'] = {
    prompt: providerProperty({
      type: 'string',
      title: 'Prompt',
      minLength: 1,
      maxLength: type === 'video' ? 2000 : 4000,
      'x-ui': {
        control: 'textarea',
        group: 'prompt',
        order: 10,
        rows: 5,
        importance: 'primary',
      },
      'x-provider': { section: 'input', parameter: 'prompt' },
    }),
  };

  if (
    generationModes.includes('image_to_image') ||
    generationModes.includes('image_to_video')
  ) {
    properties.startFrame = providerProperty({
      type: 'object',
      title: type === 'video' ? 'Start frame' : 'Reference image',
      properties: {
        url: { type: 'string', format: 'uri', title: 'URL' },
      },
      required: ['url'],
      additionalProperties: true,
      'x-ui': {
        control: 'image_upload',
        group: 'references',
        order: 30,
        importance: 'primary',
      },
      'x-provider': {
        section: 'input',
        parameter: 'img_url',
        transform: 'mediaUrl',
        omitIfEmpty: true,
      },
    });
  }

  if (
    generationModes.includes('multimodal_to_video') ||
    generationModes.includes('video_to_video')
  ) {
    properties.references = providerProperty({
      type: 'array',
      title: 'References',
      minItems: 1,
      maxItems: 4,
      items: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            title: 'Type',
            enum: ['reference_image', 'reference_video', 'reference_audio'],
          },
          url: { type: 'string', format: 'uri', title: 'URL' },
          referenceVoice: {
            type: 'string',
            format: 'uri',
            title: 'Reference voice',
          },
        },
        required: ['type', 'url'],
        additionalProperties: true,
      },
      'x-ui': {
        control: 'media_upload',
        group: 'references',
        order: 30,
        importance: 'primary',
      },
      'x-provider': {
        section: 'input',
        parameter: 'media',
        transform: 'mediaArray',
        omitIfEmpty: true,
      },
    });
  }

  if (type === 'image') {
    properties.size = providerProperty({
      type: 'string',
      title: 'Size',
      default: '1024*1024',
      enum: [
        '1024*1024',
        '1280*720',
        '720*1280',
        '960*1280',
        '1280*960',
        '1440*1440',
      ],
      'x-ui': {
        control: 'select',
        group: 'settings',
        order: 40,
        importance: 'secondary',
      },
      'x-provider': {
        section: 'parameters',
        parameter: 'size',
        omitIfDefault: true,
      },
    });
    properties.numOutputs = providerProperty({
      type: 'integer',
      title: 'Outputs',
      default: 1,
      minimum: 1,
      maximum: 4,
      'x-ui': {
        control: 'stepper',
        group: 'settings',
        order: 50,
        importance: 'secondary',
      },
      'x-provider': {
        section: 'parameters',
        parameter: 'n',
        omitIfDefault: true,
      },
    });
  }

  if (type === 'video') {
    properties.durationSeconds = providerProperty({
      type: 'integer',
      title: 'Duration',
      default: 5,
      minimum: 3,
      maximum: 10,
      'x-ui': {
        control: 'slider',
        group: 'settings',
        order: 40,
        unit: 's',
        importance: 'secondary',
      },
      'x-provider': {
        section: 'parameters',
        parameter: 'duration',
        transform: 'secondsToInteger',
        omitIfDefault: true,
      },
    });
    properties.resolution = providerProperty({
      type: 'string',
      title: 'Resolution',
      default: '720P',
      enum: ['480P', '720P', '1080P'],
      'x-ui': {
        control: 'segmented',
        group: 'settings',
        order: 50,
        importance: 'secondary',
      },
      'x-provider': {
        section: 'parameters',
        parameter: 'resolution',
        omitIfDefault: true,
      },
    });
    properties.aspectRatio = providerProperty({
      type: 'string',
      title: 'Aspect ratio',
      default: '16:9',
      enum: ['16:9', '9:16', '1:1'],
      'x-ui': {
        control: 'segmented',
        group: 'settings',
        order: 60,
        importance: 'secondary',
      },
      'x-provider': {
        section: 'parameters',
        parameter: 'aspect_ratio',
        omitIfDefault: true,
      },
    });
  }

  properties.promptExtend = providerProperty({
    type: 'boolean',
    title: 'Prompt enhance',
    default: true,
    'x-ui': {
      control: 'switch',
      group: 'advanced',
      order: 180,
      importance: 'advanced',
    },
    'x-provider': {
      section: 'parameters',
      parameter: 'prompt_extend',
      omitIfDefault: true,
    },
  });
  properties.seed = providerProperty({
    type: 'integer',
    title: 'Seed',
    minimum: 0,
    'x-ui': {
      control: 'stepper',
      group: 'advanced',
      order: 200,
      importance: 'advanced',
    },
    'x-provider': {
      section: 'parameters',
      parameter: 'seed',
      omitIfEmpty: true,
    },
  });

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
  const inputModalities = new Set<'text' | 'image' | 'video'>(['text']);
  if (
    generationModes.some(
      (mode) =>
        mode.includes('image') ||
        mode === 'multimodal_to_image' ||
        mode === 'multimodal_to_video',
    )
  ) {
    inputModalities.add('image');
  }
  if (
    generationModes.includes('video_to_video') ||
    generationModes.includes('multimodal_to_video')
  ) {
    inputModalities.add('video');
  }
  return {
    source: 'internal',
    inputModalities: Array.from(inputModalities),
    outputModalities: [type],
    generationModes,
    supportedParameters: [
      'prompt',
      'media',
      'img_url',
      'size',
      'n',
      'duration',
      'resolution',
      'aspect_ratio',
      'prompt_extend',
      'seed',
    ],
    unsupportedParameters: [],
    features: {
      cancel: false,
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
): Record<string, BailianProviderFieldBinding> {
  const map: Record<string, BailianProviderFieldBinding> = {};
  for (const [field, property] of Object.entries(schema.properties)) {
    const binding = property['x-provider'] as
      | (BailianProviderFieldBinding & { parameter?: string })
      | undefined;
    if (!binding?.parameter) continue;
    map[field] = {
      section:
        binding.section === 'parameters' || binding.section === 'input'
          ? binding.section
          : 'input',
      parameter: binding.parameter,
      transform: binding.transform,
      omitIfDefault: binding.omitIfDefault,
      omitIfEmpty: binding.omitIfEmpty,
    };
  }
  return map;
}

export function createBailianModelConfig(
  args: CreateBailianModelConfigArgs,
): BailianModelRuntimeConfig {
  const generationModes = (
    args.generationModes?.length
      ? args.generationModes
      : defaultGenerationModes(args.type, args.service)
  ) as AiGenerationMode[];
  const inputSchema = inputSchemaFor(args.type, generationModes);
  const outputSchema = outputSchemaFor(args.type);
  const queuePolicy: AiQueuePolicy = {
    queueName: args.queueName,
    globalConcurrency: args.globalConcurrency,
    perUserRunning: args.perUserRunning,
    perUserQueued: args.perUserQueued,
    priority: 0,
    maxProviderRuntimeSeconds: args.type === 'video' ? 60 * 60 : 15 * 60,
    maxQueueWaitSeconds: args.type === 'video' ? 30 * 60 : 10 * 60,
    retryPolicy: {
      maxAttempts: 3,
      retryableCodes: ['PROVIDER_429', 'PROVIDER_5XX', 'PROVIDER_TIMEOUT'],
      backoffMs: [3_000, 15_000, 45_000],
    },
  };
  const productPricing = args.billing?.productPricing;
  if (!productPricing) {
    throw new Error(
      `Alibaba Model Studio endpoint "${args.endpointId}" is missing canonical product pricing.`,
    );
  }

  return {
    endpointId: args.endpointId,
    service: args.service,
    type: args.type,
    family: familyForType(args.type),
    generationModes,
    name: args.name ?? humanizeEndpoint(args.endpointId),
    description:
      args.description ??
      `${humanizeEndpoint(args.endpointId)} via Alibaba Model Studio.`,
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
    documentation: documentationForEndpoint(args.endpointId, args.service),
  };
}

export function toAiModelDefinition(
  config: BailianModelRuntimeConfig,
): AiModelDefinition {
  const capabilityMatrix = capabilityMatrixFor(
    config.type,
    config.generationModes,
  );
  return {
    id: `bailian/${config.endpointId}`,
    provider: 'aliyun-bailian',
    providerModelId: config.endpointId,
    deployment: config.endpointId,
    modelName: config.endpointId,
    source: 'bailian-config',
    family: config.family,
    generationModes: config.generationModes,
    capability: coarseCapability(config.type),
    type: config.type,
    name: config.name,
    description: config.description,
    enabled: config.enabled,
    disabledReason: config.disabledReason,
    schemaDialect: AI_MODEL_PROTOCOL_DIALECT,
    schemaVersion: BAILIAN_SCHEMA_VERSION,
    documentation:
      config.documentation?.map((item) => ({
        title: item.title,
        url: item.url,
        source: item.url.includes('aliyun.com') ? 'official' : 'internal',
        scope: item.scope as never,
        provider: 'aliyun-bailian',
      })) ?? [],
    capability_matrix: capabilityMatrix,
    availability: {
      currentRegion: process.env.NEXT_PUBLIC_SITE_REGION ?? 'global',
      regions: [
        {
          region: process.env.NEXT_PUBLIC_SITE_REGION ?? 'global',
          status: config.enabled ? 'available' : 'requires_configuration',
          reason: config.disabledReason,
          endpointEnvVars: [
            'BAILIAN_ENABLED',
            'DASHSCOPE_API_KEY',
            'BAILIAN_REGION',
            'BAILIAN_WORKSPACE_ID',
          ],
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
          'bailian.task.submit',
          'bailian.task.status',
          'bailian.task.output',
        ],
        redactInputFields: [],
        redactProviderFields: ['Authorization'],
      },
      metrics: [
        {
          name: 'bailian.queue_wait_ms',
          unit: 'ms',
          description: 'Time spent waiting in Alibaba Model Studio queue.',
        },
        {
          name: 'bailian.provider_run_ms',
          unit: 'ms',
          description: 'Alibaba Model Studio provider runtime.',
        },
      ],
    },
    capabilities: {
      textToImage: config.generationModes.includes('text_to_image'),
      imageToImage:
        config.generationModes.includes('image_to_image') ||
        config.generationModes.includes('multimodal_to_image'),
      textToVideo: config.generationModes.includes('text_to_video'),
      imageToVideo:
        config.generationModes.includes('image_to_video') ||
        config.generationModes.includes('multimodal_to_video'),
      supportsSeed: true,
      supportsCancel: false,
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
      provider: 'aliyun-bailian',
      endpoint: config.endpointId,
      requestContentType: 'application/json',
    },
  };
}

function documentationForEndpoint(
  endpointId: string,
  service: BailianModelService,
) {
  const url =
    endpointId === 'wan2.7-r2v'
      ? 'https://help.aliyun.com/zh/model-studio/wan-video-to-video-api-reference'
      : endpointId.startsWith('wan2.7-image') ||
          endpointId === 'wanx2.1-imageedit'
        ? 'https://help.aliyun.com/zh/model-studio/wan-image-api-reference'
        : service === 'video-synthesis'
          ? 'https://help.aliyun.com/zh/model-studio/video-generation-api/'
          : service === 'text2image'
            ? 'https://help.aliyun.com/zh/model-studio/qwen-image-api'
            : 'https://help.aliyun.com/zh/model-studio/image-model/';
  return [
    {
      title: 'Alibaba Model Studio API reference',
      url,
      scope: 'api_reference',
    },
  ];
}
