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

export const BAILIAN_SCHEMA_VERSION = '2026-08-13';

interface CreateBailianModelConfigArgs {
  endpointId: string;
  service: BailianModelService;
  callMode: 'async' | 'sync';
  type: AiJobType;
  name?: string;
  description?: string;
  generationModes?: string[];
  requiredPlan: AiRequiredPlan | null;
  enabled: boolean;
  disabledReason?: string;
  queueName: AiQueueName;
  globalConcurrency: number;
  perUserRunning: number;
  perUserQueued: number;
  pollDelayMs: number;
  billing?: Partial<AiBillingPolicy>;
  parameterPolicy?: AiJsonValue;
  catalogSnapshot?: AiJsonValue;
  providerPricing?: Record<string, unknown> | null;
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

function numberFromPolicy(value: unknown, key: string): number | undefined {
  const raw = recordValue(value)?.[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
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

function inputSchemaFor(
  endpointId: string,
  type: AiJobType,
  generationModes: AiGenerationMode[],
  parameterPolicy?: AiJsonValue,
): AiInputSchema {
  const policy = recordValue(parameterPolicy);
  const maxPromptCharacters =
    numberFromPolicy(policy, 'maxPromptCharacters') ??
    (type === 'video' ? 2000 : 4000);
  const aspectOptions = stringArrayFromPolicy(
    parameterPolicy,
    'supportedAspectRatios',
  );
  const resolutionOptions = stringArrayFromPolicy(
    parameterPolicy,
    'resolutionOptions',
  );
  const outputFormatOptions = stringArrayFromPolicy(
    parameterPolicy,
    'outputFormatOptions',
  );
  const variationOptions = numberArrayFromPolicy(
    parameterPolicy,
    'variationOptions',
  );
  const reference = referencePolicy(parameterPolicy);
  const qwenImage = endpointId.startsWith('qwen-image-2.0');
  const wanImage = endpointId.startsWith('wan2.7-image');
  const properties: AiInputSchema['properties'] = {
    prompt: providerProperty({
      type: 'string',
      title: 'Prompt',
      minLength: 1,
      maxLength: maxPromptCharacters,
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
    type !== 'image' &&
    (generationModes.includes('image_to_image') ||
      generationModes.includes('image_to_video') ||
      generationModes.includes('first_last_frame_to_video'))
  ) {
    properties.startFrame = providerProperty({
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
        order: 30,
        importance: 'primary',
      },
      // Video models reshape this into input.media[{type:'first_frame'}] in the
      // request mapper; image-to-image still reads it as a flat img_url.
      'x-provider': {
        section: 'input',
        parameter: 'img_url',
        transform: 'mediaUrl',
        omitIfEmpty: true,
      },
    });
  }

  if (
    type === 'video' &&
    generationModes.includes('first_last_frame_to_video')
  ) {
    // End frame for first-last-frame-to-video; the request mapper appends it to
    // input.media as { type: 'last_frame' }. No x-provider: handled there.
    properties.endFrame = providerProperty({
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
        order: 31,
        importance: 'primary',
      },
    });
  }

  if (
    generationModes.includes('multimodal_to_video') ||
    generationModes.includes('video_to_video')
  ) {
    // Reference item types are policy-driven: each r2v endpoint accepts a
    // different subset (e.g. happyhorse-1.0-r2v takes ONLY reference_image,
    // wan2.7-r2v takes reference_image/reference_video), so advertising a type
    // the endpoint rejects would let the client submit a request the provider
    // bounces with an opaque error. Falls back to the full set for any v2v model
    // whose policy doesn't pin the list.
    const policyReferenceTypes = stringArrayFromPolicy(
      parameterPolicy,
      'referenceTypes',
    );
    const referenceTypes =
      policyReferenceTypes.length > 0
        ? policyReferenceTypes
        : ['reference_image', 'reference_video', 'reference_audio'];
    const maxReferenceItems =
      numberFromPolicy(policy, 'maxReferenceItems') ?? 4;
    const wan3Protocol =
      stringFromPolicy(parameterPolicy, 'providerProtocol') === 'wan3-video';
    const supportsReferenceVoice =
      recordValue(policy?.referenceVoice)?.enabled !== false;
    const referenceProperties: Record<string, unknown> = {
      type: {
        type: 'string',
        title: 'Type',
        default: referenceTypes[0],
        enum: referenceTypes,
      },
      url: { type: 'string', format: 'uri', title: 'URL' },
    };
    if (supportsReferenceVoice) {
      referenceProperties.referenceVoice = {
        type: 'string',
        format: 'uri',
        title: 'Reference voice',
      };
    }
    if (wan3Protocol || recordValue(policy?.referenceLimits)) {
      const referenceLimits = recordValue(policy?.referenceLimits);
      const addReferenceField = (args: {
        field: 'referenceImages' | 'referenceVideos' | 'referenceAudios';
        title: string;
        providerType: 'reference_image' | 'reference_video' | 'reference_audio';
        control: 'image_upload' | 'video_upload' | 'audio_upload';
        mediaKind: 'image' | 'video' | 'audio';
        accept: string;
        acceptFormats: string[];
        order: number;
        promptRefPrefix: '@Image' | '@Video' | '@Audio';
      }) => {
        const maximum =
          numberFromPolicy(referenceLimits, args.providerType) ?? 0;
        if (maximum <= 0) return;
        properties[args.field] = providerProperty({
          type: 'array',
          title: args.title,
          minItems: 0,
          maxItems: maximum,
          items: {
            type: 'object',
            properties: {
              url: { type: 'string', format: 'uri', title: 'URL' },
            },
            required: ['url'],
            additionalProperties: true,
          },
          'x-ui': {
            control: wan3Protocol ? args.control : 'hidden',
            group: wan3Protocol ? 'references' : 'internal',
            order: args.order,
            importance: 'primary',
            accept: args.accept,
            mediaKind: args.mediaKind,
            acceptFormats: args.acceptFormats,
            maxTotalFiles: maxReferenceItems,
            promptRefPrefix: args.promptRefPrefix,
            ...((args.mediaKind === 'video' || args.mediaKind === 'audio') && {
              minItemDurationSeconds: 1,
              maxItemDurationSeconds: 15,
              maxCombinedDurationSeconds: 15,
            }),
          },
          'x-provider': {
            section: 'input',
            parameter: 'media',
            transform:
              args.mediaKind === 'image'
                ? 'mediaArrayAsImages'
                : args.mediaKind === 'video'
                  ? 'mediaArrayAsVideos'
                  : 'mediaArrayAsAudios',
            omitIfEmpty: true,
          },
        });
      };
      addReferenceField({
        field: 'referenceImages',
        title: 'Reference images',
        providerType: 'reference_image',
        control: 'image_upload',
        mediaKind: 'image',
        accept: 'image/jpeg,image/png,image/webp',
        acceptFormats: ['jpeg', 'png', 'webp'],
        order: 30,
        promptRefPrefix: '@Image',
      });
      addReferenceField({
        field: 'referenceVideos',
        title: 'Reference videos',
        providerType: 'reference_video',
        control: 'video_upload',
        mediaKind: 'video',
        accept: 'video/mp4,video/quicktime',
        acceptFormats: ['mp4', 'mov'],
        order: 31,
        promptRefPrefix: '@Video',
      });
      addReferenceField({
        field: 'referenceAudios',
        title: 'Reference audio',
        providerType: 'reference_audio',
        control: 'audio_upload',
        mediaKind: 'audio',
        accept: 'audio/mpeg,audio/wav',
        acceptFormats: ['mp3', 'wav'],
        order: 32,
        promptRefPrefix: '@Audio',
      });

      // Agent/API callers can additionally pass documents or links through
      // the provider-native heterogeneous array. It stays schema-valid but is
      // deliberately hidden from the canvas until document assets exist.
      const nonMediaTypes = referenceTypes.filter(
        (value) => value === 'file' || value === 'link',
      );
      if (nonMediaTypes.length > 0) {
        properties.references = providerProperty({
          type: 'array',
          title: 'Document and link references',
          minItems: 1,
          maxItems: maxReferenceItems,
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                title: 'Type',
                default: nonMediaTypes[0],
                enum: nonMediaTypes,
              },
              url: { type: 'string', format: 'uri', title: 'URL' },
            },
            required: ['type', 'url'],
            additionalProperties: true,
          },
          'x-ui': {
            control: 'hidden',
            group: 'advanced',
            order: 33,
            importance: 'advanced',
          },
          'x-provider': {
            section: 'input',
            parameter: 'media',
            transform: 'mediaArray',
            omitIfEmpty: true,
          },
        });
      }
    }
    if (!wan3Protocol) {
      properties.references = providerProperty({
        type: 'array',
        title: 'References',
        minItems: 1,
        maxItems: maxReferenceItems,
        items: {
          type: 'object',
          properties: referenceProperties,
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
  }

  if (type === 'image') {
    properties.imageSize = providerProperty({
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
        order: 40,
        importance: 'secondary',
      },
      'x-provider': {
        section: 'parameters',
        parameter: 'size',
        omitIfDefault: true,
      },
    });

    if (resolutionOptions.length > 0) {
      properties.resolution = providerProperty({
        type: 'string',
        title: 'Resolution',
        default:
          stringFromPolicy(parameterPolicy, 'defaultResolution') ??
          resolutionOptions[0],
        enum: resolutionOptions,
        'x-ui': {
          control: 'segmented',
          group: 'settings',
          order: 45,
          importance: 'secondary',
        },
        'x-provider': {
          section: 'parameters',
          parameter: 'size',
          omitIfDefault: true,
        },
      });
    }

    const maxVariations =
      variationOptions.length > 0 ? Math.max(...variationOptions) : 4;
    properties.numOutputs = providerProperty({
      type: 'integer',
      title: 'Outputs',
      default: numberFromPolicy(parameterPolicy, 'defaultVariations') ?? 1,
      minimum: variationOptions.length > 0 ? Math.min(...variationOptions) : 1,
      maximum: maxVariations,
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

    if (reference.enabled && generationModes.includes('image_to_image')) {
      properties.referenceImages = providerProperty({
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

    if (qwenImage && recordValue(policy?.negativePrompt)?.enabled !== false) {
      properties.negativePrompt = providerProperty({
        type: 'string',
        title: 'Negative prompt',
        maxLength: 500,
        'x-ui': {
          control: 'textarea',
          group: 'advanced',
          order: 120,
          rows: 3,
          importance: 'advanced',
        },
        'x-provider': {
          section: 'parameters',
          parameter: 'negative_prompt',
          omitIfEmpty: true,
        },
      });
    }

    if (outputFormatOptions.length > 0) {
      properties.outputFormat = providerProperty({
        type: 'string',
        title: 'Output format',
        default:
          stringFromPolicy(parameterPolicy, 'defaultOutputFormat') ?? 'png',
        enum: outputFormatOptions,
        'x-ui': {
          control: 'segmented',
          group: 'advanced',
          order: 150,
          importance: 'advanced',
        },
      });
    }

    if (wanImage && recordValue(policy?.thinkingMode)?.enabled !== false) {
      properties.thinkingMode = providerProperty({
        type: 'boolean',
        title: 'Thinking mode',
        default: recordValue(policy?.thinkingMode)?.default !== false,
        'x-ui': {
          control: 'switch',
          group: 'advanced',
          order: 170,
          importance: 'advanced',
        },
        'x-provider': {
          section: 'parameters',
          parameter: 'thinking_mode',
          omitIfDefault: true,
        },
      });
    }
  }

  if (type === 'video') {
    // Policy-driven (falls back to the legacy fixed grid when a model declares
    // no parameterPolicy). duration + resolution are ALWAYS sent (no
    // omitIfDefault): both drive per-second billing and the provider's own
    // defaults differ from ours, so omitting a "default" pick would let the
    // provider run a different length/resolution than we quoted and charged.
    const videoDurationDefault =
      numberFromPolicy(policy, 'defaultDurationSeconds') ?? 5;
    const videoDurationMin =
      numberFromPolicy(policy, 'minDurationSeconds') ?? 3;
    const videoDurationMax =
      numberFromPolicy(policy, 'maxDurationSeconds') ?? 10;
    const videoResolutionOptions =
      resolutionOptions.length > 0
        ? resolutionOptions
        : ['480P', '720P', '1080P'];
    const videoAspectOptions =
      aspectOptions.length > 0 ? aspectOptions : ['16:9', '9:16', '1:1'];
    properties.durationSeconds = providerProperty({
      type: 'integer',
      title: 'Duration',
      default: videoDurationDefault,
      minimum: videoDurationMin,
      maximum: videoDurationMax,
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
      },
    });
    properties.resolution = providerProperty({
      type: 'string',
      title: 'Resolution',
      default:
        stringFromPolicy(parameterPolicy, 'defaultResolution') ??
        videoResolutionOptions[0],
      enum: videoResolutionOptions,
      'x-ui': {
        control: 'segmented',
        group: 'settings',
        order: 50,
        importance: 'secondary',
      },
      'x-provider': {
        section: 'parameters',
        parameter: 'resolution',
      },
    });
    properties.aspectRatio = providerProperty({
      type: 'string',
      title: 'Aspect ratio',
      default:
        stringFromPolicy(parameterPolicy, 'defaultAspectRatio') ??
        videoAspectOptions[0],
      enum: videoAspectOptions,
      'x-ui': {
        control: 'segmented',
        group: 'settings',
        order: 60,
        importance: 'secondary',
      },
      // Mapped to `parameters.ratio` by the request mapper. The parameter
      // policy decides whether media-driven modes accept it.
      'x-provider': {
        section: 'parameters',
        parameter: 'aspect_ratio',
        omitIfDefault: true,
      },
    });

    if (recordValue(policy?.generateAudio)?.enabled === true) {
      properties.generateAudio = providerProperty({
        type: 'boolean',
        title: 'Generate audio',
        default: recordValue(policy?.generateAudio)?.default !== false,
        'x-ui': {
          control: 'switch',
          group: 'settings',
          order: 70,
          importance: 'secondary',
        },
        'x-provider': {
          section: 'parameters',
          parameter: 'audio',
          omitIfDefault: true,
        },
      });
    }

    if (recordValue(policy?.enableThinking)?.enabled === true) {
      properties.enableThinking = providerProperty({
        type: 'boolean',
        title: 'Deep thinking',
        default: recordValue(policy?.enableThinking)?.default === true,
        'x-ui': {
          control: 'switch',
          group: 'advanced',
          order: 175,
          importance: 'advanced',
        },
        'x-provider': {
          section: 'parameters',
          parameter: 'enable_thinking',
          omitIfDefault: true,
        },
      });
    }
  }

  if (recordValue(policy?.promptExtend)?.enabled !== false) {
    properties.promptExtend = providerProperty({
      type: 'boolean',
      title: 'Prompt enhance',
      default: recordValue(policy?.promptExtend)?.default !== false,
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
  }
  if (recordValue(policy?.watermark)?.enabled !== false) {
    properties.watermark = providerProperty({
      type: 'boolean',
      title: 'Watermark',
      default: recordValue(policy?.watermark)?.default === true,
      'x-ui': {
        control: 'switch',
        group: 'advanced',
        order: 190,
        importance: 'advanced',
      },
      'x-provider': {
        section: 'parameters',
        parameter: 'watermark',
        omitIfDefault: true,
      },
    });
  }
  if (recordValue(policy?.seed)?.enabled !== false) {
    properties.seed = providerProperty({
      type: 'integer',
      title: 'Seed',
      minimum: 0,
      maximum: numberFromPolicy(policy?.seed, 'maximum'),
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
  }

  const wan3Protocol =
    stringFromPolicy(parameterPolicy, 'providerProtocol') === 'wan3-video';
  const schema: AiInputSchema = {
    type: 'object',
    properties,
    required: wan3Protocol ? [] : ['prompt'],
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
  if (wan3Protocol) {
    schema['x-rules'] = [
      {
        id: 'wan3-prompt-or-media',
        when: {
          all: [
            { field: 'prompt', operator: 'empty' },
            { field: 'startFrame', operator: 'empty' },
            { field: 'referenceImages', operator: 'empty' },
            { field: 'referenceVideos', operator: 'empty' },
            { field: 'referenceAudios', operator: 'empty' },
            { field: 'references', operator: 'empty' },
          ],
        },
        fields: ['prompt'],
        effect: 'require',
        message: 'Add a prompt, a start frame, or reference media.',
      },
      {
        id: 'wan3-end-frame-requires-start-frame',
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
        id: 'wan3-references-are-exclusive',
        when: {
          any: [
            { field: 'referenceImages', operator: 'exists' },
            { field: 'referenceVideos', operator: 'exists' },
            { field: 'referenceAudios', operator: 'exists' },
            { field: 'references', operator: 'exists' },
          ],
        },
        fields: ['startFrame', 'endFrame'],
        effect: 'forbid',
        message: 'Reference media cannot be combined with first/last frames.',
      },
    ];
  }
  return schema;
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
  inputSchema: AiInputSchema,
): AiCapabilityMatrix {
  const inputModalities = new Set<
    AiCapabilityMatrix['inputModalities'][number]
  >(['text']);
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
  const referenceTypes = recordValue(inputSchema.properties.references)?.items;
  const referenceItem = recordValue(referenceTypes);
  const referenceProperties = recordValue(referenceItem?.properties);
  const referenceType = recordValue(referenceProperties?.type);
  const supportedReferenceTypes = Array.isArray(referenceType?.enum)
    ? referenceType.enum.filter(
        (value): value is string => typeof value === 'string',
      )
    : [];
  if (supportedReferenceTypes.includes('reference_audio')) {
    inputModalities.add('audio');
  }
  if (inputSchema.properties.referenceAudios) {
    inputModalities.add('audio');
  }
  if (supportedReferenceTypes.includes('file')) {
    inputModalities.add('file');
    inputModalities.add('document');
  }
  return {
    source: 'internal',
    inputModalities: Array.from(inputModalities),
    outputModalities: [type],
    generationModes,
    supportedParameters: Object.keys(inputSchema.properties),
    unsupportedParameters: [],
    features: {
      cancel: false,
      providerQueue: true,
      providerUrlOutput: true,
    },
    limits: {
      maxOutputs: maxOutputsFromSchema(inputSchema, type),
      maxPromptCharacters:
        numberFromPolicy(inputSchema.properties.prompt, 'maxLength') ??
        (type === 'video' ? 2000 : 4000),
    },
  };
}

function maxOutputsFromSchema(schema: AiInputSchema, type: AiJobType): number {
  if (type === 'video') return 1;
  const maximum = recordValue(schema.properties.numOutputs)?.maximum;
  return typeof maximum === 'number' && Number.isFinite(maximum) ? maximum : 1;
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
    callMode: args.callMode,
    type: args.type,
    family: familyForType(args.type),
    generationModes,
    name: args.name ?? humanizeEndpoint(args.endpointId),
    description:
      args.description ??
      `${humanizeEndpoint(args.endpointId)} via Alibaba Model Studio.`,
    enabled: args.enabled,
    disabledReason: args.disabledReason,
    requiredPlan: args.requiredPlan ?? null,
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
    catalogSnapshot: args.catalogSnapshot,
    providerPricing: args.providerPricing ?? null,
    inputSchema,
    outputSchema,
    providerInputMap: providerInputMap(inputSchema),
    documentation: documentationForEndpoint(
      args.endpointId,
      args.service,
      args.catalogSnapshot,
    ),
  };
}

export function toAiModelDefinition(
  config: BailianModelRuntimeConfig,
): AiModelDefinition {
  const capabilityMatrix = capabilityMatrixFor(
    config.type,
    config.generationModes,
    config.inputSchema,
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
        source:
          item.url.includes('aliyun.com') ||
          item.url.includes('alibabacloud.com')
            ? 'official'
            : 'internal',
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
            'BAILIAN_API_KEY',
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
      supportsSeed: 'seed' in config.inputSchema.properties,
      supportsCancel: config.callMode === 'async',
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
  catalogSnapshot?: AiJsonValue,
) {
  const catalogDocs = recordValue(catalogSnapshot)?.docs;
  if (Array.isArray(catalogDocs)) {
    const docs = catalogDocs.flatMap((item) => {
      const doc = recordValue(item);
      const title = typeof doc?.title === 'string' ? doc.title.trim() : '';
      const url = typeof doc?.url === 'string' ? doc.url.trim() : '';
      return title && url ? [{ title, url, scope: 'api_reference' }] : [];
    });
    if (docs.length > 0) return docs;
  }
  const url =
    endpointId === 'wan2.7-r2v'
      ? 'https://help.aliyun.com/zh/model-studio/wan-video-to-video-api-reference'
      : endpointId.startsWith('wan2.7-image') ||
          endpointId === 'wanx2.1-imageedit'
        ? 'https://help.aliyun.com/zh/model-studio/wan-image-generation-and-editing-api-reference'
        : endpointId.startsWith('qwen-image-2.0')
          ? 'https://help.aliyun.com/zh/model-studio/qwen-image-api'
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
