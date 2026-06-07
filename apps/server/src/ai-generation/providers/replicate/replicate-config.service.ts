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

export interface ReplicateProviderConfig {
  enabled: boolean;
  apiToken: string | null;
  apiBaseUrl: string;
  requestTimeoutMs: number;
  pollDelayMs: number;
  catalogRefreshMs: number;
}

@Injectable()
export class ReplicateConfigService {
  private readonly value: ReplicateProviderConfig;

  constructor() {
    this.value = {
      enabled: boolEnv(process.env.REPLICATE_ENABLED, false),
      apiToken:
        process.env.REPLICATE_API_TOKEN?.trim() ||
        process.env.REPLICATE_API_KEY?.trim() ||
        null,
      apiBaseUrl:
        process.env.REPLICATE_API_BASE_URL?.replace(/\/+$/, '') ||
        'https://api.replicate.com/v1',
      requestTimeoutMs: numberEnv(
        process.env.REPLICATE_REQUEST_TIMEOUT_MS,
        300_000,
        1_000,
      ),
      pollDelayMs: numberEnv(process.env.REPLICATE_POLL_DELAY_MS, 5_000, 1_000),
      catalogRefreshMs: numberEnv(
        process.env.REPLICATE_CATALOG_REFRESH_MS,
        15 * 60_000,
        30_000,
      ),
    };
  }

  get config(): ReplicateProviderConfig {
    return this.value;
  }
}
