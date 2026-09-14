import { Injectable } from '@nestjs/common';

const boolEnv = (value: string | undefined, fallback = false): boolean => {
  if (value == null || value.trim() === '') return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new Error('MINIMAX_ENABLED must be a boolean value.');
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

export interface MiniMaxProviderConfig {
  enabled: boolean;
  apiKey: string | null;
  apiBaseUrl: string;
  requestTimeoutMs: number;
  /** Delay before first poll after create (docs recommend ~10s). */
  initialPollDelayMs: number;
}

/**
 * MiniMax Open Platform (international) video API — MiniMax-H3 / Hailuo-03.
 * Env:
 *   MINIMAX_ENABLED=true
 *   MINIMAX_API_KEY=sk-api-...
 *   MINIMAX_API_BASE_URL=https://api.minimax.io   (default)
 */
@Injectable()
export class MiniMaxConfigService {
  private readonly value: MiniMaxProviderConfig;

  constructor() {
    const apiKey =
      process.env.MINIMAX_API_KEY?.trim() ||
      process.env.MINIMAX_VIDEO_API_KEY?.trim() ||
      null;
    const enabled = boolEnv(process.env.MINIMAX_ENABLED, Boolean(apiKey));
    if (enabled && !apiKey) {
      throw new Error('MINIMAX_ENABLED=true requires MINIMAX_API_KEY.');
    }
    this.value = {
      enabled,
      apiKey,
      apiBaseUrl:
        process.env.MINIMAX_API_BASE_URL?.replace(/\/+$/, '') ||
        'https://api.minimax.io',
      requestTimeoutMs: numberEnv(
        process.env.MINIMAX_REQUEST_TIMEOUT_MS,
        120_000,
        5_000,
      ),
      initialPollDelayMs: numberEnv(
        process.env.MINIMAX_INITIAL_POLL_DELAY_MS,
        10_000,
        1_000,
      ),
    };
  }

  get config(): MiniMaxProviderConfig {
    return this.value;
  }
}
