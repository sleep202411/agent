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

export interface BailianProviderConfig {
  enabled: boolean;
  /**
   * Send `X-DashScope-DataInspection: {"input":"disable","output":"disable"}`
   * to bypass DashScope's built-in content inspection — mirrors the Java
   * backend's 万相 video/image calls (Wan25VideoService et al.). Default true.
   * Set BAILIAN_DISABLE_DATA_INSPECTION=false per-cell to keep provider-side
   * moderation on (e.g. where platform-side moderation isn't a substitute).
   */
  disableDataInspection: boolean;
  apiKey: string | null;
  region: string;
  workspaceId: string | null;
  apiBaseUrl: string;
  requestTimeoutMs: number;
  pollDelayMs: number;
  catalogRefreshMs: number;
}

@Injectable()
export class BailianConfigService {
  private readonly value: BailianProviderConfig;

  constructor() {
    const region =
      process.env.BAILIAN_REGION?.trim() ||
      process.env.DASHSCOPE_REGION?.trim() ||
      'ap-southeast-1';
    const workspaceId =
      process.env.BAILIAN_WORKSPACE_ID?.trim() ||
      process.env.DASHSCOPE_WORKSPACE_ID?.trim() ||
      null;

    this.value = {
      enabled: boolEnv(process.env.BAILIAN_ENABLED, false),
      disableDataInspection: boolEnv(
        process.env.BAILIAN_DISABLE_DATA_INSPECTION,
        true,
      ),
      apiKey:
        process.env.DASHSCOPE_API_KEY?.trim() ||
        process.env.BAILIAN_API_KEY?.trim() ||
        null,
      region,
      workspaceId,
      apiBaseUrl:
        process.env.BAILIAN_API_BASE_URL?.replace(/\/+$/, '') ||
        process.env.DASHSCOPE_API_BASE_URL?.replace(/\/+$/, '') ||
        defaultApiBaseUrl(region, workspaceId),
      requestTimeoutMs: numberEnv(
        process.env.BAILIAN_REQUEST_TIMEOUT_MS,
        300_000,
        1_000,
      ),
      pollDelayMs: numberEnv(process.env.BAILIAN_POLL_DELAY_MS, 6_000, 1_000),
      catalogRefreshMs: numberEnv(
        process.env.BAILIAN_CATALOG_REFRESH_MS,
        15 * 60_000,
        30_000,
      ),
    };
  }

  get config(): BailianProviderConfig {
    return this.value;
  }
}

function defaultApiBaseUrl(region: string, workspaceId: string | null): string {
  const normalized = region.trim().toLowerCase();
  if (
    normalized === 'cn-beijing' ||
    normalized === 'beijing' ||
    normalized === 'cn'
  ) {
    return 'https://dashscope.aliyuncs.com/api/v1';
  }
  if (normalized === 'ap-southeast-1' && workspaceId) {
    return `https://${workspaceId}.ap-southeast-1.maas.aliyuncs.com/api/v1`;
  }
  return 'https://dashscope-intl.aliyuncs.com/api/v1';
}
