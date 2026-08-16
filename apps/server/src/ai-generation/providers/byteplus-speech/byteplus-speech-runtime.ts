import { AI_MODEL_PROTOCOL_DIALECT } from '../../types';
import type {
  AiBillingPolicy,
  AiCatalogSource,
  AiGenerationMode,
  AiInputSchema,
  AiJsonValue,
  AiModelDefinition,
  AiOutputSchema,
  AiQueuePolicy,
  AiRequiredPlan,
} from '../../types';

export const BYTEPLUS_SEED_SPEECH_PROVIDER = 'byteplus-seed-speech' as const;
export const BYTEPLUS_SEED_SPEECH_SCHEMA_VERSION = '2026-08-13.2';

export type BytePlusSpeechExecutionKind = 'seed-audio' | 'seed-tts';

export interface BytePlusSpeechRuntimeConfig {
  provider: typeof BYTEPLUS_SEED_SPEECH_PROVIDER;
  modelId: string;
  endpointId: 'seed-audio-1.0' | 'seed-tts-2.0';
  executionKind: BytePlusSpeechExecutionKind;
  name: string;
  description: string;
  generationModes: AiGenerationMode[];
  enabled: boolean;
  disabledReason?: string;
  requiredPlan: AiRequiredPlan | null;
  queue: {
    queueName: 'ai-audio-generation';
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

export const BYTEPLUS_TTS_VOICES = [
  { value: 'zh_female_vv_uranus_bigtts', label: 'Vivi · Chinese · Female' },
  {
    value: 'zh_female_xiaohe_uranus_bigtts',
    label: 'Mindy · Chinese · Female',
  },
  {
    value: 'zh_female_liuchangnv_uranus_bigtts',
    label: 'Pearl · Chinese · Female',
  },
  { value: 'zh_male_m191_uranus_bigtts', label: 'Kian · Chinese · Male' },
  { value: 'zh_male_taocheng_uranus_bigtts', label: 'Cedric · Chinese · Male' },
  { value: 'zh_male_dayi_uranus_bigtts', label: 'Magnus · Chinese · Male' },
  { value: 'zh_male_liufei_uranus_bigtts', label: 'Felix · Chinese · Male' },
  {
    value: 'en_female_stokie_uranus_bigtts',
    label: 'Stokie · English · Female',
  },
  { value: 'en_female_dacey_uranus_bigtts', label: 'Dacey · English · Female' },
  { value: 'en_male_tim_uranus_bigtts', label: 'Tim · English · Male' },
] as const;

export function bytePlusSpeechExecutionKind(
  endpointId: string,
): BytePlusSpeechExecutionKind {
  if (endpointId === 'seed-audio-1.0') return 'seed-audio';
  if (endpointId === 'seed-tts-2.0') return 'seed-tts';
  throw new Error(`Unsupported BytePlus Seed Speech endpoint: ${endpointId}.`);
}

export function createBytePlusSpeechRuntimeConfig(args: {
  modelId: string;
  endpointId: string;
  name: string;
  description: string;
  generationModes: AiGenerationMode[];
  enabled: boolean;
  disabledReason?: string;
  requiredPlan: AiRequiredPlan | null;
  globalConcurrency: number;
  perUserRunning: number;
  perUserQueued: number;
  billingPolicy: AiBillingPolicy;
  parameterPolicy?: AiJsonValue;
  outputPolicy?: AiJsonValue;
}): BytePlusSpeechRuntimeConfig {
  const executionKind = bytePlusSpeechExecutionKind(args.endpointId);
  const endpointId =
    args.endpointId as BytePlusSpeechRuntimeConfig['endpointId'];
  const queuePolicy: AiQueuePolicy = {
    queueName: 'ai-audio-generation',
    globalConcurrency: args.globalConcurrency,
    perUserRunning: args.perUserRunning,
    perUserQueued: args.perUserQueued,
    priority: 0,
    maxProviderRuntimeSeconds: executionKind === 'seed-audio' ? 300 : 180,
    maxQueueWaitSeconds: 600,
    retryPolicy: {
      maxAttempts: 3,
      retryableCodes: ['PROVIDER_429', 'PROVIDER_5XX', 'PROVIDER_TIMEOUT'],
      backoffMs: [2_000, 10_000, 30_000],
    },
  };
  return {
    provider: BYTEPLUS_SEED_SPEECH_PROVIDER,
    modelId: args.modelId,
    endpointId,
    executionKind,
    name: args.name,
    description: args.description,
    generationModes: args.generationModes,
    enabled: args.enabled,
    disabledReason: args.disabledReason,
    requiredPlan: args.requiredPlan,
    queue: {
      queueName: 'ai-audio-generation',
      globalConcurrency: args.globalConcurrency,
      perUserRunning: args.perUserRunning,
      perUserQueued: args.perUserQueued,
    },
    queuePolicy,
    billingPolicy: args.billingPolicy,
    parameterPolicy: args.parameterPolicy,
    outputPolicy: args.outputPolicy,
    inputSchema:
      executionKind === 'seed-audio'
        ? seedAudioInputSchema()
        : seedTtsInputSchema(),
    outputSchema: audioOutputSchema(),
  };
}

export function toBytePlusSpeechModelDefinition(args: {
  config: BytePlusSpeechRuntimeConfig;
  source: AiCatalogSource;
  ops: AiModelDefinition['ops'];
}): AiModelDefinition {
  const { config } = args;
  const region = process.env.NEXT_PUBLIC_SITE_REGION ?? 'global';
  const isTts = config.executionKind === 'seed-tts';
  return {
    id: config.modelId,
    provider: config.provider,
    providerModelId: config.endpointId,
    deployment: config.endpointId,
    modelName: config.endpointId,
    source: args.source,
    family: 'audio',
    generationModes: config.generationModes,
    capability: 'audio_generation',
    type: 'audio',
    name: config.name,
    description: config.description,
    enabled: config.enabled,
    disabledReason: config.disabledReason,
    schemaDialect: AI_MODEL_PROTOCOL_DIALECT,
    schemaVersion: BYTEPLUS_SEED_SPEECH_SCHEMA_VERSION,
    documentation: documentationFor(config.executionKind),
    capability_matrix: {
      source: 'official',
      inputModalities: isTts ? ['text'] : ['text', 'audio'],
      outputModalities: ['audio'],
      generationModes: config.generationModes,
      supportedParameters: Object.keys(config.inputSchema.properties),
      unsupportedParameters: isTts ? ['ssml'] : ['imageReference'],
      features: {
        voiceSelection: isTts,
        audioReference: !isTts,
        streamingTransport: isTts,
        subtitles: true,
      },
      limits: isTts
        ? { maxCharacters: 3000, maxOutputs: 1 }
        : {
            maxPromptCharacters: 3000,
            maxAudioReferences: 3,
            maxReferenceBytes: 10 * 1024 * 1024,
            maxReferenceSeconds: 30,
            maxOutputSeconds: 120,
          },
    },
    availability: {
      currentRegion: region,
      regions: [
        {
          region,
          status: config.enabled ? 'available' : 'requires_configuration',
          reason: config.disabledReason,
          endpointEnvVars: [
            'BYTEPLUS_SEED_SPEECH_ENABLED',
            'BYTEPLUS_SEED_SPEECH_API_KEY',
          ],
        },
      ],
    },
    cost_estimate: {
      billingMode: isTts ? 'credit' : 'duration',
      currency: config.billingPolicy.displayCurrency,
      meters: isTts
        ? [{ meter: 'credit', unit: 'credit' }]
        : [{ meter: 'request', unit: 'request' }],
      pricingUrl: isTts
        ? 'https://docs.byteplus.com/en/docs/byteplusvoice/TTS_Billing'
        : 'https://docs.byteplus.com/en/docs/Dramagic/PlansPackages',
      supportsPreflightEstimate: true,
      finalCostSource: config.billingPolicy.finalCostSource,
    },
    observability: {
      requestId: {
        providerResponseHeader: 'x-tt-logid',
        jobField: 'providerJobId',
      },
      logging: {
        events: [
          isTts
            ? 'byteplus.seed_tts.unidirectional'
            : 'byteplus.seed_audio.create',
        ],
        redactInputFields: ['referenceAudios'],
        redactProviderFields: ['X-Api-Key', 'audio'],
      },
      metrics: [
        {
          name: 'byteplus_seed_speech.provider_run_ms',
          unit: 'ms',
          description: 'BytePlus Seed Speech provider runtime.',
        },
      ],
    },
    capabilities: {
      textToAudio: config.generationModes.includes('text_to_audio'),
      audioToAudio: config.generationModes.includes('audio_to_audio'),
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

function seedAudioInputSchema(): AiInputSchema {
  return {
    type: 'object',
    required: ['prompt', 'durationSeconds', 'outputFormat', 'sampleRate'],
    properties: {
      prompt: {
        type: 'string',
        title: 'Sound description',
        minLength: 1,
        // The mapper appends reference tokens and a duration direction before
        // calling BytePlus, whose composed text_prompt limit is 3,000.
        maxLength: 2900,
        'x-ui': {
          control: 'textarea',
          group: 'prompt',
          order: 10,
          rows: 5,
          placeholder: 'Describe the sound, ambience, music or performance…',
        },
      },
      referenceAudios: {
        type: 'array',
        title: 'Audio references',
        maxItems: 3,
        items: {
          type: 'object',
          properties: {
            url: { type: 'string', format: 'uri', title: 'URL' },
          },
          required: ['url'],
          additionalProperties: true,
        },
        'x-ui': {
          control: 'audio_upload',
          group: 'references',
          order: 20,
          accept: 'audio/mpeg,audio/wav,audio/ogg',
          hint: 'Up to 3 references, 30 seconds and 10 MB each.',
          ...({
            mediaKind: 'audio',
            acceptFormats: ['mp3', 'wav', 'ogg'],
            maxFileSizeMb: 10,
            maxItemDurationSeconds: 30,
            maxTotalFiles: 3,
            promptRefPrefix: '@Audio',
          } as Record<string, unknown>),
        } as AiInputSchema['properties'][string]['x-ui'],
      },
      durationSeconds: {
        type: 'number',
        title: 'Duration',
        minimum: 1,
        maximum: 120,
        default: 10,
        multipleOf: 1,
        'x-ui': {
          control: 'slider',
          group: 'output',
          order: 30,
          unit: 's',
          hint: 'Target duration. Seed Audio may vary the final length.',
        },
      },
      outputFormat: {
        type: 'string',
        title: 'Format',
        enum: ['mp3', 'wav', 'ogg_opus'],
        default: 'mp3',
        'x-ui': { control: 'segmented', group: 'output', order: 40 },
      },
      sampleRate: {
        type: 'integer',
        title: 'Sample rate',
        enum: [24000, 32000, 44100, 48000],
        default: 48000,
        'x-ui': { control: 'select', group: 'advanced', order: 50, unit: 'Hz' },
      },
      speechRate: rateField('Speech rate', -50, 100, 60),
      loudnessRate: rateField('Loudness', -50, 100, 70),
      pitch: rateField('Pitch', -12, 12, 80),
    },
    additionalProperties: false,
    'x-ui': {
      groups: [
        { id: 'prompt', title: 'Create', order: 10 },
        { id: 'references', title: 'References', order: 20 },
        { id: 'output', title: 'Output', order: 30 },
        {
          id: 'advanced',
          title: 'Advanced',
          order: 40,
          collapsible: true,
          defaultCollapsed: true,
        },
      ],
    },
  };
}

function seedTtsInputSchema(): AiInputSchema {
  return {
    type: 'object',
    required: ['prompt', 'speaker', 'outputFormat', 'sampleRate'],
    properties: {
      prompt: {
        type: 'string',
        title: 'Script',
        minLength: 1,
        maxLength: 3000,
        'x-ui': {
          control: 'textarea',
          group: 'prompt',
          order: 10,
          rows: 6,
          placeholder: 'Enter the words to speak. SSML is not supported.',
        },
      },
      speaker: {
        type: 'string',
        title: 'Voice',
        enum: BYTEPLUS_TTS_VOICES.map((voice) => voice.value),
        default: BYTEPLUS_TTS_VOICES[0].value,
        'x-ui': {
          control: 'select',
          group: 'voice',
          order: 20,
          options: BYTEPLUS_TTS_VOICES.map((voice) => ({ ...voice })),
        },
      },
      contextText: {
        type: 'string',
        title: 'Context',
        maxLength: 500,
        'x-ui': {
          control: 'textarea',
          group: 'voice',
          order: 30,
          rows: 2,
          placeholder:
            'Optional surrounding dialogue for pronunciation and prosody',
        },
      },
      language: {
        type: 'string',
        title: 'Language',
        enum: ['auto', 'zh-cn', 'en', 'ja', 'es'],
        default: 'auto',
        'x-ui': { control: 'select', group: 'voice', order: 40 },
      },
      outputFormat: {
        type: 'string',
        title: 'Format',
        enum: ['mp3', 'ogg_opus'],
        default: 'mp3',
        'x-ui': { control: 'segmented', group: 'output', order: 50 },
      },
      sampleRate: {
        type: 'integer',
        title: 'Sample rate',
        enum: [16000, 22050, 24000, 32000, 44100, 48000],
        default: 24000,
        'x-ui': { control: 'select', group: 'advanced', order: 60, unit: 'Hz' },
      },
      speechRate: rateField('Speech rate', -50, 100, 70),
      loudnessRate: rateField('Loudness', -50, 100, 80),
      pitch: rateField('Pitch', -12, 12, 90),
    },
    additionalProperties: false,
    'x-ui': {
      groups: [
        { id: 'prompt', title: 'Script', order: 10 },
        { id: 'voice', title: 'Voice', order: 20 },
        { id: 'output', title: 'Output', order: 30 },
        {
          id: 'advanced',
          title: 'Advanced',
          order: 40,
          collapsible: true,
          defaultCollapsed: true,
        },
      ],
    },
  };
}

function rateField(
  title: string,
  minimum: number,
  maximum: number,
  order: number,
) {
  return {
    type: 'number' as const,
    title,
    minimum,
    maximum,
    default: 0,
    multipleOf: 1,
    'x-ui': {
      control: 'slider' as const,
      group: 'advanced',
      order,
    },
  };
}

function audioOutputSchema(): AiOutputSchema {
  return {
    type: 'object',
    required: ['outputs'],
    properties: {
      outputs: {
        type: 'array',
        items: {
          type: 'object',
          required: ['url', 'mimeType'],
          properties: {
            url: { type: 'string', format: 'uri' },
            mimeType: { type: 'string' },
            durationSeconds: { type: 'number' },
          },
          additionalProperties: false,
        },
        'x-output': { control: 'audio_player', order: 10 },
      },
    },
    additionalProperties: false,
  };
}

function documentationFor(
  kind: BytePlusSpeechExecutionKind,
): AiModelDefinition['documentation'] {
  return kind === 'seed-audio'
    ? [
        {
          title: 'Seed Audio 1.0 API',
          url: 'https://docs.byteplus.com/en/docs/byteplusvoice/seedaudio-01',
          source: 'official',
          scope: 'api_reference',
          provider: BYTEPLUS_SEED_SPEECH_PROVIDER,
        },
      ]
    : [
        {
          title: 'Seed TTS 2.0 unidirectional HTTP API',
          url: 'https://docs.byteplus.com/en/docs/byteplusvoice/unidirectional_tts_http',
          source: 'official',
          scope: 'api_reference',
          provider: BYTEPLUS_SEED_SPEECH_PROVIDER,
        },
        {
          title: 'Seed TTS voice list',
          url: 'https://docs.byteplus.com/en/docs/byteplusvoice/voicelist',
          source: 'official',
          scope: 'model',
          provider: BYTEPLUS_SEED_SPEECH_PROVIDER,
        },
      ];
}
