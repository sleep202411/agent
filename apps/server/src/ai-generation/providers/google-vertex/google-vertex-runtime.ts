import { AI_MODEL_PROTOCOL_DIALECT } from '../../types';
import type {
  AiBillingPolicy,
  AiCapabilityMatrix,
  AiCatalogSource,
  AiDocumentationLink,
  AiGenerationMode,
  AiInputSchema,
  AiJobType,
  AiJsonValue,
  AiModelDefinition,
  AiOutputSchema,
  AiQueueName,
  AiQueuePolicy,
  AiRequiredPlan,
} from '../../types';

export const GOOGLE_VERTEX_PROVIDER = 'google-vertex' as const;
export const GOOGLE_VERTEX_SCHEMA_VERSION = '2026-08-13.3';

export type GoogleVertexExecutionKind = 'gemini-image' | 'veo' | 'omni';

export interface GoogleVertexRuntimeConfig {
  provider: typeof GOOGLE_VERTEX_PROVIDER;
  modelId: string;
  endpointId: string;
  executionKind: GoogleVertexExecutionKind;
  location: string;
  type: AiJobType;
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
  outputPolicy?: AiJsonValue;
  inputSchema: AiInputSchema;
  outputSchema: AiOutputSchema;
}

export interface CreateGoogleVertexRuntimeArgs {
  modelId: string;
  endpointId: string;
  location: string;
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
  outputPolicy?: AiJsonValue;
}

export function createGoogleVertexRuntimeConfig(
  args: CreateGoogleVertexRuntimeArgs,
): GoogleVertexRuntimeConfig {
  const isVideo = args.type === 'video';
  const executionKind = googleVertexExecutionKind(args.endpointId, args.type);
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
    provider: GOOGLE_VERTEX_PROVIDER,
    modelId: args.modelId,
    endpointId: args.endpointId,
    executionKind,
    location: args.location,
    type: args.type,
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
    outputPolicy: args.outputPolicy,
    inputSchema:
      executionKind === 'omni'
        ? omniInputSchema(args.generationModes, args.parameterPolicy)
        : executionKind === 'veo'
          ? veoInputSchema(args.generationModes, args.parameterPolicy)
          : imageInputSchema(args.generationModes, args.parameterPolicy),
    outputSchema: isVideo ? videoOutputSchema() : imageOutputSchema(),
  };
}

export function googleVertexExecutionKind(
  endpointId: string,
  type: AiJobType,
): GoogleVertexExecutionKind {
  if (endpointId === 'gemini-omni-flash-preview') return 'omni';
  if (endpointId.startsWith('veo-')) return 'veo';
  if (type === 'image' && endpointId.includes('image')) return 'gemini-image';
  throw new Error(
    `Unsupported Google Vertex endpoint binding: ${endpointId} (${type}).`,
  );
}

export function toGoogleVertexModelDefinition(args: {
  config: GoogleVertexRuntimeConfig;
  source: AiCatalogSource;
  ops: AiModelDefinition['ops'];
}): AiModelDefinition {
  const { config } = args;
  const isVideo = config.type === 'video';
  const capabilityMatrix = capabilityMatrixFor(config);
  const region = process.env.NEXT_PUBLIC_SITE_REGION ?? 'global';
  return {
    id: config.modelId,
    provider: config.provider,
    providerModelId: config.endpointId,
    deployment: config.endpointId,
    modelName: config.endpointId,
    source: args.source,
    family: isVideo ? 'video' : 'image',
    generationModes: config.generationModes,
    capability: isVideo ? 'video_generation' : 'image_generation',
    type: config.type,
    name: config.name,
    description: config.description,
    enabled: config.enabled,
    disabledReason: config.disabledReason,
    schemaDialect: AI_MODEL_PROTOCOL_DIALECT,
    schemaVersion: GOOGLE_VERTEX_SCHEMA_VERSION,
    documentation: documentationFor(config.endpointId).map((document) => ({
      ...document,
      source: 'official' as const,
      provider: config.provider,
    })),
    capability_matrix: capabilityMatrix,
    availability: {
      currentRegion: region,
      regions: [
        {
          region,
          status: config.enabled ? 'available' : 'requires_configuration',
          reason: config.disabledReason,
          endpointEnvVars: [
            'GOOGLE_VERTEX_ENABLED',
            'GOOGLE_CLOUD_PROJECT',
            config.executionKind === 'veo'
              ? 'GOOGLE_VERTEX_VIDEO_LOCATION'
              : 'GOOGLE_VERTEX_IMAGE_LOCATION',
          ],
        },
      ],
    },
    cost_estimate: {
      billingMode: isVideo ? 'duration' : 'token',
      currency: config.billingPolicy.displayCurrency,
      meters: isVideo
        ? [{ meter: 'video_seconds', unit: 'second' }]
        : [{ meter: 'image_output_tokens', unit: 'token' }],
      pricingUrl: 'https://cloud.google.com/vertex-ai/generative-ai/pricing',
      supportsPreflightEstimate: true,
      finalCostSource: config.billingPolicy.finalCostSource,
    },
    observability: {
      requestId: { jobField: 'providerJobId' },
      logging: {
        events: [
          config.executionKind === 'veo'
            ? 'google.vertex.generateVideos'
            : config.executionKind === 'omni'
              ? 'google.vertex.interactions.create'
              : 'google.vertex.generateContent',
        ],
        redactInputFields: [
          'referenceImages',
          'startFrame',
          'endFrame',
          'sourceVideo',
        ],
        redactProviderFields: ['Authorization'],
      },
      metrics: [
        {
          name: 'google_vertex.provider_run_ms',
          unit: 'ms',
          description: 'Google Vertex AI provider runtime.',
        },
      ],
    },
    capabilities: isVideo
      ? {
          textToVideo: config.generationModes.includes('text_to_video'),
          imageToVideo: config.generationModes.includes('image_to_video'),
          supportsSeed: Boolean(config.inputSchema.properties.seed),
          supportsCancel: false,
          maxOutputs: 1,
        }
      : {
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

function imageInputSchema(
  modes: AiGenerationMode[],
  policy?: AiJsonValue,
): AiInputSchema {
  const ratios = [
    ...stringArray(policy, 'supportedAspectRatios'),
    ...stringArray(policy, 'advancedAspectRatios'),
  ].filter((value, index, array) => array.indexOf(value) === index);
  const resolutions = stringArray(policy, 'resolutionOptions');
  const outputFormats = stringArray(policy, 'outputFormatOptions');
  const references = referencePolicy(policy);
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
      title: 'Aspect ratio',
      default: stringPolicy(policy, 'defaultAspectRatio') ?? '1:1',
      enum: ratios.length ? ratios : ['1:1', '4:3', '3:4', '16:9', '9:16'],
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
      default:
        stringPolicy(policy, 'defaultResolution') ?? resolutions[0] ?? '1K',
      enum: resolutions.length ? resolutions : ['1K', '2K', '4K'],
      'x-ui': {
        control: 'segmented',
        group: 'settings',
        order: 30,
        importance: 'secondary',
      },
    },
    outputFormat: {
      type: 'string',
      title: 'Output format',
      default:
        stringPolicy(policy, 'defaultOutputFormat') ??
        outputFormats[0] ??
        'png',
      enum: outputFormats.length ? outputFormats : ['png', 'jpeg'],
      'x-ui': {
        control: 'select',
        group: 'advanced',
        order: 90,
        importance: 'secondary',
      },
    },
  };
  if (modes.includes('image_to_image') && references.enabled) {
    properties.referenceImages = {
      type: 'array',
      title: 'Reference images',
      minItems: references.min,
      maxItems: references.max,
      items: mediaReferenceItem(),
      'x-ui': {
        control: 'image_upload',
        group: 'references',
        order: 40,
        importance: 'primary',
        accept: 'image/jpeg,image/png,image/webp',
        ...({ maxFileSizeMb: 7 } as Record<string, unknown>),
      },
    };
  }
  return objectSchema(properties, ['prompt']);
}

function veoInputSchema(
  modes: AiGenerationMode[],
  policy?: AiJsonValue,
): AiInputSchema {
  const resolutions = stringArray(policy, 'resolutionOptions');
  const ratios = stringArray(policy, 'supportedAspectRatios');
  const durations = stringArray(policy, 'durationOptions');
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
        rows: 4,
        importance: 'primary',
      },
    },
    resolution: {
      type: 'string',
      title: 'Resolution',
      default: stringPolicy(policy, 'defaultResolution') ?? '1080p',
      enum: resolutions.length ? resolutions : ['720p', '1080p'],
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
      default: stringPolicy(policy, 'defaultAspectRatio') ?? '16:9',
      enum: ratios.length ? ratios : ['16:9', '9:16'],
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
      default: stringPolicy(policy, 'defaultDurationSeconds') ?? '8',
      enum: durations.length ? durations : ['4', '6', '8'],
      'x-ui': {
        control: 'segmented',
        group: 'settings',
        order: 50,
        unit: 's',
        importance: 'secondary',
      },
    },
  };
  if (enabledPolicy(policy, 'generateAudio')) {
    properties.generateAudio = {
      type: 'boolean',
      title: 'Generate audio',
      default: booleanPolicy(policy, 'generateAudio', 'default') ?? true,
      'x-ui': {
        control: 'switch',
        group: 'settings',
        order: 55,
        importance: 'secondary',
      },
    };
  }
  if (enabledPolicy(policy, 'negativePrompt')) {
    properties.negativePrompt = {
      type: 'string',
      title: 'Negative prompt',
      maxLength: 1000,
      'x-ui': {
        control: 'textarea',
        group: 'advanced',
        order: 80,
        rows: 2,
        importance: 'secondary',
      },
    };
  }
  if (enabledPolicy(policy, 'seed')) {
    properties.seed = {
      type: 'integer',
      title: 'Seed',
      minimum: 0,
      maximum: 2147483647,
      'x-ui': {
        control: 'stepper',
        group: 'advanced',
        order: 90,
        importance: 'secondary',
      },
    };
  }
  if (
    modes.includes('image_to_video') ||
    modes.includes('first_last_frame_to_video')
  ) {
    properties.startFrame = frameProperty('Start frame', 20);
  }
  if (modes.includes('first_last_frame_to_video')) {
    properties.endFrame = frameProperty('End frame', 21);
  }
  const references = referencePolicy(policy);
  if (modes.includes('multimodal_to_video') && references.enabled) {
    properties.referenceImages = {
      type: 'array',
      title: 'Asset references',
      minItems: references.min,
      maxItems: references.max,
      items: mediaReferenceItem(),
      'x-ui': {
        control: 'image_upload',
        group: 'references',
        order: 22,
        importance: 'primary',
        accept: 'image/jpeg,image/png',
        ...({ maxFileSizeMb: 20 } as Record<string, unknown>),
      },
    };
  }
  const schema = objectSchema(properties, []);
  schema['x-rules'] = [
    {
      id: 'veo-prompt-or-start-frame',
      when: {
        all: [
          { field: 'prompt', operator: 'empty' },
          { field: 'startFrame', operator: 'empty' },
        ],
      },
      fields: ['prompt'],
      effect: 'require',
      message: 'Add a prompt or a start frame.',
    },
    {
      id: 'veo-end-frame-requires-start-frame',
      when: {
        all: [
          { field: 'endFrame', operator: 'exists' },
          { field: 'startFrame', operator: 'empty' },
        ],
      },
      fields: ['startFrame'],
      effect: 'require',
      message: 'An end frame requires a start frame.',
    },
    {
      id: 'veo-reference-images-are-exclusive',
      when: { all: [{ field: 'referenceImages', operator: 'exists' }] },
      fields: ['startFrame', 'endFrame'],
      effect: 'forbid',
      message: 'Asset references cannot be combined with first/last frames.',
    },
  ];
  return schema;
}

function omniInputSchema(
  modes: AiGenerationMode[],
  policy?: AiJsonValue,
): AiInputSchema {
  const references = referencePolicy(policy);
  const durations = stringArray(policy, 'durationOptions');
  const ratios = stringArray(policy, 'supportedAspectRatios');
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
        rows: 4,
        importance: 'primary',
      },
    },
    resolution: {
      type: 'string',
      title: 'Resolution',
      default: '720p',
      enum: ['720p'],
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
      default: stringPolicy(policy, 'defaultAspectRatio') ?? '16:9',
      enum: ratios.length ? ratios : ['16:9', '9:16'],
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
      default: stringPolicy(policy, 'defaultDurationSeconds') ?? '8',
      enum: durations.length
        ? durations
        : ['3', '4', '5', '6', '7', '8', '9', '10'],
      'x-ui': {
        control: 'segmented',
        group: 'settings',
        order: 50,
        unit: 's',
        importance: 'secondary',
      },
    },
  };
  if (modes.includes('image_to_video')) {
    properties.startFrame = frameProperty('Start image', 20);
  }
  if (modes.includes('multimodal_to_video') && references.enabled) {
    properties.referenceImages = {
      type: 'array',
      title: 'Reference images',
      minItems: references.min,
      maxItems: references.max,
      items: mediaReferenceItem(),
      'x-ui': {
        control: 'image_upload',
        group: 'references',
        order: 21,
        importance: 'primary',
        accept: 'image/jpeg,image/png,image/webp',
        ...({ maxFileSizeMb: 20 } as Record<string, unknown>),
      },
    };
  }
  if (modes.includes('video_to_video')) {
    properties.sourceVideo = videoProperty('Source video', 22, true);
  }
  const schema = objectSchema(properties, ['prompt']);
  schema['x-rules'] = [
    {
      id: 'omni-input-mode-is-exclusive',
      when: { all: [{ field: 'sourceVideo', operator: 'exists' }] },
      fields: ['startFrame', 'referenceImages'],
      effect: 'forbid',
      message: 'Video editing cannot be combined with image references.',
    },
  ];
  return schema;
}

function objectSchema(
  properties: AiInputSchema['properties'],
  required: string[],
): AiInputSchema {
  return {
    type: 'object',
    properties,
    required,
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

function frameProperty(
  title: string,
  order: number,
): AiInputSchema['properties'][string] {
  return {
    type: 'object',
    title,
    properties: { url: { type: 'string', format: 'uri', title: 'URL' } },
    required: ['url'],
    additionalProperties: true,
    'x-ui': {
      control: 'image_upload',
      group: 'references',
      order,
      importance: 'primary',
      accept: 'image/jpeg,image/png',
      ...({ maxFileSizeMb: 20 } as Record<string, unknown>),
    },
  };
}

function videoProperty(
  title: string,
  order: number,
  includeSourceJobId = false,
): AiInputSchema['properties'][string] {
  return {
    type: 'object',
    title,
    properties: {
      url: { type: 'string', format: 'uri', title: 'URL' },
      ...(includeSourceJobId
        ? { sourceJobId: { type: 'string', title: 'Source generation job' } }
        : {}),
    },
    required: ['url'],
    additionalProperties: true,
    'x-ui': {
      control: 'video_upload',
      group: 'references',
      order,
      importance: 'primary',
      // The model accepts additional legacy containers, but the product media
      // service currently ingests MP4 and QuickTime only. Keep the UI contract
      // at the verified end-to-end intersection.
      accept: 'video/mp4,video/quicktime',
      ...({ maxFileSizeMb: 50 } as Record<string, unknown>),
    },
  };
}

function mediaReferenceItem() {
  return {
    type: 'object' as const,
    properties: {
      url: { type: 'string' as const, format: 'uri', title: 'URL' },
    },
    required: ['url'],
    additionalProperties: true,
  };
}

function imageOutputSchema(): AiOutputSchema {
  return outputSchema('image_gallery', {
    url: { type: 'string', format: 'uri', title: 'URL' },
    width: { type: 'integer', title: 'Width' },
    height: { type: 'integer', title: 'Height' },
    mimeType: { type: 'string', title: 'MIME type' },
  });
}

function videoOutputSchema(): AiOutputSchema {
  return outputSchema('video_player', {
    url: { type: 'string', format: 'uri', title: 'URL' },
    mimeType: { type: 'string', title: 'MIME type' },
    durationSeconds: { type: 'number', title: 'Duration (s)' },
  });
}

function outputSchema(
  control: 'image_gallery' | 'video_player',
  properties: AiInputSchema['properties'],
): AiOutputSchema {
  return {
    type: 'object',
    properties: {
      outputs: {
        type: 'array',
        items: {
          type: 'object',
          properties,
          required: ['url'],
          additionalProperties: true,
        },
        'x-output': { control, order: 10 },
      },
    },
    required: ['outputs'],
    additionalProperties: true,
  };
}

function capabilityMatrixFor(
  config: GoogleVertexRuntimeConfig,
): AiCapabilityMatrix {
  return {
    source: 'official',
    inputModalities: config.generationModes.some((mode) =>
      [
        'image_to_image',
        'image_to_video',
        'first_last_frame_to_video',
        'multimodal_to_video',
        'video_to_video',
      ].includes(mode),
    )
      ? config.generationModes.includes('video_to_video')
        ? ['text', 'image', 'video']
        : ['text', 'image']
      : ['text'],
    outputModalities: config.type === 'video' ? ['video'] : ['image'],
    generationModes: config.generationModes,
    supportedParameters: Object.keys(config.inputSchema.properties),
    unsupportedParameters: [],
    features: {
      cancel: false,
      providerQueue: config.type === 'video',
      providerUrlOutput: false,
    },
    limits: { maxOutputs: 1, maxPromptCharacters: 4000 },
  };
}

function documentationFor(
  endpointId: string,
): Array<Omit<AiDocumentationLink, 'source' | 'provider'>> {
  if (endpointId.startsWith('veo-')) {
    return [
      {
        title: 'Veo 3.1 model card',
        url: 'https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/veo/3-1-generate',
        scope: 'guide' as const,
      },
      {
        title: 'Veo video generation overview',
        url: 'https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/video/overview',
        scope: 'api_reference' as const,
      },
    ];
  }
  if (endpointId === 'gemini-omni-flash-preview') {
    return [
      {
        title: 'Gemini 2.5 Omni model card',
        url: 'https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/omni-flash-preview',
        scope: 'guide' as const,
      },
      {
        title: 'Interactions API reference',
        url: 'https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/models/interactions-api',
        scope: 'api_reference' as const,
      },
    ];
  }
  return [
    {
      title: 'Generate images with Gemini',
      url: 'https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/image-generation',
      scope: 'guide' as const,
    },
    {
      title: 'Google Gen AI SDK for JavaScript',
      url: 'https://googleapis.github.io/js-genai/',
      scope: 'api_reference',
    },
  ];
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringArray(policy: AiJsonValue | undefined, key: string): string[] {
  const value = record(policy)?.[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function stringPolicy(
  policy: AiJsonValue | undefined,
  key: string,
): string | undefined {
  const value = record(policy)?.[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function booleanPolicy(
  policy: AiJsonValue | undefined,
  block: string,
  key: string,
): boolean | undefined {
  const value = record(record(policy)?.[block])?.[key];
  return typeof value === 'boolean' ? value : undefined;
}

function enabledPolicy(
  policy: AiJsonValue | undefined,
  block: string,
): boolean {
  return booleanPolicy(policy, block, 'enabled') === true;
}

function referencePolicy(policy: AiJsonValue | undefined) {
  const value = record(record(policy)?.referenceImages);
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
