import { Injectable } from '@nestjs/common';
import type {
  FoundryAvailability,
  FoundryCapabilityMatrix,
  FoundryCostEstimate,
  FoundryDeploymentRecord,
  FoundryDocumentationLink,
  FoundryInputSchema,
  AiJobType,
  FoundryModelCapability,
  FoundryModelDefinition,
  FoundryObservabilityContract,
  FoundryObjectSchema,
  FoundryOutputSchema,
  FoundryPreflightEstimator,
} from '../../types';

export const FOUNDRY_SCHEMA_VERSION = '2026-05-16';
const FOUNDRY_SCHEMA_DIALECT =
  'https://fizzdragon.com/schemas/foundry/model/v1';

const GPT_IMAGE_2_MODELS = new Set(['gpt-image-2', 'gpt-image-2-2026-04-21']);
const OPENAI_API_VERSION = 'v1';
const OPENAI_PRICING_URL = 'https://platform.openai.com/pricing';
const OPENAI_IMAGE_CALCULATOR_URL =
  'https://platform.openai.com/tokenizer?view=image';

const GPT_IMAGE_2_PREFLIGHT_ESTIMATOR: FoundryPreflightEstimator = {
  kind: 'token_heuristic',
  label: 'Estimated credits',
  labelKey: 'foundry.schema.preflight.estimatedCredits',
  confidence: 'low',
  currency: 'CREDITS',
  promptField: 'prompt',
  sizeField: 'size',
  qualityField: 'quality',
  countField: 'n',
  referenceImagesField: 'reference_images',
  charsPerTextToken: 4,
  minTextTokens: 16,
  imageInputTokensPerReference: 512,
  defaultSize: '1024x1024',
  autoSize: '1024x1024',
  defaultQuality: 'auto',
  defaultCount: 1,
  baseOutputTokens: 1024,
  outputTokensPerMegapixel: 2048,
  qualityMultipliers: {
    auto: 1.15,
    low: 0.65,
    medium: 1,
    high: 1.6,
  },
  inputCostPerMillion: 1000,
  outputCostPerMillion: 6500,
  minimumAmount: 24,
  rounding: 'ceil',
  notes: [
    'Heuristic only. GPT Image 2 authoritative token usage is available after provider execution.',
  ],
};

const GPT_IMAGE_2_DOCUMENTATION: FoundryDocumentationLink[] = [
  {
    title: 'GPT Image 2 model',
    url: 'https://developers.openai.com/api/docs/models/gpt-image-2',
    source: 'official',
    scope: 'model',
    provider: 'openai',
  },
  {
    title: 'Image generation guide',
    url: 'https://developers.openai.com/api/docs/guides/image-generation',
    source: 'official',
    scope: 'guide',
    provider: 'openai',
  },
  {
    title: 'Images API reference',
    url: 'https://developers.openai.com/api/reference/resources/images/methods/generate',
    source: 'official',
    scope: 'api_reference',
    provider: 'openai',
  },
  {
    title: 'OpenAI API pricing',
    url: OPENAI_PRICING_URL,
    source: 'official',
    scope: 'pricing',
    provider: 'openai',
  },
  {
    title: 'Image edits API reference',
    url: 'https://developers.openai.com/api/reference/resources/images/methods/edit',
    source: 'official',
    scope: 'api_reference',
    provider: 'openai',
  },
];

const GPT_IMAGE_2_CAPABILITY_MATRIX: FoundryCapabilityMatrix = {
  source: 'official',
  inputModalities: ['text', 'image'],
  outputModalities: ['image'],
  generationModes: ['text_to_image', 'image_to_image'],
  supportedParameters: [
    'prompt',
    'size',
    'quality',
    'n',
    'reference_images',
    'background',
    'output_format',
    'output_compression',
    'moderation',
    'stream',
    'partial_images',
  ],
  unsupportedParameters: ['response_format', 'input_fidelity', 'seed'],
  features: {
    customSize: true,
    streaming: true,
    transparentBackground: false,
    revisedPrompt: false,
    providerUrlOutput: false,
    base64Output: true,
    highFidelityImageInput: true,
    cancel: false,
  },
  limits: {
    maxOutputs: 10,
    maxReferenceImages: 16,
    maxPartialImages: 3,
    maxPromptCharacters: 32000,
    sizeMultipleOf: 16,
    maxEdgePixels: 3840,
    minOutputPixels: 655360,
    maxOutputPixels: 8294400,
    maxAspectRatio: '3:1',
  },
};

const IMAGE_HINTS = [
  'dall-e',
  'dalle',
  'flux',
  'gpt-image',
  'image',
  'imagen',
  'recraft',
  'sd-',
  'stable-diffusion',
  'seedream',
];

const VIDEO_HINTS = [
  'hailuo',
  'kling',
  'luma',
  'pixverse',
  'runway',
  'sora',
  'veo',
  'video',
  'wan',
];

function intEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function executionEnabled(): boolean {
  return process.env.FOUNDRY_EXECUTION_ENABLED === 'true';
}

function executionConfigured(): boolean {
  const openAIBaseUrl = process.env.AZURE_OPENAI_BASE_URL?.trim();
  const foundryModelsEndpoint =
    process.env.AZURE_FOUNDRY_MODELS_ENDPOINT?.trim();
  const apiKey =
    process.env.AZURE_OPENAI_API_KEY?.trim() ??
    process.env.AZURE_FOUNDRY_API_KEY?.trim();
  return Boolean((openAIBaseUrl || foundryModelsEndpoint) && apiKey);
}

function disabledReason(): string | undefined {
  if (!executionConfigured()) {
    return 'Foundry execution endpoint or credentials are not configured.';
  }
  if (!executionEnabled()) {
    return 'Foundry execution is not enabled for this environment.';
  }
  return undefined;
}

function displayName(value: string): string {
  return value
    .split(/[-_/:\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function capabilityOverride(record: FoundryDeploymentRecord) {
  const raw = process.env.FOUNDRY_MODEL_CAPABILITIES_JSON?.trim();
  if (!raw) return null;
  const parsed = JSON.parse(raw) as Record<string, FoundryModelCapability>;
  return parsed[record.deployment] ?? parsed[record.modelName] ?? null;
}

function includesAny(value: string, hints: string[]): boolean {
  return hints.some((hint) => value.includes(hint));
}

const promptField = {
  type: 'string',
  title: 'Prompt',
  titleKey: 'foundry.schema.field.prompt.title',
  maxLength: 4000,
  'x-ui': {
    control: 'textarea',
    group: 'prompt',
    importance: 'primary',
    order: 10,
    rows: 6,
    labelKey: 'foundry.schema.field.prompt.label',
  },
  'x-provider': { parameter: 'prompt' },
} as const;

function gptImage2PromptField() {
  return {
    ...promptField,
    maxLength: 32000,
    description: 'Text description of the desired image or image edit.',
    descriptionKey: 'foundry.gptImage2.prompt.description',
  } as const;
}

function mediaReferenceSchema(title: string): FoundryObjectSchema {
  return {
    type: 'object',
    title,
    required: ['url'],
    additionalProperties: false,
    properties: {
      url: {
        type: 'string',
        title,
        titleKey: 'foundry.schema.media.url.title',
        format: 'uri',
      },
      mimeType: {
        type: 'string',
        title: 'MIME type',
        titleKey: 'foundry.schema.media.mimeType.title',
      },
      name: {
        type: 'string',
        title: 'File name',
        titleKey: 'foundry.schema.media.name.title',
      },
      bytes: {
        type: 'integer',
        title: 'Bytes',
        titleKey: 'foundry.schema.media.bytes.title',
        minimum: 0,
      },
    },
  };
}

function imageInputSchema(record: FoundryDeploymentRecord): FoundryInputSchema {
  if (isGptImage2Model(record)) return gptImage2InputSchema();

  return {
    type: 'object',
    required: ['prompt'],
    additionalProperties: false,
    'x-ui': {
      groups: [
        {
          id: 'prompt',
          title: 'Prompt',
          titleKey: 'foundry.schema.group.prompt.title',
          order: 10,
        },
        {
          id: 'generation',
          title: 'Generation',
          titleKey: 'foundry.schema.group.generation.title',
          order: 20,
        },
        {
          id: 'references',
          title: 'References',
          titleKey: 'foundry.schema.group.references.title',
          order: 30,
          collapsible: true,
          defaultCollapsed: true,
        },
        {
          id: 'advanced',
          title: 'Advanced',
          titleKey: 'foundry.schema.group.advanced.title',
          order: 90,
          collapsible: true,
          defaultCollapsed: true,
        },
      ],
    },
    properties: {
      prompt: promptField,
      size: {
        type: 'string',
        title: 'Size',
        titleKey: 'foundry.schema.field.size.title',
        enum: ['1024x1024', '1024x1536', '1536x1024'],
        default: '1024x1024',
        'x-ui': {
          control: 'segmented',
          group: 'generation',
          importance: 'primary',
          order: 20,
          labelKey: 'foundry.schema.field.size.label',
        },
        'x-provider': { parameter: 'size', omitIfDefault: false },
      },
      quality: {
        type: 'string',
        title: 'Quality',
        titleKey: 'foundry.schema.field.quality.title',
        enum: ['low', 'medium', 'high'],
        default: 'medium',
        'x-ui': {
          control: 'select',
          group: 'advanced',
          importance: 'advanced',
          order: 80,
          labelKey: 'foundry.schema.field.quality.label',
        },
        'x-provider': { parameter: 'quality', omitIfDefault: true },
      },
      n: {
        type: 'integer',
        title: 'Outputs',
        titleKey: 'foundry.schema.field.outputs.title',
        minimum: 1,
        maximum: 4,
        default: 1,
        'x-ui': {
          control: 'stepper',
          group: 'generation',
          importance: 'primary',
          order: 30,
          labelKey: 'foundry.schema.field.outputs.label',
        },
        'x-provider': { parameter: 'n', omitIfDefault: true },
      },
      reference_images: {
        type: 'array',
        title: 'Reference images',
        titleKey: 'foundry.schema.field.referenceImages.title',
        items: mediaReferenceSchema('Reference image URL'),
        maxItems: 4,
        'x-ui': {
          control: 'image_upload',
          group: 'references',
          importance: 'secondary',
          order: 40,
          accept: 'image/jpeg,image/png,image/webp',
          labelKey: 'foundry.schema.field.referenceImages.label',
        },
        'x-provider': {
          parameter: 'image',
          transform: 'mediaArrayToOpenAIImageInput',
          omitIfEmpty: true,
        },
      },
      seed: {
        type: 'integer',
        title: 'Seed',
        titleKey: 'foundry.schema.field.seed.title',
        minimum: 0,
        maximum: 2147483647,
        'x-ui': {
          control: 'stepper',
          group: 'advanced',
          importance: 'advanced',
          order: 90,
          labelKey: 'foundry.schema.field.seed.label',
        },
        'x-provider': { parameter: 'seed', omitIfEmpty: true },
      },
    },
  };
}

function gptImage2InputSchema(): FoundryInputSchema {
  return {
    type: 'object',
    required: ['prompt'],
    additionalProperties: false,
    'x-ui': {
      groups: [
        {
          id: 'prompt',
          title: 'Prompt',
          titleKey: 'foundry.schema.group.prompt.title',
          order: 10,
        },
        {
          id: 'generation',
          title: 'Generation',
          titleKey: 'foundry.schema.group.generation.title',
          order: 20,
        },
        {
          id: 'references',
          title: 'References',
          titleKey: 'foundry.schema.group.references.title',
          order: 30,
          collapsible: true,
          defaultCollapsed: true,
        },
        {
          id: 'output',
          title: 'Output',
          titleKey: 'foundry.schema.group.output.title',
          order: 40,
          collapsible: true,
          defaultCollapsed: true,
        },
        {
          id: 'advanced',
          title: 'Advanced',
          titleKey: 'foundry.schema.group.advanced.title',
          order: 90,
          collapsible: true,
          defaultCollapsed: true,
        },
      ],
    },
    'x-rules': [
      {
        id: 'compression-requires-lossy-format',
        when: {
          field: 'output_format',
          operator: 'notIn',
          values: ['jpeg', 'webp'],
        },
        effect: 'forbid',
        fields: ['output_compression'],
        message:
          'Compression is only supported when Output format is jpeg or webp.',
      },
      {
        id: 'partial-images-require-stream',
        when: { field: 'stream', operator: 'notEquals', value: true },
        effect: 'forbid',
        fields: ['partial_images'],
        message:
          'Partial images can only be requested when streaming is enabled.',
      },
    ],
    properties: {
      prompt: gptImage2PromptField(),
      size: {
        type: 'string',
        title: 'Size',
        titleKey: 'foundry.schema.field.size.title',
        description:
          'Use auto or WIDTHxHEIGHT. Width and height must be multiples of 16; total pixels must be 655360-8294400; aspect ratio must be at most 3:1.',
        descriptionKey: 'foundry.gptImage2.size.description',
        default: 'auto',
        format: 'gpt-image-2-size',
        examples: [
          'auto',
          '1024x1024',
          '1536x1024',
          '1024x1536',
          '2048x1152',
          '3840x2160',
        ],
        'x-constraints': [
          {
            kind: 'dimension2d',
            allowAuto: true,
            multipleOf: 16,
            minPixels: 655360,
            maxPixels: 8294400,
            maxEdge: 3840,
            maxAspectRatio: 3,
          },
        ],
        'x-ui': {
          control: 'segmented',
          group: 'generation',
          importance: 'primary',
          order: 20,
          options: [
            {
              value: 'auto',
              label: 'Auto',
              labelKey: 'foundry.imageLab.sizePreset.auto',
            },
            {
              value: '1024x1024',
              label: '1:1',
              labelKey: 'foundry.imageLab.sizePreset.square',
            },
            {
              value: '1536x1024',
              label: '3:2',
              labelKey: 'foundry.imageLab.sizePreset.landscape',
            },
            {
              value: '1024x1536',
              label: '2:3',
              labelKey: 'foundry.imageLab.sizePreset.portrait',
            },
            {
              value: '2048x1152',
              label: '16:9',
              labelKey: 'foundry.imageLab.sizePreset.wide',
            },
          ],
          hint: 'Choose a common ratio. Custom WIDTHxHEIGHT remains available through schema/API.',
          labelKey: 'foundry.schema.field.size.label',
          hintKey: 'foundry.gptImage2.size.hint',
        },
        'x-provider': {
          parameter: 'size',
          transform: 'omitAuto',
          omitIfDefault: true,
        },
      },
      quality: {
        type: 'string',
        title: 'Quality',
        titleKey: 'foundry.schema.field.quality.title',
        enum: ['auto', 'low', 'medium', 'high'],
        // `auto` routes to Azure's preview default pool which is
        // chronically EngineOverloaded. `low` has its own much wider
        // capacity — default there so the happy path actually completes.
        default: 'low',
        'x-ui': {
          control: 'segmented',
          group: 'generation',
          importance: 'primary',
          order: 30,
          labelKey: 'foundry.schema.field.quality.label',
        },
        'x-provider': {
          parameter: 'quality',
          transform: 'omitAuto',
        },
      },
      n: {
        type: 'integer',
        title: 'Outputs',
        titleKey: 'foundry.schema.field.outputs.title',
        minimum: 1,
        maximum: 10,
        default: 1,
        'x-ui': {
          control: 'stepper',
          group: 'generation',
          importance: 'primary',
          order: 40,
          labelKey: 'foundry.schema.field.outputs.label',
        },
        'x-provider': { parameter: 'n', omitIfDefault: true },
      },
      reference_images: {
        type: 'array',
        title: 'Reference images',
        titleKey: 'foundry.schema.field.referenceImages.title',
        description:
          'Input images for edit/reference workflows. GPT Image 2 accepts up to 16 input images.',
        descriptionKey: 'foundry.gptImage2.referenceImages.description',
        items: mediaReferenceSchema('Reference image URL'),
        maxItems: 16,
        'x-ui': {
          control: 'image_upload',
          group: 'references',
          importance: 'secondary',
          order: 50,
          accept: 'image/jpeg,image/png,image/webp',
          labelKey: 'foundry.schema.field.referenceImages.label',
        },
        'x-provider': {
          parameter: 'image',
          transform: 'mediaArrayToOpenAIImageInput',
          omitIfEmpty: true,
        },
      },
      background: {
        type: 'string',
        title: 'Background',
        titleKey: 'foundry.schema.field.background.title',
        description:
          'GPT Image 2 currently supports automatic or opaque backgrounds; transparent output is not supported.',
        descriptionKey: 'foundry.gptImage2.background.description',
        enum: ['auto', 'opaque'],
        default: 'auto',
        'x-ui': {
          control: 'segmented',
          group: 'output',
          importance: 'advanced',
          order: 60,
          labelKey: 'foundry.schema.field.background.label',
        },
        'x-provider': {
          parameter: 'background',
          transform: 'omitAuto',
          omitIfDefault: true,
        },
      },
      output_format: {
        type: 'string',
        title: 'Output format',
        titleKey: 'foundry.schema.field.outputFormat.title',
        enum: ['png', 'jpeg', 'webp'],
        default: 'png',
        'x-ui': {
          control: 'segmented',
          group: 'output',
          importance: 'secondary',
          order: 70,
          labelKey: 'foundry.schema.field.outputFormat.label',
        },
        'x-provider': { parameter: 'output_format', omitIfDefault: true },
      },
      output_compression: {
        type: 'integer',
        title: 'Compression',
        titleKey: 'foundry.schema.field.outputCompression.title',
        description: 'Compression level for jpeg or webp output.',
        descriptionKey: 'foundry.schema.field.outputCompression.description',
        minimum: 0,
        maximum: 100,
        'x-ui': {
          control: 'slider',
          group: 'output',
          importance: 'advanced',
          order: 80,
          labelKey: 'foundry.schema.field.outputCompression.label',
          visibleWhen: {
            field: 'output_format',
            operator: 'in',
            values: ['jpeg', 'webp'],
          },
          showWhen: {
            field: 'output_format',
            operator: 'in',
            values: ['jpeg', 'webp'],
          },
          enabledWhen: {
            field: 'output_format',
            operator: 'in',
            values: ['jpeg', 'webp'],
          },
        },
        'x-provider': { parameter: 'output_compression', omitIfEmpty: true },
      },
      moderation: {
        type: 'string',
        title: 'Moderation',
        titleKey: 'foundry.schema.field.moderation.title',
        enum: ['auto', 'low'],
        default: 'auto',
        'x-ui': {
          control: 'segmented',
          group: 'advanced',
          importance: 'advanced',
          order: 90,
          labelKey: 'foundry.schema.field.moderation.label',
        },
        'x-provider': {
          parameter: 'moderation',
          transform: 'omitAuto',
          omitIfDefault: true,
        },
      },
      stream: {
        type: 'boolean',
        title: 'Stream partial images',
        titleKey: 'foundry.schema.field.stream.title',
        default: false,
        'x-ui': {
          control: 'switch',
          group: 'advanced',
          importance: 'advanced',
          order: 100,
          labelKey: 'foundry.schema.field.stream.label',
        },
        'x-provider': { parameter: 'stream', omitIfDefault: true },
      },
      partial_images: {
        type: 'integer',
        title: 'Partial images',
        titleKey: 'foundry.schema.field.partialImages.title',
        description: 'Number of partial images to request for streaming.',
        descriptionKey: 'foundry.schema.field.partialImages.description',
        minimum: 0,
        maximum: 3,
        'x-ui': {
          control: 'stepper',
          group: 'advanced',
          importance: 'advanced',
          order: 110,
          labelKey: 'foundry.schema.field.partialImages.label',
          visibleWhen: { field: 'stream', operator: 'equals', value: true },
          showWhen: { field: 'stream', operator: 'equals', value: true },
          enabledWhen: { field: 'stream', operator: 'equals', value: true },
        },
        'x-provider': { parameter: 'partial_images', omitIfEmpty: true },
      },
    },
  };
}

function videoInputSchema(): FoundryInputSchema {
  return {
    type: 'object',
    required: ['prompt'],
    additionalProperties: false,
    'x-ui': {
      groups: [
        {
          id: 'prompt',
          title: 'Prompt',
          titleKey: 'foundry.schema.group.prompt.title',
          order: 10,
        },
        {
          id: 'generation',
          title: 'Generation',
          titleKey: 'foundry.schema.group.generation.title',
          order: 20,
        },
        {
          id: 'references',
          title: 'References',
          titleKey: 'foundry.schema.group.references.title',
          order: 30,
          collapsible: true,
          defaultCollapsed: true,
        },
        {
          id: 'advanced',
          title: 'Advanced',
          titleKey: 'foundry.schema.group.advanced.title',
          order: 90,
          collapsible: true,
          defaultCollapsed: true,
        },
      ],
    },
    properties: {
      prompt: promptField,
      size: {
        type: 'string',
        title: 'Size',
        titleKey: 'foundry.schema.field.size.title',
        enum: [
          '480x480',
          '480x854',
          '854x480',
          '720x720',
          '720x1280',
          '1280x720',
          '1080x1080',
          '1080x1920',
          '1920x1080',
        ],
        default: '1280x720',
        'x-ui': {
          control: 'select',
          group: 'generation',
          importance: 'primary',
          order: 20,
          labelKey: 'foundry.schema.field.size.label',
        },
        'x-provider': { parameter: 'size', omitIfDefault: false },
      },
      seconds: {
        type: 'integer',
        title: 'Duration',
        titleKey: 'foundry.schema.field.duration.title',
        minimum: 1,
        maximum: 20,
        default: 4,
        'x-ui': {
          control: 'stepper',
          group: 'generation',
          importance: 'primary',
          order: 30,
          unit: 's',
          labelKey: 'foundry.schema.field.duration.label',
        },
        'x-provider': {
          parameter: 'duration',
          transform: 'secondsToDuration',
          omitIfDefault: true,
        },
      },
      n: {
        type: 'integer',
        title: 'Variants',
        titleKey: 'foundry.schema.field.variants.title',
        minimum: 1,
        maximum: 2,
        default: 1,
        'x-ui': {
          control: 'stepper',
          group: 'generation',
          importance: 'secondary',
          order: 40,
          labelKey: 'foundry.schema.field.variants.label',
        },
        'x-provider': { parameter: 'n', omitIfDefault: true },
      },
      input_reference: {
        type: 'array',
        title: 'Reference images',
        titleKey: 'foundry.schema.field.referenceImages.title',
        items: mediaReferenceSchema('Reference image URL'),
        maxItems: 4,
        'x-ui': {
          control: 'image_upload',
          group: 'references',
          importance: 'secondary',
          order: 50,
          accept: 'image/jpeg,image/png,image/webp',
          labelKey: 'foundry.schema.field.referenceImages.label',
        },
        'x-provider': {
          parameter: 'input_reference',
          transform: 'mediaArrayToOpenAIImageInput',
          omitIfEmpty: true,
        },
      },
      seed: {
        type: 'integer',
        title: 'Seed',
        titleKey: 'foundry.schema.field.seed.title',
        minimum: 0,
        maximum: 2147483647,
        'x-ui': {
          control: 'stepper',
          group: 'advanced',
          importance: 'advanced',
          order: 90,
          labelKey: 'foundry.schema.field.seed.label',
        },
        'x-provider': { parameter: 'seed', omitIfEmpty: true },
      },
    },
  };
}

function outputSchema(type: AiJobType): FoundryOutputSchema {
  const key = type === 'image' ? 'images' : 'videos';
  return {
    type: 'object',
    additionalProperties: false,
    'x-ui': {
      groups: [
        {
          id: 'media',
          title: 'Media',
          titleKey: 'foundry.schema.group.media.title',
          order: 10,
        },
        {
          id: 'metadata',
          title: 'Metadata',
          titleKey: 'foundry.schema.group.metadata.title',
          order: 90,
          collapsible: true,
          defaultCollapsed: true,
        },
      ],
    },
    properties: {
      [key]: {
        type: 'array',
        title: type === 'image' ? 'Images' : 'Videos',
        titleKey:
          type === 'image'
            ? 'foundry.schema.output.images.title'
            : 'foundry.schema.output.videos.title',
        'x-output': {
          control: type === 'image' ? 'image_gallery' : 'video_player',
          group: 'media',
          order: 10,
          labelKey:
            type === 'image'
              ? 'foundry.schema.output.images.label'
              : 'foundry.schema.output.videos.label',
        },
        items: {
          type: 'object',
          title: type === 'image' ? 'Image' : 'Video',
          additionalProperties: false,
          required: ['url', 'storagePath'],
          properties: {
            url: { type: 'string', title: 'URL', format: 'uri' },
            storagePath: {
              type: 'string',
              title: 'Storage path',
              titleKey: 'foundry.schema.output.storagePath.title',
            },
            width: {
              type: 'integer',
              title: 'Width',
              titleKey: 'foundry.schema.output.width.title',
            },
            height: {
              type: 'integer',
              title: 'Height',
              titleKey: 'foundry.schema.output.height.title',
            },
            durationSeconds: {
              type: 'number',
              title: 'Duration',
              titleKey: 'foundry.schema.output.duration.title',
            },
            mimeType: {
              type: 'string',
              title: 'MIME type',
              titleKey: 'foundry.schema.output.mimeType.title',
            },
            bytes: {
              type: 'integer',
              title: 'Bytes',
              titleKey: 'foundry.schema.output.bytes.title',
              minimum: 0,
            },
          },
        },
      },
      provider_metadata: {
        type: 'object',
        title: 'Provider metadata',
        titleKey: 'foundry.schema.output.providerMetadata.title',
        additionalProperties: true,
        'x-output': {
          control: 'metadata',
          group: 'metadata',
          order: 90,
          labelKey: 'foundry.schema.output.providerMetadata.label',
        },
        properties: {},
      },
    },
  };
}

function gptImageProviderOutputSchema(): FoundryOutputSchema {
  return {
    type: 'object',
    title: 'OpenAI Images response',
    additionalProperties: true,
    required: ['created', 'data'],
    properties: {
      created: {
        type: 'integer',
        title: 'Created',
        description: 'Unix timestamp in seconds from the provider response.',
      },
      background: {
        type: 'string',
        title: 'Background',
        enum: ['transparent', 'opaque'],
      },
      data: {
        type: 'array',
        title: 'Generated images',
        items: {
          type: 'object',
          additionalProperties: true,
          properties: {
            b64_json: {
              type: 'string',
              title: 'Base64 image',
              description:
                'Base64-encoded image returned by GPT image models before FizzDragon uploads it to OSS.',
            },
            revised_prompt: {
              type: 'string',
              title: 'Revised prompt',
              description:
                'Provider revised prompt when supported by a model. GPT Image 2 does not currently expose this.',
            },
            url: {
              type: 'string',
              title: 'Temporary URL',
              format: 'uri',
              description:
                'URL output for legacy DALL-E models. Unsupported for GPT image models.',
            },
          },
        },
      },
      output_format: {
        type: 'string',
        title: 'Output format',
        enum: ['png', 'webp', 'jpeg'],
      },
      quality: {
        type: 'string',
        title: 'Quality',
        enum: ['low', 'medium', 'high'],
      },
      size: {
        type: 'string',
        title: 'Size',
      },
      usage: {
        type: 'object',
        title: 'Usage',
        additionalProperties: true,
        properties: {
          input_tokens: { type: 'integer', title: 'Input tokens' },
          output_tokens: { type: 'integer', title: 'Output tokens' },
          total_tokens: { type: 'integer', title: 'Total tokens' },
          input_tokens_details: {
            type: 'object',
            title: 'Input token details',
            additionalProperties: true,
            properties: {
              image_tokens: { type: 'integer', title: 'Image input tokens' },
              text_tokens: { type: 'integer', title: 'Text input tokens' },
            },
          },
          output_tokens_details: {
            type: 'object',
            title: 'Output token details',
            additionalProperties: true,
            properties: {
              image_tokens: { type: 'integer', title: 'Image output tokens' },
              text_tokens: { type: 'integer', title: 'Text output tokens' },
            },
          },
        },
      },
    },
  };
}

function gptImageStreamEventSchema(): FoundryOutputSchema {
  return {
    type: 'object',
    title: 'OpenAI image streaming event',
    additionalProperties: true,
    required: ['type'],
    properties: {
      type: {
        type: 'string',
        title: 'Event type',
        enum: ['image_generation.partial_image', 'image_generation.completed'],
      },
      b64_json: {
        type: 'string',
        title: 'Base64 image',
      },
      partial_image_index: {
        type: 'integer',
        title: 'Partial image index',
        minimum: 0,
      },
      usage: {
        type: 'object',
        title: 'Usage',
        additionalProperties: true,
        properties: {},
      },
    },
  };
}

function providerOutputSchema(
  record: FoundryDeploymentRecord,
  type: AiJobType,
): FoundryOutputSchema | undefined {
  if (type === 'image' && isGptImage2Model(record)) {
    return gptImageProviderOutputSchema();
  }
  return undefined;
}

function streamEventSchema(
  record: FoundryDeploymentRecord,
  type: AiJobType,
): FoundryOutputSchema | undefined {
  if (type === 'image' && isGptImage2Model(record)) {
    return gptImageStreamEventSchema();
  }
  return undefined;
}

function membership(
  _record: FoundryDeploymentRecord,
  type: AiJobType,
): FoundryModelDefinition['membership'] {
  // Tier gate lives with the model definition so frontend lock badges,
  // backend submit checks, and tooltip text all read from one source.
  // Override via env (e.g. `FOUNDRY_IMAGE_MIN_TIER=VIP2`) per deploy
  // without touching schema code. Set to `NONE` to open to free users.
  const envKey =
    type === 'image' ? 'FOUNDRY_IMAGE_MIN_TIER' : 'FOUNDRY_VIDEO_MIN_TIER';
  const raw = (process.env[envKey] ?? '').trim().toUpperCase();
  const defaultTier = type === 'image' ? 'VIP1' : 'VIP2';
  const value = raw || defaultTier;
  if (value === 'NONE' || value === 'FREE') return { minTier: null };
  return { minTier: value as FoundryModelDefinition['membership']['minTier'] };
}

function providerBinding(
  record: FoundryDeploymentRecord,
  type: AiJobType,
): FoundryModelDefinition['provider_binding'] {
  if (type === 'image') {
    return {
      provider: 'openai-compatible-images',
      endpoint: 'images.generate',
      apiVersion: OPENAI_API_VERSION,
      requestContentType: isGptImage2Model(record)
        ? 'multipart/form-data'
        : 'application/json',
      operationSelector: {
        field: 'reference_images',
        emptyEndpoint: 'images.generate',
        presentEndpoint: 'images.edit',
      },
      passthroughUserId: true,
    };
  }

  return {
    provider: 'openai-compatible-videos',
    endpoint: 'videos.create',
    apiVersion: OPENAI_API_VERSION,
    requestContentType: 'multipart/form-data',
    passthroughUserId: true,
  };
}

function capabilityMatrix(
  record: FoundryDeploymentRecord,
  type: AiJobType,
): FoundryCapabilityMatrix {
  if (type === 'image' && isGptImage2Model(record)) {
    return GPT_IMAGE_2_CAPABILITY_MATRIX;
  }

  if (type === 'image') {
    return {
      source: 'inferred',
      inputModalities: ['text', 'image'],
      outputModalities: ['image'],
      generationModes: ['text_to_image', 'image_to_image'],
      supportedParameters: [
        'prompt',
        'size',
        'quality',
        'n',
        'reference_images',
        'seed',
      ],
      unsupportedParameters: [],
      features: {
        customSize: false,
        streaming: false,
        transparentBackground: false,
        revisedPrompt: false,
        providerUrlOutput: false,
        base64Output: true,
        cancel: false,
      },
      limits: {
        maxOutputs: 4,
        maxReferenceImages: 4,
        maxPromptCharacters: 4000,
      },
    };
  }

  return {
    source: 'inferred',
    inputModalities: ['text', 'image'],
    outputModalities: ['video'],
    generationModes: ['text_to_video', 'image_to_video'],
    supportedParameters: [
      'prompt',
      'size',
      'seconds',
      'n',
      'input_reference',
      'seed',
    ],
    unsupportedParameters: [],
    features: {
      streaming: false,
      cancel: true,
      providerUrlOutput: true,
    },
    limits: {
      maxOutputs: 2,
      maxReferenceImages: 4,
      maxPromptCharacters: 4000,
      maxSeconds: 20,
    },
  };
}

function availability(): FoundryAvailability {
  const currentRegion = currentSiteRegion();
  const configured = executionConfigured();
  const enabled = executionEnabled();
  return {
    currentRegion,
    regions: [
      {
        region: currentRegion,
        status:
          configured && enabled
            ? 'available'
            : configured
              ? 'requires_configuration'
              : 'unavailable',
        reason:
          configured && enabled
            ? undefined
            : (disabledReason() ?? 'Foundry execution is not available.'),
        endpointEnvVars: [
          'AZURE_OPENAI_BASE_URL',
          'AZURE_FOUNDRY_MODELS_ENDPOINT',
          'AZURE_OPENAI_API_KEY',
          'AZURE_FOUNDRY_API_KEY',
          'FOUNDRY_EXECUTION_ENABLED',
        ],
      },
      {
        region: currentRegion === 'cn' ? 'global' : 'cn',
        status: 'unknown',
        reason:
          'This deployment has separate region credentials and must be discovered independently.',
      },
    ],
  };
}

function costEstimate(
  record: FoundryDeploymentRecord,
  type: AiJobType,
): FoundryCostEstimate {
  if (type === 'image' && isGptImage2Model(record)) {
    return {
      billingMode: 'token',
      currency: 'USD',
      meters: [
        {
          meter: 'text_input_tokens',
          unit: 'token',
          usagePath: 'usage.input_tokens_details.text_tokens',
        },
        {
          meter: 'image_input_tokens',
          unit: 'token',
          usagePath: 'usage.input_tokens_details.image_tokens',
        },
        {
          meter: 'image_output_tokens',
          unit: 'token',
          usagePath: 'usage.output_tokens_details.image_tokens',
        },
      ],
      pricingUrl: OPENAI_PRICING_URL,
      calculatorUrl: OPENAI_IMAGE_CALCULATOR_URL,
      supportsPreflightEstimate: false,
      finalCostSource: 'provider_usage',
    };
  }

  return {
    billingMode: 'unknown',
    currency: 'USD',
    meters: [],
    supportsPreflightEstimate: false,
    finalCostSource: 'unknown',
  };
}

function preflightEstimator(
  record: FoundryDeploymentRecord,
  type: AiJobType,
): FoundryPreflightEstimator | undefined {
  if (type === 'image' && isGptImage2Model(record)) {
    return GPT_IMAGE_2_PREFLIGHT_ESTIMATOR;
  }
  return undefined;
}

function observability(): FoundryObservabilityContract {
  return {
    requestId: {
      jobField: 'id',
      inboundHeader: 'x-request-id',
      outboundHeader: 'x-request-id',
      providerResponseHeader: 'x-request-id',
    },
    logging: {
      events: [
        'foundry.job.created',
        'foundry.job.queued',
        'foundry.provider.request',
        'foundry.provider.response',
        'foundry.oss.upload',
        'foundry.job.completed',
        'foundry.job.failed',
      ],
      redactInputFields: ['prompt', 'reference_images', 'input_reference'],
      redactProviderFields: ['b64_json', 'image', 'mask'],
    },
    metrics: [
      {
        name: 'foundry.queue_wait_ms',
        unit: 'ms',
        description: 'Time spent waiting before provider execution starts.',
      },
      {
        name: 'foundry.provider_run_ms',
        unit: 'ms',
        description: 'Provider call or provider job runtime.',
      },
      {
        name: 'foundry.output_fetch_ms',
        unit: 'ms',
        description: 'Time spent fetching provider output bytes.',
      },
      {
        name: 'foundry.oss_upload_ms',
        unit: 'ms',
        description: 'Time spent uploading generated media to OSS.',
      },
      {
        name: 'foundry.total_ms',
        unit: 'ms',
        description: 'Total job runtime from enqueue to terminal status.',
      },
      {
        name: 'foundry.provider_tokens',
        unit: 'tokens',
        description: 'Provider usage tokens reported by the response.',
      },
    ],
  };
}

@Injectable()
export class FoundrySchemaFactory {
  buildModel(record: FoundryDeploymentRecord): FoundryModelDefinition | null {
    const capability = this.inferCapability(record);
    if (capability === 'unsupported') return null;

    const type: AiJobType =
      capability === 'video_generation' ? 'video' : 'image';
    const isEnabled = executionConfigured() && executionEnabled();
    const name =
      record.displayName ??
      displayName(record.modelName || record.deployment || record.id);
    const isGptImage2 = type === 'image' && isGptImage2Model(record);
    const matrix = capabilityMatrix(record, type);

    return {
      id: `foundry/${record.deployment}`,
      provider: 'microsoft-foundry',
      deployment: record.deployment,
      modelName: record.modelName,
      modelVersion: record.modelVersion,
      publisher: record.publisher,
      source: record.source,
      capability,
      type,
      name,
      description:
        record.description ??
        `${name} deployment from Microsoft Foundry catalog.`,
      enabled: isEnabled,
      disabledReason: isEnabled ? undefined : disabledReason(),
      schemaDialect: FOUNDRY_SCHEMA_DIALECT,
      schemaVersion: FOUNDRY_SCHEMA_VERSION,
      documentation: modelDocumentation(record, type),
      capability_matrix: matrix,
      availability: availability(),
      cost_estimate: costEstimate(record, type),
      preflight_estimator: preflightEstimator(record, type),
      observability: observability(),
      capabilities:
        type === 'image'
          ? {
              textToImage: matrix.generationModes.includes('text_to_image'),
              imageToImage: matrix.generationModes.includes('image_to_image'),
              supportsSeed: matrix.supportedParameters.includes('seed'),
              supportsCancel: matrix.features.cancel,
              maxOutputs: Number(matrix.limits.maxOutputs ?? 1),
            }
          : {
              textToVideo: matrix.generationModes.includes('text_to_video'),
              imageToVideo: matrix.generationModes.includes('image_to_video'),
              supportsSeed: matrix.supportedParameters.includes('seed'),
              supportsCancel: matrix.features.cancel,
              maxOutputs: Number(matrix.limits.maxOutputs ?? 1),
            },
      queue:
        type === 'image'
          ? {
              queueName: 'foundry-image',
              globalConcurrency: intEnv('FOUNDRY_IMAGE_GLOBAL_CONCURRENCY', 3),
              perUserRunning: intEnv('FOUNDRY_PER_USER_IMAGE_RUNNING', 2),
              perUserQueued: intEnv('FOUNDRY_PER_USER_QUEUED_TOTAL', 10),
            }
          : {
              queueName: 'foundry-video',
              globalConcurrency: intEnv('FOUNDRY_VIDEO_GLOBAL_CONCURRENCY', 2),
              perUserRunning: intEnv('FOUNDRY_PER_USER_VIDEO_RUNNING', 1),
              perUserQueued: intEnv('FOUNDRY_PER_USER_QUEUED_TOTAL', 10),
            },
      membership: membership(record, type),
      input_schema:
        type === 'image' ? imageInputSchema(record) : videoInputSchema(),
      output_schema: outputSchema(type),
      provider_output_schema: providerOutputSchema(record, type),
      stream_event_schema: streamEventSchema(record, type),
      provider_binding: providerBinding(record, type),
    };
  }

  seedModels(): FoundryModelDefinition[] {
    const records: FoundryDeploymentRecord[] = [
      {
        id: 'seed-fallback:gpt-image-2',
        deployment: 'gpt-image-2',
        modelName: 'gpt-image-2',
        displayName: 'GPT Image 2',
        description:
          'Seed fallback GPT Image 2 model until Foundry catalog is configured.',
        source: 'seed-fallback',
      },
      {
        id: 'seed-fallback:sora-2',
        deployment: 'sora-2',
        modelName: 'sora-2',
        displayName: 'Sora 2',
        description:
          'Seed fallback video model until Foundry catalog is configured.',
        source: 'seed-fallback',
      },
    ];

    return records
      .map((record) => this.buildModel(record))
      .filter((model): model is FoundryModelDefinition => Boolean(model));
  }

  private inferCapability(
    record: FoundryDeploymentRecord,
  ): FoundryModelCapability {
    const override = capabilityOverride(record);
    if (override) return override;

    if (isGptImage2Model(record)) return 'image_generation';

    // MAI-Image preview deployments intentionally remain inferred until their
    // GA API contract is stable enough to model as an official capability set.
    const value = [
      record.deployment,
      record.modelName,
      record.displayName,
      record.publisher,
      record.description,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    if (includesAny(value, VIDEO_HINTS)) return 'video_generation';
    if (includesAny(value, IMAGE_HINTS)) return 'image_generation';
    return 'unsupported';
  }
}

function isGptImage2Model(record: FoundryDeploymentRecord): boolean {
  return [record.deployment, record.modelName].some(
    (value) => value && GPT_IMAGE_2_MODELS.has(value.trim().toLowerCase()),
  );
}

function currentSiteRegion(): string {
  const raw =
    process.env.NEXT_PUBLIC_SITE_REGION?.trim() ??
    process.env.SITE_REGION?.trim() ??
    process.env.FOUNDRY_SITE_REGION?.trim();
  return raw === 'cn' ? 'cn' : 'global';
}

function modelDocumentation(
  record: FoundryDeploymentRecord,
  type: AiJobType,
): FoundryDocumentationLink[] {
  if (type === 'image' && isGptImage2Model(record)) {
    return GPT_IMAGE_2_DOCUMENTATION;
  }
  return [];
}
