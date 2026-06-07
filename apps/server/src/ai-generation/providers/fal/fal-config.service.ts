import { Injectable } from '@nestjs/common';

const boolEnv = (value: string | undefined, fallback = false): boolean => {
  if (value == null || value.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
};

const numberEnv = (
  value: string | undefined,
  fallback: number,
  min = 0,
): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return Math.floor(parsed);
};

export interface FalProviderConfig {
  enabled: boolean;
  apiKey: string | null;
  queueBaseUrl: string;
  apiBaseUrl: string;
  requestTimeoutMs: number;
  pollDelayMs: number;
  catalogRefreshMs: number;
}

@Injectable()
export class FalConfigService {
  private readonly value: FalProviderConfig;

  constructor() {
    this.value = {
      enabled: boolEnv(process.env.FAL_ENABLED, false),
      apiKey:
        process.env.FAL_API_KEY?.trim() || process.env.FAL_KEY?.trim() || null,
      queueBaseUrl:
        process.env.FAL_QUEUE_BASE_URL?.replace(/\/+$/, '') ||
        'https://queue.fal.run',
      apiBaseUrl:
        process.env.FAL_API_BASE_URL?.replace(/\/+$/, '') ||
        'https://api.fal.ai/v1',
      requestTimeoutMs: numberEnv(
        process.env.FAL_REQUEST_TIMEOUT_MS,
        300_000,
        1_000,
      ),
      pollDelayMs: numberEnv(process.env.FAL_POLL_DELAY_MS, 5_000, 1_000),
      catalogRefreshMs: numberEnv(
        process.env.FAL_CATALOG_REFRESH_MS,
        15 * 60_000,
        30_000,
      ),
    };
  }

  get config(): FalProviderConfig {
    return this.value;
  }
}
