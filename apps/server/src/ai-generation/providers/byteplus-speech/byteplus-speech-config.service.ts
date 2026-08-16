import { Injectable } from '@nestjs/common';

const DEFAULT_BASE_URL = 'https://voice.ap-southeast-1.bytepluses.com/api/v3';

export interface BytePlusSpeechProviderConfig {
  enabled: boolean;
  apiKey: string | null;
  apiBaseUrl: string;
  requestTimeoutMs: number;
  catalogRefreshMs: number;
}

@Injectable()
export class BytePlusSpeechConfigService {
  private readonly value: BytePlusSpeechProviderConfig;

  constructor() {
    const enabled = boolEnv(process.env.BYTEPLUS_SEED_SPEECH_ENABLED, false);
    const apiKey = process.env.BYTEPLUS_SEED_SPEECH_API_KEY?.trim() || null;
    if (enabled && !apiKey) {
      throw new Error(
        'BYTEPLUS_SEED_SPEECH_ENABLED=true requires BYTEPLUS_SEED_SPEECH_API_KEY.',
      );
    }
    this.value = {
      enabled,
      apiKey,
      apiBaseUrl:
        process.env.BYTEPLUS_SEED_SPEECH_API_BASE_URL?.replace(/\/+$/, '') ||
        DEFAULT_BASE_URL,
      requestTimeoutMs: numberEnv(
        process.env.BYTEPLUS_SEED_SPEECH_REQUEST_TIMEOUT_MS,
        180_000,
        1_000,
      ),
      catalogRefreshMs: numberEnv(
        process.env.BYTEPLUS_SEED_SPEECH_CATALOG_REFRESH_MS,
        15 * 60_000,
        30_000,
      ),
    };
  }

  get config(): BytePlusSpeechProviderConfig {
    return this.value;
  }
}

function boolEnv(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function numberEnv(
  value: string | undefined,
  fallback: number,
  min: number,
): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min
    ? Math.floor(parsed)
    : fallback;
}
