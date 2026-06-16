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
  /** Model takes ONE reference image as a single `image_url` (e.g. hunyuan). */
  single: boolean;
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
    single: value?.single === true,
  };
}

function seedEnabled(policy: AiJsonValue | undefined): boolean {
  return recordValue(recordValue(policy)?.seed)?.enabled === true;
}

function booleanFromPolicy(value: unknown, key: string): boolean | undefined {
  const flag = recordValue(value)?.[key];
  return typeof flag === 'boolean' ? flag : undefined;
}

/**
 * `generateAudio` policy block (Seedance & other audio-video models). When
 * `enabled` is false (or missing) the switch is not emitted at all.
 */
function generateAudioPolicy(
  policy: AiJsonValue | undefined,
): { default: boolean } | undefined {
  const value = recordValue(recordValue(policy)?.generateAudio);
  if (!value || value.enabled !== true) return undefined;
  return { default: booleanFromPolicy(value, 'default') ?? true };
}

/**
 * Multimodal `referenceInputs` policy (Seedance 全能参考 / multimodal_to_video).
 * Distinct from the image-model `referenceImages` shape read by
 * `referencePolicy()` — this carries separate image/video/audio caps and a
 * combined `maxTotalFiles` ceiling.
 */
function referenceInputsPolicy(policy: AiJsonValue | undefined):
  | {
      images: { min: number; max: number };
      videos: { min: number; max: number };
      audios: { min: number; max: number };
      maxTotalFiles?: number;
    }
  | undefined {
  const value = recordValue(recordValue(policy)?.referenceInputs);
  if (!value || value.enabled !== true) return undefined;
  const slot = (key: string): { min: number; max: number } => {
    const entry = recordValue(value[key]);
    const min = numberFromPolicy(entry, 'min');
    const max = numberFromPolicy(entry, 'max');
    return {
      min: typeof min === 'number' ? Math.max(0, min) : 0,
      max: typeof max === 'number' ? Math.max(0, max) : 0,
    };
  };
  return {
    images: slot('images'),
    videos: slot('videos'),
    audios: slot('audios'),
    maxTotalFiles: numberFromPolicy(value, 'maxTotalFiles'),
  };
}

function numberFromPolicy(value: unknown, key: string): number | undefined {
  const number = recordValue(value)?.[key];
  return typeof number === 'number' && Number.isFinite(number)
    ? number
    : undefined;
}

function numberControlPolicy(
  policy: AiJsonValue | undefined,
  key: string,
):
  | {
      defaultValue?: number;
      maximum?: number;
      minimum?: number;
      step?: number;
    }
  | undefined {
  const value = recordValue(recordValue(policy)?.[key]);
  if (value?.enabled !== true) return undefined;
  return {
    defaultValue: numberFromPolicy(value, 'default'),
    minimum: numberFromPolicy(value, 'minimum'),
    maximum: numberFromPolicy(value, 'maximum'),
    step: numberFromPolicy(value, 'step'),
  };
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
  // Single-image transform ops: one input image → one output image, no prompt
  // and none of the generation controls. Each may still add its own narrow
  // param (upscale → factor); background removal adds none.
  const upscale = generationModes.includes('upscale');
  const removeBackground = generationModes.includes('remove_background');
  const pureTransform = upscale || removeBackground;
  // Relight (IC-Light) is a single-image op that DOES take a prompt, so it is
  // not a pure transform — it keeps the prompt but takes a curated control set
  // (preset size + output count + light direction) instead of the generic
  // aspect/resolution controls.
  const relight = generationModes.includes('relight');
  const nanoBanana = isNanoBananaEndpoint(endpointId);
  // Reference-image limits come straight from the canonical parameterPolicy —
  // the seed encodes each provider's real cap (e.g. seedream's documented max
  // of 10: https://fal.ai/models/fal-ai/bytedance/seedream/v4/edit/api), so no
  // hardcoded per-endpoint clamps live here anymore.
  const reference = referencePolicy(parameterPolicy);

  const properties: AiInputSchema['properties'] = {};
  // Pure transform ops (upscale / remove background) take no prompt.
  if (!pureTransform) {
    properties.prompt = {
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
    };
  }

  // Pure transform ops take none of the generation controls
  // (aspect / resolution / quality / output-count / negative prompt) — only
  // their own input image + op param, added below.
  if ((imageMode || imageToImage) && !pureTransform && !relight) {
    const aspectOptions = stringArrayFromPolicy(
      parameterPolicy,
      'supportedAspectRatios',
    );
    // Aspect-driven iff the canonical policy declares supportedAspectRatios.
    // Verified per currently-seeded fal image endpoint (2026-06): every one
    // either takes aspect ratios natively or takes `image_size` as a
    // {width, height} object that the request mapper derives from
    // ratio + resolution —
    //  - openai/gpt-image-2: presets OR {width, height}
    //    (https://fal.ai/models/openai/gpt-image-2/api)
    //  - fal-ai/flux-2 (dev) / flux-2-pro / flux-2-flex / flux-2-max:
    //    presets OR {width, height} (https://fal.ai/models/fal-ai/flux-2/api,
    //    https://fal.ai/models/fal-ai/flux-2-max/api)
    //  - fal-ai/bytedance/seedream/*: {width, height}
    //  - fal-ai/qwen-image-2*: {width, height}
    //  - fal-ai/nano-banana*: native `aspect_ratio` enum (policy declares
    //    aspectParameter: 'aspect_ratio')
    // An endpoint that only accepted preset tokens would have to drop
    // supportedAspectRatios (or set aspectParameter) in its seed policy.
    const aspectRatioDriven = aspectOptions.length > 0;
    const aspectParameter =
      stringFromPolicy(parameterPolicy, 'aspectParameter') ??
      // Per-family fallback for policies that predate `aspectParameter`.
      (nanoBanana ? 'aspect_ratio' : 'image_size');
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
        parameter: aspectParameter,
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

    // Emission is gated by the policy itself (numberControlPolicy returns
    // undefined unless `enabled === true`) — NOT by endpoint regexes, which
    // drifted and silently dropped flux-2-dev's declared sliders (its
    // endpoint is the bare `fal-ai/flux-2`).
    const guidanceScale = numberControlPolicy(parameterPolicy, 'guidanceScale');
    if (guidanceScale) {
      properties.guidanceScale = {
        type: 'number',
        title: 'Guidance scale',
        default: guidanceScale.defaultValue ?? 3.5,
        minimum: guidanceScale.minimum ?? 1.5,
        maximum: guidanceScale.maximum ?? 10,
        ...(guidanceScale.step ? { multipleOf: guidanceScale.step } : {}),
        'x-ui': {
          control: 'slider',
          group: 'advanced',
          order: 88,
          importance: 'advanced',
        },
        'x-provider': {
          parameter: 'guidance_scale',
          omitIfEmpty: true,
        },
      };
    }

    const inferenceSteps = numberControlPolicy(
      parameterPolicy,
      'inferenceSteps',
    );
    if (inferenceSteps) {
      properties.inferenceSteps = {
        type: 'integer',
        title: 'Inference steps',
        default: inferenceSteps.defaultValue ?? 28,
        minimum: inferenceSteps.minimum ?? 1,
        maximum: inferenceSteps.maximum ?? 50,
        'x-ui': {
          control: 'slider',
          group: 'advanced',
          order: 89,
          importance: 'advanced',
        },
        'x-provider': {
          parameter: 'num_inference_steps',
          omitIfEmpty: true,
        },
      };
    }

    // Any model whose policy declares negativePrompt { enabled: true } gets
    // the control (today: the qwen-image seeds) — no endpoint gating.
    const negativePrompt = recordValue(
      recordValue(parameterPolicy)?.negativePrompt,
    );
    if (negativePrompt?.enabled === true) {
      properties.negativePrompt = {
        type: 'string',
        title: 'Negative prompt',
        maxLength: numberFromPolicy(negativePrompt, 'maxLength') ?? 500,
        'x-ui': {
          control: 'textarea',
          group: 'advanced',
          order: 82,
          rows: 3,
          importance: 'advanced',
        },
        'x-provider': {
          parameter: 'negative_prompt',
          omitIfEmpty: true,
        },
      };
    }
  }

  if ((imageToImage || pureTransform || relight) && reference.enabled) {
    properties.referenceImages = {
      type: 'array',
      title: pureTransform || relight ? 'Image' : 'Reference images',
      minItems: reference.min,
      maxItems: reference.single ? 1 : reference.max,
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
      // One-image models bind a single `image_url`; multi-image models bind the
      // `image_urls` array (and route to the provider's /edit endpoint).
      'x-provider': reference.single
        ? { parameter: 'image_url', transform: 'mediaFirstUrl' }
        : { parameter: 'image_urls', transform: 'mediaArrayToUrls' },
    };
  }

  // Upscale factor — the only user-facing control for the upscale op.
  if (upscale) {
    properties.upscaleFactor = {
      type: 'integer',
      title: 'Scale',
      enum: [2, 4],
      default: 2,
      'x-ui': {
        control: 'segmented',
        group: 'parameters',
        order: 30,
        importance: 'primary',
        unit: '×',
      },
      'x-provider': { parameter: 'upscale_factor' },
    };
  }

  // Relight (IC-Light): a curated control set instead of the generic aspect/
  // resolution block — a preset output size, a coarse light direction, and an
  // output count. The prompt (required) is emitted above by the !pureTransform
  // branch; the single source image by the reference block above.
  if (relight) {
    properties.imageSize = {
      type: 'string',
      title: 'Image size',
      default: 'square_hd',
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
      'x-provider': { parameter: 'image_size' },
    };
    properties.initialLatent = {
      type: 'string',
      title: 'Light direction',
      default: 'None',
      enum: ['None', 'Left', 'Right', 'Top', 'Bottom'],
      'x-ui': {
        control: 'segmented',
        group: 'settings',
        order: 22,
        importance: 'primary',
      },
      'x-provider': { parameter: 'initial_latent', omitIfDefault: true },
    };
    const variationOptions = numberArrayFromPolicy(
      parameterPolicy,
      'variationOptions',
    );
    const maxVariations =
      variationOptions.length > 0 ? Math.max(...variationOptions) : 4;
    if (maxVariations > 1) {
      properties.numOutputs = {
        type: 'integer',
        title: 'Outputs',
        default:
          typeof recordValue(parameterPolicy)?.defaultVariations === 'number'
            ? (recordValue(parameterPolicy)?.defaultVariations as number)
            : 1,
        minimum: 1,
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
  }

  if (
    imageToImage &&
    reference.enabled &&
    reference.maskSupported &&
    !reference.single
  ) {
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
    // Policy-driven video controls. Models whose parameterPolicy declares the
    // relevant keys (e.g. Seedance 2.0) get the canonical enum/switch controls;
    // models without those keys fall back to the previous hardcoded shape so we
    // never regress the other fal video endpoints.
    const videoResolutionOptions = stringArrayFromPolicy(
      parameterPolicy,
      'resolutionOptions',
    );
    const videoDurationOptions = stringArrayFromPolicy(
      parameterPolicy,
      'durationOptions',
    );
    const videoAspectOptions = stringArrayFromPolicy(
      parameterPolicy,
      'supportedAspectRatios',
    );
    const audioPolicy = generateAudioPolicy(parameterPolicy);

    if (videoResolutionOptions.length > 0) {
      properties.resolution = {
        type: 'string',
        title: 'Resolution',
        default:
          stringFromPolicy(parameterPolicy, 'defaultResolution') ??
          videoResolutionOptions[0],
        enum: videoResolutionOptions,
        'x-ui': {
          control: 'segmented',
          group: 'settings',
          order: 55,
          importance: 'secondary',
        },
        'x-provider': { parameter: 'resolution', omitIfDefault: true },
      };
    }

    if (videoDurationOptions.length > 0) {
      // STRING enum incl. 'auto' (e.g. Seedance 'auto'/'4'..'15') rendered as a
      // dropdown, NOT an integer slider.
      properties.duration = {
        type: 'string',
        title: 'Duration',
        default:
          stringFromPolicy(parameterPolicy, 'defaultDurationSeconds') ??
          videoDurationOptions[0],
        enum: videoDurationOptions,
        'x-ui': {
          control: 'select',
          group: 'settings',
          order: 60,
          importance: 'secondary',
        },
        // ALWAYS sent (no omitIfDefault): duration drives per-second billing
        // and fal's own default is 'auto' (= the ceiling). Omitting our '5'
        // default would let the provider run 15 s while we charged 5 s.
        'x-provider': { parameter: 'duration' },
      };
    } else {
      // Fallback: integer slider for video models without a duration policy.
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
    }

    properties.aspectRatio = {
      type: 'string',
      title: 'Aspect ratio',
      default:
        stringFromPolicy(parameterPolicy, 'defaultAspectRatio') ??
        (videoAspectOptions.length > 0 ? videoAspectOptions[0] : '16:9'),
      enum:
        videoAspectOptions.length > 0
          ? videoAspectOptions
          : ['16:9', '9:16', '1:1'],
      'x-ui': {
        control: 'segmented',
        group: 'settings',
        order: 70,
        importance: 'secondary',
      },
      'x-provider': { parameter: 'aspect_ratio', omitIfDefault: true },
    };

    if (audioPolicy) {
      properties.generateAudio = {
        type: 'boolean',
        title: 'Generate audio',
        default: audioPolicy.default,
        'x-ui': {
          control: 'switch',
          group: 'settings',
          order: 75,
          importance: 'secondary',
        },
        'x-provider': { parameter: 'generate_audio' },
      };
    }
  }

  // Multimodal references (Seedance 全能参考 / multimodal_to_video): up to
  // 9 images + 3 videos + 3 audios, ≤ maxTotalFiles across all three. Each
  // array is a separate upload control; the per-spec format/size/duration
  // constraints ride on `x-ui` so the composer + validation layer can enforce
  // them (the panel skips group 'references' — these belong to Layer 2).
  const referenceInputs = referenceInputsPolicy(parameterPolicy);
  if (generationModes.includes('multimodal_to_video') && referenceInputs) {
    const maxTotalFiles = referenceInputs.maxTotalFiles;
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
          order: 30,
          importance: 'primary',
          accept: 'image/jpeg,image/png,image/webp',
          // Per-spec constraints carried for the UI/validation layer.
          ...({
            mediaKind: 'image',
            acceptFormats: ['jpeg', 'png', 'webp'],
            maxFileSizeMb: 30,
            promptRefPrefix: '@Image',
            maxTotalFiles,
          } as Record<string, unknown>),
        } as AiInputSchema['properties'][string]['x-ui'],
        'x-provider': {
          parameter: 'image_urls',
          transform: 'mediaArrayToUrls',
        },
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
          order: 31,
          importance: 'primary',
          accept: 'video/mp4,video/quicktime',
          ...({
            mediaKind: 'video',
            acceptFormats: ['mp4', 'mov'],
            maxCombinedFileSizeMb: 50,
            minCombinedDurationSeconds: 2,
            maxCombinedDurationSeconds: 15,
            resolutionBand: '480p-720p',
            promptRefPrefix: '@Video',
            maxTotalFiles,
          } as Record<string, unknown>),
        } as AiInputSchema['properties'][string]['x-ui'],
        'x-provider': {
          parameter: 'video_urls',
          transform: 'mediaArrayToUrls',
        },
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
          order: 32,
          importance: 'primary',
          accept: 'audio/mpeg,audio/wav',
          ...({
            mediaKind: 'audio',
            acceptFormats: ['mp3', 'wav'],
            maxFileSizeMb: 15,
            maxCombinedDurationSeconds: 15,
            // Audio cannot be sent without ≥1 image or video reference.
            audioRequiresVisual: true,
            promptRefPrefix: '@Audio',
            maxTotalFiles,
          } as Record<string, unknown>),
        } as AiInputSchema['properties'][string]['x-ui'],
        'x-provider': {
          parameter: 'audio_urls',
          transform: 'mediaArrayToUrls',
        },
      };
    }
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
    // Pure transforms omit the prompt property entirely (see the
    // `!pureTransform` gate above), so it must not be listed as required —
    // that would be an invalid schema (required field absent from properties).
    required: pureTransform ? [] : ['prompt'],
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
  // Pure transforms (upscale / remove background) take an image and NO prompt,
  // so their input is image-only — the `image_to` substring check below would
  // otherwise mis-tag them as text input. Relight takes an image AND a prompt.
  const pureTransform =
    generationModes.includes('upscale') ||
    generationModes.includes('remove_background');
  const relight = generationModes.includes('relight');
  const imageInput =
    pureTransform ||
    relight ||
    generationModes.some((mode) => mode.includes('image_to'));
  return {
    source: 'internal',
    inputModalities: imageInput
      ? pureTransform
        ? ['image']
        : ['text', 'image']
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
      'video_urls',
      'audio_urls',
      'mask_url',
      'end_image_url',
      'output_format',
      'duration',
      'aspect_ratio',
      'generate_audio',
      'seed',
      // Only present when an upscale binding adds the `upscaleFactor` control
      // (maps to the provider's `upscale_factor`).
      ...(generationModes.includes('upscale') ? ['upscale_factor'] : []),
      // Relight adds the coarse light-direction control (initial_latent).
      ...(relight ? ['initial_latent'] : []),
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
