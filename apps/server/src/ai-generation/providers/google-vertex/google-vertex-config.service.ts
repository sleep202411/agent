import { Injectable } from '@nestjs/common';

const DEFAULT_REQUEST_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_CATALOG_REFRESH_MS = 15 * 60_000;
const DEFAULT_VIDEO_POLL_DELAY_MS = 15_000;

export interface GoogleVertexProviderConfig {
  enabled: boolean;
  project: string | null;
  imageLocation: string | null;
  videoLocation: string | null;
  requestTimeoutMs: number;
  catalogRefreshMs: number;
  videoPollDelayMs: number;
  mediaAllowedHosts: ReadonlySet<string>;
}

@Injectable()
export class GoogleVertexConfigService {
  private readonly value: GoogleVertexProviderConfig;

  constructor() {
    const enabled = booleanEnv('GOOGLE_VERTEX_ENABLED', false);
    const project = optionalString(process.env.GOOGLE_CLOUD_PROJECT);
    const imageLocation = optionalString(
      process.env.GOOGLE_VERTEX_IMAGE_LOCATION,
    );
    const videoLocation = optionalString(
      process.env.GOOGLE_VERTEX_VIDEO_LOCATION,
    );

    if (enabled && !project) {
      throw new Error(
        'GOOGLE_CLOUD_PROJECT is required when GOOGLE_VERTEX_ENABLED=true.',
      );
    }
    if (enabled && !imageLocation) {
      throw new Error(
        'GOOGLE_VERTEX_IMAGE_LOCATION is required when GOOGLE_VERTEX_ENABLED=true.',
      );
    }
    if (enabled && !videoLocation) {
      throw new Error(
        'GOOGLE_VERTEX_VIDEO_LOCATION is required when GOOGLE_VERTEX_ENABLED=true.',
      );
    }

    this.value = {
      enabled,
      project,
      imageLocation,
      videoLocation,
      requestTimeoutMs: integerEnv(
        'GOOGLE_VERTEX_REQUEST_TIMEOUT_MS',
        DEFAULT_REQUEST_TIMEOUT_MS,
        1_000,
      ),
      catalogRefreshMs: integerEnv(
        'GOOGLE_VERTEX_CATALOG_REFRESH_MS',
        DEFAULT_CATALOG_REFRESH_MS,
        30_000,
      ),
      videoPollDelayMs: integerEnv(
        'GOOGLE_VERTEX_VIDEO_POLL_DELAY_MS',
        DEFAULT_VIDEO_POLL_DELAY_MS,
        1_000,
      ),
      mediaAllowedHosts: mediaAllowedHosts(),
    };
  }

  get config(): GoogleVertexProviderConfig {
    return this.value;
  }
}

function booleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  throw new Error(`${name} must be a boolean value.`);
}

function integerEnv(name: string, fallback: number, minimum: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}.`);
  }
  return parsed;
}

function optionalString(value: string | undefined): string | null {
  return value?.trim() || null;
}

function mediaAllowedHosts(): ReadonlySet<string> {
  const hosts = new Set<string>();
  const urlVars = [
    'MEDIA_PUBLIC_BASE_URL_AZURE_BLOB',
    'AZURE_BLOB_PUBLIC_BASE_URL',
    'MEDIA_PUBLIC_BASE_URL_ALIYUN_OSS',
    'OSS_PUBLIC_BASE_URL',
    'MEDIA_PUBLIC_BASE_URL_S3_COMPATIBLE',
    'LEGACY_OSS_BASE_URL',
  ];
  for (const name of urlVars) {
    const raw = process.env[name]?.trim();
    if (!raw) continue;
    try {
      hosts.add(new URL(raw).hostname.toLowerCase());
    } catch {
      throw new Error(`${name} must be an absolute URL.`);
    }
  }

  for (const raw of (process.env.GOOGLE_VERTEX_MEDIA_ALLOWED_HOSTS ?? '').split(
    ',',
  )) {
    const host = raw.trim().toLowerCase();
    if (!host) continue;
    if (
      host.includes('/') ||
      host.includes(':') ||
      host.startsWith('.') ||
      host.endsWith('.')
    ) {
      throw new Error(
        'GOOGLE_VERTEX_MEDIA_ALLOWED_HOSTS must contain comma-separated hostnames only.',
      );
    }
    hosts.add(host);
  }
  return hosts;
}
