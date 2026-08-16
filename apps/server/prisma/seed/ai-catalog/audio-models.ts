/** Declarative canonical audio catalog. */
import type { Prisma } from '@prisma/client';
import type { AiProductPricingPolicy } from '@repo/shared';
import type { ImageModelSeed } from './image-models';

const SEED_AUDIO_PRICING: AiProductPricingPolicy = {
  mode: 'per_second_matrix',
  version: 'byteplus-seed-audio-1-0-points-v1-2026-08-13',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 1,
  defaultResolution: 'audio',
  pointsPerSecond: { audio: 14 },
  minSeconds: 1,
  maxSeconds: 120,
  defaultSeconds: 10,
  autoQuoteSeconds: 120,
  referenceImageSurchargePoints: 0,
  extraReferenceImagePoints: 0,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

const SEED_TTS_PRICING: AiProductPricingPolicy = {
  mode: 'per_character',
  version: 'byteplus-seed-tts-2-0-points-v1-2026-08-13',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 1,
  pointsPerCharacter: 0.003,
  minCharacters: 1,
  maxCharacters: 3000,
  defaultCharacters: 200,
  minimumPoints: 1,
  roundTo: 1,
};

const SEED_AUDIO_PARAMETER_POLICY = {
  promptMaxLength: 2900,
  maxAudioReferences: 3,
  maxReferenceBytes: 10485760,
  maxReferenceSeconds: 30,
  duration: { minimum: 1, maximum: 120, default: 10 },
  outputFormats: ['mp3', 'wav', 'ogg_opus'],
  sampleRates: [24000, 32000, 44100, 48000],
} as const satisfies Prisma.InputJsonObject;

const SEED_TTS_PARAMETER_POLICY = {
  promptMaxLength: 3000,
  ssmlSupported: false,
  outputFormats: ['mp3', 'ogg_opus'],
  sampleRates: [16000, 22050, 24000, 32000, 44100, 48000],
  voiceCatalogSource:
    'https://docs.byteplus.com/en/docs/byteplusvoice/voicelist',
} as const satisfies Prisma.InputJsonObject;

const AUDIO_PROVIDER_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    audio: { type: 'string', contentEncoding: 'base64' },
    duration: { type: 'number' },
    original_duration: { type: 'number' },
    subtitle: { type: 'string' },
  },
} as const satisfies Prisma.InputJsonObject;

export const AUDIO_MODELS: ImageModelSeed[] = [
  {
    slug: 'seed-audio-1-0',
    displayName: 'Seed Audio 1.0',
    family: 'audio',
    vendor: 'ByteDance',
    description:
      'Generates sound effects, ambience and musical audio from text with optional audio references.',
    modes: ['text_to_audio', 'audio_to_audio'],
    requiredPlan: null,
    cost: 140,
    parameterPolicy: SEED_AUDIO_PARAMETER_POLICY,
    productPricing: SEED_AUDIO_PRICING,
    group: 'Audio',
    sortOrder: 10,
    recommended: true,
    providers: [
      {
        provider: 'byteplus-seed-speech',
        endpointId: 'seed-audio-1.0',
        modes: ['text_to_audio', 'audio_to_audio'],
        priority: 10,
        weight: 100,
        providerInputSchema: {
          type: 'object',
          required: ['model', 'text_prompt', 'audio_config', 'watermark'],
          properties: {
            model: { const: 'seed-audio-1.0' },
            text_prompt: { type: 'string', maxLength: 3000 },
            references: { type: 'array', maxItems: 3 },
            audio_config: { type: 'object' },
            watermark: { type: 'object' },
          },
        },
        providerOutputSchema: AUDIO_PROVIDER_OUTPUT_SCHEMA,
        requestTimeoutSeconds: 180,
        catalogSnapshot: {
          service: 'BytePlus Seed Speech',
          callMode: 'sync',
          docs: [
            {
              title: 'Seed Audio 1.0 API',
              url: 'https://docs.byteplus.com/en/docs/byteplusvoice/seedaudio-01',
            },
          ],
          pricing: {
            source: 'official_dramagic_points',
            pointsPerSecond: 14,
            usdPerSecond: 0.14,
            url: 'https://docs.byteplus.com/en/docs/Dramagic/PlansPackages',
          },
        },
      },
    ],
    providerAliases: ['byteplus-seed-speech/seed-audio-1.0'],
  },
  {
    slug: 'seed-tts-2-0',
    displayName: 'Seed TTS 2.0',
    family: 'audio',
    vendor: 'ByteDance',
    description:
      'Production text-to-speech with multilingual voices and natural performance control.',
    modes: ['text_to_audio'],
    requiredPlan: null,
    cost: 1,
    parameterPolicy: SEED_TTS_PARAMETER_POLICY,
    productPricing: SEED_TTS_PRICING,
    group: 'Audio',
    sortOrder: 20,
    providers: [
      {
        provider: 'byteplus-seed-speech',
        endpointId: 'seed-tts-2.0',
        modes: ['text_to_audio'],
        priority: 10,
        weight: 100,
        providerInputSchema: {
          type: 'object',
          required: ['req_params'],
          properties: {
            req_params: {
              type: 'object',
              required: ['text', 'speaker', 'audio_params', 'additions'],
            },
          },
        },
        providerOutputSchema: {
          type: 'object',
          description: 'Newline-delimited JSON frames carrying base64 audio.',
          properties: {
            code: { type: 'integer' },
            data: { type: ['string', 'null'] },
          },
        },
        requestTimeoutSeconds: 180,
        catalogSnapshot: {
          service: 'BytePlus Seed TTS',
          resourceId: 'seed-tts-2.0',
          appKey: 'aGjiRDfUWi',
          callMode: 'streaming_sync',
          docs: [
            {
              title: 'Seed TTS 2.0 unidirectional HTTP API',
              url: 'https://docs.byteplus.com/en/docs/byteplusvoice/unidirectional_tts_http',
            },
            {
              title: 'Voice list',
              url: 'https://docs.byteplus.com/en/docs/byteplusvoice/voicelist',
            },
          ],
          pricing: {
            source: 'official_tts_billing',
            usdPerMillionCharacters: 30,
            url: 'https://docs.byteplus.com/en/docs/byteplusvoice/TTS_Billing',
          },
        },
      },
    ],
    providerAliases: ['byteplus-seed-speech/seed-tts-2.0'],
  },
];
