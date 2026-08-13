import { Injectable } from '@nestjs/common';

export const LEGACY_OSS_BASE_URL_ENV = 'LEGACY_OSS_BASE_URL';

/**
 * Region-owned legacy cover storage configuration.
 *
 * This value is deliberately required in every deployment cell. Falling back
 * to another region is unsafe: a valid object key can silently be resolved
 * against the wrong bucket and turn every project cover into a 404.
 */
@Injectable()
export class LegacyProjectsConfigService {
  readonly ossBaseUrl: string;

  constructor() {
    this.ossBaseUrl = resolveLegacyOssBaseUrl(process.env);
  }
}

export function resolveLegacyOssBaseUrl(env: NodeJS.ProcessEnv): string {
  const raw = env[LEGACY_OSS_BASE_URL_ENV]?.trim();
  if (!raw) {
    throw new Error(`Missing required env var: ${LEGACY_OSS_BASE_URL_ENV}`);
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw invalidLegacyOssBaseUrl();
  }

  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw invalidLegacyOssBaseUrl();
  }

  return raw.replace(/\/+$/, '');
}

function invalidLegacyOssBaseUrl(): Error {
  return new Error(
    `${LEGACY_OSS_BASE_URL_ENV} must be an absolute HTTP(S) URL without credentials, query parameters, or a fragment.`,
  );
}
