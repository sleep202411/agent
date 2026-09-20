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

export const BYTEPLUS_IMAGE_SCHEMA_VERSION = '2026-08-10';

export type BytePlusReferenceTransport = 'public_url' | 'modelark_asset_uri';

export interface BytePlusImageRuntimeConfig {
  provider: 'byteplus-modelark';
  endpointId: string;
  type: AiJobType;
  family: AiModelFamily;
  generationModes: AiGenerationMode[];
  /**
   * Wire representation for provider-registered reference media. Public URLs
   * are the only valid transport for Seedream; Seedance can address active
   * ModelArk private-library mirrors through `asset://<externalAssetId>`.
   */
  referenceTransport: BytePlusReferenceTransport;
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
  /**
   * Canonical model `outputPolicy` JsonB (AiCanonicalModel.outputPolicy),
   * plumbed exactly like `parameterPolicy`. The request mapper reads
   * `outputPolicy.watermark` (boolean) to decide the provider watermark.
   */
  outputPolicy?: AiJsonValue;
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
  outputPolicy?: AiJsonValue;
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
    referenceTransport: 'public_url',
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
    inputSchema: inputSchemaFor(args.generationModes, args.parameterPolicy),
    outputSchema: outputSchemaFor(),
    documentation: documentationFor(args.endpointId),
  };
}

/**
 * Async video runtime (Seedance on ModelArk). Same config shape as the image
 * runtime but type/family 'video', a video input/output schema, and the video
 * queue. The adapter branches on `type` to use the async task submit→poll path.
 */
export function createBytePlusVideoRuntimeConfig(
  args: CreateBytePlusImageRuntimeArgs,
): BytePlusImageRuntimeConfig {
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
    provider: args.provider,
    endpointId: args.endpointId,
    type: 'video',
    family: 'video',
    generationModes: args.generationModes,
    referenceTransport: 'modelark_asset_uri',
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
    inputSchema: videoInputSchemaFor(
      args.endpointId,
      args.generationModes,
      args.parameterPolicy,
    ),
    outputSchema: videoOutputSchemaFor(),
    documentation: documentationFor(args.endpointId),
  };
}

export function toBytePlusImageModelDefinition(args: {
  config: BytePlusImageRuntimeConfig;
  modelId: string;
  source: AiCatalogSource;
  ops: AiModelDefinition['ops'];
}): AiModelDefinition {
  const { config } = args;
  const isVideo = config.type === 'video';
  const capabilityMatrix = capabilityMatrixFor(
    config.type,
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
    capability: isVideo ? 'video_generation' : 'image_generation',
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
        events: [
          isVideo ? 'byteplus.contents.tasks' : 'byteplus.images.generations',
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
    capabilities: isVideo
      ? {
          textToVideo: config.generationModes.includes('text_to_video'),
          imageToVideo: config.generationModes.includes('image_to_video'),
          supportsSeed: Boolean(config.inputSchema.properties.seed),
          supportsCancel: true,
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

/** Object-frame image input (start/end frame), shaped like the fal field. */
function imageFrameProperty(
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
    },
  };
}

/**
 * Seedance video input schema. Field NAMES and x-ui constraint metadata
 * mirror the (retired) fal Seedance schema (`startFrame`/`endFrame`/
 * `referenceImages`/`referenceVideos`/`referenceAudios`/`resolution`/
 * `aspectRatio`/`duration`/`generateAudio`) on purpose: the studio composer,
 * validation layer, and persisted job inputs all key on these names, so the
 * official adapter is a drop-in replacement. BytePlus ModelArk is the sole
 * Seedance provider (real-person ACR + pricing + watermark compliance).
 */
function videoInputSchemaFor(
  endpointId: string,
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
  const outputFormatOptions = stringArrayFromPolicy(
    parameterPolicy,
    'outputFormatOptions',
  );
  const omniTaskTypes = stringArrayFromPolicy(
    parameterPolicy,
    'omniReferenceTaskTypes',
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
        rows: 4,
        importance: 'primary',
      },
    },
  };

  // i2v first frame and flf2v start frame share `startFrame` (matches fal).
  if (imageToVideo || firstLastFrame) {
    properties.startFrame = imageFrameProperty('Start frame', 20);
  }
  if (firstLastFrame) {
    properties.endFrame = imageFrameProperty('End frame', 21);
  }
  // Omni reference (multimodal_to_video, 全能参考): images + videos + audio,
  // caps from `referenceInputs` policy. Field names and x-ui constraint
  // metadata mirror the fal schema mapper so the studio composer/validation
  // layer works unchanged. Content roles at the wire: reference_image /
  // reference_video / reference_audio (ModelArk Seedance 2.0 API, doc
  // 1520757). Entries may carry `asset://` URLs for provider-hosted
  // (character-library) assets — the mapper forwards them verbatim.
  const referenceInputs = referenceInputsFor(parameterPolicy);
  if (multimodal && referenceInputs) {
    const { maxTotalFiles } = referenceInputs;
    const referenceItems = {
      type: 'object' as const,
      properties: {
        url: { type: 'string' as const, format: 'uri', title: 'URL' },
      },
      required: ['url'],
      additionalProperties: true,
    };
    if (referenceInputs.images.max > 0) {
      properties.referenceImages = {
        type: 'array',
        title: 'Reference images',
        minItems: referenceInputs.images.min,
        maxItems: referenceInputs.images.max,
        items: referenceItems,
        'x-ui': {
          control: 'image_upload',
          group: 'references',
          order: 22,
          importance: 'primary',
          accept: mimeAcceptFor(referenceInputs.images.acceptFormats, 'image'),
          ...({
            mediaKind: 'image',
            acceptFormats: referenceInputs.images.acceptFormats,
            maxFileSizeMb: referenceInputs.images.maxFileSizeMb,
            promptRefPrefix: '@Image',
            maxTotalFiles,
          } as Record<string, unknown>),
        } as AiInputSchema['properties'][string]['x-ui'],
      };
    }
    if (referenceInputs.videos.max > 0) {
      properties.referenceVideos = {
        type: 'array',
        title: 'Reference videos',
        minItems: referenceInputs.videos.min,
        maxItems: referenceInputs.videos.max,
        items: referenceItems,
        'x-ui': {
          control: 'video_upload',
          group: 'references',
          order: 23,
          importance: 'primary',
          accept: mimeAcceptFor(referenceInputs.videos.acceptFormats, 'video'),
          ...({
            mediaKind: 'video',
            acceptFormats: referenceInputs.videos.acceptFormats,
            maxFileSizeMb: referenceInputs.videos.maxFileSizeMb,
            maxCombinedFileSizeMb: referenceInputs.videos.maxCombinedFileSizeMb,
            minItemDurationSeconds:
              referenceInputs.videos.minItemDurationSeconds,
            maxItemDurationSeconds:
              referenceInputs.videos.maxItemDurationSeconds,
            minCombinedDurationSeconds:
              referenceInputs.videos.minCombinedDurationSeconds,
            maxCombinedDurationSeconds:
              referenceInputs.videos.maxCombinedDurationSeconds,
            resolutionBand: referenceInputs.videos.resolutionBand,
            promptRefPrefix: '@Video',
            maxTotalFiles,
          } as Record<string, unknown>),
        } as AiInputSchema['properties'][string]['x-ui'],
      };
    }
    if (referenceInputs.audios.max > 0) {
      properties.referenceAudios = {
        type: 'array',
        title: 'Reference audio',
        minItems: referenceInputs.audios.min,
        maxItems: referenceInputs.audios.max,
        items: referenceItems,
        'x-ui': {
          control: 'audio_upload',
          group: 'references',
          order: 24,
          importance: 'primary',
          accept: mimeAcceptFor(referenceInputs.audios.acceptFormats, 'audio'),
          ...({
            mediaKind: 'audio',
            acceptFormats: referenceInputs.audios.acceptFormats,
            maxFileSizeMb: referenceInputs.audios.maxFileSizeMb,
            maxCombinedFileSizeMb: referenceInputs.audios.maxCombinedFileSizeMb,
            minItemDurationSeconds:
              referenceInputs.audios.minItemDurationSeconds,
            maxItemDurationSeconds:
              referenceInputs.audios.maxItemDurationSeconds,
            minCombinedDurationSeconds:
              referenceInputs.audios.minCombinedDurationSeconds,
            maxCombinedDurationSeconds:
              referenceInputs.audios.maxCombinedDurationSeconds,
            audioRequiresVisual: referenceInputs.audioRequiresVisual,
            promptRefPrefix: '@Audio',
            maxTotalFiles,
          } as Record<string, unknown>),
        } as AiInputSchema['properties'][string]['x-ui'],
      };
    }
    // Seedance 2.5 `omni_reference_task_type` guidance parameter (doc
    // 1520757): pre-guides the model's task classification so edit/extend
    // parameter locks are validated at submit instead of failing
    // asynchronously. Declared via policy (`omniReferenceTaskTypes`), so
    // 2.0-series schemas never grow the field. Rendered by the composer as a
    // sub-mode pill in omni-reference mode only — hidden from the generic
    // settings panels, which are not mode-aware.
    if (omniTaskTypes.length > 0) {
      properties.omniReferenceTaskType = {
        type: 'string',
        title: 'Task type',
        default:
          stringFromPolicy(parameterPolicy, 'defaultOmniReferenceTaskType') ??
          omniTaskTypes[0],
        enum: omniTaskTypes,
        'x-ui': {
          control: 'hidden',
          group: 'settings',
          order: 25,
          importance: 'secondary',
        },
      };
    }
  }

  properties.resolution = {
    type: 'string',
    title: 'Resolution',
    default: stringFromPolicy(parameterPolicy, 'defaultResolution') ?? '720p',
    enum: resolutionOptions.length > 0 ? resolutionOptions : ['480p', '720p'],
    'x-ui': {
      control: 'segmented',
      group: 'settings',
      order: 30,
      importance: 'secondary',
    },
  };
  properties.aspectRatio = {
    type: 'string',
    title: 'Aspect ratio',
    default: stringFromPolicy(parameterPolicy, 'defaultAspectRatio') ?? '16:9',
    enum: aspectOptions.length > 0 ? aspectOptions : ['16:9', '9:16', '1:1'],
    'x-ui': {
      control: 'segmented',
      group: 'settings',
      order: 40,
      importance: 'secondary',
    },
  };
  // Duration mirrors fal: a STRING enum (incl. 'auto') when the policy declares
  // durationOptions — this is the exact field the per-second billing reads, so
  // emitting `duration` (not `durationSeconds`) keeps the charge consistent
  // across providers. Falls back to an integer slider for video models whose
  // policy has no duration enum.
  if (durationOptions.length > 0) {
    properties.duration = {
      type: 'string',
      title: 'Duration',
      default:
        stringFromPolicy(parameterPolicy, 'defaultDurationSeconds') ??
        durationOptions[0],
      enum: durationOptions,
      'x-ui': {
        control: 'select',
        group: 'settings',
        order: 50,
        importance: 'secondary',
      },
    };
  } else {
    properties.durationSeconds = {
      type: 'integer',
      title: 'Duration',
      default: numberFromPolicy(parameterPolicy, 'defaultDurationSeconds') ?? 5,
      minimum: numberFromPolicy(parameterPolicy, 'minDurationSeconds') ?? 3,
      maximum: numberFromPolicy(parameterPolicy, 'maxDurationSeconds') ?? 12,
      'x-ui': {
        control: 'slider',
        group: 'settings',
        order: 50,
        unit: 's',
        importance: 'secondary',
      },
    };
  }
  // Native synced audio switch (Seedance 2.0 `generate_audio`, upstream
  // default true) — emitted only when the policy declares it, same shape as
  // the fal schema mapper so the studio switch carries over.
  const audioPolicy = generateAudioFor(parameterPolicy);
  if (audioPolicy) {
    properties.generateAudio = {
      type: 'boolean',
      title: 'Generate audio',
      default: audioPolicy.default,
      'x-ui': {
        control: 'switch',
        group: 'settings',
        order: 55,
        importance: 'secondary',
      },
    };
  }
  if (outputFormatOptions.length > 0) {
    properties.outputFormat = {
      type: 'string',
      title: 'Output format',
      default:
        stringFromPolicy(parameterPolicy, 'defaultOutputFormat') ??
        outputFormatOptions[0],
      enum: outputFormatOptions,
      'x-ui': {
        control: 'select',
        group: 'advanced',
        order: 57,
        importance: 'secondary',
      },
    };
  }
  // Seed is policy-gated: the Seedance 2.0 series does NOT support `seed`
  // (1.x only), so its policy disables it and the field never reaches the
  // schema (additionalProperties:false then strips it from normalized input).
  if (seedEnabledFor(parameterPolicy)) {
    properties.seed = {
      type: 'integer',
      title: 'Seed',
      minimum: 0,
      maximum: 2147483647,
      'x-ui': {
        control: 'stepper',
        group: 'advanced',
        order: 60,
        importance: 'secondary',
      },
    };
  }

  return {
    type: 'object',
    properties,
    required: [],
    additionalProperties: false,
    // ModelArk rejects mixed frame/reference scenarios. Some older Seedance
    // contracts additionally require reference audio to have a visual; 2.5
    // explicitly permits audio-only input, so that rule is policy-gated. Enforced on
    // the character-EXPANDED input (normalizeInput runs after expansion,
    // before any wallet hold) so both the manual and character-mention paths
    // fail loud with a typed 400 instead of a provider-side rejection.
    'x-rules': [
      // Match the worker mapper before submission or credit reservation.
      ...(endpointId === 'dreamina-seedance-2-5-260628'
        ? [
            {
              id: 'seedance-frame-ratio-adaptive',
              when: {
                all: [
                  {
                    any: [
                      { field: 'startFrame', operator: 'exists' as const },
                      { field: 'endFrame', operator: 'exists' as const },
                    ],
                  },
                  {
                    field: 'aspectRatio',
                    operator: 'notEquals' as const,
                    value: 'auto',
                  },
                ],
              },
              fields: ['aspectRatio'],
              effect: 'forbid' as const,
              message:
                'Seedance 2.5 frame-guided generation requires Auto aspect ratio.',
            },
          ]
        : []),
      {
        id: 'seedance-prompt-or-media',
        when: {
          all: [
            { field: 'prompt', operator: 'empty' },
            { field: 'startFrame', operator: 'empty' },
            { field: 'endFrame', operator: 'empty' },
            { field: 'referenceImages', operator: 'empty' },
            { field: 'referenceVideos', operator: 'empty' },
            { field: 'referenceAudios', operator: 'empty' },
          ],
        },
        fields: ['prompt'],
        effect: 'require',
        message: 'Add a prompt or at least one media reference.',
      },
      {
        id: 'seedance-frames-xor-references',
        when: {
          any: [
            { field: 'referenceImages', operator: 'exists' },
            { field: 'referenceVideos', operator: 'exists' },
            { field: 'referenceAudios', operator: 'exists' },
          ],
        },
        fields: ['startFrame', 'endFrame'],
        effect: 'forbid',
        message:
          'Start/end frames cannot be combined with reference media — use one or the other.',
      },
      // Seedance 2.5 omni-reference task-type locks (doc 1520757). Deliberately
      // no "clear when reference-less" rule: silently dropping an explicit
      // edit/extend selection would lose user intent — a task type without
      // its reference video fails loud instead (composer resets the type on
      // mode switch, so only stale persisted inputs ever see that path).
      // edit/extend ratio + edit duration locks fail loud pre-submit;
      // ModelArk's own synchronous validation is the backstop.
      ...(multimodal && omniTaskTypes.length > 0
        ? [
            {
              id: 'seedance-edit-requires-reference-video',
              when: {
                field: 'omniReferenceTaskType',
                operator: 'equals' as const,
                value: 'edit',
              },
              fields: ['referenceVideos'],
              effect: 'require' as const,
              message: 'Video editing requires at least one reference video.',
            },
            {
              id: 'seedance-extend-requires-reference-video',
              when: {
                field: 'omniReferenceTaskType',
                operator: 'equals' as const,
                value: 'extend',
              },
              fields: ['referenceVideos'],
              effect: 'require' as const,
              message: 'Video extension requires at least one reference video.',
            },
            {
              id: 'seedance-edit-extend-ratio-adaptive',
              when: {
                all: [
                  {
                    field: 'omniReferenceTaskType',
                    operator: 'in' as const,
                    values: ['edit', 'extend'],
                  },
                  {
                    field: 'aspectRatio',
                    operator: 'notEquals' as const,
                    value: 'auto',
                  },
                ],
              },
              fields: ['aspectRatio'],
              effect: 'forbid' as const,
              message:
                'Editing and extension keep the source video\u2019s aspect ratio — set aspect ratio to Auto.',
            },
            {
              id: 'seedance-edit-duration-auto',
              when: {
                all: [
                  {
                    field: 'omniReferenceTaskType',
                    operator: 'equals' as const,
                    value: 'edit',
                  },
                  {
                    field: 'duration',
                    operator: 'notEquals' as const,
                    value: 'auto',
                  },
                ],
              },
              fields: ['duration'],
              effect: 'forbid' as const,
              message:
                'Video editing keeps the source video\u2019s duration — set duration to Auto.',
            },
          ]
        : []),
      ...(referenceInputs?.audioRequiresVisual
        ? [
            {
              id: 'seedance-audio-needs-visual',
              when: {
                all: [
                  { field: 'referenceAudios', operator: 'exists' as const },
                  { field: 'referenceImages', operator: 'empty' as const },
                  { field: 'referenceVideos', operator: 'empty' as const },
                ],
              },
              fields: ['referenceImages'],
              effect: 'require' as const,
              message:
                'Reference audio needs at least one image or video reference.',
            },
          ]
        : []),
    ],
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
  const hasImageInput = isVideo
    ? generationModes.includes('image_to_video') ||
      generationModes.includes('first_last_frame_to_video') ||
      generationModes.includes('multimodal_to_video')
    : generationModes.includes('image_to_image');
  const inputModalities: Array<'text' | 'image' | 'video' | 'audio'> = ['text'];
  if (hasImageInput) inputModalities.push('image');
  if (
    isVideo &&
    generationModes.includes('multimodal_to_video') &&
    inputSchema.properties.referenceVideos
  ) {
    inputModalities.push('video');
  }
  if (
    isVideo &&
    generationModes.includes('multimodal_to_video') &&
    inputSchema.properties.referenceAudios
  ) {
    inputModalities.push('audio');
  }
  return {
    source: 'internal',
    inputModalities,
    outputModalities: isVideo ? ['video'] : ['image'],
    generationModes,
    supportedParameters: Object.keys(inputSchema.properties),
    unsupportedParameters: [],
    features: {
      cancel: isVideo,
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
  if (endpointId === 'dreamina-seedance-2-5-260628') {
    return [
      {
        title: 'Seedance 2.5 integration guide',
        url: 'https://docs.byteplus.com/en/docs/ModelArk/2607688',
        scope: 'guide',
      },
      {
        title: 'Create a video generation task',
        url: 'https://docs.byteplus.com/en/docs/ModelArk/1520757',
        scope: 'api_reference',
      },
      {
        title: 'Retrieve a video generation task',
        url: 'https://docs.byteplus.com/en/docs/ModelArk/1521309',
        scope: 'api_reference',
      },
    ];
  }
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

function numberFromPolicy(
  policy: AiJsonValue | undefined,
  key: string,
): number | undefined {
  const value = recordValue(policy)?.[key];
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

/**
 * Multimodal `referenceInputs` policy (Seedance 全能参考): per-kind caps +
 * combined ceiling. Mirrors the fal schema mapper's reading so one canonical
 * policy drives both providers' schemas identically.
 */
function referenceInputsFor(policy: AiJsonValue | undefined): {
  images: ReferenceMediaPolicy;
  videos: ReferenceMediaPolicy;
  audios: ReferenceMediaPolicy;
  maxTotalFiles?: number;
  audioRequiresVisual: boolean;
} | null {
  const references = recordValue(recordValue(policy)?.referenceInputs);
  if (!references || references.enabled === false) return null;
  const range = (key: string): ReferenceMediaPolicy => {
    const value = recordValue(references[key]);
    const min = typeof value?.min === 'number' ? Math.max(0, value.min) : 0;
    const max = typeof value?.max === 'number' ? Math.max(0, value.max) : 0;
    const number = (field: string): number | undefined => {
      const candidate = value?.[field];
      return typeof candidate === 'number' && Number.isFinite(candidate)
        ? candidate
        : undefined;
    };
    const acceptFormats = Array.isArray(value?.acceptFormats)
      ? value.acceptFormats.filter(
          (item): item is string => typeof item === 'string',
        )
      : [];
    return {
      min,
      max,
      acceptFormats,
      maxFileSizeMb: number('maxFileSizeMb'),
      maxCombinedFileSizeMb: number('maxCombinedFileSizeMb'),
      minItemDurationSeconds: number('minItemDurationSeconds'),
      maxItemDurationSeconds: number('maxItemDurationSeconds'),
      minCombinedDurationSeconds: number('minCombinedDurationSeconds'),
      maxCombinedDurationSeconds: number('maxCombinedDurationSeconds'),
      resolutionBand:
        typeof value?.resolutionBand === 'string'
          ? value.resolutionBand
          : undefined,
    };
  };
  const maxTotalFiles =
    typeof references.maxTotalFiles === 'number'
      ? references.maxTotalFiles
      : undefined;
  const parsed = {
    images: range('images'),
    videos: range('videos'),
    audios: range('audios'),
    audioRequiresVisual: references.audioRequiresVisual === true,
    ...(maxTotalFiles != null ? { maxTotalFiles } : {}),
  };
  return parsed.images.max > 0 || parsed.videos.max > 0 || parsed.audios.max > 0
    ? parsed
    : null;
}

interface ReferenceMediaPolicy {
  min: number;
  max: number;
  acceptFormats: string[];
  maxFileSizeMb?: number;
  maxCombinedFileSizeMb?: number;
  minItemDurationSeconds?: number;
  maxItemDurationSeconds?: number;
  minCombinedDurationSeconds?: number;
  maxCombinedDurationSeconds?: number;
  resolutionBand?: string;
}

function mimeAcceptFor(
  formats: string[],
  kind: 'image' | 'video' | 'audio',
): string {
  const mime: Record<string, string> = {
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
  };
  const resolved = formats.map((format) => mime[format]).filter(Boolean);
  if (resolved.length > 0) return [...new Set(resolved)].join(',');
  if (kind === 'video') return 'video/mp4,video/quicktime';
  if (kind === 'audio') return 'audio/mpeg,audio/wav';
  return 'image/jpeg,image/png,image/webp';
}

/** `generateAudio` policy block — emitted only when enabled === true. */
function generateAudioFor(
  policy: AiJsonValue | undefined,
): { default: boolean } | null {
  const value = recordValue(recordValue(policy)?.generateAudio);
  if (!value || value.enabled !== true) return null;
  return { default: value.default !== false };
}

/** Seed support — default ON, disabled via `seed.enabled: false`. */
function seedEnabledFor(policy: AiJsonValue | undefined): boolean {
  return recordValue(recordValue(policy)?.seed)?.enabled !== false;
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
