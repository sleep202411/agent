import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { BytePlusSpeechConfigService } from './byteplus-speech-config.service';
import {
  bytePlusSpeechError,
  mapBytePlusSpeechBodyError,
  mapBytePlusSpeechHttpError,
} from './byteplus-speech-error.mapper';

export interface BytePlusAudioReference {
  audio_url: string;
  prompt?: string;
}

export interface BytePlusAudioCreationRequest {
  model: 'seed-audio-1.0';
  text_prompt: string;
  references?: BytePlusAudioReference[];
  audio_config: {
    format: 'mp3' | 'wav' | 'ogg_opus';
    sample_rate: number;
    speech_rate?: number;
    loudness_rate?: number;
    pitch?: number;
    enable_subtitle: boolean;
  };
  watermark: {
    aigc_watermark: boolean;
    aigc_metadata: {
      enable: boolean;
      content_producer: string;
      produce_id: string;
    };
  };
}

export interface BytePlusAudioCreationResponse {
  code?: number;
  message?: string;
  audio?: string;
  duration?: number;
  original_duration?: number;
  url?: string;
  subtitle?: string;
}

export interface BytePlusTtsRequest {
  user: { uid: string };
  req_params: {
    text: string;
    speaker: string;
    audio_params: {
      format: 'mp3' | 'ogg_opus' | 'pcm';
      sample_rate: number;
      bit_rate?: number;
      speech_rate?: number;
      loudness_rate?: number;
      enable_subtitle: boolean;
    };
    additions: string;
  };
}

export interface BytePlusAudioCreationResult {
  body: BytePlusAudioCreationResponse;
  status: number;
  headers: Record<string, string>;
  requestId: string;
}

export interface BytePlusTtsResult {
  audio: Buffer;
  status: number;
  headers: Record<string, string>;
  requestId: string;
}

@Injectable()
export class BytePlusSpeechClient {
  constructor(private readonly configService: BytePlusSpeechConfigService) {}

  async createAudio(
    request: BytePlusAudioCreationRequest,
    requestId: string = randomUUID(),
  ): Promise<BytePlusAudioCreationResult> {
    const response = await this.request('/tts/create', request, {
      'X-Api-Request-Id': requestId,
    });
    const raw = await response.text();
    const body = parseJson<BytePlusAudioCreationResponse>(raw);
    if (!response.ok) throw mapBytePlusSpeechHttpError(response.status, raw);
    if (typeof body.code === 'number' && body.code !== 0) {
      throw mapBytePlusSpeechBodyError(
        body.code,
        body.message ?? 'Unknown BytePlus Seed Audio error.',
        body,
      );
    }
    if (!body.audio) {
      throw bytePlusSpeechError(
        'UNKNOWN',
        'BytePlus Seed Audio completed without audio bytes.',
        'BytePlus Seed Audio returned no playable audio.',
        body,
      );
    }
    return {
      body,
      status: response.status,
      headers: responseHeaders(response.headers),
      requestId: response.headers.get('x-tt-logid') ?? requestId,
    };
  }

  async synthesizeTts(
    request: BytePlusTtsRequest,
    requestId: string = randomUUID(),
  ): Promise<BytePlusTtsResult> {
    const response = await this.request('/tts/unidirectional', request, {
      'X-Api-Resource-Id': 'seed-tts-2.0',
      'X-Api-App-Key': 'aGjiRDfUWi',
      'X-Api-Request-Id': requestId,
      Connection: 'keep-alive',
    });
    if (!response.ok) {
      throw mapBytePlusSpeechHttpError(response.status, await response.text());
    }
    const audio = await readTtsAudioStream(response);
    return {
      audio,
      status: response.status,
      headers: responseHeaders(response.headers),
      requestId: response.headers.get('x-tt-logid') ?? requestId,
    };
  }

  private async request(
    path: string,
    body: unknown,
    headers: Record<string, string>,
  ): Promise<Response> {
    const config = this.configService.config;
    if (!config.enabled || !config.apiKey) {
      throw bytePlusSpeechError(
        'PROVIDER_NOT_CONFIGURED',
        'BytePlus Seed Speech provider is disabled or missing its API key.',
        'BytePlus Seed Speech is not configured for this environment.',
      );
    }
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      config.requestTimeoutMs,
    );
    try {
      return await fetch(`${config.apiBaseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': config.apiKey,
          ...headers,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw bytePlusSpeechError(
          'PROVIDER_TIMEOUT',
          `BytePlus Seed Speech timed out after ${config.requestTimeoutMs} ms.`,
          'Audio generation timed out. Please try again.',
        );
      }
      throw bytePlusSpeechError(
        'UNKNOWN',
        `BytePlus Seed Speech request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

export async function readTtsAudioStream(response: Response): Promise<Buffer> {
  if (!response.body) {
    throw bytePlusSpeechError('UNKNOWN', 'BytePlus TTS response has no body.');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: Buffer[] = [];
  let carry = '';
  let completed = false;
  let totalBytes = 0;

  const consume = (line: string) => {
    const source = line.trim().replace(/^data:\s*/, '');
    if (!source) return;
    const frame = parseJson<Record<string, unknown>>(source);
    const code = Number(frame.code);
    if (code === 20_000_000) {
      completed = true;
      return;
    }
    if (code !== 0) {
      throw mapBytePlusSpeechBodyError(
        code,
        typeof frame.message === 'string'
          ? frame.message
          : 'Unknown BytePlus TTS stream error.',
        frame,
      );
    }
    if (typeof frame.data !== 'string' || frame.data.length === 0) return;
    const chunk = Buffer.from(frame.data, 'base64');
    totalBytes += chunk.length;
    if (totalBytes > 128 * 1024 * 1024) {
      throw bytePlusSpeechError(
        'VALIDATION_ERROR',
        'BytePlus TTS response exceeded the 128 MiB safety limit.',
      );
    }
    chunks.push(chunk);
  };

  while (true) {
    const { value, done } = await reader.read();
    carry += decoder.decode(value, { stream: !done });
    const lines = carry.split(/\r?\n/);
    carry = lines.pop() ?? '';
    for (const line of lines) consume(line);
    if (done) break;
  }
  if (carry.trim()) consume(carry);
  if (!completed) {
    throw bytePlusSpeechError(
      'UNKNOWN',
      'BytePlus TTS stream ended without its completion frame.',
    );
  }
  if (chunks.length === 0) {
    throw bytePlusSpeechError(
      'UNKNOWN',
      'BytePlus TTS stream completed without audio bytes.',
    );
  }
  return Buffer.concat(chunks);
}

function parseJson<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw bytePlusSpeechError(
      'UNKNOWN',
      `BytePlus Seed Speech returned malformed JSON: ${raw.slice(0, 500)}`,
    );
  }
}

function responseHeaders(headers: Headers): Record<string, string> {
  return Object.fromEntries(headers.entries());
}
