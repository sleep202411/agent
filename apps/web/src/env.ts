/**
 * Environment variables.
 *
 * Next.js replaces `process.env.NEXT_PUBLIC_FOO` with the literal value **at build time**,
 * but only for static dot-access (not dynamic `process.env[name]`). Keep every access
 * as a literal below so client bundles carry the inlined value.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  OSS_BASE_URL: required("NEXT_PUBLIC_OSS_BASE_URL", process.env.NEXT_PUBLIC_OSS_BASE_URL),
  /** Base URL for IP project banner/avatar images (fizzdragon-banner OSS) */
  BANNER_BASE_URL: required("NEXT_PUBLIC_BANNER_BASE_URL", process.env.NEXT_PUBLIC_BANNER_BASE_URL),
  /** Base URL for user avatar images */
  USER_BASE_URL: process.env.NEXT_PUBLIC_USER_BASE_URL ?? "",
  SITE_REGION: process.env.NEXT_PUBLIC_SITE_REGION ?? "global",
  PARENT_ORIGIN: process.env.NEXT_PUBLIC_PARENT_ORIGIN ?? "",
} as const;
