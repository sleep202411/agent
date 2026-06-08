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

export interface BytePlusProviderConfig {
  enabled: boolean;
  apiKey: string | null;
  apiBaseUrl: string;
  requestTimeoutMs: number;
  catalogRefreshMs: number;
}

@Injectable()
export class BytePlusConfigService {
  private readonly value: BytePlusProviderConfig;

  constructor() {
    this.value = {
      enabled: boolEnv(process.env.BYTEPLUS_MODELARK_ENABLED, false),
      apiKey:
        process.env.BYTEPLUS_MODELARK_API_KEY?.trim() ||
        process.env.BYTEPLUS_API_KEY?.trim() ||
        process.env.ARK_API_KEY?.trim() ||
        null,
      apiBaseUrl:
        process.env.BYTEPLUS_MODELARK_API_BASE_URL?.replace(/\/+$/, '') ||
        'https://ark.ap-southeast.bytepluses.com/api/v3',
      requestTimeoutMs: numberEnv(
        process.env.BYTEPLUS_MODELARK_REQUEST_TIMEOUT_MS,
        300_000,
        1_000,
      ),
      catalogRefreshMs: numberEnv(
        process.env.BYTEPLUS_MODELARK_CATALOG_REFRESH_MS,
        15 * 60_000,
        30_000,
      ),
    };
  }

  get config(): BytePlusProviderConfig {
    return this.value;
  }
}
