import { Injectable } from '@nestjs/common';

const boolEnv = (value: string | undefined): boolean | undefined => {
  if (value == null || value.trim() === '') return undefined;
  if (['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(value.trim().toLowerCase())) {
    return false;
  }
  return undefined;
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

export interface AgnesProviderConfig {
  enabled: boolean;
  apiKey: string | null;
  apiBaseUrl: string;
  requestTimeoutMs: number;
  pollDelayMs: number;
  catalogRefreshMs: number;
}

@Injectable()
export class AgnesConfigService {
  private readonly value: AgnesProviderConfig;

  constructor() {
    const apiKey = process.env.AGNES_API_KEY?.trim() || null;
    const explicitEnabled = boolEnv(process.env.AGNES_ENABLED);
    const enabled = explicitEnabled ?? Boolean(apiKey);

    if (enabled && !apiKey) {
      throw new Error('AGNES_ENABLED=true requires AGNES_API_KEY.');
    }

    this.value = {
      enabled,
      apiKey,
      apiBaseUrl:
        process.env.AGNES_API_BASE_URL?.replace(/\/+$/, '') ||
        process.env.AGNES_BASE_URL?.replace(/\/+$/, '') ||
        'https://apihub.agnes-ai.com',
      requestTimeoutMs: numberEnv(
        process.env.AGNES_REQUEST_TIMEOUT_MS,
        300_000,
        1_000,
      ),
      pollDelayMs: numberEnv(process.env.AGNES_POLL_DELAY_MS, 5_000, 1_000),
      catalogRefreshMs: numberEnv(
        process.env.AGNES_CATALOG_REFRESH_MS,
        15 * 60_000,
        30_000,
      ),
    };
  }

  get config(): AgnesProviderConfig {
    return this.value;
  }
}
