import type { ProviderGenerationContext } from '../../provider-adapter';
import type {
  BytePlusAudioCreationRequest,
  BytePlusTtsRequest,
} from './byteplus-speech-client';
import { bytePlusSpeechError } from './byteplus-speech-error.mapper';
import type { BytePlusSpeechRuntimeConfig } from './byteplus-speech-runtime';

export type BytePlusSpeechProviderRequest =
  | { kind: 'seed-audio'; body: BytePlusAudioCreationRequest }
  | {
      kind: 'seed-tts';
      body: BytePlusTtsRequest;
      outputFormat: 'mp3' | 'ogg_opus';
    };

export function mapBytePlusSpeechProviderRequest(
  runtime: BytePlusSpeechRuntimeConfig,
  input: Record<string, unknown>,
  context: ProviderGenerationContext,
): BytePlusSpeechProviderRequest {
  return runtime.executionKind === 'seed-audio'
    ? mapSeedAudio(input, context)
    : mapSeedTts(input, context);
}

export function safeBytePlusSpeechRequest(
  request: BytePlusSpeechProviderRequest,
): Record<string, unknown> {
  if (request.kind === 'seed-tts') {
    return { ...request.body, req_params: { ...request.body.req_params } };
  }
  return {
    ...request.body,
    references: request.body.references?.map((reference, index) => ({
      audio_url: `[reference-audio-${index + 1}]`,
      prompt: reference.prompt,
    })),
  };
}

export function bytePlusSpeechOutputFormat(format: string): {
  mimeType: string;
  ext: string;
} {
  if (format === 'wav') return { mimeType: 'audio/wav', ext: 'wav' };
  if (format === 'ogg_opus') return { mimeType: 'audio/ogg', ext: 'ogg' };
  return { mimeType: 'audio/mpeg', ext: 'mp3' };
}

function mapSeedAudio(
  input: Record<string, unknown>,
  context: ProviderGenerationContext,
): BytePlusSpeechProviderRequest {
  const references = mediaReferences(input.referenceAudios);
  if (references.length > 3) {
    validation('Seed Audio accepts at most three audio references.');
  }
  references.forEach((reference) => {
    assertHttpsUrl(reference.url);
    if (reference.durationSeconds == null || reference.bytes == null) {
      validation(
        'Every Seed Audio reference must include verified duration and byte-size metadata.',
      );
    }
    if (reference.durationSeconds > 30) {
      validation('Seed Audio references cannot exceed 30 seconds each.');
    }
    if (reference.bytes > 10 * 1024 * 1024) {
      validation('Seed Audio references cannot exceed 10 MB each.');
    }
  });
  const durationSeconds = boundedNumber(input.durationSeconds, 1, 120, 10);
  const format = audioFormat(input.outputFormat);
  const text = requiredText(input.prompt, 'Sound description');
  const referenceTokens = references
    .map((_, index) => `@Audio${index + 1}`)
    .filter((token) => !text.includes(token));
  const durationDirection = `Target duration: approximately ${durationSeconds} seconds.`;
  const textPrompt = [text, ...referenceTokens, durationDirection].join('\n');
  if (Array.from(textPrompt).length > 3000) {
    validation(
      'The composed Seed Audio prompt exceeds 3,000 characters. Shorten the sound description.',
    );
  }

  return {
    kind: 'seed-audio',
    body: {
      model: 'seed-audio-1.0',
      text_prompt: textPrompt,
      ...(references.length
        ? {
            references: references.map((reference) => ({
              audio_url: reference.url,
            })),
          }
        : {}),
      audio_config: {
        format,
        sample_rate: integerEnum(
          input.sampleRate,
          [24000, 32000, 44100, 48000],
          48000,
        ),
        speech_rate: boundedOptionalNumber(input.speechRate, -50, 100),
        loudness_rate: boundedOptionalNumber(input.loudnessRate, -50, 100),
        pitch: boundedOptionalNumber(input.pitch, -12, 12),
        enable_subtitle: false,
      },
      watermark: {
        aigc_watermark: false,
        aigc_metadata: {
          enable: true,
          content_producer: 'FizzDragon',
          produce_id: context.jobId,
        },
      },
    },
  };
}

function mapSeedTts(
  input: Record<string, unknown>,
  context: ProviderGenerationContext,
): BytePlusSpeechProviderRequest {
  const outputFormat = ttsFormat(input.outputFormat);
  const language = optionalText(input.language);
  const contextText = optionalText(input.contextText);
  const additions = {
    ...(contextText ? { context_texts: [contextText] } : {}),
    ...(language && language !== 'auto'
      ? { explicit_language: [language] }
      : {}),
    ...(input.pitch == null
      ? {}
      : {
          post_process: {
            pitch: boundedNumber(input.pitch, -12, 12, 0),
          },
        }),
  };
  return {
    kind: 'seed-tts',
    outputFormat,
    body: {
      user: { uid: context.userId },
      req_params: {
        text: requiredText(input.prompt, 'Script'),
        speaker: requiredText(input.speaker, 'Voice'),
        audio_params: {
          format: outputFormat,
          sample_rate: integerEnum(
            input.sampleRate,
            [16000, 22050, 24000, 32000, 44100, 48000],
            24000,
          ),
          bit_rate: 128000,
          speech_rate: boundedOptionalNumber(input.speechRate, -50, 100),
          loudness_rate: boundedOptionalNumber(input.loudnessRate, -50, 100),
          enable_subtitle: false,
        },
        additions: JSON.stringify(additions),
      },
    },
  };
}

function requiredText(value: unknown, label: string): string {
  const text = optionalText(value);
  if (text) return text;
  validation(`${label} is required.`);
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function mediaReferences(value: unknown): Array<{
  url: string;
  durationSeconds?: number;
  bytes?: number;
}> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return;
      const row = item as Record<string, unknown>;
      const url = optionalText(row.url);
      if (!url) return;
      return {
        url,
        ...(typeof row.durationSeconds === 'number' &&
        Number.isFinite(row.durationSeconds)
          ? { durationSeconds: row.durationSeconds }
          : {}),
        ...(typeof row.bytes === 'number' && Number.isFinite(row.bytes)
          ? { bytes: row.bytes }
          : {}),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

function assertHttpsUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    validation('Every audio reference must contain a valid URL.');
  }
  if (url.protocol !== 'https:') {
    validation('BytePlus audio references must use HTTPS URLs.');
  }
}

function audioFormat(
  value: unknown,
): BytePlusAudioCreationRequest['audio_config']['format'] {
  if (value === 'wav' || value === 'ogg_opus' || value === 'mp3') return value;
  return 'mp3';
}

function ttsFormat(value: unknown): 'mp3' | 'ogg_opus' {
  return value === 'ogg_opus' ? value : 'mp3';
}

function integerEnum(
  value: unknown,
  allowed: number[],
  fallback: number,
): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(number) && allowed.includes(number)
    ? number
    : fallback;
}

function boundedNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function boundedOptionalNumber(
  value: unknown,
  minimum: number,
  maximum: number,
): number | undefined {
  if (value == null || value === '') return undefined;
  return boundedNumber(value, minimum, maximum, 0);
}

function validation(message: string): never {
  throw bytePlusSpeechError('VALIDATION_ERROR', message, message);
}
